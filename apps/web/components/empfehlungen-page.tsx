"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RecommendationSet, TargetRegion } from "@/lib/api";
import { ApiError } from "@/lib/api/types";
import { getAnalysisApi } from "@/lib/analysis/api";
import { analysisFailureFromHttp, ANALYSIS_FAILURE_COPY, isMarkedTargetRegionNotFound } from "@/lib/analysis/failure";
import { analysisStartLocked, isInFlightStatus } from "@/lib/analysis/poll";
import { rememberStartedRun } from "@/lib/analysis/started-runs";
import { clearMarkedKey } from "@/lib/locations/marked-region";
import { usePersistedMarkedKey } from "./use-persisted-marked-key";
import { MarkedRegionMissingNotice } from "./marked-region-missing";
import { markedRegion, regionListKey } from "@/lib/locations/regions";
import { getLocationApi } from "@/lib/locations/api";
import { buildTrefferlisteKarte } from "@/lib/map/karte";
import {
  RECOMMENDATION_COPY,
  buildPatternProfile,
  buildTrefferlisteCards,
  headingForMarkedRegion,
  isLegacyTargetRegionSet,
  rankLabel,
  stichtagCopy,
  targetRegionKeyOf,
  trefferStatusCopy,
  type SparkPoint,
  type TrefferCardView,
  type TrefferCriterionRow,
} from "@/lib/recommendations/model";
import { errorText } from "@/lib/user-message";
import { formatStandPrefix, markedStandRegions, type BoundVerlauf } from "@/lib/verlauf/bind";
import { bindTrefferlisteForRegion, loadTrefferlisteAfterCompletedRun, pollTrefferlisteRun } from "@/lib/recommendations/bind";
import { CatalogHitLabel } from "./catalog-hit-label";
import { RunRegionLabel } from "./run-region-label";
import { useSession } from "./session-provider";

const MapView = dynamic(() => import("./map-view").then((mod) => mod.MapView), {
  ssr: false,
  loading: () => <div className="map-status">Karte wird geladen …</div>,
});

type PagePhase = "loading" | "idle" | "failed";
type RunPhase = "idle" | "queued" | "running" | "failed" | "deadline";

export function EmpfehlungenPage() {
  const { session } = useSession();
  const analysisApi = getAnalysisApi();
  const locationApi = getLocationApi();
  const [pagePhase, setPagePhase] = useState<PagePhase>("loading");
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const [bound, setBound] = useState<BoundVerlauf | null>(null);
  const [boundKey, setBoundKey] = useState<string | null>(null);
  const [bindFailed, setBindFailed] = useState(false);
  const [recommendationSet, setRecommendationSet] = useState<RecommendationSet | null>(null);
  const [regions, setRegions] = useState<TargetRegion[]>([]);
  const [markedKey, setMarkedKey] = usePersistedMarkedKey(regions);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [runPhase, setRunPhase] = useState<RunPhase>("idle");
  const [runError, setRunError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [runLock, setRunLock] = useState(false);
  const [bindNonce, setBindNonce] = useState(0);
  const [showPattern, setShowPattern] = useState(false);
  const [selectedHitId, setSelectedHitId] = useState<string | null>(null);
  const bindRequest = useRef(0);
  const inflightByKey = useRef(new Map<string, string>());
  const pollAbort = useRef<AbortController | null>(null);
  const startGate = useRef(false);

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
  const status = trefferStatusCopy({
    pageLoading: pagePhase === "loading",
    bindLoading: bindPhase === "loading" || starting,
    runStatus: runPhase,
  });
  const inFlight = runPhase === "queued" || runPhase === "running";
  const startLocked = analysisStartLocked({
    starting,
    runStatus: runPhase,
    otherInFlight: runLock,
  });
  const boundRecommendations =
    bindPhase === "ready" &&
    !inFlight &&
    bound &&
    recommendationSet &&
    recommendationSet.runId === bound.runId
      ? recommendationSet
      : null;
  const cards = useMemo(
    () => (bindPhase === "ready" && !inFlight ? buildTrefferlisteCards(boundRecommendations, marked) : []),
    [bindPhase, boundRecommendations, marked, inFlight],
  );
  const patternRows = useMemo(
    () =>
      bindPhase === "ready" && !inFlight ? buildPatternProfile(boundRecommendations?.patternByDataset) : [],
    [bindPhase, boundRecommendations, inFlight],
  );
  const runRegions = bindPhase === "ready" && !inFlight && bound ? markedStandRegions(bound, marked) : [];
  const standPrefix =
    bindPhase === "ready" && !inFlight && bound ? formatStandPrefix(bound.createdAt) : null;
  const heading = headingForMarkedRegion(marked);
  const legacySet = Boolean(boundRecommendations && isLegacyTargetRegionSet(boundRecommendations.items));
  const showEmptyRun =
    visible &&
    pagePhase === "idle" &&
    !inFlight &&
    runPhase === "idle" &&
    !starting &&
    bindPhase !== "loading" &&
    (bindPhase === "empty" || (bindPhase === "ready" && !boundRecommendations)) &&
    visibleRegions.length > 0;
  const showLegacySet = bindPhase === "ready" && !inFlight && legacySet;
  const showEmptyHits =
    bindPhase === "ready" && !inFlight && Boolean(boundRecommendations) && cards.length === 0 && !legacySet;
  const showRestart =
    (runPhase === "failed" || runPhase === "deadline") &&
    !showLegacySet &&
    runError !== ANALYSIS_FAILURE_COPY.markedTargetRegionMissing;
  const showMarkedRegionMissing = runError === ANALYSIS_FAILURE_COPY.markedTargetRegionMissing;

  function stopPolling() {
    pollAbort.current?.abort();
    pollAbort.current = null;
  }

  function rememberInflight(key: string | null, id: string | null) {
    if (!key) return;
    if (id) inflightByKey.current.set(key, id);
    else inflightByKey.current.delete(key);
    setRunLock(inflightByKey.current.size > 0);
  }

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
      setLoadError(null);
      setRunPhase("idle");
      setRunError(null);
      setStarting(false);
      try {
        const nextRegions = await locationApi.listTargetRegions();
        if (cancelled) return;
        setRegions(nextRegions);
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
      stopPolling();
    };
  }, [session, locationApi]);

  useEffect(() => {
    if (!session || pagePhase !== "idle") return;
    const current = markedRegion(regions, markedKey);
    const key = current ? regionListKey(current) : null;
    const token = bindRequest.current + 1;
    bindRequest.current = token;
    stopPolling();

    void (async () => {
      try {
        const inflight = key ? inflightByKey.current.get(key) : undefined;
        const next = await bindTrefferlisteForRegion(analysisApi, current, inflight);
        if (bindRequest.current !== token) return;
        setStarting(false);
        if (next.kind === "in_flight") {
          setBound(null);
          setRecommendationSet(null);
          setBoundKey(key);
          setBindFailed(false);
          setSelectedHitId(null);
          setRunPhase(next.status);
          rememberInflight(key, next.runId);
          const controller = new AbortController();
          pollAbort.current = controller;
          const settled = await pollTrefferlisteRun(analysisApi, next.runId, current, {
            signal: controller.signal,
            onStatus: (status) => {
              if (bindRequest.current !== token) return;
              setRunPhase(status);
            },
          });
          if (bindRequest.current !== token || settled.kind === "aborted") return;
          rememberInflight(key, null);
          if (settled.kind === "deadline") {
            setRunPhase("deadline");
            setRunError(RECOMMENDATION_COPY.analysisDeadline);
            return;
          }
          if (settled.kind === "failed") {
            setRunPhase("failed");
            setRunError(settled.message);
            return;
          }
          if (settled.kind === "ready") {
            setBound(settled.bound);
            setRecommendationSet(settled.set);
            setBoundKey(key);
            setBindFailed(false);
            setRunPhase("idle");
            setRunError(null);
            setSelectedHitId(null);
            return;
          }
          setBound(null);
          setRecommendationSet(null);
          setBoundKey(key);
          setRunPhase("idle");
          return;
        }
        if (next.kind === "failed") {
          setBound(null);
          setRecommendationSet(null);
          setBoundKey(key);
          setBindFailed(false);
          setSelectedHitId(null);
          setRunPhase("failed");
          setRunError(next.message);
          rememberInflight(key, null);
          return;
        }
        if (next.kind === "ready") {
          setBound(next.bound);
          setRecommendationSet(next.set);
          setBoundKey(key);
          setBindFailed(false);
          setSelectedHitId(null);
          setRunPhase("idle");
          if (key) rememberInflight(key, null);
          return;
        }
        setBound(null);
        setRecommendationSet(null);
        setBoundKey(key);
        setBindFailed(false);
        setSelectedHitId(null);
        setRunPhase("idle");
      } catch {
        if (bindRequest.current !== token) return;
        setStarting(false);
        setBound(null);
        setRecommendationSet(null);
        setBoundKey(key);
        setBindFailed(true);
        setSelectedHitId(null);
        setRunPhase("idle");
      }
    })();
  }, [session, pagePhase, regions, markedKey, analysisApi, bindNonce]);

  async function onStartAnalysis() {
    const current = markedRegion(regions, markedKey);
    const key = current ? regionListKey(current) : null;
    if (!current || !key) return;
    if (
      startGate.current ||
      analysisStartLocked({
        starting,
        runStatus: runPhase,
        otherInFlight: inflightByKey.current.size > 0,
      })
    ) {
      return;
    }
    startGate.current = true;
    const token = bindRequest.current + 1;
    bindRequest.current = token;
    stopPolling();
    setStarting(true);
    setRunError(null);
    setBindFailed(false);
    setRunPhase("idle");
    try {
      const created = await analysisApi.createAnalysisRun({ geoKey: targetRegionKeyOf(current) });
      if (current.geoKey) rememberStartedRun(current.geoKey, created.id);
      if (isInFlightStatus(created.status)) {
        rememberInflight(key, created.id);
      }
      setStarting(false);
      if (bindRequest.current !== token) return;
      if (isInFlightStatus(created.status)) {
        setRunPhase(created.status);
        setBound(null);
        setRecommendationSet(null);
        setBoundKey(key);
        const controller = new AbortController();
        pollAbort.current = controller;
        const settled = await pollTrefferlisteRun(analysisApi, created.id, current, {
          signal: controller.signal,
          onStatus: (status) => {
            if (bindRequest.current !== token) return;
            setRunPhase(status);
          },
        });
        if (bindRequest.current !== token || settled.kind === "aborted") return;
        rememberInflight(key, null);
        if (settled.kind === "deadline") {
          setRunPhase("deadline");
          setRunError(RECOMMENDATION_COPY.analysisDeadline);
          return;
        }
        if (settled.kind === "failed") {
          setRunPhase("failed");
          setRunError(settled.message);
          return;
        }
        if (settled.kind === "ready") {
          setBound(settled.bound);
          setRecommendationSet(settled.set);
          setBoundKey(key);
          setRunPhase("idle");
          setRunError(null);
          setSelectedHitId(null);
          return;
        }
        setBound(null);
        setRecommendationSet(null);
        setRunPhase("idle");
        return;
      }
      if (created.status === "failed") {
        rememberInflight(key, null);
        setRunPhase("failed");
        setRunError(analysisFailureFromHttp(0, created.failureReason));
        setBoundKey(key);
        return;
      }
      rememberInflight(key, null);
      const loaded = await loadTrefferlisteAfterCompletedRun(analysisApi, created.id, current);
      if (bindRequest.current !== token) return;
      if (loaded.kind === "ready") {
        setBound(loaded.bound);
        setRecommendationSet(loaded.set);
        setBoundKey(key);
        setRunPhase("idle");
        setSelectedHitId(null);
        return;
      }
      setBound(null);
      setRecommendationSet(null);
      setBoundKey(key);
      setRunPhase("idle");
    } catch (caught) {
      if (bindRequest.current !== token) return;
      setStarting(false);
      setRunPhase("failed");
      if (isMarkedTargetRegionNotFound(caught)) {
        clearMarkedKey();
        setRunError(ANALYSIS_FAILURE_COPY.markedTargetRegionMissing);
      } else {
        const status = caught instanceof ApiError ? caught.status : 0;
        const message = caught instanceof ApiError ? caught.message : null;
        const code = caught instanceof ApiError ? caught.code : null;
        setRunError(analysisFailureFromHttp(status, message, code));
      }
      setBoundKey(key);
    } finally {
      startGate.current = false;
    }
  }

  const karte = useMemo(
    () =>
      buildTrefferlisteKarte({
        region: marked,
        items: cards
          .map((card) => boundRecommendations?.items.find((item) => item.id === card.id))
          .filter((item): item is NonNullable<typeof item> => Boolean(item)),
      }),
    [marked, cards, boundRecommendations],
  );
  const cameraKey = !session || (visible && pagePhase !== "loading") ? karte.cameraKey : null;
  const busy = pagePhase === "loading" || bindPhase === "loading" || starting || inFlight;

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
    <div className="treffer-page" id="inhalt" aria-busy={busy}>
      <div className="treffer-list">
        <p className="stub-kicker">Empfehlung</p>
        {visibleRegions.length > 0 ? (
          <ul className="treffer-region-list">
            {visibleRegions.map((region) => {
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
                    <CatalogHitLabel source={region} />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="message">Noch keine Zielregion gespeichert.</p>
        )}

        {standPrefix ? (
          <div className="treffer-stand" role="status">
            {standPrefix}
            <RunRegionLabel regions={runRegions} catalog={visibleRegions} />
          </div>
        ) : null}
        <h1>{heading ?? RECOMMENDATION_COPY.title}</h1>

        {status.text ? (
          <p
            className={status.tone === "error" ? "message message-error" : "message"}
            role={status.tone === "error" ? "alert" : "status"}
          >
            {status.text}
          </p>
        ) : null}
        {loadError ? (
          <p className="message message-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {bindPhase === "failed" && !inFlight ? (
          <div className="treffer-load-error">
            <p className="message" role="status">
              {RECOMMENDATION_COPY.loadFailed}
            </p>
            <button type="button" className="button" onClick={() => setBindNonce((value) => value + 1)}>
              {RECOMMENDATION_COPY.retryLoad}
            </button>
          </div>
        ) : null}
        {showMarkedRegionMissing ? <MarkedRegionMissingNotice /> : null}
        {runPhase === "failed" && runError && !showMarkedRegionMissing ? (
          <p className="message message-error" role="alert">
            {runError}
          </p>
        ) : null}

        {showEmptyRun ? (
          <div className="treffer-empty">
            <p className="message" role="status">
              {RECOMMENDATION_COPY.missingRun}
            </p>
            <div className="auth-actions">
              <button
                type="button"
                className="button"
                onClick={() => void onStartAnalysis()}
                disabled={startLocked}
              >
                {RECOMMENDATION_COPY.startAnalysis}
              </button>
            </div>
          </div>
        ) : null}

        {showLegacySet ? (
          <div className="treffer-empty">
            <p className="message" role="status">
              {RECOMMENDATION_COPY.legacySet}
            </p>
            <div className="auth-actions">
              <button
                type="button"
                className="button"
                onClick={() => void onStartAnalysis()}
                disabled={startLocked}
              >
                {RECOMMENDATION_COPY.restartAnalysis}
              </button>
            </div>
          </div>
        ) : null}

        {showRestart ? (
          <div className="auth-actions">
            <button
              type="button"
              className="button"
              onClick={() => void onStartAnalysis()}
              disabled={startLocked}
            >
              {RECOMMENDATION_COPY.restartAnalysis}
            </button>
          </div>
        ) : null}

        {showEmptyHits ? (
          <p className="message" role="status">
            {RECOMMENDATION_COPY.empty}
          </p>
        ) : null}

        {bindPhase === "ready" && !inFlight && !legacySet && patternRows.length > 0 ? (
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
        <p className="treffer-rank">{rankLabel(card.rank)}</p>
        <h2>{card.name}</h2>
        <p className="hint">
          {card.badge}
          {card.parentLabel ? ` ${card.parentLabel}` : ""}
        </p>
        {card.intersection ? <p className="hint">{card.intersection}</p> : null}
        {card.lage ? <p className="hint treffer-lage">{card.lage}</p> : null}
      </button>
      {card.stichtagLabel ? <p className="treffer-stichtag">{card.stichtagLabel}</p> : null}
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
        {card.overlapDetails.length > 0 ? (
          <ul className="treffer-overlap-details">
            {card.overlapDetails.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        ) : null}
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
  if (present.length === 0) return null;
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
  const first = present[0];
  const x0 = first ? first.index * step : 0;
  const y0 = first ? height - 4 - ((first.value - min) / span) * (height - 8) : height / 2;
  return (
    <svg className={tone === "pattern" ? "sparkline is-pattern" : "sparkline"} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {present.length > 1 ? <path d={path} fill="none" stroke="currentColor" strokeWidth="1.75" /> : null}
      {present.length === 1 ? <circle cx={x0} cy={y0} r="2.25" fill="currentColor" /> : null}
    </svg>
  );
}
