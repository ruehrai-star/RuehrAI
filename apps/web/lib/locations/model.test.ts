import assert from "node:assert/strict";
import { test } from "node:test";
import {
  draftsFromSaved,
  formatMonthLabel,
  monthKeys,
  parseRevenueInput,
  regionDraftFromHit,
  rowsForMonths,
  validateStoreDraft,
} from "./model.ts";

test("month keys run oldest to newest in UTC", () => {
  assert.deepEqual(monthKeys(3, new Date("2026-09-15T12:00:00Z")), ["2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(monthKeys(2, new Date("2026-01-01T00:00:00Z")), ["2025-12", "2026-01"]);
  assert.match(formatMonthLabel("2026-01"), /Januar 2026/);
});

test("revenue input treats empty as missing and zero as a value", () => {
  assert.equal(parseRevenueInput("  "), null);
  assert.equal(parseRevenueInput("0"), 0);
  assert.equal(parseRevenueInput("12,50"), 12.5);
  assert.equal(parseRevenueInput("1.234,50"), 1234.5);
  assert.equal(parseRevenueInput("-1"), "invalid");
  assert.equal(parseRevenueInput("12.345"), "invalid");
});

test("month rows mark gaps and keep zero", () => {
  const rows = rowsForMonths(
    ["2026-01", "2026-02", "2026-03"],
    [
      { month: "2026-01", revenueEur: 10 },
      { month: "2026-02", revenueEur: 0 },
    ],
    draftsFromSaved(["2026-01", "2026-02", "2026-03"], [
      { month: "2026-01", revenueEur: 10 },
      { month: "2026-02", revenueEur: 0 },
    ]),
  );
  assert.equal(rows[0]?.missing, false);
  assert.equal(rows[1]?.missing, false);
  assert.equal(rows[1]?.revenueEur, 0);
  assert.equal(rows[2]?.missing, true);
  assert.equal(rows[2]?.revenueEur, null);
});

test("an edited empty month stays missing and invalid text is rejected", () => {
  const rows = rowsForMonths(
    ["2026-04"],
    [{ month: "2026-04", revenueEur: 80 }],
    { "2026-04": "abc" },
  );
  assert.equal(rows[0]?.invalid, true);
  assert.equal(rows[0]?.missing, false);

  const cleared = rowsForMonths(
    ["2026-04"],
    [{ month: "2026-04", revenueEur: 80 }],
    { "2026-04": "" },
  );
  assert.equal(cleared[0]?.missing, true);
  assert.equal(cleared[0]?.revenueEur, null);
});

test("store drafts and region hits", () => {
  assert.equal(validateStoreDraft({ name: " Nord ", street: "Weg 1", postalCode: "80331", city: "München" }), null);
  assert.match(validateStoreDraft({ name: "", street: "Weg 1", postalCode: "80331", city: "München" }) ?? "", /Bezeichnung/);
  assert.match(validateStoreDraft({ name: "Nord", street: "Weg 1", postalCode: "8033", city: "München" }) ?? "", /PLZ/);
  assert.deepEqual(
    regionDraftFromHit({
      id: "1",
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      lon: 11.5,
      lat: 48.1,
    }),
    { label: "München", grain: "ags", geoKey: "09162000", lon: 11.5, lat: 48.1 },
  );
});
