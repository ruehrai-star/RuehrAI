import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { DatabaseService } from "../database/database.service";
import { isUniqueViolation } from "../database/pg-error";
import { TOKEN_TTL_SECONDS } from "./auth.constants";
import { TokenResponse, UserResponse } from "./auth.types";
import { CredentialsDto } from "./dto";

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
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
    });
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
