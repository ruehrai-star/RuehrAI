"use client";

import { useEffect, useRef, useState } from "react";
import { CatalogParentName } from "@/components/catalog-parent-name";
import { ApiError, getApi, type AnalysisPattern, type SearchHit, type TargetRegion } from "@/lib/api";
import { revenueDirectionLabel } from "@/lib/analysis/model";
import { catalogBadge, catalogPlaceName, visibleSavedRegions, visibleSearchHits } from "@/lib/format";
import { regionHasDrawableArea } from "@/lib/map/karte";
import {
  REGION_LIST_COPY,
  isHitInList,
  regionListKey,
} from "@/lib/locations/regions";
import { errorText } from "@/lib/user-message";

interface RegionSectionProps {
  items: TargetRegion[];
  markedKey: string | null;
  adding: boolean;
  removingKey: string | null;
  error: string | null;
  notice: string | null;
  onMark: (key: string) => void;
  onAdd: (hit: SearchHit) => Promise<void>;
  onRemove: (key: string) => Promise<void>;
}

export function RegionSection({
  items,
  markedKey,
  adding,
  removingKey,
  error,
  notice,
  onMark,
  onAdd,
  onRemove,
}: RegionSectionProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pattern, setPattern] = useState<AnalysisPattern | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      getApi()
        .search(trimmed)
        .then((response) => {
          if (cancelled) return;
          setHits(response.hits);
          setResultQuery(trimmed);
          setSearchError(null);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setHits([]);
          setResultQuery(trimmed);
          setSearchError(caught instanceof ApiError ? errorText(caught, "Suche fehlgeschlagen.") : "Suche fehlgeschlagen.");
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  useEffect(() => {
    if (!markedKey) return;
    let cancelled = false;
    getApi()
      .getAnalysisPattern()
      .then((latest) => {
        if (cancelled) return;
        setPattern(latest?.pattern ?? null);
      })
      .catch(() => {
        if (cancelled) return;
        setPattern(null);
      });
    return () => {
      cancelled = true;
    };
  }, [markedKey]);

  const trimmed = query.trim();
  const searching = trimmed.length >= 2 && resultQuery !== trimmed;
  const visibleHits = trimmed.length >= 2 && resultQuery === trimmed ? visibleSearchHits(hits) : [];
  const visibleItems = visibleSavedRegions(items);

  async function addHit(hit: SearchHit) {
    if (isHitInList(hit, visibleItems) || !catalogPlaceName(hit)) return;
    await onAdd(hit);
    setQuery("");
    setHits([]);
    setResultQuery("");
    searchRef.current?.focus();
  }

  return (
    <section className="section-card" id="zielregion" aria-labelledby="zielregion-title">
      <h2 id="zielregion-title">{REGION_LIST_COPY.heading}</h2>

      {visibleItems.length === 0 ? <p className="message">{REGION_LIST_COPY.empty}</p> : null}

      {visibleItems.length > 0 ? (
        <ul className="region-list">
          {visibleItems.map((item) => {
            const key = regionListKey(item);
            const name = catalogPlaceName(item);
            const badge = catalogBadge(item);
            const marked = markedKey === key;
            const missing = !regionHasDrawableArea(item);
            return (
              <li key={key} className={marked ? "region-row is-marked" : "region-row"}>
                <div className="region-row-main">
                  <button
                    type="button"
                    className={marked ? "hit is-active" : "hit"}
                    aria-pressed={marked}
                    onClick={() => onMark(key)}
                  >
                    <span className="hit-label">
                      {name}
                      <CatalogParentName source={item} />
                    </span>
                    {badge ? (
                      <span className="hit-meta">
                        <span className="badge">{badge}</span>
                      </span>
                    ) : null}
                  </button>
                  <button
                    type="button"
                    className="button button-quiet"
                    disabled={removingKey === key}
                    onClick={() => void onRemove(key)}
                  >
                    {REGION_LIST_COPY.remove}
                  </button>
                </div>
                {missing ? <p className="message">{REGION_LIST_COPY.missingArea}</p> : null}
                {marked ? <Verlauf pattern={pattern} /> : null}
              </li>
            );
          })}
        </ul>
      ) : null}

      <div className="stack">
        <label htmlFor="region-q">Zielregion suchen</label>
        <input
          ref={searchRef}
          id="region-q"
          type="search"
          value={query}
          placeholder={REGION_LIST_COPY.searchPlaceholder}
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          aria-controls="region-hits"
        />
        {searchError ? (
          <p className="message message-error" role="alert">
            {searchError}
          </p>
        ) : null}
        <div className="results-head">
          <h3>Treffer</h3>
          <span aria-live="polite">
            {searching ? "Suche …" : trimmed.length >= 2 ? `${visibleHits.length} Treffer` : "Bereit"}
          </span>
        </div>
        <ul id="region-hits" className="results">
          {visibleHits.map((hit) => {
            const name = catalogPlaceName(hit);
            const inList = isHitInList(hit, visibleItems);
            const badge = catalogBadge({ ...hit, geoKey: hit.geoKey || hit.id });
            return (
              <li key={hit.id}>
                <div className={inList ? "hit is-added" : "hit"}>
                  <span className="hit-label">
                    {name}
                    <CatalogParentName source={hit} />
                  </span>
                  <span className="hit-meta">
                    {badge ? <span className="badge">{badge}</span> : null}
                    {inList ? (
                      <span className="hit-added">{REGION_LIST_COPY.added}</span>
                    ) : (
                      <button
                        type="button"
                        className="button"
                        disabled={adding || !name}
                        onClick={() => void addHit(hit)}
                      >
                        {REGION_LIST_COPY.add}
                      </button>
                    )}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        {trimmed.length >= 2 && !searching && visibleHits.length === 0 && !searchError ? (
          <p className="message">{REGION_LIST_COPY.noHits}</p>
        ) : null}
        {error ? (
          <p className="message message-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="message message-ok" role="status">
            {notice}
          </p>
        ) : null}
      </div>
    </section>
  );
}

function Verlauf({ pattern }: { pattern: AnalysisPattern | null }) {
  return (
    <div className="verlauf">
      <h3>{REGION_LIST_COPY.verlauf}</h3>
      {pattern ? (
        <>
          <p className="summary-line">{pattern.summary}</p>
          <p className="hint">Umsatzrichtung: {revenueDirectionLabel(pattern.revenueDirection)}</p>
        </>
      ) : null}
    </div>
  );
}
