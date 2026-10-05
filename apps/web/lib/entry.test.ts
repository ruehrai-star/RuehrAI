import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RuehrApi } from "./api/client.ts";
import {
  ENTRY_COPY,
  MAP_HREF,
  STANDORTE_HREF,
  VERLAUF_HREF,
  hasSavedLocations,
  resolveSignedInEntryHref,
  signedInEntryHref,
} from "./entry.ts";
import { POST_STANDORTE_HREF } from "./verlauf/model.ts";

function api(partial: {
  stores?: unknown[] | Error;
  regions?: unknown[] | Error;
}): Pick<RuehrApi, "listStores" | "listTargetRegions"> {
  return {
    async listStores() {
      if (partial.stores instanceof Error) throw partial.stores;
      return (partial.stores ?? []) as Awaited<ReturnType<RuehrApi["listStores"]>>;
    },
    async listTargetRegions() {
      if (partial.regions instanceof Error) throw partial.regions;
      return (partial.regions ?? []) as Awaited<ReturnType<RuehrApi["listTargetRegions"]>>;
    },
  };
}

test("root and login send accounts with locations to Verlauf", () => {
  assert.equal(VERLAUF_HREF, "/verlauf");
  assert.equal(VERLAUF_HREF, POST_STANDORTE_HREF);
  assert.equal(STANDORTE_HREF, "/standorte");
  assert.equal(MAP_HREF, "/karte");
  assert.notEqual(MAP_HREF, "/");
  assert.equal(signedInEntryHref(true), "/verlauf");
  assert.equal(signedInEntryHref(false), "/standorte");
  assert.equal(hasSavedLocations({ length: 1 }), true);
  assert.equal(hasSavedLocations({ length: 0 }, { length: 1 }), true);
  assert.equal(hasSavedLocations({ length: 0 }, { length: 0 }), false);
});

test("resolveSignedInEntryHref uses GET /stores and GET /target-region", async () => {
  assert.equal(await resolveSignedInEntryHref(api({ stores: [{ id: "s1" }] })), "/verlauf");
  assert.equal(await resolveSignedInEntryHref(api({ regions: [{ geoKey: "plz5:12247" }] })), "/verlauf");
  assert.equal(await resolveSignedInEntryHref(api({})), "/standorte");
  assert.equal(await resolveSignedInEntryHref(api({ stores: new Error("down") })), "/verlauf");
});

test("Karte lives at /karte; login and / share the entry helper", () => {
  const root = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const karte = readFileSync(new URL("../app/karte/page.tsx", import.meta.url), "utf8");
  const header = readFileSync(new URL("../components/app-header.tsx", import.meta.url), "utf8");
  const login = readFileSync(new URL("../components/login-form.tsx", import.meta.url), "utf8");
  const register = readFileSync(new URL("../components/register-form.tsx", import.meta.url), "utf8");
  const panel = readFileSync(new URL("../components/signed-in-panel.tsx", import.meta.url), "utf8");
  const placeholder = readFileSync(new URL("../components/placeholder-page.tsx", import.meta.url), "utf8");
  assert.match(root, /HomeGate/);
  assert.equal(root.includes("MapPage"), false);
  assert.match(karte, /MapPage/);
  assert.match(header, /href: "\/karte", label: "Karte"/);
  assert.match(header, /href: "\/verlauf", label: "Verlauf"/);
  assert.match(header, /href: "\/standorte"/);
  assert.match(login, /resolveSignedInEntryHref/);
  assert.match(register, /resolveSignedInEntryHref/);
  assert.match(panel, /MAP_HREF/);
  assert.match(placeholder, /MAP_HREF/);
  assert.match(ENTRY_COPY.redirecting, /Weiterleitung/);
});
