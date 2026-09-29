import { getApi } from "../api/index.ts";
import type { RuehrApi } from "../api/client.ts";

/**
 * Standort-Eingaben through `RuehrApi` / `@ruehrai/api-contracts`.
 * There is no fixture stand-in.
 */
export function getLocationApi(): RuehrApi {
  return getApi();
}
