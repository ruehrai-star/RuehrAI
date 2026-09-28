import type { Session } from "./api/types";

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

export function readStoredSession(): Session | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedSession;
  cachedRaw = raw;
  if (!raw) {
    cachedSession = null;
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    cachedSession = isSession(parsed) ? parsed : null;
  } catch {
    cachedSession = null;
  }
  return cachedSession;
}

export function writeStoredSession(session: Session | null): void {
  if (typeof window === "undefined") return;
  if (!session) {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } else {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  cachedRaw = window.sessionStorage.getItem(STORAGE_KEY);
  cachedSession = session;
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeSession(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
