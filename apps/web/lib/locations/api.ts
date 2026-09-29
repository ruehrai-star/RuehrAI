import type { MonthlyRevenue, RegionDraft, StoreAddress, StoreDraft, TargetRegion } from "./model";

/**
 * Standort-Eingaben against `@ruehrai/api-contracts`.
 * `null` means those operations are not in the published OpenAPI yet.
 * Callers must not substitute Demo-Daten.
 */
export interface LocationApi {
  loadRegion(): Promise<TargetRegion | null>;
  saveRegion(draft: RegionDraft): Promise<TargetRegion>;
  listStores(): Promise<StoreAddress[]>;
  createStore(draft: StoreDraft): Promise<StoreAddress>;
  updateStore(id: string, draft: StoreDraft): Promise<StoreAddress>;
  deleteStore(id: string): Promise<void>;
  listRevenue(storeId: string): Promise<MonthlyRevenue[]>;
  saveRevenue(storeId: string, rows: MonthlyRevenue[]): Promise<MonthlyRevenue[]>;
}

export const LOCATION_CONTRACT_MESSAGE =
  "Der Backend-Vertrag enthält noch keine Operationen für Zielregion, Filialadressen und Umsatz. Speichern ist deaktiviert. Es werden keine Demo-Daten verwendet.";

export function getLocationApi(): LocationApi | null {
  return null;
}
