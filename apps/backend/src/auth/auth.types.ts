export interface AuthUser {
  id: string;
  email: string;
  /** Present on tokens issued with a `jti` claim. Logout revokes this id. */
  jti?: string;
  /** Access-token expiry as seconds since epoch. */
  exp?: number;
}

export interface JwtPayload {
  sub: string;
  email?: string;
  jti?: string;
  exp?: number;
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
