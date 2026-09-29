import { BadRequestException } from "@nestjs/common";
import { hashPassword, verifyPassword } from "./password-hash";

/** Postgres pgcrypto: crypt('dev-password', '$2a$10$N9qo8uLOickgx2ZMRZoMye'). */
const PGCRYPTO_DEV_PASSWORD =
  "$2a$10$N9qo8uLOickgx2ZMRZoMyeJEtDi7qhSZ9VeeKHIWmKtBPkWAhxUMC";

describe("password hash", () => {
  it("verifies a pgcrypto $2a$ hash and a hash from this process", async () => {
    await expect(verifyPassword("dev-password", PGCRYPTO_DEV_PASSWORD)).resolves.toBe(true);
    await expect(verifyPassword("other-password", PGCRYPTO_DEV_PASSWORD)).resolves.toBe(false);

    const stored = await hashPassword("dev-password");
    expect(stored).toMatch(/^\$2[ab]\$10\$/);
    await expect(verifyPassword("dev-password", stored)).resolves.toBe(true);
  });

  it("rejects passwords bcrypt would truncate or that contain a NUL", async () => {
    await expect(hashPassword("ä".repeat(40))).rejects.toBeInstanceOf(BadRequestException);
    await expect(hashPassword("secret-\0-pass")).rejects.toBeInstanceOf(BadRequestException);
    await expect(verifyPassword("secret-\0-pass", PGCRYPTO_DEV_PASSWORD)).resolves.toBe(false);
  });

  it("does not throw when the stored hash is corrupt", async () => {
    await expect(verifyPassword("dev-password", "not-a-hash")).resolves.toBe(false);
    await expect(verifyPassword("dev-password", "")).resolves.toBe(false);
  });
});
