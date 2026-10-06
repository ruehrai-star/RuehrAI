"use client";

import { formatRunRegionLabel, type RunRegionSource } from "@/lib/analysis/run-label";

/**
 * Run label: every Zielregion as `Name (Gemeinde)`, or name alone.
 * Several regions collapse to `Erste + N weitere` with an expandable list.
 */
export function RunRegionLabel({
  regions,
  catalog,
  className,
}: {
  regions: readonly RunRegionSource[] | null | undefined;
  /** Saved Zielregionen — used only to fill a missing `parentLabel`. */
  catalog?: readonly RunRegionSource[] | null;
  className?: string;
}) {
  const view = formatRunRegionLabel(regions, catalog);
  if (!view.summary) return null;
  if (!view.expandable) {
    return <span className={className}>{view.summary}</span>;
  }
  return (
    <details className={className ? `run-region-label ${className}` : "run-region-label"}>
      <summary>{view.summary}</summary>
      <ul>
        {view.entries.map((entry) => (
          <li key={entry}>{entry}</li>
        ))}
      </ul>
    </details>
  );
}
