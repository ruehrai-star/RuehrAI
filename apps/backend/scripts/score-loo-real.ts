/**
 * Read-only leave-one-out calibration. Never writes. Do not run against STAGE
 * in this PR — PREPARE only. Failure is calibration, not PROD.
 *
 * Fixture:
 *   pnpm --filter @ruehrai/backend score:loo -- --fixture ./loo-fixture.json --out ./loo-out
 *
 * STAGE (later, read-only):
 *   SCORE_LOO_DATABASE_URL=… pnpm --filter @ruehrai/backend score:loo -- --out ./loo-out
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { AreaCandidate } from "../src/recommendations/area-candidates";
import { PatternCriterion } from "../src/analysis/types";
import { YearlySeries } from "../src/analysis/yearly-series";
import {
  LeaveOneOutStore,
  assertEnoughLooStores,
  evaluateLeaveOneOut,
  formatLeaveOneOutMarkdown,
} from "../src/recommendations/score-loo";

interface LooFixture {
  targetRegionGeoKey: string;
  stores: LeaveOneOutStore[];
  pool: AreaCandidate[];
  yearly: YearlySeries[];
  criteria: PatternCriterion[];
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.fixture && !process.env.SCORE_LOO_DATABASE_URL?.trim()) {
    process.stdout.write(
      [
        "STAGE leave-one-out (read-only). Never writes. Failure = calibration, not PROD.",
        "",
        "  pnpm --filter @ruehrai/backend score:loo -- --fixture <json> --out <dir>",
        "  SCORE_LOO_DATABASE_URL=… pnpm --filter @ruehrai/backend score:loo -- --out <dir>",
        "",
        "Aborts when fewer than 3 stores. This PR only prepares the command; do not run it on STAGE.",
        "",
      ].join("\n"),
    );
    return;
  }
  if (!args.fixture) {
    throw Object.assign(new Error("SCORE_LOO_DATABASE_URL is set but STAGE load is not wired in this PR (PREPARE only)."), {
      code: "LOO_STAGE_NOT_WIRED",
    });
  }
  const fixture = JSON.parse(await readFile(resolve(args.fixture), "utf8")) as LooFixture;
  assertEnoughLooStores(fixture.stores);
  const byKey = new Map<string, YearlySeries[]>();
  for (const series of fixture.yearly) {
    const list = byKey.get(series.requestedGeoKey) ?? [];
    list.push(series);
    byKey.set(series.requestedGeoKey, list);
  }
  const report = evaluateLeaveOneOut({
    stores: fixture.stores,
    pool: fixture.pool,
    yearlyFor: (geoKeys) => geoKeys.flatMap((key) => byKey.get(key) ?? []),
    criteria: fixture.criteria,
    targetRegionGeoKey: fixture.targetRegionGeoKey,
  });
  const markdown = formatLeaveOneOutMarkdown(report);
  const json = `${JSON.stringify(report, null, 2)}\n`;
  if (args.out) {
    const dir = resolve(args.out);
    await mkdir(dir, { recursive: true });
    await writeFile(resolve(dir, "loo-report.md"), markdown, "utf8");
    await writeFile(resolve(dir, "loo-report.json"), json, "utf8");
  } else {
    process.stdout.write(markdown);
  }
  if (!report.passed) process.exitCode = 1;
}

function parseArgs(argv: string[]): { fixture?: string; out?: string } {
  const out: { fixture?: string; out?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--fixture" && next) {
      out.fixture = next;
      index += 1;
    } else if (token === "--out" && next) {
      out.out = next;
      index += 1;
    }
  }
  return out;
}

main().catch((error: unknown) => {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  process.stderr.write(`${error instanceof Error ? error.message : "leave-one-out failed"}\n`);
  process.exit(code === "LOO_TOO_FEW_STORES" ? 2 : 1);
});
