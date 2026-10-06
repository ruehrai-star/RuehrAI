import assert from "node:assert/strict";
import { test } from "node:test";
import { clearMarkedKey, isUnresolvedMarkedKey, persistedMarkedKey, readMarkedKey, withMarkedRegionHref, writeMarkedKey } from "./marked-region.ts";
import { regionListKey } from "./regions.ts";
import type { TargetRegion } from "../api/types.ts";

function region(partial: Pick<TargetRegion, "label" | "geoKey">): TargetRegion {
  return {
    grain: null,
    lon: null,
    lat: null,
    bounds: null,
    geometry: null,
    updatedAt: "2026-10-06T12:00:00.000Z",
    ...partial,
  };
}

const tempelhof = region({ label: "Tempelhof", geoKey: "ortsteil:osm:162894" });
const innenstadt = region({ label: "Innenstadt", geoKey: "stadtbezirk:koeln:innenstadt" });

test("persisted mark survives a list reload and does not fall back to the first row", () => {
  const items = [innenstadt, tempelhof];
  assert.equal(persistedMarkedKey(items, regionListKey(tempelhof)), regionListKey(tempelhof));
  assert.equal(persistedMarkedKey(items, null), regionListKey(innenstadt));
  assert.equal(persistedMarkedKey([], "ortsteil:osm:162894"), null);
});

test("an unknown stored or URL key does not silently become another saved Zielregion", () => {
  const items = [innenstadt, tempelhof];
  assert.equal(persistedMarkedKey(items, "ortsteil:osm:999999999"), null);
  assert.equal(persistedMarkedKey(items, "999999999"), null);
  assert.equal(isUnresolvedMarkedKey(items, "ortsteil:osm:999999999"), true);
  assert.equal(isUnresolvedMarkedKey(items, "999999999"), true);
  assert.equal(isUnresolvedMarkedKey(items, regionListKey(tempelhof)), false);
  assert.equal(isUnresolvedMarkedKey(items, null), false);
  assert.equal(isUnresolvedMarkedKey([], "ortsteil:osm:999999999"), false);
});

test("nav hrefs carry the marked catalog key", () => {
  assert.equal(withMarkedRegionHref("/empfehlungen", "ortsteil:osm:162894"), "/empfehlungen?region=ortsteil%3Aosm%3A162894");
  assert.equal(withMarkedRegionHref("/verlauf#zielregion", "ortsteil:osm:162894"), "/verlauf?region=ortsteil%3Aosm%3A162894#zielregion");
  assert.equal(withMarkedRegionHref("/karte", null), "/karte");
});

test("clearing a stale mark does not fall back to the first saved row until the user picks again", () => {
  withBrowser(() => {
    writeMarkedKey(regionListKey(tempelhof));
    assert.equal(readMarkedKey(), regionListKey(tempelhof));
    clearMarkedKey();
    assert.equal(readMarkedKey(), null);
    assert.equal(persistedMarkedKey([innenstadt, tempelhof], readMarkedKey()), null);
    assert.equal(isUnresolvedMarkedKey([innenstadt, tempelhof], readMarkedKey()), true);
    writeMarkedKey(regionListKey(innenstadt));
    assert.equal(persistedMarkedKey([innenstadt, tempelhof], readMarkedKey()), regionListKey(innenstadt));
    assert.equal(isUnresolvedMarkedKey([innenstadt, tempelhof], readMarkedKey()), false);
  });
});

test("an unknown region query is unresolved and is not replaced by Innenstadt", () => {
  withBrowser({ search: "?region=ortsteil%3Aosm%3A999999999" }, () => {
    assert.equal(readMarkedKey(), "ortsteil:osm:999999999");
    const items = [innenstadt, tempelhof];
    assert.equal(persistedMarkedKey(items, readMarkedKey()), null);
    assert.equal(isUnresolvedMarkedKey(items, readMarkedKey()), true);
    clearMarkedKey();
    assert.equal(readMarkedKey(), null);
    assert.equal(persistedMarkedKey(items, readMarkedKey()), null);
    assert.equal(withMarkedRegionHref("/empfehlungen", readMarkedKey()), "/empfehlungen");
  });
});

function withBrowser<T>(run: () => T): T;
function withBrowser<T>(options: { search: string }, run: () => T): T;
function withBrowser<T>(optionsOrRun: { search: string } | (() => T), maybeRun?: () => T): T {
  const options = typeof optionsOrRun === "function" ? { search: "?region=ortsteil%3Aosm%3A162894" } : optionsOrRun;
  const run = typeof optionsOrRun === "function" ? optionsOrRun : (maybeRun as () => T);
  const search = options.search.startsWith("?") || options.search.length === 0 ? options.search : `?${options.search}`;
  const local = new Map<string, string>();
  const session = new Map<string, string>();
  const location = {
    href: `http://app.test/empfehlungen${search}`,
    search,
    pathname: "/empfehlungen",
    hash: "",
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: (key: string) => local.get(key) ?? null,
        setItem: (key: string, value: string) => {
          local.set(key, value);
        },
        removeItem: (key: string) => {
          local.delete(key);
        },
      },
      sessionStorage: {
        getItem: (key: string) => session.get(key) ?? null,
        setItem: (key: string, value: string) => {
          session.set(key, value);
        },
        removeItem: (key: string) => {
          session.delete(key);
        },
      },
      location,
      history: {
        state: null,
        replaceState(_state: unknown, _unused: string, url: string) {
          const next = new URL(url, "http://app.test");
          location.pathname = next.pathname;
          location.search = next.search;
          location.hash = next.hash;
          location.href = next.toString();
        },
      },
      dispatchEvent() {
        return true;
      },
    },
  });
  try {
    return run();
  } finally {
    if (previous) Object.defineProperty(globalThis, "window", previous);
    else delete (globalThis as { window?: unknown }).window;
  }
}
