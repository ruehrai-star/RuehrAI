import { catalogParentName } from "@/lib/format";

/**
 * Parent municipality next to a catalog hit.
 * Renders only the contract field `parentLabel` when it is a non-empty string.
 */
export function CatalogParentName({ source }: { source: unknown }) {
  const parent = catalogParentName(source);
  if (!parent) return null;
  return <span className="hit-parent">{parent}</span>;
}
