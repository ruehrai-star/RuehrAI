"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { AnalysisInput, AnalysisPattern, AnalysisRun } from "@/lib/api";
import { getAnalysisApi } from "@/lib/analysis/api";
import {
  ANALYSIS_COPY,
  brainStatusText,
  criterionDirectionLabel,
  formatAnalysisSummary,
  patternSourceLabel,
  revenueDirectionLabel,
} from "@/lib/analysis/model";
import { analysisFailureFromHttp, analysisFailureMessage } from "@/lib/analysis/failure";
import { isInFlightStatus, pollAnalysisRun } from "@/lib/analysis/poll";
import { errorText } from "@/lib/user-message";
import { useSession } from "./session-provider";

type Phase = "loading" | "idle" | "running" | "failed" | "deadline";

export function MusteranalysePage() {
  const { session } = useSession();
  const api = getAnalysisApi();
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const [input, setInput] = useState<AnalysisInput | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [pattern, setPattern] = useState<AnalysisPattern | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const request = useRef(0);
  const pollAbort = useRef<AbortController | null>(null);

  const visible = Boolean(session && loadedEmail === session.email && phase !== "loading");
  const visibleInput = visible ? input : null;
  const visibleRun = visible && phase !== "running" ? run : null;
  const visiblePattern = visible && phase !== "running" ? pattern : null;
  const status = statusText(phase, visible, Boolean(visiblePattern));

  useEffect(() => {
    if (!session) return;
    const email = session.email;
    let cancelled = false;

    void (async () => {
      setPhase("loading");
      setInput(null);
      setInputError(null);
      setRun(null);
      setPattern(null);
      setReadError(null);
      setActionError(null);

      try {
        const nextInput = await api.getAnalysisInput();
        if (cancelled) return;
        setInput(nextInput);
      } catch (caught) {
        if (cancelled) return;
        setInputError(errorText(caught, "Die Eingaben konnten nicht geladen werden."));
      }

      try {
        const latest = await api.getAnalysisPattern();
        if (cancelled) return;
        if (latest) {
          setPattern(latest.pattern);
          try {
            const stored = await api.getAnalysisRun(latest.runId);
            if (cancelled) return;
            setRun(stored);
            setPattern(stored.pattern);
          } catch (caught) {
            if (cancelled) return;
            setReadError(errorText(caught, "Die Analyse konnte nicht geladen werden."));
          }
        }
      } catch (caught) {
        if (cancelled) return;
        setReadError(errorText(caught, "Das Muster konnte nicht geladen werden."));
      }

      if (cancelled) return;
      setLoadedEmail(email);
      setPhase("idle");
    })();

    return () => {
      cancelled = true;
      request.current += 1;
      pollAbort.current?.abort();
      pollAbort.current = null;
    };
  }, [session, api]);

  async function onStart() {
    const token = request.current + 1;
    request.current = token;
    pollAbort.current?.abort();
    const controller = new AbortController();
    pollAbort.current = controller;
    setPhase("running");
    setActionError(null);
    setReadError(null);
    try {
      const created = await api.createAnalysisRun();
      if (request.current !== token) return;
      let settled = created;
      if (isInFlightStatus(created.status)) {
        const outcome = await pollAnalysisRun(api, created.id, { signal: controller.signal });
        if (request.current !== token || outcome.kind === "aborted") return;
        if (outcome.kind === "deadline") {
          setActionError(ANALYSIS_COPY.deadline);
          setPhase("deadline");
          return;
        }
        if (outcome.kind === "failed") {
          setActionError(outcome.message);
          setPhase("failed");
          return;
        }
        settled = outcome.run;
      } else if (created.status === "failed") {
        setActionError(analysisFailureMessage(created.failureReason));
        setPhase("failed");
        return;
      }
      if (request.current !== token) return;
      setRun(settled);
      setPattern(settled.pattern);
      setReadError(null);
      setPhase("idle");
    } catch (caught) {
      if (request.current !== token) return;
      const status = caught instanceof Error && "status" in caught ? Number((caught as { status: number }).status) : 0;
      setActionError(
        analysisFailureFromHttp(status, caught instanceof Error ? caught.message : ANALYSIS_COPY.failed),
      );
      setPhase("failed");
    }
  }

  if (!session) {
    return (
      <main className="sheet" id="inhalt">
        <p className="stub-kicker">Analyse</p>
        <h1>{ANALYSIS_COPY.title}</h1>
        <p className="stub-copy">{ANALYSIS_COPY.help}</p>
        <p className="stub-copy">Die Musteranalyse steht nach der Anmeldung zur Verfügung.</p>
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

  const brain = visibleRun ? brainStatusText(visibleRun.brain) : null;

  return (
    <main className="sheet" id="inhalt" aria-busy={phase === "running" || phase === "loading"}>
      <p className="stub-kicker">Analyse</p>
      <h1>{ANALYSIS_COPY.title}</h1>
      <p className="stub-copy">{ANALYSIS_COPY.help}</p>

      <section className="section-card" aria-labelledby="analyse-eingabe">
        <h2 id="analyse-eingabe">Zusammenfassung</h2>
        <p className="summary-caption">{ANALYSIS_COPY.summary}</p>
        {visibleInput ? (
          <>
            <p className="summary-line">{formatAnalysisSummary(visibleInput)}</p>
            <p className="hint">Umsatzrichtung: {revenueDirectionLabel(visibleInput.revenueDirection)}</p>
          </>
        ) : null}
        {visible && inputError ? (
          <p className="message message-error" role="alert">
            {inputError}
          </p>
        ) : null}
      </section>

      {status ? (
        <p
          className={phase === "failed" || phase === "deadline" ? "message message-error" : "message"}
          role={phase === "failed" || phase === "deadline" ? "alert" : "status"}
          aria-live="polite"
        >
          {status}
        </p>
      ) : null}
      {phase === "failed" && actionError && actionError !== ANALYSIS_COPY.failed ? (
        <p className="message message-error">{actionError}</p>
      ) : null}
      {visible && readError ? (
        <p className="message message-error" role="alert">
          {readError}
        </p>
      ) : null}

      <div className="auth-actions">
        <button type="button" className="button" onClick={onStart} disabled={phase === "loading" || phase === "running"}>
          {phase === "failed" || phase === "deadline" ? ANALYSIS_COPY.restart : ANALYSIS_COPY.start}
        </button>
        <Link href="/standorte" className="button button-quiet">
          {ANALYSIS_COPY.back}
        </Link>
        {visiblePattern ? (
          <Link href="/verlauf" className="button">
            Verlauf
          </Link>
        ) : null}
        {visiblePattern ? (
          <Link href="/empfehlungen" className="button button-quiet">
            Empfehlungen
          </Link>
        ) : null}
      </div>

      {brain ? (
        <section className="section-card" aria-labelledby="brain-status">
          <h2 id="brain-status">{ANALYSIS_COPY.brainHeading}</h2>
          <p className="summary-line">{brain.mode}</p>
          {brain.detail ? (
            <p className={brain.tone === "info" ? "hint" : "message"}>{brain.detail}</p>
          ) : null}
        </section>
      ) : null}

      {visiblePattern ? (
        <section className="section-card" aria-labelledby="muster">
          <h2 id="muster">{ANALYSIS_COPY.patternHeading}</h2>
          <PatternView pattern={visiblePattern} />
        </section>
      ) : null}
    </main>
  );
}

function PatternView({ pattern }: { pattern: AnalysisPattern }) {
  return (
    <>
      <h3>{ANALYSIS_COPY.briefHeading}</h3>
      <p className="summary-line">{pattern.summary}</p>
      <p className="hint">
        Umsatzrichtung: {revenueDirectionLabel(pattern.revenueDirection)} · Quelle: {patternSourceLabel(pattern.source)}
      </p>
      {pattern.criteria.length > 0 ? (
        <>
          <h3>{ANALYSIS_COPY.criteriaHeading}</h3>
          <ul className="criterion-list">
            {pattern.criteria.map((criterion) => (
              <li key={criterion.key} className="criterion">
                <p className="hit-label">
                  {criterion.label} · {criterionDirectionLabel(criterion.direction)}
                </p>
                <p className="message">{criterion.evidence}</p>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </>
  );
}

function statusText(phase: Phase, visible: boolean, hasPattern: boolean): string | null {
  if (phase === "loading" || !visible) return "Eingaben werden geladen …";
  if (phase === "running") return ANALYSIS_COPY.running;
  if (phase === "deadline") return ANALYSIS_COPY.deadline;
  if (phase === "failed") return ANALYSIS_COPY.failed;
  if (!hasPattern) return ANALYSIS_COPY.empty;
  return null;
}
