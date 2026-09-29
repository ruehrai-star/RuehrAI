import { getApi } from "../api/index.ts";
import type { RuehrApi } from "../api/client.ts";

/**
 * Empfehlungen through `RuehrApi` / `@ruehrai/api-contracts`.
 * The browser calls only the Backend. It does not call oMLX.
 */
export function getRecommendationApi(): RuehrApi {
  return getApi();
}
