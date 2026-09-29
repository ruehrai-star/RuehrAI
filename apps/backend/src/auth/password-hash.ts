import { BadRequestException } from "@nestjs/common";
import bcrypt from "bcryptjs";

/** Same cost `gen_salt('bf', 10)` used when hashes were created in Postgres. */
const BCRYPT_COST = 10;

/**
 * bcrypt hash stored in `app.users.password_hash`.
 * `$2a$` is what pgcrypto `bf` writes. `$2b$` is what this process writes.
 * Both verify here, so existing rows keep working without `crypt()`.
 */
export async function hashPassword(password: string): Promise<string> {
  assertBcryptPassword(password);
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, passwordHash: string): Promise<boolean> {
  if (password.includes("\0") || !isBcryptHash(passwordHash)) return false;
  try {
    return await bcrypt.compare(password, passwordHash);
  } catch {
    return false;
  }
}

function assertBcryptPassword(password: string): void {
  if (password.includes("\0") || bcrypt.truncates(password)) {
    throw new BadRequestException("Password must be at most 72 bytes");
  }
}

function isBcryptHash(hash: string): boolean {
  return hash.length === 60 && /^\$2[aby]\$\d{2}\$/.test(hash);
}
