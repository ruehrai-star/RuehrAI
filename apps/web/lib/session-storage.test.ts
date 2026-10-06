import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("the session store is localStorage plus a storage event, not sessionStorage-only", () => {
  const source = readFileSync(new URL("./session-storage.ts", import.meta.url), "utf8");
  assert.match(source, /localStorage/);
  assert.match(source, /addEventListener\("storage"/);
  assert.match(source, /sessionStorage\.removeItem/);
});
