import { catalogBadge, catalogParentName, catalogPlaceName } from "@/lib/format";

/**
 * Zielregion / search label: `Name · Badge · Gemeinde`.
 * `parentLabel` is the municipality. Catalog keys are never shown.
 */
export function CatalogHitLabel({ source }: { source: unknown }) {
  const name = catalogPlaceName(source);
  if (!name) return null;
  const badgeSource = asBadgeSource(source);
  const badge = catalogBadge({ ...badgeSource, geoKey: badgeSource.geoKey || badgeSource.id });
  const parent = catalogParentName(source);
  return (
    <span className="hit-label">
      {name}
      {badge ? (
        <>
          <span className="hit-sep" aria-hidden="true">
            {" · "}
          </span>
          <span className="badge">{badge}</span>
        </>
      ) : null}
      {parent ? (
        <>
          <span className="hit-sep" aria-hidden="true">
            {" · "}
          </span>
          <span className="hit-parent">{parent}</span>
        </>
      ) : null}
    </span>
  );
}

function asBadgeSource(source: unknown): {
  level?: unknown;
  grain?: "address" | "grid100" | "plz8" | "plz5" | "ags" | "ags5" | "other" | null;
  geoKey?: string | null;
  ags?: string | null;
  id?: string | null;
} {
  if (!source || typeof source !== "object") return {};
  return source as {
    level?: unknown;
    grain?: "address" | "grid100" | "plz8" | "plz5" | "ags" | "ags5" | "other" | null;
    geoKey?: string | null;
    ags?: string | null;
    id?: string | null;
  };
}
