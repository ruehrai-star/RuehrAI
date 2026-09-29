import assert from "node:assert/strict";
import { test } from "node:test";
import { parseStoredSession } from "./session-storage.ts";

const session = {
  accessToken: "jwt",
  tokenType: "Bearer" as const,
  expiresAt: "2026-09-29T12:00:00.000Z",
  email: "dev@ruehrai.local",
};

test("stored session parses only a complete JWT record", () => {
  assert.deepEqual(parseStoredSession(JSON.stringify(session)), session);
  assert.equal(parseStoredSession(null), null);
  assert.equal(parseStoredSession(""), null);
  assert.equal(parseStoredSession("{"), null);
  assert.equal(parseStoredSession(JSON.stringify({ ...session, accessToken: 1 })), null);
  assert.equal(parseStoredSession(JSON.stringify({ email: session.email })), null);
});
