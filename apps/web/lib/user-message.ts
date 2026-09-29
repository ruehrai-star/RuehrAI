import { ApiError } from "./api/types.ts";

export function errorText(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.message) return error.message;
  return fallback;
}

export function authErrorMessage(error: unknown, action: "login" | "register"): string {
  if (error instanceof ApiError) {
    if (error.status === 401) return "E-Mail oder Passwort ist ungültig.";
    if (error.status === 409) return "Diese E-Mail ist bereits registriert.";
    if (error.status === 400) return "Die Angaben sind ungültig.";
    if (error.status === 502) return "Die Antwort des Backends ist ungültig.";
    if (error.message) return error.message;
  }
  return action === "login" ? "Anmeldung fehlgeschlagen." : "Registrierung fehlgeschlagen.";
}
