import { getApi } from "../api/index.ts";
import type { RuehrApi } from "../api/client.ts";

/**
 * Musteranalyse through `RuehrApi` / `@ruehrai/api-contracts`.
 * The browser calls only the Backend analysis routes. It does not call
 * `/recommendations` or oMLX.
 */
export function getAnalysisApi(): RuehrApi {
  return getApi();
}
