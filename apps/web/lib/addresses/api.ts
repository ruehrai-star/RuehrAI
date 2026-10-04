import { getApi } from "../api/index.ts";
import type { RuehrApi } from "../api/client.ts";

/**
 * Adressen through `RuehrApi` `POST /address-pair`.
 * The browser calls only the Backend. There is no fixture stand-in.
 */
export function getAddressApi(): RuehrApi {
  return getApi();
}
