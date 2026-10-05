"use client";

import dynamic from "next/dynamic";
import type { KarteModel } from "@/lib/map/karte";
import { LEGEND_LABEL, NO_STORES_LABEL, REGION_FILL, REGION_LINE } from "@/lib/map/karte";

const MapView = dynamic(() => import("./map-view").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <div className="map-status">Karte wird geladen …</div>,
});

interface ProofMapProps {
  karte: KarteModel;
  cameraKey: string | null;
  error: string | null;
}

/** Proof map: Zielregion Polygon/MultiPolygon only. No demo-gemeinden layer. */
export function ProofMap({ karte, cameraKey, error }: ProofMapProps) {
  return (
    <div className="map-stage verlauf-proof-stage">
      <MapView
        pins={karte.pins}
        empfehlungen={karte.empfehlungen}
        region={karte.region}
        cameraKey={cameraKey}
        camera={karte.camera}
        markerKey={karte.markerKey}
        regionKey={karte.regionKey}
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
      {error ? <p className="message message-error map-banner">{error}</p> : null}
      {karte.showLegend ? (
        <div className="map-legend">
          <span className="legend-swatch" style={{ backgroundColor: REGION_FILL, borderColor: REGION_LINE }} />
          <span>{LEGEND_LABEL}</span>
        </div>
      ) : null}
    </div>
  );
}
