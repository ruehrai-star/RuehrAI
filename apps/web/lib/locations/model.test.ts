import assert from "node:assert/strict";
import { test } from "node:test";
import {
  draftsForPoints,
  formatMonthName,
  formatMonthNumber,
  formatRevenueInput,
  parseRevenueInput,
  revenueYears,
  rowsForYear,
  toTargetRegionWrite,
  validateStoreDraft,
} from "./model.ts";

test("revenue years cover the last three calendar years", () => {
  assert.deepEqual(revenueYears(new Date("2026-09-15T12:00:00Z")), [2024, 2025, 2026]);
  assert.equal(formatMonthNumber(1), "01");
  assert.equal(formatMonthName(1), "Januar");
});

test("revenue input treats empty as missing and zero as a value", () => {
  assert.equal(parseRevenueInput("  "), null);
  assert.equal(parseRevenueInput("0"), 0);
  assert.equal(parseRevenueInput("12,50"), 12.5);
  assert.equal(parseRevenueInput("1.234,50"), 1234.5);
  assert.equal(parseRevenueInput("5.000"), 5000);
  assert.equal(parseRevenueInput("5.000,50"), 5000.5);
  assert.equal(parseRevenueInput("5000"), 5000);
  assert.equal(parseRevenueInput("5000,5"), 5000.5);
  assert.equal(parseRevenueInput("12.345"), 12345);
  assert.equal(parseRevenueInput("1.234.567,89"), 1234567.89);
  assert.equal(parseRevenueInput("-1"), "invalid");
  assert.equal(parseRevenueInput("abc"), "invalid");
  assert.equal(parseRevenueInput("5.000,50,1"), "invalid");
  assert.equal(parseRevenueInput("12,345"), "invalid");
  assert.equal(parseRevenueInput("12.34"), "invalid");
});

test("revenue display formatting round-trips German thousands separators", () => {
  assert.equal(formatRevenueInput(5000), "5.000");
  assert.equal(parseRevenueInput("5.000"), 5000);
  assert.equal(parseRevenueInput(formatRevenueInput(5000)), 5000);
  const parsed = parseRevenueInput("5.000");
  assert.equal(typeof parsed === "number" ? formatRevenueInput(parsed) : parsed, "5.000");
  assert.equal(formatRevenueInput(1234.5), "1.234,5");
  assert.equal(parseRevenueInput(formatRevenueInput(1234.5)), 1234.5);
});

test("formatted saved revenue stays valid in the year grid", () => {
  const saved = [{ year: 2026, month: 1, revenueEur: 5000, updatedAt: "2026-02-01T00:00:00.000Z" }];
  const drafts = draftsForPoints(saved);
  assert.equal(drafts["2026-01"], "5.000");
  const rows = rowsForYear(2026, saved, drafts);
  assert.equal(rows[0]?.invalid, false);
  assert.equal(rows[0]?.missing, false);
  assert.equal(rows[0]?.revenueEur, 5000);
});

test("a year grid marks gaps, keeps zero, and shows Jahr plus Monat", () => {
  const saved = [
    { year: 2026, month: 1, revenueEur: 10, updatedAt: "2026-02-01T00:00:00.000Z" },
    { year: 2026, month: 2, revenueEur: 0, updatedAt: "2026-03-01T00:00:00.000Z" },
  ];
  const rows = rowsForYear(2026, saved, draftsForPoints(saved));
  assert.equal(rows.length, 12);
  assert.equal(rows[0]?.year, 2026);
  assert.equal(rows[0]?.monthNumber, "01");
  assert.equal(rows[0]?.missing, false);
  assert.equal(rows[1]?.missing, false);
  assert.equal(rows[1]?.revenueEur, 0);
  assert.equal(rows[2]?.month, 3);
  assert.equal(rows[2]?.missing, true);
  assert.equal(rows.filter((row) => row.missing).length, 10);
});

test("an edited empty month stays missing and invalid text is rejected", () => {
  const saved = [{ year: 2026, month: 4, revenueEur: 80, updatedAt: "2026-05-01T00:00:00.000Z" }];
  const invalid = rowsForYear(2026, saved, { "2026-04": "abc" });
  assert.equal(invalid[3]?.invalid, true);
  assert.equal(invalid[3]?.missing, false);

  const cleared = rowsForYear(2026, saved, { "2026-04": "" });
  assert.equal(cleared[3]?.missing, true);
  assert.equal(cleared[3]?.revenueEur, null);
});

test("store drafts and region hits map onto the contract", () => {
  assert.equal(
    validateStoreDraft({ label: " Nord ", street: "Weg 1", postalCode: "80331", city: "München" }),
    null,
  );
  assert.match(
    validateStoreDraft({ label: "", street: "Weg 1", postalCode: "80331", city: "München" }) ?? "",
    /Bezeichnung/,
  );
  assert.match(
    validateStoreDraft({ label: "Nord", street: "Weg 1", postalCode: "8033", city: "München" }) ?? "",
    /PLZ/,
  );
  assert.deepEqual(
    toTargetRegionWrite({
      id: "1",
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      lon: 11.5,
      lat: 48.1,
    }),
    {
      label: "München",
      grain: "ags",
      geoKey: "09162000",
      ags: "09162000",
      plz: null,
      lon: 11.5,
      lat: 48.1,
    },
  );
  assert.equal(
    toTargetRegionWrite({ id: "2", label: "80331", grain: "plz5", geoKey: "80331", lon: null, lat: null }).plz,
    "80331",
  );
});
