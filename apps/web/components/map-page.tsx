"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { FeatureCollection } from "geojson";
import {
  ApiError,
  coordinatesOf,
  DEFAULT_LAYER_ID,
  getApi,
  toMapFeatureCollection,
  type SearchHit,
} from "@/lib/api";
import { grainLabel } from "@/lib/format";
import { SearchPanel } from "./search-panel";
import { useSession } from "./session-provider";

const MapView = dynamic(() => import("./map-view").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <div className="map-status">Karte wird geladen …</div>,
});

export function MapPage() {
  const { session } = useSession();
  const [layer, setLayer] = useState<FeatureCollection | null>(null);
  const [layerError, setLayerError] = useState<string | null>(null);
  const [layerName, setLayerName] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<"unknown" | "ok" | "down">("unknown");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<SearchHit | null>(null);
  const [fitNonce, setFitNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    getApi()
      .health()
      .then(() => {
        if (!cancelled) setApiStatus("ok");
      })
      .catch(() => {
        if (!cancelled) setApiStatus("down");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!session) return;

    let cancelled = false;
    getApi()
      .getLayer(DEFAULT_LAYER_ID)
      .then((collection) => {
        if (cancelled) return;
        const mapLayer = toMapFeatureCollection(collection);
        setLayer(mapLayer);
        setLayerName(collection.name ?? DEFAULT_LAYER_ID);
        setLayerError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLayer(null);
        setLayerName(null);
        setLayerError(error instanceof ApiError ? error.message : "Lage konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  const visibleLayer = session ? layer : null;
  const layerStatus = !session
    ? "Anmeldung erforderlich, um die Lage zu laden."
    : layerError
      ? layerError
      : visibleLayer
        ? `${layerName ?? DEFAULT_LAYER_ID} · ${visibleLayer.features.length} Objekte`
        : "Lage wird geladen …";

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      getApi()
        .search(trimmed)
        .then((response) => {
          if (cancelled) return;
          setResults(response.hits);
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

  const selectionPoint = selection ? coordinatesOf(selection) : null;
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
        apiStatus={apiStatus}
        layerStatus={layerStatus}
      />
      <div className="map-stage">
        {visibleLayer ? (
          <MapView layer={visibleLayer} selection={selection} onSelect={setSelection} fitNonce={fitNonce} />
        ) : (
          <div className="map-status">{layerStatus}</div>
        )}
        {selection ? (
          <div className="callout">
            <span className="badge">{grainLabel(selection.grain)}</span>
            <strong>{selection.label}</strong>
            {selectionPoint ? (
              <span className="callout-coords">
                {selectionPoint.lat.toFixed(4)}° N, {selectionPoint.lon.toFixed(4)}° E
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
