import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { QueryResultRow } from "pg";
import { DatabaseService } from "../database/database.service";
import { isForeignKeyViolation, isTransientConnectionError, isUniqueViolation } from "../database/pg-error";
import { TOKEN_TTL_SECONDS } from "./auth.constants";
import { AuthUser, TokenResponse, UserResponse } from "./auth.types";
import { CredentialsDto } from "./dto";

/** One try plus two retries. Backoff stays short so a flap does not sit on the client. */
const AUTH_DB_RETRIES = 2;
const AUTH_DB_BACKOFF_MS = [100, 200];

const JTI =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UserRow {
  id: string;
  email: string;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: CredentialsDto): Promise<TokenResponse> {
    const result = await this.queryUsers<UserRow>(
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
      const result = await this.queryUsers<UserRow>(
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
   * Login and register only. A dropped or timed-out pool connection is retried.
   * Still failing is 503, not a client error and not an opaque 500.
   */
  private async queryUsers<T extends QueryResultRow>(
    text: string,
    params: unknown[],
  ): Promise<{ rows: T[] }> {
    let last: unknown;
    for (let attempt = 0; attempt <= AUTH_DB_RETRIES; attempt += 1) {
      try {
        return await this.db.query<T>(text, params);
      } catch (error) {
        last = error;
        if (!isTransientConnectionError(error) || attempt === AUTH_DB_RETRIES) break;
        this.logger.warn(
          `Database connection failed during auth; retrying (${attempt + 1}/${AUTH_DB_RETRIES})`,
        );
        await delay(AUTH_DB_BACKOFF_MS[attempt] ?? 200);
      }
    }
    if (isTransientConnectionError(last)) {
      this.logger.error(`Database connection failed during auth (${connectionErrorText(last)})`);
      throw new ServiceUnavailableException("Database temporarily unavailable");
    }
    throw last;
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

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function connectionErrorText(error: unknown): string {
  const parts: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 3 && current instanceof Error; depth += 1) {
    parts.push(current.message);
    current = "cause" in current ? (current as { cause: unknown }).cause : undefined;
  }
  return parts.join("; ") || "unknown";
}
