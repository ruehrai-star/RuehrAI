import { ApiError, NetworkError } from "./api/types.ts";
import { LOGIN_EXPIRED_COPY } from "./session-storage.ts";

/** OpenAPI `ErrorResponse.code` on POST /analysis/runs for an unknown/foreign mark. */
export const MARKED_TARGET_REGION_NOT_FOUND_CODE = "marked_target_region_not_found";

export const USER_MESSAGE_COPY = {
  invalidInput: "Bitte prüfen Sie Ihre Eingabe.",
  sessionExpired: LOGIN_EXPIRED_COPY,
  forbidden: "Sie haben keine Berechtigung für diese Aktion.",
  notFound: "Der Eintrag wurde nicht gefunden.",
  conflict: "Der Vorgang steht im Konflikt mit dem aktuellen Stand.",
  tooManyRequests: "Zu viele Anfragen. Bitte versuchen Sie es später erneut.",
  serverUnavailable: "Der Dienst ist gerade nicht verfügbar. Bitte versuchen Sie es später erneut.",
  network: "Die Verbindung zum Backend ist fehlgeschlagen.",
  markedTargetRegionMissing: "Diese Zielregion ist nicht mehr gespeichert. Bitte wählen Sie sie neu.",
  loginInvalid: "E-Mail oder Passwort ist ungültig.",
  registerDuplicate: "Diese E-Mail ist bereits registriert.",
  invalidDetails: "Die Angaben sind ungültig.",
  invalidBackend: "Die Antwort des Backends ist ungültig.",
  loginFailed: "Anmeldung fehlgeschlagen.",
  registerFailed: "Registrierung fehlgeschlagen.",
} as const;

const KNOWN_CODE_COPY: Record<string, string> = {
  [MARKED_TARGET_REGION_NOT_FOUND_CODE]: USER_MESSAGE_COPY.markedTargetRegionMissing,
};

function copyForKnownCode(code?: string | null): string | null {
  if (typeof code !== "string") return null;
  const trimmed = code.trim();
  return trimmed ? (KNOWN_CODE_COPY[trimmed] ?? null) : null;
}

function copyForStatus(status: number): string | null {
  if (status === 400 || status === 422) return USER_MESSAGE_COPY.invalidInput;
  if (status === 401) return USER_MESSAGE_COPY.sessionExpired;
  if (status === 403) return USER_MESSAGE_COPY.forbidden;
  if (status === 404) return USER_MESSAGE_COPY.notFound;
  if (status === 409) return USER_MESSAGE_COPY.conflict;
  if (status === 429) return USER_MESSAGE_COPY.tooManyRequests;
  if (status >= 500 && status <= 599) return USER_MESSAGE_COPY.serverUnavailable;
  if (status === 0) return USER_MESSAGE_COPY.network;
  return null;
}

/** Dedicated German for a known backend `code`, or null when the code is unknown. */
export function messageForKnownApiCode(code?: string | null): string | null {
  return copyForKnownCode(code);
}

/**
 * User-visible text for API failures. Never returns `ApiError.message`
 * (often English). Known `code` values win; otherwise status; otherwise
 * the caller’s German fallback for this context.
 */
export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const fromCode = copyForKnownCode(error.code);
    if (fromCode) return fromCode;
    if (error.code) return fallback;
    const fromStatus = copyForStatus(error.status);
    if (fromStatus) return fromStatus;
    if (error instanceof NetworkError) return USER_MESSAGE_COPY.network;
  }
  return fallback;
}

export function authErrorMessage(error: unknown, action: "login" | "register"): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return USER_MESSAGE_COPY.loginInvalid;
    if (error.status === 409) return USER_MESSAGE_COPY.registerDuplicate;
    if (error.status === 400 || error.status === 422) return USER_MESSAGE_COPY.invalidDetails;
    if (error.status === 502) return USER_MESSAGE_COPY.invalidBackend;
    if (error.status === 0 || error instanceof NetworkError) return USER_MESSAGE_COPY.network;
  }
  return action === "login" ? USER_MESSAGE_COPY.loginFailed : USER_MESSAGE_COPY.registerFailed;
}
