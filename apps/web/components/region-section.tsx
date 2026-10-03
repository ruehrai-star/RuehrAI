"use client";

import { useEffect, useState, type FormEvent } from "react";
import { ApiError, getApi, type SearchHit, type TargetRegion, type TargetRegionWrite } from "@/lib/api";
import { CatalogParentName } from "@/components/catalog-parent-name";
import { catalogBadge } from "@/lib/format";
import { toTargetRegionWrite } from "@/lib/locations/model";
import { errorText } from "@/lib/user-message";

interface RegionSectionProps {
  saved: TargetRegion | null;
  canSave: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  onSave: (draft: TargetRegionWrite) => Promise<void>;
}

export function RegionSection({ saved, canSave, saving, error, notice, onSave }: RegionSectionProps) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [resultQuery, setResultQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [picked, setPicked] = useState<SearchHit | null>(null);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;

    let cancelled = false;
    const timer = window.setTimeout(() => {
      getApi()
        .search(trimmed)
        .then((response) => {
          if (cancelled) return;
          setHits(response.hits);
          setResultQuery(trimmed);
          setSearchError(null);
        })
        .catch((caught: unknown) => {
          if (cancelled) return;
          setHits([]);
          setResultQuery(trimmed);
          setSearchError(caught instanceof ApiError ? errorText(caught, "Suche fehlgeschlagen.") : "Suche fehlgeschlagen.");
        });
    }, 180);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const trimmed = query.trim();
  const searching = trimmed.length >= 2 && resultQuery !== trimmed;
  const visibleHits = trimmed.length >= 2 && resultQuery === trimmed ? hits : [];

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!picked) return;
    await onSave(toTargetRegionWrite(picked));
  }

  return (
    <section className="section-card" id="zielregion" aria-labelledby="zielregion-title">
      <h2 id="zielregion-title">Zielregion</h2>
      <p className="stub-copy">
        Gebiet, in dem der neue Laden eröffnet werden soll. Suche einen Treffer und speichere die Auswahl.
      </p>
      <ol className="steps">
        <li>Region suchen</li>
        <li>Treffer wählen</li>
        <li>Zielregion speichern</li>
      </ol>

      {saved ? (
        <p className="status-line">
          <span>
            Gespeichert: <strong>{saved.label}</strong>
            <CatalogParentName source={saved} />
            {saved.geoKey ? ` · ${saved.geoKey}` : ""}
          </span>
          {saved.grain || saved.level ? <span className="badge">{catalogBadge(saved)}</span> : null}
        </p>
      ) : (
        <p className="message">Noch keine Zielregion gespeichert.</p>
      )}

      <form className="stack" onSubmit={onSubmit}>
        <label htmlFor="region-q">Region suchen</label>
        <input
          id="region-q"
          type="search"
          value={query}
          placeholder="z. B. München, 80331, 09162000"
          autoComplete="off"
          onChange={(event) => setQuery(event.target.value)}
          aria-controls="region-hits"
        />
        <p className="hint">Die Suche nutzt das Backend. Die Auswahl wird erst mit Speichern übernommen.</p>
        {searchError ? (
          <p className="message message-error" role="alert">
            {searchError}
          </p>
        ) : null}
        <div className="results-head">
          <h3>Treffer</h3>
          <span aria-live="polite">
            {searching ? "Suche …" : trimmed.length >= 2 ? `${visibleHits.length} Treffer` : "Bereit"}
          </span>
        </div>
        <ul id="region-hits" className="results">
          {visibleHits.map((hit) => {
            const active = picked?.id === hit.id;
            return (
              <li key={hit.id}>
                <button
                  type="button"
                  className={active ? "hit is-active" : "hit"}
                  aria-pressed={active}
                  onClick={() => setPicked(hit)}
                >
                  <span className="hit-label">
                    {hit.label}
                    <CatalogParentName source={hit} />
                  </span>
                  <span className="hit-meta">
                    <span className="badge">{catalogBadge({ ...hit, geoKey: hit.geoKey || hit.id })}</span>
                    <span className="hit-id">{hit.geoKey ?? hit.id}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {trimmed.length >= 2 && !searching && visibleHits.length === 0 && !searchError ? (
          <p className="message">Keine Treffer. Gemeinde, PLZ oder AGS versuchen.</p>
        ) : null}
        {picked ? (
          <p className="message">
            Auswahl: <strong>{picked.label}</strong>
            {saved?.label === picked.label && saved.geoKey === (picked.geoKey ?? null)
              ? " · entspricht der gespeicherten Zielregion"
              : " · noch nicht gespeichert"}
          </p>
        ) : null}
        {error ? (
          <p className="message message-error" role="alert">
            {error}
          </p>
        ) : null}
        {notice ? (
          <p className="message message-ok" role="status">
            {notice}
          </p>
        ) : null}
        <button type="submit" className="button" disabled={!canSave || !picked || saving}>
          {saving ? "Speichern …" : "Zielregion speichern"}
        </button>
      </form>
    </section>
  );
}
