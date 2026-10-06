"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RecommendationSet, TargetRegion } from "@/lib/api";
import { getAnalysisApi } from "@/lib/analysis/api";
import { ensureMarkedKey, markedRegion, regionListKey } from "@/lib/locations/regions";
import { getLocationApi } from "@/lib/locations/api";
import { buildTrefferlisteKarte } from "@/lib/map/karte";
import { getRecommendationApi } from "@/lib/recommendations/api";
import {
  RECOMMENDATION_COPY,
  buildPatternProfile,
  buildTrefferlisteCards,
  headingForMarkedRegion,
  stichtagCopy,
  type SparkPoint,
  type TrefferCardView,
  type TrefferCriterionRow,
} from "@/lib/recommendations/model";
import { errorText } from "@/lib/user-message";
import { formatStandLine, loadPatternForMarkedRegion, type BoundVerlauf } from "@/lib/verlauf/bind";
import { regionView } from "@/lib/verlauf/model";
import { CatalogParentName } from "./catalog-parent-name";
import { useSession } from "./session-provider";

const MapView = dynamic(() => import("./map-view").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <div className="map-status">Karte wird geladen …</div>,
});

type PagePhase = "loading" | "idle" | "failed";

export function EmpfehlungenPage() {
  const { session } = useSession();
  const analysisApi = getAnalysisApi();
  const recommendationApi = getRecommendationApi();
  const locationApi = getLocationApi();
  const [pagePhase, setPagePhase] = useState<PagePhase>("loading");
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const [bound, setBound] = useState<BoundVerlauf | null>(null);
  const [boundKey, setBoundKey] = useState<string | null>(null);
  const [bindFailed, setBindFailed] = useState(false);
  const [recommendationSet, setRecommendationSet] = useState<RecommendationSet | null>(null);
  const [regions, setRegions] = useState<TargetRegion[]>([]);
  const [markedKey, setMarkedKey] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showPattern, setShowPattern] = useState(false);
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);
  const bindRequest = useRef(0);

  const visible = Boolean(session && loadedEmail === session.email && pagePhase !== "loading");
  const visibleRegions = visible ? regions : [];
  const marked = visible ? markedRegion(visibleRegions, markedKey) : null;
  const currentKey = marked ? regionListKey(marked) : null;
  const bindReady = visible && pagePhase === "idle" && boundKey === currentKey;
  const bindPhase: "loading" | "ready" | "empty" | "failed" = !bindReady
    ? "loading"
    : bindFailed
      ? "failed"
      : bound
        ? "ready"
        : "empty";
  const boundRecommendations =
    bindPhase === "ready" && bound && recommendationSet && recommendationSet.runId === bound.runId
      ? recommendationSet
      : null;
  const cards = useMemo(
    () => (bindPhase === "ready" ? buildTrefferlisteCards(boundRecommendations, marked) : []),
    [bindPhase, boundRecommendations, marked],
  );
  const patternRows = useMemo(
    () => (bindPhase === "ready" ? buildPatternProfile(boundRecommendations?.patternByDataset) : []),
    [bindPhase, boundRecommendations],
  );
  const standLine = bindPhase === "ready" && bound ? formatStandLine(bound.createdAt, bound.region) : null;
  const heading = headingForMarkedRegion(marked);
  const showEmptyRun = visible && pagePhase === "idle" && bindPhase === "empty" && visibleRegions.length > 0;
  const showEmptyHits = bindPhase === "ready" && cards.length === 0;

  useEffect(() => {
    if (!session) return;
    const email = session.email;
    let cancelled = false;

    void (async () => {
      setPagePhase("loading");
      setBound(null);
      setBoundKey(null);
      setBindFailed(false);
      setRecommendationSet(null);
      setRegions([]);
      setMarkedKey(null);
      setLoadError(null);
      try {
        const [nextSet, nextRegions] = await Promise.all([
          recommendationApi.getRecommendations(),
          locationApi.listTargetRegions(),
        ]);
        if (cancelled) return;
        setRecommendationSet(nextSet);
        setRegions(nextRegions);
        setMarkedKey(ensureMarkedKey(nextRegions, null));
        setLoadedEmail(email);
        setPagePhase("idle");
      } catch (caught) {
        if (cancelled) return;
        setLoadError(errorText(caught, "Empfehlungen konnten nicht geladen werden."));
        setLoadedEmail(email);
        setPagePhase("failed");
      }
    })();

    return () => {
      cancelled = true;
      bindRequest.current += 1;
    };
  }, [session, recommendationApi, locationApi]);

  useEffect(() => {
    if (!session || pagePhase !== "idle") return;
    const current = markedRegion(regions, markedKey);
    const key = current ? regionListKey(current) : null;
    const token = bindRequest.current + 1;
    bindRequest.current = token;

    void (async () => {
      try {
        const next = await loadPatternForMarkedRegion(analysisApi, current);
        if (bindRequest.current !== token) return;
        setBound(next);
        setBoundKey(key);
        setBindFailed(false);
        setSelectedHitId(null);
      } catch {
        if (bindRequest.current !== token) return;
        setBound(null);
        setBoundKey(key);
        setBindFailed(true);
        setSelectedHitId(null);
      }
    })();
  }, [session, pagePhase, regions, markedKey, analysisApi]);

  const karte = useMemo(
    () =>
      buildTrefferlisteKarte({
        region: marked,
        items: cards.map((card) => boundRecommendations?.items.find((item) => item.id === card.id)).filter((item): item is NonNullable<typeof item> => Boolean(item)),
      }),
    [marked, cards, boundRecommendations],
  );
  const cameraKey = !session || (visible && pagePhase !== "loading") ? karte.cameraKey : null;

  if (!session) {
    return (
      <main className="sheet" id="inhalt">
        <p className="stub-kicker">Empfehlung</p>
        <h1>{RECOMMENDATION_COPY.title}</h1>
        <p className="stub-copy">Die Empfehlungen stehen nach der Anmeldung zur Verfügung.</p>
        <div className="auth-actions">
          <Link href="/login" className="button">
            Anmelden
          </Link>
          <Link href="/register" className="button button-quiet">
            Registrieren
          </Link>
        </div>
      </main>
    );
  }

  return (
    <div className="treffer-page" id="inhalt" aria-busy={pagePhase === "loading" || bindPhase === "loading"}>
      <div className="treffer-list">
        <p className="stub-kicker">Empfehlung</p>
        {visibleRegions.length > 0 ? (
          <ul className="treffer-region-list">
            {visibleRegions.map((region) => {
              const view = regionView(region);
              const key = regionListKey(region);
              const selected = marked != null && key === regionListKey(marked);
              return (
                <li key={`${key}-${region.updatedAt}`}>
                  <button
                    type="button"
                    className={selected ? "hit is-active" : "hit"}
                    aria-pressed={selected}
                    onClick={() => setMarkedKey(key)}
                  >
                    <span className="hit-label">
                      {view.label}
                      <CatalogParentName source={region} />
                    </span>
                    {view.badge ? <span className="badge">{view.badge}</span> : null}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="message">Noch keine Zielregion gespeichert.</p>
        )}

        {standLine ? (
          <p className="treffer-stand" role="status">
            {standLine}
          </p>
        ) : null}
        {heading && bindPhase === "ready" ? <h1>{heading}</h1> : <h1>{RECOMMENDATION_COPY.title}</h1>}

        {pagePhase === "loading" || bindPhase === "loading" ? (
          <p className="message">{RECOMMENDATION_COPY.loading}</p>
        ) : null}
        {loadError ? (
          <p className="message message-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {bindPhase === "failed" ? (
          <p className="message message-error" role="alert">
            {RECOMMENDATION_COPY.analysisFailed}
          </p>
        ) : null}

        {showEmptyRun ? (
          <div className="treffer-empty">
            <p className="message" role="status">
              {RECOMMENDATION_COPY.missingRun}
            </p>
            <div className="auth-actions">
              <Link href="/musteranalyse" className="button">
                {RECOMMENDATION_COPY.startAnalysis}
              </Link>
            </div>
          </div>
        ) : null}

        {showEmptyHits ? (
          <p className="message" role="status">
            {RECOMMENDATION_COPY.empty}
          </p>
        ) : null}

        {bindPhase === "ready" && patternRows.length > 0 ? (
          <div className="treffer-pattern-toggle">
            <button
              type="button"
              className="button button-quiet"
              aria-expanded={showPattern}
              onClick={() => setShowPattern((open) => !open)}
            >
              {RECOMMENDATION_COPY.patternHeading}
            </button>
            {showPattern ? (
              <section className="section-card treffer-pattern" aria-label={RECOMMENDATION_COPY.patternHeading}>
                <ul className="treffer-pattern-list">
                  {patternRows.map((row) => (
                    <li key={row.key}>
                      <p className="hit-label">{row.label}</p>
                      <p className="hint">
                        {[row.levelBadge, row.baselineLabel, row.methodLabel].filter(Boolean).join(" · ")}
                      </p>
                      {row.missing ? (
                        <p className="message">{RECOMMENDATION_COPY.missingValue}</p>
                      ) : row.coverage === "series" ? (
                        <Sparkline points={row.series} tone="pattern" />
                      ) : row.coverage === "single" ? (
                        <p className="treffer-stichtag">{stichtagCopy(row.stichtagValue, row.stichtagYear)}</p>
                      ) : (
                        <p className="message">{RECOMMENDATION_COPY.missingValue}</p>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}

        {cards.length > 0 ? (
          <ol className="rec-list">
            {cards.map((card) => (
              <li key={card.id}>
                <TrefferCard card={card} selected={selectedHitId === card.id} onSelect={() => setSelectedHitId(card.id)} />
              </li>
            ))}
          </ol>
        ) : null}
      </div>

      <aside className="treffer-map" aria-label="Lage">
        <MapView
          pins={karte.pins}
          empfehlungen={karte.empfehlungen}
          hits={karte.hits}
          hitMarkers={karte.hitMarkers}
          region={karte.region}
          cameraKey={cameraKey}
          camera={karte.camera}
          markerKey={karte.markerKey}
          regionKey={karte.regionKey}
          hitKey={karte.hitKey}
          selectedHitId={selectedHitId}
          regionFrameOnly={karte.regionFrameOnly}
          onSelectHit={setSelectedHitId}
        />
      </aside>
    </div>
  );
}

function TrefferCard({
  card,
  selected,
  onSelect,
}: {
  card: TrefferCardView;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <article className={selected ? "section-card rec-card is-selected" : "section-card rec-card"}>
      <button type="button" className="treffer-card-head" onClick={onSelect}>
        <p className="treffer-rank">{`Rang ${card.rank}`}</p>
        <h2>{card.name}</h2>
        <p className="hint">
          {card.badge}
          {card.parentLabel ? ` ${card.parentLabel}` : ""}
        </p>
      </button>
      {card.intersection ? <p className="hint">{card.intersection}</p> : null}
      {card.trendSummary ? <p className="summary-line">{card.trendSummary}</p> : null}
      <p className="message">{card.rationale}</p>
      {card.geometryHint ? <p className="hint">{card.geometryHint}</p> : null}
      <ul className="treffer-criteria">
        {card.criteria.map((row) => (
          <CriterionRow key={row.key} row={row} />
        ))}
        {card.inherited.map((row) => (
          <CriterionRow key={row.key} row={row} inherited />
        ))}
      </ul>
      <details>
        <summary>{RECOMMENDATION_COPY.details}</summary>
        <ul className="treffer-details">
          {[...card.criteria, ...card.inherited].map((row) => (
            <li key={`detail-${row.key}`}>
              <p className="hit-label">{row.label}</p>
              {row.details.rawValue ? <p className="hint">{row.details.rawValue}</p> : null}
              <p className="message">{row.details.evidence}</p>
              {row.details.years.length > 0 ? (
                <ol>
                  {row.details.years.map((year) => (
                    <li key={year.period}>
                      {year.period}: {year.normalized}
                      {year.raw ? ` · Rohwert ${year.raw}` : ""}
                      {year.baseline ? ` · ${year.baseline}` : ""}
                    </li>
                  ))}
                </ol>
              ) : null}
            </li>
          ))}
        </ul>
      </details>
    </article>
  );
}

function CriterionRow({ row, inherited = false }: { row: TrefferCriterionRow; inherited?: boolean }) {
  return (
    <li className={inherited ? "treffer-criterion is-inherited" : "treffer-criterion"}>
      <div className="treffer-criterion-charts">
        {row.missing ? (
          <p className="message">{RECOMMENDATION_COPY.missingValue}</p>
        ) : row.coverage === "series" ? (
          <Sparkline points={row.series} tone="hit" />
        ) : row.coverage === "single" ? (
          <p className="treffer-stichtag">{stichtagCopy(row.stichtagValue, row.stichtagYear)}</p>
        ) : (
          <p className="message">{RECOMMENDATION_COPY.missingValue}</p>
        )}
        {row.direction === "up" ? <span aria-label="steigend">↑</span> : null}
        {row.direction === "down" ? <span aria-label="fallend">↓</span> : null}
        {row.direction === "flat" ? <span aria-label="gleichbleibend">→</span> : null}
        {row.patternMissing ? (
          <p className="hint treffer-pattern-missing">{RECOMMENDATION_COPY.missingValue}</p>
        ) : (
          <Sparkline points={row.patternSeries} tone="pattern" />
        )}
      </div>
      <div className="treffer-criterion-meta">
        <p className="hit-label">{row.label}</p>
        <p className="hint">
          {[row.baselineLabel, row.levelBadge, row.methodLabel, inherited ? row.inheritedLabel : null]
            .filter(Boolean)
            .join(" · ")}
        </p>
      </div>
    </li>
  );
}

function Sparkline({ points, tone }: { points: SparkPoint[]; tone: "hit" | "pattern" }) {
  const present = points
    .map((point, index) => ({ index, value: point.value }))
    .filter((point): point is { index: number; value: number } => point.value != null);
  if (present.length < 2) return null;
  const values = present.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const width = 72;
  const height = 28;
  const step = points.length > 1 ? width / (points.length - 1) : width;
  const path = present
    .map((point, offset) => {
      const x = point.index * step;
      const y = height - 4 - ((point.value - min) / span) * (height - 8);
      return `${offset === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={tone === "pattern" ? "sparkline is-pattern" : "sparkline"} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}
