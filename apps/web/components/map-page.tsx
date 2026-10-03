"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState } from "react";
import type { FeatureCollection } from "geojson";
import type { Recommendation, StoreLocation, TargetRegion } from "@ruehrai/api-contracts";
import {
  ApiError,
  coordinatesOf,
  DEFAULT_LAYER_ID,
  getApi,
  toMapFeatureCollection,
  type SearchHit,
} from "@/lib/api";
import { CatalogParentName } from "@/components/catalog-parent-name";
import { catalogBadge, catalogPlaceName } from "@/lib/format";
import { ensureMarkedKey } from "@/lib/locations/regions";
import {
  LEGEND_LABEL,
  NO_STORES_LABEL,
  REGION_FILL,
  REGION_LINE,
  buildKarte,
} from "@/lib/map/karte";
import { errorText } from "@/lib/user-message";
import { SearchPanel } from "./search-panel";
import { useSession } from "./session-provider";

const MapView = dynamic(() => import("./map-view").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <div className="map-status">Karte wird geladen …</div>,
});

const EMPTY_LAYER: FeatureCollection = { type: "FeatureCollection", features: [] };

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
  const [snapshot, setSnapshot] = useState<{
    token: string;
    stores: StoreLocation[] | null;
    regions: TargetRegion[];
    markedKey: string | null;
    recommendations: Recommendation[];
    error: string | null;
    ready: boolean;
  } | null>(null);

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
        setLayer(toMapFeatureCollection(collection));
        setLayerName(collection.name ?? DEFAULT_LAYER_ID);
        setLayerError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLayer(null);
        setLayerName(null);
        setLayerError(error instanceof ApiError ? error.message : "Layer konnte nicht geladen werden.");
      });
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    const token = session?.accessToken;
    if (!token) return;

    let cancelled = false;
    let request = 0;

    const load = () => {
      const current = ++request;
      const api = getApi();
      Promise.all([
        api.listStores(),
        api.listTargetRegions(),
        api.getRecommendations().catch(() => null),
      ])
        .then(([nextStores, nextRegions, nextRecommendations]) => {
          if (cancelled || current !== request) return;
          setSnapshot((currentSnapshot) => ({
            token,
            stores: nextStores,
            regions: nextRegions,
            markedKey: ensureMarkedKey(nextRegions, currentSnapshot?.token === token ? currentSnapshot.markedKey : null),
            recommendations: nextRecommendations?.items ?? [],
            error: null,
            ready: true,
          }));
        })
        .catch((error: unknown) => {
          if (cancelled || current !== request) return;
          setSnapshot({
            token,
            stores: null,
            regions: [],
            markedKey: null,
            recommendations: [],
            error: errorText(error, "Filialadressen konnten nicht geladen werden."),
            ready: true,
          });
        });
    };

    load();
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [session]);

  const visibleLayer = session ? layer : null;
  const layerStatus = !session
    ? "Anmeldung erforderlich, um den Layer zu laden."
    : layerError
      ? layerError
      : visibleLayer
        ? `${layerName ?? DEFAULT_LAYER_ID} · ${visibleLayer.features.length} Objekte`
        : "Layer wird geladen …";

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

  const mine = snapshot && session?.accessToken === snapshot.token ? snapshot : null;
  const karte = useMemo(
    () =>
      buildKarte({
        stores: mine?.stores ?? [],
        regions: mine?.regions ?? [],
        markedKey: mine?.markedKey ?? null,
        recommendations: mine?.recommendations ?? [],
        addressesKnownEmpty: Boolean(mine?.ready && mine.stores && mine.stores.length === 0),
      }),
    [mine],
  );

  const selectionPoint = selection ? coordinatesOf(selection) : null;
  const trimmedQuery = query.trim();
  const queryActive = trimmedQuery.length >= 2;
  const searching = queryActive && resultQuery !== trimmedQuery;
  const visibleResults = queryActive && resultQuery === trimmedQuery ? results : [];
  const cameraKey = !session || mine?.ready ? karte.cameraKey : null;

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
        <MapView
          layer={visibleLayer ?? EMPTY_LAYER}
          selection={selection}
          onSelect={setSelection}
          fitNonce={fitNonce}
          pins={karte.pins}
          empfehlungen={karte.empfehlungen}
          region={karte.region}
          cameraKey={cameraKey}
          camera={karte.camera}
          markerKey={karte.markerKey}
          regionKey={karte.regionKey}
          onMarkRegion={(key) =>
            setSnapshot((current) => (current ? { ...current, markedKey: key } : current))
          }
        />
        <div className="map-notices">
          {karte.showEmptyAddresses ? (
            <p className="map-empty" role="status">
              {NO_STORES_LABEL}
            </p>
          ) : null}
          {karte.coordinateGapLabel ? (
            <p className="map-gap" role="status">
              {karte.coordinateGapLabel}
            </p>
          ) : null}
          {karte.missingAreaLabel ? (
            <p className="map-area" role="status">
              {karte.missingAreaLabel}
            </p>
          ) : null}
        </div>
        {mine?.error ? <p className="message message-error map-banner">{mine.error}</p> : null}
        {karte.showLegend ? (
          <div className="map-legend">
            <span
              className="legend-swatch"
              style={{ backgroundColor: REGION_FILL, borderColor: REGION_LINE }}
            />
            <span>{LEGEND_LABEL}</span>
          </div>
        ) : null}
        {selection ? (
          <div className="callout">
            <span className="badge">{catalogBadge({ ...selection, geoKey: selection.geoKey || selection.id })}</span>
            {catalogPlaceName(selection) ? <strong>{catalogPlaceName(selection)}</strong> : null}
            <CatalogParentName source={selection} />
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
