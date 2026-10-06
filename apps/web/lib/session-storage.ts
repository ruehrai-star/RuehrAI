import type { Session } from "./api/types.ts";

const STORAGE_KEY = "ruehrai.session";
const CHANGE_EVENT = "ruehrai-session";

let cachedRaw: string | null = null;
let cachedSession: Session | null = null;

function isSession(value: unknown): value is Session {
  if (!value || typeof value !== "object") return false;
  const session = value as Partial<Session>;
  return (
    typeof session.accessToken === "string" &&
    session.tokenType === "Bearer" &&
    typeof session.expiresAt === "string" &&
    typeof session.email === "string"
  );
}

export function parseStoredSession(raw: string | null): Session | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** `expiresAt` in the past or unreadable counts as signed out. */
export function sessionIsCurrent(session: Session, now = Date.now()): boolean {
  const expires = Date.parse(session.expiresAt);
  return Number.isFinite(expires) && expires > now;
}

const LOGIN_PATHS = new Set(["/login", "/register"]);

/**
 * Drop the stored JWT and send this tab to `/login`. Other tabs pick up
 * `null` via the `storage` event. Login/register stay put.
 */
export function clearStoredSessionAndGoToLogin(): void {
  writeStoredSession(null);
  if (typeof window === "undefined") return;
  if (LOGIN_PATHS.has(window.location.pathname)) return;
  // Fetch interceptor is not a React event handler; a full navigation
  // drops in-memory UI that still thinks the JWT is valid.
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign("/login");
}

/**
 * JWT lives in localStorage so a second tab stays signed in.
 * The Backend issues the token in the JSON body (no httpOnly cookie).
 * Logout writes null here; other tabs pick that up on the `storage` event.
 * A leftover sessionStorage value from older builds is migrated once.
 */
function readRaw(): string | null {
  if (typeof window === "undefined") return null;
  const local = window.localStorage.getItem(STORAGE_KEY);
  if (local) return local;
  const previous = window.sessionStorage.getItem(STORAGE_KEY);
  if (previous) {
    window.localStorage.setItem(STORAGE_KEY, previous);
    window.sessionStorage.removeItem(STORAGE_KEY);
    return previous;
  }
  return null;
}

export function readStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = readRaw();
  if (raw === cachedRaw) {
    if (cachedSession && !sessionIsCurrent(cachedSession)) {
      writeStoredSession(null);
      return null;
    }
    return cachedSession;
  }
  cachedRaw = raw;
  const parsed = parseStoredSession(raw);
  if (parsed && !sessionIsCurrent(parsed)) {
    writeStoredSession(null);
    return null;
  }
  cachedSession = parsed;
  return cachedSession;
}

export function writeStoredSession(session: Session | null): void {
  if (typeof window === "undefined") return;
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    window.sessionStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    window.sessionStorage.removeItem(STORAGE_KEY);
  }
  cachedRaw = window.localStorage.getItem(STORAGE_KEY);
  cachedSession = session;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeSession(onChange: () => void): () => void {
  const onCustom = () => onChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) {
      cachedRaw = null;
      cachedSession = null;
      onChange();
    }
  };
  window.addEventListener(CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
  };
}
