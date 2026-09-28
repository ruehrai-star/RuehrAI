"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import { ApiError, getApi, type HealthResponse, type SearchHit } from "@/lib/api";
import { grainLabel } from "@/lib/format";
import { SearchPanel } from "./search-panel";

const MapView = dynamic(() => import("./map-view").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <div className="map-status">Karte wird geladen …</div>,
});

export function MapPage() {
  const [layer, setLayer] = useState<FeatureCollection | null>(null);
  const [layerStatus, setLayerStatus] = useState("Lage grid100 wird geladen …");
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SearchHit | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .getLayer("grid100")
      .then((collection) => {
        if (cancelled) return;
        setLayer(collection);
        setLayerStatus(`Lage grid100 · ${collection.features.length} Zellen`);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof ApiError ? error.message : "Lage konnte nicht geladen werden.";
        setLayerStatus(message);
      });
    getApi()
      .health()
      .then((response) => {
        if (!cancelled) setHealth(response);
      })
      .catch(() => {
        if (!cancelled) setHealth({ status: "degraded" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      getApi()
        .search(trimmed)
        .then((response) => {
          if (cancelled) return;
          setResults(response.results);
          setResultQuery(trimmed);
          setSearchError(null);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          setResults([]);
          setResultQuery(trimmed);
          setSearchError(error instanceof ApiError ? error.message : "Suche fehlgeschlagen.");
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const trimmedQuery = query.trim();
  const queryActive = trimmedQuery.length >= 2;
  const searching = queryActive && resultQuery !== trimmedQuery;
  const visibleResults = queryActive && resultQuery === trimmedQuery ? results : [];

  function fitLayer() {
    setSelection(null);
    setFitNonce((value) => value + 1);
  }

  return (
    <div className="map-page" id="inhalt">
      <SearchPanel
        query={query}
        onQueryChange={setQuery}
        results={visibleResults}
        searching={searching}
        error={queryActive && resultQuery === trimmedQuery ? searchError : null}
        selection={selection}
        onSelect={setSelection}
        onFitLayer={fitLayer}
        health={health}
        layerStatus={layerStatus}
      />
      <div className="map-stage">
        {layer ? (
          <MapView layer={layer} selection={selection} onSelect={setSelection} fitNonce={fitNonce} />
        ) : (
          <div className="map-status">{layerStatus}</div>
        )}
        {selection ? (
          <div className="callout">
            <span className="badge">{grainLabel(selection.grain)}</span>
            <strong>{selection.label}</strong>
            {selection.lon !== undefined && selection.lat !== undefined ? (
              <span className="callout-coords">
                {selection.lat.toFixed(4)}° N, {selection.lon.toFixed(4)}° E
              </span>
            ) : null}
          </div>
        ) : (
          <p className="map-hint">Gitterzelle anklicken oder einen Treffer wählen.</p>
        )}
      </div>
    </div>
  );
}
