import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseStoredSession, sessionIsCurrent } from "./session-storage.ts";

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
  assert.match(source, /sessionIsCurrent/);
  assert.match(source, /expiresAt/);
  assert.match(source, /writeStoredSession\(null\)/);
  assert.match(source, /location\.assign\("\/login"\)/);
});

test("a session whose expiresAt is in the past is treated as signed out", () => {
  const now = Date.parse("2026-10-06T12:00:00.000Z");
  assert.equal(sessionIsCurrent({ ...session, expiresAt: "2026-10-06T11:59:59.000Z" }, now), false);
  assert.equal(sessionIsCurrent({ ...session, expiresAt: "2026-10-06T12:00:00.000Z" }, now), false);
  assert.equal(sessionIsCurrent({ ...session, expiresAt: "2026-10-06T12:00:01.000Z" }, now), true);
  assert.equal(sessionIsCurrent({ ...session, expiresAt: "not-a-date" }, now), false);
  const reader = readFileSync(new URL("./session-storage.ts", import.meta.url), "utf8");
  const readFn = reader.slice(reader.indexOf("export function readStoredSession"), reader.indexOf("export function writeStoredSession"));
  assert.match(readFn, /sessionIsCurrent/);
  assert.match(readFn, /writeStoredSession\(null\)/);
});
