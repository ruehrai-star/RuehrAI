export interface AuthUser {
  id: string;
  email: string;
}

export interface JwtPayload {
  sub: string;
  email?: string;
}

export interface TokenResponse {
  accessToken: string;
  tokenType: "Bearer";
  expiresIn: number;
}

export interface UserResponse {
  id: string;
  email: string;
}
