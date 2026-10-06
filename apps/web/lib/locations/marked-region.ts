import type { TargetRegion } from "../api/types.ts";
import { ensureMarkedKey } from "./regions.ts";

const STORAGE_KEY = "ruehrai.markedRegion";
const CHANGE_EVENT = "ruehrai-marked-region";
const QUERY = "region";

/**
 * Persist the marked Zielregion across pages and tabs.
 * #71 kept the mark in per-page React state, so navigation reset it to the
 * first saved row. localStorage plus a `storage` event keeps the same key
 * on Standorte, Verlauf, Empfehlungen, Karte, and Musteranalyse.
 */

function trimKey(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readUrlKey(): string | null {
  if (typeof window === "undefined") return null;
  return trimKey(new URLSearchParams(window.location.search).get(QUERY));
}

export function readMarkedKey(): string | null {
  if (typeof window === "undefined") return null;
  return readUrlKey() ?? trimKey(window.localStorage.getItem(STORAGE_KEY));
}

export function writeMarkedKey(key: string | null): void {
  if (typeof window === "undefined") return;
  const next = trimKey(key);
  if (!next) window.localStorage.removeItem(STORAGE_KEY);
  else window.localStorage.setItem(STORAGE_KEY, next);
  syncUrl(next);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function syncUrl(key: string | null): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const current = trimKey(url.searchParams.get(QUERY));
  if (current === key) return;
  if (key) url.searchParams.set(QUERY, key);
  else url.searchParams.delete(QUERY);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function subscribeMarkedKey(onChange: () => void): () => void {
  const onCustom = () => onChange();
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY || event.key === null) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onCustom);
  window.addEventListener("storage", onStorage);
  window.addEventListener("popstate", onCustom);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onCustom);
    window.removeEventListener("storage", onStorage);
    window.removeEventListener("popstate", onCustom);
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

/** Marked catalog key for a loaded list: stored key if it is still in the list. */
export function persistedMarkedKey(items: readonly TargetRegion[], stored: string | null): string | null {
  return ensureMarkedKey(items, stored);
}
