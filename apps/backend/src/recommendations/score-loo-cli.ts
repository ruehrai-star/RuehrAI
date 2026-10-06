import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadLocalEnv } from "../database/load-local-env";
import {
  LooFixture,
  extractLooFixtureFromPayload,
  isLooFixture,
  withFixtureValueKeyHygiene,
} from "./score-loo-fixture";
import {
  DEFAULT_LOO_USER_ID,
  LooStageOptions,
  createLooStageDeps,
  createReadOnlyLooDb,
  createReadOnlyLooPool,
  loadLooFromDatabase,
} from "./score-loo-stage";
import { LeaveOneOutStore, assertEnoughLooStores, evaluateLeaveOneOut, formatLeaveOneOutMarkdown } from "./score-loo";
import { RecommendationPayload } from "./types";

export interface LooCliArgs {
  fixture?: string;
  out?: string;
  userId: string;
  runId?: string;
  extractPayload?: string;
}

export interface LooCliIo {
  env?: NodeJS.Dict<string>;
  loadFixtureFile?: (path: string) => Promise<unknown>;
  loadStage?: (options: LooStageOptions) => Promise<LooFixture>;
  writeOut?: (dir: string, files: { markdown: string; json: string }) => Promise<void>;
  stdout?: { write: (chunk: string) => void };
}

const USAGE = [
  "STAGE leave-one-out (read-only). Never writes. Failure = calibration, not PROD.",
  "",
  "  pnpm --filter @ruehrai/backend score:loo -- --fixture <json> --out <dir>",
  "  SCORE_LOO_DATABASE_URL=… pnpm --filter @ruehrai/backend score:loo -- --out <dir>",
  "  SCORE_LOO_DATABASE_URL=… pnpm --filter @ruehrai/backend score:loo -- --user-id 2 --run-id <id> --out <dir>",
  "",
  "Aborts when fewer than 3 stores (LOO_TOO_FEW_STORES).",
  "",
].join("\n");

export function parseLooArgs(argv: string[]): LooCliArgs {
  const out: LooCliArgs = { userId: DEFAULT_LOO_USER_ID };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    const next = argv[index + 1];
    if (token === "--fixture" && next) {
      out.fixture = next;
      index += 1;
    } else if (token === "--out" && next) {
      out.out = next;
      index += 1;
    } else if ((token === "--user-id" || token === "--userId") && next) {
      out.userId = next;
      index += 1;
    } else if ((token === "--run-id" || token === "--runId") && next) {
      out.runId = next;
      index += 1;
    } else if (token === "--extract-payload" && next) {
      out.extractPayload = next;
      index += 1;
    }
  }
  return out;
}

export async function runScoreLoo(
  argv: string[],
  io: LooCliIo = {},
): Promise<{ passed: boolean; fixture: LooFixture }> {
  loadLocalEnv();
  const args = parseLooArgs(argv);
  const env = io.env ?? process.env;
  const databaseUrl = env.SCORE_LOO_DATABASE_URL?.trim();
  if (!args.fixture && !args.extractPayload && !databaseUrl) {
    (io.stdout ?? process.stdout).write(USAGE);
    return {
      passed: true,
      fixture: { targetRegionGeoKey: "", stores: [], pool: [], yearly: [], criteria: [] },
    };
  }

  const loaded = args.fixture
    ? await readFixture(args.fixture, io)
    : args.extractPayload
      ? await extractFromPayloadFile(args.extractPayload, io)
      : await loadStageFixture(databaseUrl!, args, io);
  const fixture = withFixtureValueKeyHygiene(loaded);

  assertEnoughLooStores(fixture.stores);
  const byKey = new Map<string, LooFixture["yearly"]>();
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
  const stampLines = fixture.targetRegionStampNote
    ? ["", fixture.targetRegionStampNote, `targetRegionGeoKey: ${fixture.targetRegionGeoKey}`, ""]
    : [];
  const markdown = `${formatLeaveOneOutMarkdown(report)}${stampLines.length > 0 ? stampLines.join("\n") : ""}`;
  const json = `${JSON.stringify(
    {
      ...report,
      targetRegionGeoKey: fixture.targetRegionGeoKey,
      targetRegionStampNote: fixture.targetRegionStampNote,
    },
    null,
    2,
  )}\n`;
  if (args.out) {
    if (io.writeOut) {
      await io.writeOut(resolve(args.out), { markdown, json });
    } else {
      const dir = resolve(args.out);
      await mkdir(dir, { recursive: true });
      await writeFile(resolve(dir, "loo-report.md"), markdown, "utf8");
      await writeFile(resolve(dir, "loo-report.json"), json, "utf8");
    }
  } else {
    (io.stdout ?? process.stdout).write(markdown);
  }
  if (!report.passed) process.exitCode = 1;
  return { passed: report.passed, fixture };
}

async function readFixture(path: string, io: LooCliIo): Promise<LooFixture> {
  const raw = io.loadFixtureFile ? await io.loadFixtureFile(path) : JSON.parse(await readFile(resolve(path), "utf8"));
  if (!isLooFixture(raw)) {
    throw Object.assign(new Error("loo fixture JSON is missing stores, pool, yearly, or criteria"), {
      code: "LOO_BAD_FIXTURE",
    });
  }
  return raw;
}

async function extractFromPayloadFile(path: string, io: LooCliIo): Promise<LooFixture> {
  const raw = io.loadFixtureFile ? await io.loadFixtureFile(path) : JSON.parse(await readFile(resolve(path), "utf8"));
  if (!raw || typeof raw !== "object") {
    throw Object.assign(new Error("extract payload is not a JSON object"), { code: "LOO_BAD_FIXTURE" });
  }
  const record = raw as { payload?: RecommendationPayload; stores?: LeaveOneOutStore[] } & Partial<RecommendationPayload>;
  const payload = (record.payload ?? record) as RecommendationPayload;
  const stores = Array.isArray(record.stores) ? record.stores : [];
  return extractLooFixtureFromPayload({ payload, stores });
}

async function loadStageFixture(databaseUrl: string, args: LooCliArgs, io: LooCliIo): Promise<LooFixture> {
  const options: LooStageOptions = { userId: args.userId, runId: args.runId };
  if (io.loadStage) return io.loadStage(options);
  const pool = createReadOnlyLooPool(databaseUrl);
  try {
    const db = createReadOnlyLooDb(pool);
    return await loadLooFromDatabase(createLooStageDeps(db), options);
  } finally {
    await pool.end();
  }
}

export function looExitCode(error: unknown): number {
  const code = error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : "";
  return code === "LOO_TOO_FEW_STORES" ? 2 : 1;
}
