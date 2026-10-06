/**
 * Read-only leave-one-out calibration. Never writes. Failure is calibration,
 * not PROD. Does not change score weights, thresholds, or minActiveDatasets.
 *
 * Fixture (valueKey hygiene applied on load):
 *   pnpm --filter @ruehrai/backend score:loo -- --fixture ./loo-fixture.json --out ./loo-out
 *
 * STAGE (read-only, live YearlySeries so valueKey is preserved):
 *   SCORE_LOO_DATABASE_URL=… pnpm --filter @ruehrai/backend score:loo -- --out ./loo-out
 *   SCORE_LOO_DATABASE_URL=… pnpm --filter @ruehrai/backend score:loo -- --user-id 2 --run-id 64 --out ./loo-out
 */
import { looExitCode, runScoreLoo } from "../src/recommendations/score-loo-cli";

runScoreLoo(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "leave-one-out failed"}\n`);
  process.exit(looExitCode(error));
});
