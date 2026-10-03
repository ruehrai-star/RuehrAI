"use client";

import type { FormEvent } from "react";
import type { SearchHit } from "@/lib/api";
import { CatalogParentName } from "@/components/catalog-parent-name";
import { catalogBadge, catalogPlaceName, visibleSearchHits } from "@/lib/format";

const EXAMPLES = ["München", "80331", "09162000", "Marienplatz", "Berlin"];

interface SearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  results: SearchHit[];
  searching: boolean;
  error: string | null;
  selection: SearchHit | null;
  onSelect: (hit: SearchHit) => void;
  onFitLayer: () => void;
  apiStatus: "unknown" | "ok" | "down";
  layerStatus: string;
}

export function SearchPanel({
  query,
  onQueryChange,
  results,
  searching,
  error,
  selection,
  onSelect,
  onFitLayer,
  apiStatus,
  layerStatus,
}: SearchPanelProps) {
  const visibleResults = visibleSearchHits(results);

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const first = visibleResults[0];
    if (first) onSelect(first);
  }

  return (
    <section className="panel" aria-label="Suche">
      <form className="search-form" onSubmit={onSubmit}>
        <label htmlFor="search-q">Adresse, AGS oder PLZ</label>
        <input
          id="search-q"
          type="search"
          value={query}
          placeholder="z. B. München, 80331, 09162000"
          autoComplete="off"
          onChange={(event) => onQueryChange(event.target.value)}
          aria-controls="search-results"
        />
        <p className="hint">
          Die Suche ruft <code>GET /search</code> am Backend auf. Ein Treffer setzt die Karte
          dorthin. Suche und Layer brauchen die Anmeldung.
        </p>
        <div className="examples" aria-label="Beispielsuchen">
          {EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              className="chip"
              onClick={() => onQueryChange(example)}
            >
              {example}
            </button>
          ))}
        </div>
      </form>

      <div className="results-head">
        <h2>Treffer</h2>
        <span aria-live="polite">
          {searching ? "Suche …" : query.trim().length >= 2 ? `${visibleResults.length} Treffer` : "Bereit"}
        </span>
      </div>

      {error ? <p className="message message-error">{error}</p> : null}

      <ul id="search-results" className="results">
        {visibleResults.map((hit) => {
          const active = selection?.id === hit.id;
          return (
            <li key={hit.id}>
              <button
                type="button"
                className={active ? "hit is-active" : "hit"}
                aria-pressed={active}
                onClick={() => onSelect(hit)}
              >
                <span className="hit-label">
                  {catalogPlaceName(hit)}
                  <CatalogParentName source={hit} />
                </span>
                <span className="hit-meta">
                  <span className="badge">{catalogBadge({ ...hit, geoKey: hit.geoKey || hit.id })}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {query.trim().length >= 2 && !searching && visibleResults.length === 0 && !error ? (
        <p className="message">Keine Treffer. Adresse, PLZ oder AGS versuchen.</p>
      ) : null}

      <div className="panel-foot">
        <button type="button" className="button button-quiet" onClick={onFitLayer}>
          Layer einpassen
        </button>
        <p className="status-line">
          <span>{layerStatus}</span>
          <span>{apiStatus === "ok" ? "API ok" : apiStatus === "down" ? "API nicht erreichbar" : "API …"}</span>
        </p>
      </div>
    </section>
  );
}
