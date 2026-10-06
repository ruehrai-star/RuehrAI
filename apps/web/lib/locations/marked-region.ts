import type { TargetRegion } from "../api/types.ts";
import { ensureMarkedKey } from "./regions.ts";

const STORAGE_KEY = "ruehrai.markedRegion";
const CLEARED_KEY = "ruehrai.markedRegion.cleared";
const CHANGE_EVENT = "ruehrai-marked-region";
const QUERY = "region";

/**
 * Persist the marked Zielregion across pages and tabs.
 * #71 kept the mark in per-page React state, so navigation reset it to the
 * first saved row. localStorage plus a `storage` event keeps the same key
 * on Standorte, Verlauf, Empfehlungen, Karte, and Musteranalyse.
 */

function browserWindow(): Window | undefined {
  const value = (globalThis as { window?: Window }).window;
  return value;
}

function trimKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readUrlKey(): string | null {
  const win = browserWindow();
  if (!win) return null;
  return trimKey(new URLSearchParams(win.location.search).get(QUERY));
}

export function readMarkedKey(): string | null {
  const win = browserWindow();
  if (!win) return null;
  return readUrlKey() ?? trimKey(win.localStorage.getItem(STORAGE_KEY));
}

export function writeMarkedKey(key: string | null): void {
  const win = browserWindow();
  if (!win) return;
  const next = trimKey(key);
  if (next) clearHeldEmptyMark();
  if (!next) win.localStorage.removeItem(STORAGE_KEY);
  else win.localStorage.setItem(STORAGE_KEY, next);
  syncUrl(next);
  win.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Drop a stale mark so POST /analysis/runs cannot loop on a missing geoKey. */
export function clearMarkedKey(): void {
  if (!browserWindow()) return;
  holdEmptyMark();
  writeMarkedKey(null);
}

function syncUrl(key: string | null): void {
  const win = browserWindow();
  if (!win) return;
  const url = new URL(win.location.href);
  const current = trimKey(url.searchParams.get(QUERY));
  if (current === key) return;
  if (key) url.searchParams.set(QUERY, key);
  else url.searchParams.delete(QUERY);
  win.history.replaceState(win.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function subscribeMarkedKey(onChange: () => void): () => void {
  const win = browserWindow();
  if (!win) return () => undefined;
  const onCustom = () => onChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  win.addEventListener(CHANGE_EVENT, onCustom);
  win.addEventListener("storage", onStorage);
  win.addEventListener("popstate", onCustom);
  return () => {
    win.removeEventListener(CHANGE_EVENT, onCustom);
    win.removeEventListener("storage", onStorage);
    win.removeEventListener("popstate", onCustom);
  };
}

export function withMarkedRegionHref(href: string, key: string | null): string {
  const marked = trimKey(key);
  if (!marked) return href;
  const [path, hash] = href.split("#");
  const url = new URL(path || href, "http://same-origin.invalid");
  url.searchParams.set(QUERY, marked);
  const search = url.search;
  return `${url.pathname}${search}${hash ? `#${hash}` : ""}`;
}

function holdEmptyMark(): void {
  const win = browserWindow();
  if (!win) return;
  try {
    win.sessionStorage.setItem(CLEARED_KEY, "1");
  } catch {
    // sessionStorage can throw in private mode.
  }
}

function clearHeldEmptyMark(): void {
  const win = browserWindow();
  if (!win) return;
  try {
    win.sessionStorage.removeItem(CLEARED_KEY);
  } catch {
    // sessionStorage can throw in private mode.
  }
}

function isEmptyMarkHeld(): boolean {
  const win = browserWindow();
  if (!win) return false;
  try {
    return win.sessionStorage.getItem(CLEARED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Marked catalog key for a loaded list: stored key if it is still in the list. */
export function persistedMarkedKey(items: readonly TargetRegion[], stored: string | null): string | null {
  if (!stored && isEmptyMarkHeld()) return null;
  return ensureMarkedKey(items, stored);
}
