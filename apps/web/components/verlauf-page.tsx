"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MonthlyRevenuePoint, RecommendationSet, StoreLocation, TargetRegion } from "@/lib/api";
import { getAnalysisApi } from "@/lib/analysis/api";
import { ensureMarkedKey, markedRegion, regionListKey } from "@/lib/locations/regions";
import { getLocationApi } from "@/lib/locations/api";
import { buildKarte } from "@/lib/map/karte";
import { getRecommendationApi } from "@/lib/recommendations/api";
import { recommendationStatus } from "@/lib/recommendations/model";
import { errorText } from "@/lib/user-message";
import { formatStandLine, loadPatternForMarkedRegion, type BoundVerlauf } from "@/lib/verlauf/bind";
import {
  POST_STANDORTE_HREF,
  SELECTABLE_AREA_LEVELS,
  VERLAUF_COPY,
  buildVerlaufHero,
  optionalRevenueCount,
  regionView,
} from "@/lib/verlauf/model";
import { CatalogParentName } from "./catalog-parent-name";
import { ProofMap } from "./proof-map";
import { useSession } from "./session-provider";

type PagePhase = "loading" | "idle" | "failed";
type RecPhase = "idle" | "running" | "failed";

export function VerlaufPage() {
  const { session } = useSession();
  const analysisApi = getAnalysisApi();
  const recommendationApi = getRecommendationApi();
  const locationApi = getLocationApi();
  const [pagePhase, setPagePhase] = useState<PagePhase>("loading");
  const [recPhase, setRecPhase] = useState<RecPhase>("idle");
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const [bound, setBound] = useState<BoundVerlauf | null>(null);
  const [boundKey, setBoundKey] = useState<string | null>(null);
  const [bindFailed, setBindFailed] = useState(false);
  const [recommendationSet, setRecommendationSet] = useState<RecommendationSet | null>(null);
  const [regions, setRegions] = useState<TargetRegion[]>([]);
  const [markedKey, setMarkedKey] = useState<string | null>(null);
  const [stores, setStores] = useState<StoreLocation[] | null>(null);
  const [revenue, setRevenue] = useState<MonthlyRevenuePoint[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const request = useRef(0);
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
  const boundPattern = bindPhase === "ready" ? (bound?.pattern ?? null) : null;
  const boundRecommendations =
    bindPhase === "ready" && bound && recommendationSet && recommendationSet.runId === bound.runId
      ? recommendationSet
      : null;
  const hero = visible ? buildVerlaufHero({ pattern: boundPattern, recommendations: boundRecommendations, revenue }) : null;
  const status =
    visible && boundRecommendations && recPhase !== "running" && bindPhase === "ready"
      ? recommendationStatus(boundRecommendations)
      : null;
  const revenueCount = optionalRevenueCount(revenue);
  const standLine = bindPhase === "ready" && bound ? formatStandLine(bound.createdAt, bound.region) : null;
  const showEmpty = visible && pagePhase === "idle" && bindPhase === "empty" && visibleRegions.length > 0;

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
      setStores(null);
      setRevenue([]);
      setLoadError(null);
      setActionError(null);
      try {
        const [nextSet, nextRegions, nextStores] = await Promise.all([
          recommendationApi.getRecommendations(),
          locationApi.listTargetRegions(),
          locationApi.listStores(),
        ]);
        if (cancelled) return;
        setRecommendationSet(nextSet);
        setRegions(nextRegions);
        setMarkedKey(ensureMarkedKey(nextRegions, null));
        setStores(nextStores);
        setLoadedEmail(email);
        setPagePhase("idle");
        const first = nextStores[0];
        if (first) {
          try {
            const rows = await locationApi.listStoreRevenue(first.id);
            if (!cancelled) setRevenue(rows);
          } catch {
            if (!cancelled) setRevenue([]);
          }
        }
      } catch (caught) {
        if (cancelled) return;
        setLoadError(errorText(caught, "Der Verlauf konnte nicht geladen werden."));
        setLoadedEmail(email);
        setPagePhase("failed");
      }
    })();

    return () => {
      cancelled = true;
      request.current += 1;
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
      } catch {
        if (bindRequest.current !== token) return;
        setBound(null);
        setBoundKey(key);
        setBindFailed(true);
      }
    })();
  }, [session, pagePhase, regions, markedKey, analysisApi]);

  async function onCreate() {
    if (!bound || bindPhase !== "ready") return;
    const token = request.current + 1;
    request.current = token;
    setRecPhase("running");
    setActionError(null);
    try {
      const created = await recommendationApi.createRecommendations({ runId: bound.runId });
      if (request.current !== token) return;
      setRecommendationSet(created);
      setRecPhase("idle");
    } catch (caught) {
      if (request.current !== token) return;
      setActionError(errorText(caught, "Empfehlungen konnten nicht ermittelt werden."));
      setRecPhase("failed");
    }
  }

  const karte = useMemo(
    () =>
      buildKarte({
        stores: visible ? (stores ?? []) : [],
        regions: visible ? regions : [],
        markedKey: visible ? markedKey : null,
        recommendations: visible ? (boundRecommendations?.items ?? []) : [],
        addressesKnownEmpty: Boolean(visible && stores && stores.length === 0),
      }),
    [visible, stores, regions, markedKey, boundRecommendations],
  );
  const cameraKey = !session || (visible && pagePhase !== "loading") ? karte.cameraKey : null;

  if (!session) {
    return (
      <main className="sheet" id="inhalt">
        <p className="stub-kicker">{VERLAUF_COPY.kicker}</p>
        <h1>{VERLAUF_COPY.title}</h1>
        <p className="stub-copy">{VERLAUF_COPY.signedOut}</p>
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
    <div
      className="verlauf-page"
      id="inhalt"
      data-post-standorte={POST_STANDORTE_HREF}
      aria-busy={recPhase === "running" || pagePhase === "loading" || bindPhase === "loading"}
    >
      <div className="verlauf-hero">
        <p className="verlauf-kicker">{VERLAUF_COPY.kicker}</p>
        {visibleRegions.length > 0 ? (
          <ul className="verlauf-region-list">
            {visibleRegions.map((region) => {
              const view = regionView(region);
              const key = regionListKey(region);
              const selected = marked != null && key === regionListKey(marked);
              return (
                <li key={`${key}-${region.updatedAt}`} className={selected ? "verlauf-region is-marked" : "verlauf-region"}>
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
          <p className="verlauf-region">Noch keine Zielregion gespeichert.</p>
        )}
        <p className="verlauf-levels">
          {VERLAUF_COPY.levels} {VERLAUF_COPY.gemeindeHint}
        </p>
        <ol className="verlauf-level-list">
          {SELECTABLE_AREA_LEVELS.map((level) => (
            <li key={level}>
              <Link href="/standorte#zielregion">{level}</Link>
            </li>
          ))}
        </ol>

        {standLine ? (
          <p className="verlauf-stand" role="status">
            {standLine}
          </p>
        ) : null}

        {pagePhase === "loading" || bindPhase === "loading" ? <p className="message">Verlauf wird geladen …</p> : null}
        {recPhase === "running" ? (
          <p className="message" role="status" aria-live="polite">
            {VERLAUF_COPY.running}
          </p>
        ) : null}
        {loadError ? (
          <p className="message message-error" role="alert">
            {loadError}
          </p>
        ) : null}
        {bindPhase === "failed" ? (
          <p className="message message-error" role="alert">
            {VERLAUF_COPY.analysisFailed}
          </p>
        ) : null}
        {recPhase === "failed" && actionError ? (
          <p className="message message-error" role="alert">
            {actionError}
          </p>
        ) : null}

        {showEmpty ? (
          <div className="verlauf-empty">
            <p className="message" role="status">
              {VERLAUF_COPY.missingRun}
            </p>
            <div className="auth-actions">
              <Link href="/musteranalyse" className="button">
                {VERLAUF_COPY.startAnalysis}
              </Link>
              <Link href="/standorte" className="button button-quiet">
                {VERLAUF_COPY.toStandorte}
              </Link>
            </div>
          </div>
        ) : (
          <div className="auth-actions">
            <button
              type="button"
              className="button"
              onClick={onCreate}
              disabled={pagePhase === "loading" || recPhase === "running" || bindPhase !== "ready" || !bound}
            >
              {VERLAUF_COPY.compute}
            </button>
            <Link href="/standorte" className="button button-quiet">
              {VERLAUF_COPY.toStandorte}
            </Link>
            <Link href="/musteranalyse" className="button button-quiet">
              {VERLAUF_COPY.toAnalysis}
            </Link>
          </div>
        )}

        {hero ? (
          <section className="verlauf-compare" aria-labelledby="muster-held">
            <p className="verlauf-kicker">{hero.heading}</p>
            <h1 id="muster-held">{hero.change}</h1>
            {hero.series.length > 0 ? (
              <ul className="verlauf-series">
                {hero.series.map((item) => (
                  <li key={`${item.metricId}-${item.requestedGeoKey}`}>
                    <p className="verlauf-year-label">{item.label}</p>
                    {item.sourceNote ? <p className="verlauf-source-note">{item.sourceNote}</p> : null}
                    <ol className={item.showTrend ? "verlauf-years is-trend" : "verlauf-years"}>
                      {item.points.map((point) => (
                        <li key={point.period} data-status={point.status}>
                          <p className="verlauf-year-label">{point.period}</p>
                          <p className={point.status === "absent" ? "verlauf-year-value is-absent" : "verlauf-year-value"}>
                            {point.display}
                          </p>
                        </li>
                      ))}
                    </ol>
                  </li>
                ))}
              </ul>
            ) : null}
            {hero.criteria.length > 0 ? (
              <ul className="verlauf-criteria">
                {hero.criteria.map((criterion) => (
                  <li key={criterion.key}>
                    <p className="verlauf-year-label">{criterion.label}</p>
                    <p className="verlauf-year-value">{criterion.direction}</p>
                    <p className="verlauf-year-evidence">{criterion.evidence}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            {hero.months.length > 0 ? (
              <ol className="verlauf-months" aria-label="Monate im Bewertungsfenster">
                {hero.months.map((month) => (
                  <li key={month}>{month}</li>
                ))}
              </ol>
            ) : null}
            {hero.nextSentence || hero.nextAddress ? (
              <div className="verlauf-next">
                <p className="verlauf-kicker">{hero.nextHeading}</p>
                {hero.nextSentence ? <p className="verlauf-next-text">{hero.nextSentence}</p> : null}
                {hero.nextAddress ? (
                  <p className="verlauf-next-address">
                    {VERLAUF_COPY.nextLead} {hero.nextAddress}.
                  </p>
                ) : null}
              </div>
            ) : null}
          </section>
        ) : null}

        {visible && !boundRecommendations && bindPhase === "ready" && recPhase === "idle" ? (
          <p className="message">{VERLAUF_COPY.noneYet}</p>
        ) : null}
        {status?.thin ? <p className="banner">{VERLAUF_COPY.thin}</p> : null}
        {status?.empty ? (
          <p className="message" role="status">
            {VERLAUF_COPY.empty}
          </p>
        ) : null}
        {status?.reason ? <p className="message">{status.reason}</p> : null}

        {hero && hero.top3.length > 0 ? (
          <section className="verlauf-top" aria-labelledby="top3-title">
            <h2 id="top3-title">{VERLAUF_COPY.top3}</h2>
            <ol className="verlauf-top3">
              {hero.top3.map((entry) => (
                <li key={entry.id}>
                  <p className="verlauf-rank">Rang {entry.rank}</p>
                  <p className="verlauf-address">{entry.address}</p>
                  <p className="verlauf-rationale">{entry.rationale}</p>
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        <details className="verlauf-revenue">
          <summary>{VERLAUF_COPY.revenueOptional}</summary>
          {revenueCount === 0 ? (
            <p className="message">Kein Monatsumsatz hinterlegt. Das ist optional und nicht der Motor.</p>
          ) : (
            <ol className="verlauf-months verlauf-months-quiet">
              {revenue
                .filter((point) => point.revenueEur != null)
                .map((point) => (
                  <li key={`${point.year}-${point.month}`}>
                    {String(point.month).padStart(2, "0")}.{point.year}
                  </li>
                ))}
            </ol>
          )}
        </details>
      </div>

      <aside className="verlauf-proof" aria-label={VERLAUF_COPY.proof}>
        <p className="verlauf-kicker">{VERLAUF_COPY.proof}</p>
        <ProofMap karte={karte} cameraKey={cameraKey} error={visible ? null : loadError} />
      </aside>
    </div>
  );
}
