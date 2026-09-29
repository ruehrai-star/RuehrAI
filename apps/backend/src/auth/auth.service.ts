import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DatabaseService } from "../database/database.service";
import {
  isCheckViolation,
  isForeignKeyViolation,
  isUniqueViolation,
  pgErrorSummary,
} from "../database/pg-error";
import { TOKEN_TTL_SECONDS } from "./auth.constants";
import { AuthUser, TokenResponse, UserResponse } from "./auth.types";
import { CredentialsDto } from "./dto";
import { hashPassword, verifyPassword } from "./password-hash";

const JTI =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UserRow {
  id: string;
  email: string;
}

interface LoginRow extends UserRow {
  password_hash: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: CredentialsDto): Promise<TokenResponse> {
    let user: LoginRow | undefined;
    try {
      const result = await this.db.query<LoginRow>(
        `SELECT id::text AS id, email, password_hash
         FROM app.users
         WHERE email = $1`,
        [normalizeEmail(dto.email)],
      );
      user = result.rows[0];
    } catch (error) {
      this.logger.error(
        `login failed (${pgErrorSummary(error)})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
    if (!user || !(await verifyPassword(dto.password, user.password_hash))) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.issueToken(user);
  }

  async register(dto: CredentialsDto): Promise<TokenResponse> {
    const passwordHash = await hashPassword(dto.password);
    let user: UserRow | undefined;
    try {
      const result = await this.db.query<UserRow>(
        `INSERT INTO app.users (email, password_hash)
         VALUES ($1, $2)
         RETURNING id::text AS id, email`,
        [normalizeEmail(dto.email), passwordHash],
      );
      user = result.rows[0];
    } catch (error) {
      if (error instanceof HttpException) throw error;
      if (isUniqueViolation(error)) {
        throw new ConflictException("Email already registered");
      }
      if (isCheckViolation(error)) {
        this.logger.warn(`register rejected by check constraint (${pgErrorSummary(error)})`);
        throw new BadRequestException("Invalid email or password");
      }
      this.logger.error(
        `register failed (${pgErrorSummary(error)})`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
    }
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.issueToken(user);
  }

  /**
   * Revoke the presented access token until its `exp`.
   * Slice-1 stays JWT-only: there is no server session. Logout records the
   * token `jti` in `app.revoked_tokens`. Clients should also drop the token.
   */
  async logout(user: AuthUser): Promise<void> {
    if (!user.jti || !JTI.test(user.jti) || typeof user.exp !== "number") {
      throw new BadRequestException("Token cannot be revoked");
    }
    try {
      await this.db.query(
        `INSERT INTO app.revoked_tokens (jti, user_id, expires_at)
         VALUES ($1::uuid, $2::bigint, to_timestamp($3))
         ON CONFLICT (jti) DO NOTHING`,
        [user.jti, user.id, user.exp],
      );
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new UnauthorizedException();
      }
      throw error;
    }
    await this.db.query(
      `DELETE FROM app.revoked_tokens WHERE expires_at <= now()`,
    );
  }

  async isRevoked(jti: string): Promise<boolean> {
    if (!JTI.test(jti)) return false;
    const result = await this.db.query(
      `SELECT 1
       FROM app.revoked_tokens
       WHERE jti = $1::uuid
         AND expires_at > now()`,
      [jti],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async me(userId: string): Promise<UserResponse> {
    const result = await this.db.query<UserRow>(
      `SELECT id::text AS id, email
       FROM app.users
       WHERE id = $1::bigint`,
      [userId],
    );
    const user = result.rows[0];
    if (!user) {
      throw new UnauthorizedException();
    }
    return user;
  }

  private async issueToken(user: UserRow): Promise<TokenResponse> {
    const accessToken = await this.jwt.signAsync(
      {
        sub: user.id,
        email: user.email,
      },
      { jwtid: randomUUID() },
    );
    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: TOKEN_TTL_SECONDS,
    };
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
