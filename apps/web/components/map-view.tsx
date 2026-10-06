"use client";

import type { FeatureCollection, GeoJsonProperties, Geometry, Position } from "geojson";
import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  Marker,
  Popup,
  type MapGeoJSONFeature,
  NavigationControl,
  ScaleControl,
  setWorkerUrl,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { coordinatesOf, isGrain, type SearchHit } from "@/lib/api";
import { unnamedPlaceLabel, visiblePlaceText, zoomForGrain } from "@/lib/format";
import {
  EMPFEHLUNG_COLOR,
  FIT_MAX_ZOOM,
  FIT_PADDING_PX,
  GERMANY_VIEW,
  PIN_COLOR,
  REGION_FILL,
  REGION_FILL_OPACITY,
  REGION_LINE,
  type EmpfehlungPin,
  type HitOutline,
  type MapCamera,
  type StorePin,
} from "@/lib/map/karte";
import "maplibre-gl/dist/maplibre-gl.css";

const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";

const EMPTY: FeatureCollection = { type: "FeatureCollection", features: [] };

interface MapViewProps {
  layer?: FeatureCollection;
  selection?: SearchHit | null;
  onSelect?: (hit: SearchHit) => void;
  fitNonce?: number;
  pins: StorePin[];
  empfehlungen: EmpfehlungPin[];
  hits?: FeatureCollection;
  hitMarkers?: HitOutline[];
  region: FeatureCollection;
  /** Null while Filialadressen and the Zielregion are still loading. */
  cameraKey: string | null;
  camera: MapCamera;
  markerKey: string;
  regionKey: string;
  hitKey?: string;
  selectedHitId?: string | null;
  regionFrameOnly?: boolean;
  onMarkRegion?: (geoKey: string) => void;
  onSelectHit?: (id: string) => void;
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

function mapFeatureLabel(label: unknown, id: string): string {
  const fromLabel = typeof label === "string" ? visiblePlaceText(label, id) : "";
  if (fromLabel) return fromLabel;
  return unnamedPlaceLabel({ id, geoKey: id }) ?? "";
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
    label: mapFeatureLabel(properties.label, id),
    grain,
    lon,
    lat,
  };
}

function pointCollection(selection: SearchHit | null): FeatureCollection {
  const point = selection ? coordinatesOf(selection) : null;
  if (!selection || !point) return EMPTY;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        geometry: { type: "Point", coordinates: [point.lon, point.lat] },
        properties: { id: selection.id },
      },
    ],
  };
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function addressLines(primary: string, secondary: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "pin-popup";
  const title = document.createElement("strong");
  title.textContent = primary;
  const place = document.createElement("span");
  place.textContent = secondary;
  root.append(title, place);
  return root;
}

function germanPopup(primary: string, secondary: string): Popup {
  const popup = new Popup({ offset: 18, closeButton: true, maxWidth: "260px" }).setDOMContent(
    addressLines(primary, secondary),
  );
  popup.on("open", () => {
    popup.getElement()?.querySelector(".maplibregl-popup-close-button")?.setAttribute("aria-label", "Schließen");
  });
  return popup;
}

function hitHintLines(marker: Pick<HitOutline, "rank" | "title" | "badge" | "lage">): HTMLElement {
  const root = document.createElement("div");
  root.className = "pin-popup";
  const rank = document.createElement("span");
  rank.className = "hint";
  rank.textContent = `Rang ${marker.rank}`;
  const name = document.createElement("strong");
  name.textContent = marker.title;
  const badge = document.createElement("span");
  badge.textContent = marker.badge;
  root.append(rank, name, badge);
  if (marker.lage) {
    const lage = document.createElement("span");
    lage.className = "hint";
    lage.textContent = marker.lage;
    root.append(lage);
  }
  return root;
}

function hitHintPopup(marker: Pick<HitOutline, "rank" | "title" | "badge" | "lage">): Popup {
  const popup = new Popup({ offset: 18, closeButton: true, maxWidth: "280px" }).setDOMContent(hitHintLines(marker));
  popup.on("open", () => {
    popup.getElement()?.querySelector(".maplibregl-popup-close-button")?.setAttribute("aria-label", "Schließen");
  });
  return popup;
}

function storeButton(pin: StorePin): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "steckadel";
  button.setAttribute("aria-label", pin.ariaLabel);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 18 18");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("aria-hidden", "true");
  const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  rect.setAttribute("x", "1.5");
  rect.setAttribute("y", "1.5");
  rect.setAttribute("width", "15");
  rect.setAttribute("height", "15");
  rect.setAttribute("fill", PIN_COLOR);
  rect.setAttribute("stroke", "#fffaf3");
  rect.setAttribute("stroke-width", "1.5");
  svg.append(rect);
  button.append(svg);
  return button;
}

function empfehlungButton(pin: EmpfehlungPin): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "empfehlung-punkt";
  button.setAttribute("aria-label", pin.ariaLabel);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "24");
  svg.setAttribute("height", "24");
  svg.setAttribute("aria-hidden", "true");
  const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  circle.setAttribute("cx", "12");
  circle.setAttribute("cy", "12");
  circle.setAttribute("r", "10");
  circle.setAttribute("fill", EMPFEHLUNG_COLOR);
  circle.setAttribute("stroke", "#fffaf3");
  circle.setAttribute("stroke-width", "2");
  const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
  label.setAttribute("x", "12");
  label.setAttribute("y", "12");
  label.setAttribute("text-anchor", "middle");
  label.setAttribute("dominant-baseline", "central");
  label.setAttribute("fill", "#fffaf3");
  label.setAttribute("font-size", "11");
  label.setAttribute("font-weight", "700");
  label.textContent = String(pin.rank);
  svg.append(circle, label);
  button.append(svg);
  return button;
}

function addStorePin(map: Map, pin: StorePin): Marker {
  return new Marker({ element: storeButton(pin), anchor: "center" })
    .setLngLat([pin.lon, pin.lat])
    .setPopup(germanPopup(pin.street, pin.place))
    .addTo(map);
}

function addEmpfehlungPin(map: Map, pin: EmpfehlungPin): Marker {
  return new Marker({ element: empfehlungButton(pin), anchor: "center" })
    .setLngLat([pin.lon, pin.lat])
    .setPopup(germanPopup(pin.title, "Empfehlung"))
    .addTo(map);
}

function hitButton(marker: HitOutline, selected: boolean, onSelect?: (id: string) => void): HTMLButtonElement {
  const button = empfehlungButton({
    kind: "empfehlung",
    id: marker.id,
    rank: marker.rank,
    lon: marker.lon,
    lat: marker.lat,
    title: marker.title,
    ariaLabel: marker.ariaLabel,
  });
  button.classList.toggle("is-selected", selected);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    onSelect?.(marker.id);
  });
  return button;
}

function addHitMarker(map: Map, marker: HitOutline, selected: boolean, onSelect?: (id: string) => void): Marker {
  return new Marker({ element: hitButton(marker, selected, onSelect), anchor: "center" })
    .setLngLat([marker.lon, marker.lat])
    .setPopup(hitHintPopup(marker))
    .addTo(map);
}

function applyCamera(map: Map, camera: MapCamera, animate: boolean): void {
  const duration = animate && !prefersReducedMotion() ? 700 : 0;
  if (camera.kind === "germany") {
    const view = {
      center: [GERMANY_VIEW.lon, GERMANY_VIEW.lat] as [number, number],
      zoom: GERMANY_VIEW.zoom,
    };
    if (duration === 0) map.jumpTo(view);
    else map.easeTo({ ...view, duration, essential: true });
    return;
  }
  const { west, south, east, north } = camera.bounds;
  map.fitBounds(
    [
      [west, south],
      [east, north],
    ],
    { padding: FIT_PADDING_PX, maxZoom: FIT_MAX_ZOOM, duration },
  );
}

export function MapView({
  layer = EMPTY,
  selection = null,
  onSelect,
  fitNonce = 0,
  pins,
  empfehlungen,
  hits = EMPTY,
  hitMarkers = [],
  region,
  cameraKey,
  camera,
  markerKey,
  regionKey,
  hitKey = "",
  selectedHitId = null,
  regionFrameOnly = false,
  onMarkRegion,
  onSelectHit,
}: MapViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Map | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const selectionRef = useRef(selection);
  const selectedFeatureId = useRef<string | number | null>(null);
  const selectedHitRef = useRef<string | number | null>(null);
  const onSelectRef = useRef(onSelect);
  const onMarkRegionRef = useRef(onMarkRegion);
  const onSelectHitRef = useRef(onSelectHit);
  const layerRef = useRef(layer);
  const regionRef = useRef(region);
  const hitsRef = useRef(hits);
  const pinsRef = useRef(pins);
  const empfehlungenRef = useRef(empfehlungen);
  const hitMarkersRef = useRef(hitMarkers);
  const cameraRef = useRef(camera);
  const cameraKeyRef = useRef(cameraKey);
  const appliedCamera = useRef<string | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onMarkRegionRef.current = onMarkRegion;
  }, [onMarkRegion]);

  useEffect(() => {
    onSelectHitRef.current = onSelectHit;
  }, [onSelectHit]);

  useEffect(() => {
    layerRef.current = layer;
    regionRef.current = region;
    hitsRef.current = hits;
    pinsRef.current = pins;
    empfehlungenRef.current = empfehlungen;
    hitMarkersRef.current = hitMarkers;
    cameraRef.current = camera;
    cameraKeyRef.current = cameraKey;
  }, [layer, region, hits, pins, empfehlungen, hitMarkers, camera, cameraKey]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Turbopack does not emit the MapLibre worker next to the bundled library,
    // so the browser requests an HTML 404 and refuses the module. Serve the
    // package worker from public/ (copied on postinstall).
    setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

    const map = new Map({
      container,
      style: BASEMAP_STYLE,
      center: [GERMANY_VIEW.lon, GERMANY_VIEW.lat],
      zoom: GERMANY_VIEW.zoom,
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
        data: layerRef.current,
        promoteId: "id",
      });
      map.addLayer({
        id: "layer-fill",
        type: "fill",
        source: "layer",
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        paint: {
          "fill-color": ["case", ["boolean", ["feature-state", "selected"], false], "#d85a2a", "#1f7a72"],
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.72, 0.48],
        },
      });
      map.addLayer({
        id: "layer-line",
        type: "line",
        source: "layer",
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#8a3414", "#143f3c"],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 2.5, 1],
        },
      });
      map.addLayer({
        id: "layer-circle",
        type: "circle",
        source: "layer",
        filter: ["==", ["geometry-type"], "Point"],
        paint: {
          "circle-radius": ["case", ["boolean", ["feature-state", "selected"], false], 9, 6],
          "circle-color": ["case", ["boolean", ["feature-state", "selected"], false], "#d85a2a", "#1f7a72"],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fffaf3",
        },
      });
      map.addSource("zielregion", { type: "geojson", data: regionRef.current });
      map.addLayer({
        id: "zielregion-fill",
        type: "fill",
        source: "zielregion",
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        paint: {
          "fill-color": REGION_FILL,
          "fill-opacity": ["case", ["==", ["get", "marked"], true], 0.44, REGION_FILL_OPACITY],
        },
      });
      map.addLayer({
        id: "zielregion-line",
        type: "line",
        source: "zielregion",
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        paint: {
          "line-color": ["case", ["==", ["get", "marked"], true], "#0f2a4d", REGION_LINE],
          "line-width": ["case", ["==", ["get", "marked"], true], 3.25, 1.5],
        },
      });
      map.addSource("treffer", { type: "geojson", data: hitsRef.current, promoteId: "id" });
      map.addLayer({
        id: "treffer-fill",
        type: "fill",
        source: "treffer",
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        paint: {
          "fill-color": EMPFEHLUNG_COLOR,
          "fill-opacity": ["case", ["boolean", ["feature-state", "selected"], false], 0.42, 0.22],
        },
      });
      map.addLayer({
        id: "treffer-line",
        type: "line",
        source: "treffer",
        filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "MultiPolygon"]],
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "selected"], false], "#8a3414", EMPFEHLUNG_COLOR],
          "line-width": ["case", ["boolean", ["feature-state", "selected"], false], 3, 1.75],
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

      const selectFeature = (event: { features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0];
        if (!feature) return;
        const hit = hitFromProperties(feature.properties, feature.id);
        if (hit) onSelectRef.current?.(hit);
      };
      for (const layerId of ["layer-fill", "layer-circle"]) {
        map.on("click", layerId, selectFeature);
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      const markOutline = (event: { features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0];
        const key = feature?.properties?.geoKey;
        if (typeof key === "string" && key.length > 0) onMarkRegionRef.current?.(key);
      };
      for (const layerId of ["zielregion-fill", "zielregion-line"]) {
        map.on("click", layerId, markOutline);
        map.on("mouseenter", layerId, () => {
          map.getCanvas().style.cursor = "pointer";
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }
      let outlineHint: Popup | null = null;
      const showOutlineHint = (
        event: { lngLat: { lng: number; lat: number }; features?: MapGeoJSONFeature[] },
        persistent: boolean,
      ) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id ?? feature?.id;
        const marker = hitMarkersRef.current.find((item) => item.id === id);
        if (!marker) return;
        outlineHint?.remove();
        outlineHint = hitHintPopup(marker).setLngLat(event.lngLat).addTo(map);
        if (!persistent) {
          outlineHint.once("close", () => {
            if (outlineHint) outlineHint = null;
          });
        }
      };
      const selectHit = (event: { lngLat: { lng: number; lat: number }; features?: MapGeoJSONFeature[] }) => {
        const feature = event.features?.[0];
        const id = feature?.properties?.id ?? feature?.id;
        if (typeof id === "string" && id.length > 0) onSelectHitRef.current?.(id);
        showOutlineHint(event, true);
      };
      for (const layerId of ["treffer-fill", "treffer-line"]) {
        map.on("click", layerId, selectHit);
        map.on("mouseenter", layerId, (event) => {
          map.getCanvas().style.cursor = "pointer";
          showOutlineHint(event, false);
        });
        map.on("mouseleave", layerId, () => {
          map.getCanvas().style.cursor = "";
        });
      }

      applySelection(map, selectionRef.current, selectedFeatureId, false);
      if (cameraKeyRef.current != null) {
        appliedCamera.current = cameraKeyRef.current;
        applyCamera(map, cameraRef.current, false);
      }
      setMapReady(true);
    });

    mapRef.current = map;
    return () => {
      setMapReady(false);
      appliedCamera.current = null;
      for (const marker of markersRef.current) marker.remove();
      markersRef.current = [];
      resize.disconnect();
      map.remove();
      mapRef.current = null;
      selectedFeatureId.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("layer");
    if (source && "setData" in source) (source as GeoJSONSource).setData(layer);
    applySelection(map, selectionRef.current, selectedFeatureId, false);
  }, [layer, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("zielregion");
    if (source && "setData" in source) (source as GeoJSONSource).setData(region);
    if (map.getLayer("zielregion-fill")) {
      map.setPaintProperty(
        "zielregion-fill",
        "fill-opacity",
        regionFrameOnly ? 0 : ["case", ["==", ["get", "marked"], true], 0.44, REGION_FILL_OPACITY],
      );
    }
    if (map.getLayer("zielregion-line")) {
      map.setPaintProperty(
        "zielregion-line",
        "line-width",
        regionFrameOnly ? 1.25 : ["case", ["==", ["get", "marked"], true], 3.25, 1.5],
      );
    }
  }, [region, regionKey, regionFrameOnly, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const source = map.getSource("treffer");
    if (source && "setData" in source) (source as GeoJSONSource).setData(hits);
    applyHitSelection(map, selectedHitId, selectedHitRef);
  }, [hits, hitKey, selectedHitId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const marker of markersRef.current) marker.remove();
    markersRef.current = [
      ...pinsRef.current.map((pin) => addStorePin(map, pin)),
      ...empfehlungenRef.current.map((pin) => addEmpfehlungPin(map, pin)),
      ...hitMarkersRef.current.map((marker) => addHitMarker(map, marker, marker.id === selectedHitId, onSelectHitRef.current)),
    ];
  }, [markerKey, selectedHitId, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || cameraKey == null) return;
    if (appliedCamera.current === cameraKey) return;
    const animate = appliedCamera.current != null;
    appliedCamera.current = cameraKey;
    applyCamera(map, camera, animate);
  }, [camera, cameraKey, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    applySelection(map, selection, selectedFeatureId, true);
  }, [selection, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || fitNonce === 0) return;
    const bounds = boundsOf(layer);
    if (!bounds) return;
    const duration = prefersReducedMotion() ? 0 : 700;
    map.fitBounds(bounds, { padding: 72, maxZoom: FIT_MAX_ZOOM, duration });
  }, [fitNonce, layer, mapReady]);

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

  const point = selection ? coordinatesOf(selection) : null;
  if (!selection || !point) return;

  map.setFeatureState({ source: "layer", id: selection.id }, { selected: true });
  selectedFeatureId.current = selection.id;

  const view = {
    center: [point.lon, point.lat] as [number, number],
    zoom: zoomForGrain(selection.grain),
  };
  if (!animate || prefersReducedMotion()) {
    map.jumpTo(view);
  } else {
    map.flyTo({ ...view, essential: true });
  }
}

function applyHitSelection(
  map: Map,
  selectedHitId: string | null,
  selectedHitRef: { current: string | number | null },
): void {
  if (selectedHitRef.current != null) {
    map.setFeatureState({ source: "treffer", id: selectedHitRef.current }, { selected: false });
    selectedHitRef.current = null;
  }
  if (!selectedHitId) return;
  map.setFeatureState({ source: "treffer", id: selectedHitId }, { selected: true });
  selectedHitRef.current = selectedHitId;
}
