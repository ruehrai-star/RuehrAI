"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Recommendation, RecommendationSet } from "@/lib/api";
import { criterionDirectionLabel } from "@/lib/analysis/model";
import { getRecommendationApi } from "@/lib/recommendations/api";
import {
  RECOMMENDATION_COPY,
  formatAddress,
  formatLocationMeta,
  formatScore,
  formatWindow,
  rankLabel,
  recommendationSourceLabel,
  recommendationStatus,
  shortCriteria,
} from "@/lib/recommendations/model";
import { errorText } from "@/lib/user-message";
import { useSession } from "./session-provider";

type Phase = "loading" | "idle" | "running" | "failed";

export function EmpfehlungenPage() {
  const { session } = useSession();
  const api = getRecommendationApi();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const [set, setSet] = useState<RecommendationSet | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const request = useRef(0);

  const visible = Boolean(session && loadedEmail === session.email && phase !== "loading");
  const visibleSet = visible && phase !== "running" ? set : null;
  const status = visibleSet ? recommendationStatus(visibleSet) : null;

  useEffect(() => {
    if (!session) return;
    const email = session.email;
    let cancelled = false;

    void (async () => {
      setPhase("loading");
      setSet(null);
      setActionError(null);
      try {
        const latest = await api.getRecommendations();
        if (cancelled) return;
        setSet(latest);
        setLoadedEmail(email);
        setPhase("idle");
      } catch (caught) {
        if (cancelled) return;
        setActionError(errorText(caught, "Empfehlungen konnten nicht geladen werden."));
        setLoadedEmail(email);
        setPhase("failed");
      }
    })();

    return () => {
      cancelled = true;
      request.current += 1;
    };
  }, [session, api]);

  async function onCreate() {
    const token = request.current + 1;
    request.current = token;
    setPhase("running");
    setActionError(null);
    try {
      const created = await api.createRecommendations();
      if (request.current !== token) return;
      setSet(created);
      setPhase("idle");
    } catch (caught) {
      if (request.current !== token) return;
      setActionError(errorText(caught, "Empfehlungen konnten nicht ermittelt werden."));
      setPhase("failed");
    }
  }

  if (!session) {
    return (
      <main className="sheet" id="inhalt">
        <p className="stub-kicker">Empfehlung</p>
        <h1>{RECOMMENDATION_COPY.title}</h1>
        <p className="stub-copy">{RECOMMENDATION_COPY.subtitle}</p>
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
    <main className="sheet" id="inhalt" aria-busy={phase === "running" || phase === "loading"}>
      <p className="stub-kicker">Empfehlung</p>
      <h1>{RECOMMENDATION_COPY.title}</h1>
      <p className="stub-copy">{RECOMMENDATION_COPY.subtitle}</p>

      {phase === "loading" ? <p className="message">Empfehlungen werden geladen …</p> : null}
      {phase === "running" ? (
        <p className="message" role="status" aria-live="polite">
          {RECOMMENDATION_COPY.running}
        </p>
      ) : null}
      {phase === "failed" && actionError ? (
        <p className="message message-error" role="alert">
          {actionError}
        </p>
      ) : null}
      {visible && !visibleSet && phase === "idle" ? <p className="message">{RECOMMENDATION_COPY.noneYet}</p> : null}

      <div className="auth-actions">
        <button type="button" className="button" onClick={onCreate} disabled={phase === "loading" || phase === "running"}>
          {RECOMMENDATION_COPY.compute}
        </button>
        <Link href="/musteranalyse" className="button button-quiet">
          {RECOMMENDATION_COPY.toAnalysis}
        </Link>
      </div>

      {visibleSet ? (
        <section className="section-card" aria-labelledby="muster-kurz">
          <h2 id="muster-kurz">{RECOMMENDATION_COPY.patternHeading}</h2>
          <h3>{RECOMMENDATION_COPY.shortCriteriaHeading}</h3>
          {shortCriteria(visibleSet.pattern).length > 0 ? (
            <ul className="criterion-list">
              {shortCriteria(visibleSet.pattern).map((line) => (
                <li key={line} className="criterion">
                  <p className="hit-label">{line}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="message">{visibleSet.pattern.summary}</p>
          )}
          <p className="hint">Zeitraum {formatWindow(visibleSet.window)}</p>
        </section>
      ) : null}

      {visibleSet && status?.thin ? <p className="banner">{RECOMMENDATION_COPY.thin}</p> : null}
      {visibleSet && status?.empty ? (
        <p className="message" role="status">
          {RECOMMENDATION_COPY.empty}
        </p>
      ) : null}
      {visibleSet && status?.reason ? <p className="message">{status.reason}</p> : null}

      {visibleSet && visibleSet.items.length > 0 ? (
        <ol className="rec-list">
          {visibleSet.items.map((item) => (
            <li key={item.id}>
              <RecommendationCard item={item} />
            </li>
          ))}
        </ol>
      ) : null}
    </main>
  );
}

function RecommendationCard({ item }: { item: Recommendation }) {
  return (
    <article className="section-card rec-card">
      <h2>{rankLabel(item.rank)}</h2>
      <h3>{RECOMMENDATION_COPY.address}</h3>
      <p className="summary-line">{formatAddress(item)}</p>
      <p className="hint">
        {formatLocationMeta(item)} · {formatScore(item.score)}
      </p>
      <h3>{RECOMMENDATION_COPY.rationale}</h3>
      <p className="message">{item.rationale}</p>
      <details>
        <summary>{RECOMMENDATION_COPY.details}</summary>
        <p className="hint">Quelle: {recommendationSourceLabel(item.source)}</p>
        {item.criteriaEvidence.length > 0 ? (
          <ul className="criterion-list">
            {item.criteriaEvidence.map((evidence) => (
              <li key={evidence.key} className="criterion">
                <p className="hit-label">
                  {evidence.label} · {criterionDirectionLabel(evidence.direction)}
                </p>
                <p className="message">{evidence.evidence}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="message">Keine weiteren Angaben.</p>
        )}
      </details>
    </article>
  );
}
