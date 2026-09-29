import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DatabaseService } from "../database/database.service";
import { isForeignKeyViolation, isUniqueViolation } from "../database/pg-error";
import { TOKEN_TTL_SECONDS } from "./auth.constants";
import { AuthUser, TokenResponse, UserResponse } from "./auth.types";
import { CredentialsDto } from "./dto";

const JTI =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UserRow {
  id: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: CredentialsDto): Promise<TokenResponse> {
    const result = await this.db.query<UserRow>(
      `SELECT id::text AS id, email
       FROM app.users
       WHERE email = $1
         AND password_hash = crypt($2, password_hash)`,
      [normalizeEmail(dto.email), dto.password],
    );
    const user = result.rows[0];
    if (!user) {
      throw new UnauthorizedException("Invalid email or password");
    }
    return this.issueToken(user);
  }

  async register(dto: CredentialsDto): Promise<TokenResponse> {
    try {
      const result = await this.db.query<UserRow>(
        `INSERT INTO app.users (email, password_hash)
         VALUES ($1, crypt($2, gen_salt('bf', 10)))
         RETURNING id::text AS id, email`,
        [normalizeEmail(dto.email), dto.password],
      );
      const user = result.rows[0];
      if (!user) {
        throw new UnauthorizedException();
      }
      return this.issueToken(user);
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException("Email already registered");
      }
      throw error;
    }
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
