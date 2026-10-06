"use client";

import { useEffect, useRef, useState } from "react";
import { CatalogHitLabel } from "@/components/catalog-hit-label";
import { getApi, ApiError, type SearchHit, type TargetRegion } from "@/lib/api";
import { catalogPlaceName, visibleSavedRegions, visibleSearchHits } from "@/lib/format";
import { regionHasDrawableArea } from "@/lib/map/karte";
import {
  REGION_LIST_COPY,
  isHitInList,
  markedRegion,
  regionListKey,
} from "@/lib/locations/regions";
import { errorText } from "@/lib/user-message";
import { loadPatternForMarkedRegion } from "@/lib/verlauf/bind";
import { VERLAUF_COPY } from "@/lib/verlauf/model";

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
  const [pattern, setPattern] = useState<string | null>(null);
  const [patternKey, setPatternKey] = useState<string | null>(null);

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
    const marked = markedRegion(items, markedKey);
    if (!marked) return;
    const key = regionListKey(marked);
    let cancelled = false;
    loadPatternForMarkedRegion(getApi(), marked)
      .then((bound) => {
        if (cancelled) return;
        setPattern(bound?.pattern.summary ?? null);
        setPatternKey(key);
      })
      .catch(() => {
        if (cancelled) return;
        setPattern(null);
        setPatternKey(key);
      });
    return () => {
      cancelled = true;
    };
  }, [items, markedKey]);

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
                    <CatalogHitLabel source={item} />
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
                {marked ? (
                  <Verlauf
                    summary={patternKey === key ? pattern : null}
                    loaded={patternKey === key}
                  />
                ) : null}
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
            return (
              <li key={hit.id}>
                <div className={inList ? "hit is-added" : "hit"}>
                  <CatalogHitLabel source={hit} />
                  <span className="hit-meta">
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

function Verlauf({ summary, loaded }: { summary: string | null; loaded: boolean }) {
  return (
    <div className="verlauf">
      <h3>{REGION_LIST_COPY.verlauf}</h3>
      {summary ? <p className="summary-line">{summary}</p> : loaded ? <p className="message">{VERLAUF_COPY.missingRun}</p> : null}
    </div>
  );
}
