import { catalogParentName } from "@/lib/format";

/**
 * Parent municipality next to a catalog hit.
 * Renders only when `catalogParentName` reads a named contract field.
 */
export function CatalogParentName({ source }: { source: unknown }) {
  const parent = catalogParentName(source);
  if (!parent) return null;
  return <span className="hit-parent">{parent}</span>;
}
