"use client";

import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from "geojson";
import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  type MapGeoJSONFeature,
  NavigationControl,
  ScaleControl,
} from "maplibre-gl";
import { useEffect, useRef } from "react";
import { isGrain, type SearchHit } from "@/lib/api";
import { zoomForGrain } from "@/lib/format";
import "maplibre-gl/dist/maplibre-gl.css";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

interface MapViewProps {
  layer: FeatureCollection;
  selection: SearchHit | null;
  onSelect: (hit: SearchHit) => void;
  fitNonce: number;
}

function walkPositions(coordinates: unknown, visit: (position: Position) => void): void {
  if (!Array.isArray(coordinates)) return;
  if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
    visit(coordinates as Position);
    return;
  }
  for (const child of coordinates) {
    walkPositions(child, visit);
  }
}

function collectPositions(geometry: Geometry, bounds: LngLatBounds): boolean {
  if (geometry.type === "GeometryCollection") {
    return geometry.geometries.some((child) => collectPositions(child, bounds));
  }
  let found = false;
  walkPositions(geometry.coordinates, (position) => {
    bounds.extend([position[0], position[1]]);
    found = true;
  });
  return found;
}

function boundsOf(collection: FeatureCollection): LngLatBounds | null {
  const bounds = new LngLatBounds();
  let found = false;
  for (const feature of collection.features) {
    if (!feature.geometry) continue;
    if (collectPositions(feature.geometry, bounds)) found = true;
  }
  return found ? bounds : null;
}

function hitFromProperties(
  properties: GeoJsonProperties,
  fallbackId: string | number | undefined,
): SearchHit | null {
  if (!properties) return null;
  const id = String(properties.id ?? fallbackId ?? "");
  const grain = properties.grain;
  const lon = Number(properties.lon);
  const lat = Number(properties.lat);
  if (!id || !isGrain(grain) || !Number.isFinite(lon) || !Number.isFinite(lat)) {
    return null;
  }
  return {
    id,
    label: String(properties.label ?? id),
    grain,
    lon,
    lat,
  };
}

function pointCollection(selection: SearchHit | null): FeatureCollection {
  if (selection?.lon === undefined || selection.lat === undefined) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [selection.lon, selection.lat] },
        properties: { id: selection.id },
      },
    ],
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function MapView({ layer, selection, onSelect, fitNonce }: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const selectionRef = useRef(selection);
  const selectedFeatureId = useRef<string | number | null>(null);
  const onSelectRef = useRef(onSelect);
  const readyRef = useRef(false);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const map = new Map({
      container,
      style: BASEMAP_STYLE,
      center: [10.4, 51.1],
      zoom: 5.2,
    });
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ maxWidth: 120, unit: "metric" }), "bottom-left");

    const resize = new ResizeObserver(() => {
      map.resize();
    });
    resize.observe(container);

    map.on("load", () => {
      map.addSource("layer", {
        type: "geojson",
        data: layer,
        promoteId: "id",
      });
      map.addLayer({
        id: "layer-fill",
        type: "fill",
        source: "layer",
        paint: {
          "fill-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#d85a2a",
            "#1f7a72",
          ],
          "fill-opacity": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            0.72,
            0.48,
          ],
        },
      });
      map.addLayer({
        id: "layer-line",
        type: "line",
        source: "layer",
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#8a3414",
            "#143f3c",
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            2.5,
            1,
          ],
        },
      });
      map.addSource("selection", { type: "geojson", data: EMPTY });
      map.addLayer({
        id: "selection-circle",
        type: "circle",
        source: "selection",
        paint: {
          "circle-radius": 7,
          "circle-color": "#d85a2a",
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fffaf3",
        },
      });

      map.on("click", "layer-fill", (event: { features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const hit = hitFromProperties(feature.properties, feature.id);
        if (hit) onSelectRef.current(hit);
      });
      map.on("mouseenter", "layer-fill", () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", "layer-fill", () => {
        map.getCanvas().style.cursor = "";
      });

      readyRef.current = true;
      const bounds = boundsOf(layer);
      if (bounds) {
        map.fitBounds(bounds, { padding: 72, maxZoom: 15.5, duration: 0 });
      }
      applySelection(map, selectionRef.current, selectedFeatureId, false);
    });

    mapRef.current = map;
    return () => {
      readyRef.current = false;
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      selectedFeatureId.current = null;
    };
  }, [layer]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    applySelection(map, selection, selectedFeatureId, true);
  }, [selection]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !readyRef.current || fitNonce === 0) return;
    const bounds = boundsOf(layer);
    if (!bounds) return;
    const duration = prefersReducedMotion() ? 0 : 700;
    map.fitBounds(bounds, { padding: 72, maxZoom: 15.5, duration });
  }, [fitNonce, layer]);

  return <div ref={containerRef} className="map-canvas" />;
}

function applySelection(
  map: Map,
  selection: SearchHit | null,
  selectedFeatureId: { current: string | number | null },
  animate: boolean,
): void {
  if (selectedFeatureId.current != null) {
    map.setFeatureState({ source: "layer", id: selectedFeatureId.current }, { selected: false });
    selectedFeatureId.current = null;
  }

  const source = map.getSource("selection");
  if (source && "setData" in source) {
    (source as GeoJSONSource).setData(pointCollection(selection));
  }

  if (!selection || selection.lon === undefined || selection.lat === undefined) return;

  map.setFeatureState({ source: "layer", id: selection.id }, { selected: true });
  selectedFeatureId.current = selection.id;

  const camera = {
    center: [selection.lon, selection.lat] as [number, number],
    zoom: zoomForGrain(selection.grain),
  };
  if (!animate || prefersReducedMotion()) {
    map.jumpTo(camera);
  } else {
    map.flyTo({ ...camera, essential: true });
  }
}
