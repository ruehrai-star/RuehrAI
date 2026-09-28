"use client";

import type { FormEvent } from "react";
import type { HealthResponse, SearchHit } from "@/lib/api";
import { grainLabel } from "@/lib/format";

const EXAMPLES = ["München", "80331", "09162000", "Marienplatz", "Friedrichshafen"];

interface SearchPanelProps {
  query: string;
  onQueryChange: (query: string) => void;
  results: SearchHit[];
  searching: boolean;
  error: string | null;
  selection: SearchHit | null;
  onSelect: (hit: SearchHit) => void;
  onFitLayer: () => void;
  health: HealthResponse | null;
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
  health,
  layerStatus,
}: SearchPanelProps) {
  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const first = results[0];
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
          Die Suche spricht den Mock von <code>GET /search</code> an. Ein Treffer fliegt die Karte
          dorthin.
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
          {searching ? "Suche …" : query.trim().length >= 2 ? `${results.length} Treffer` : "Bereit"}
        </span>
      </div>

      {error ? <p className="message message-error">{error}</p> : null}

      <ul id="search-results" className="results">
        {results.map((hit) => {
          const active = selection?.id === hit.id;
          return (
            <li key={hit.id}>
              <button
                type="button"
                className={active ? "hit is-active" : "hit"}
                aria-pressed={active}
                onClick={() => onSelect(hit)}
              >
                <span className="hit-label">{hit.label}</span>
                <span className="hit-meta">
                  <span className="badge">{grainLabel(hit.grain)}</span>
                  <span className="hit-id">{hit.id}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {query.trim().length >= 2 && !searching && results.length === 0 && !error ? (
        <p className="message">Keine Treffer. Adresse, PLZ oder AGS versuchen.</p>
      ) : null}

      <div className="panel-foot">
        <button type="button" className="button button-quiet" onClick={onFitLayer}>
          Gitter einpassen
        </button>
        <p className="status-line">
          <span>{layerStatus}</span>
          <span>{health ? `API ${health.status}` : "API …"}</span>
        </p>
      </div>
    </section>
  );
}
