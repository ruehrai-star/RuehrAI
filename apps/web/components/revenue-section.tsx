"use client";

import { useMemo, useState } from "react";
import {
  draftsFromSaved,
  monthKeys,
  rowsForMonths,
  type MonthlyRevenue,
  type StoreAddress,
} from "@/lib/locations/model";

interface RevenueSectionProps {
  stores: StoreAddress[];
  storeId: string | null;
  saved: MonthlyRevenue[];
  canSave: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  onSelectStore: (id: string) => void;
  onSave: (rows: MonthlyRevenue[]) => Promise<void>;
}

export function RevenueSection({
  stores,
  storeId,
  saved,
  canSave,
  loading,
  saving,
  error,
  notice,
  onSelectStore,
  onSave,
}: RevenueSectionProps) {
  const [span, setSpan] = useState<12 | 36>(12);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftStore, setDraftStore] = useState<string | null>(null);
  const months = useMemo(() => monthKeys(span, new Date()), [span]);

  const baseDrafts = draftsFromSaved(months, saved);
  const activeDrafts = draftStore === storeId ? { ...baseDrafts, ...drafts } : baseDrafts;
  const rows = rowsForMonths(months, saved, activeDrafts);
  const missing = rows.filter((row) => row.missing).length;
  const invalid = rows.some((row) => row.invalid);

  function edit(month: string, value: string) {
    const base = draftStore === storeId ? drafts : draftsFromSaved(months, saved);
    setDraftStore(storeId);
    setDrafts({ ...base, [month]: value });
  }

  return (
    <section className="section-card" id="umsatz" aria-labelledby="umsatz-title">
      <h2 id="umsatz-title">Umsatz</h2>
      <p className="stub-copy">
        Monatlicher Umsatz je Standort. Leere Monate sind als fehlend markiert. 0 € ist ein echter Wert.
      </p>

      {stores.length === 0 ? (
        <p className="message">Lege zuerst eine Filialadresse an.</p>
      ) : (
        <div className="stack">
          <label htmlFor="revenue-store">Standort</label>
          <select
            id="revenue-store"
            value={storeId ?? ""}
            onChange={(event) => {
              setDraftStore(null);
              setDrafts({});
              onSelectStore(event.target.value);
            }}
          >
            {stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name} · {store.postalCode} {store.city}
              </option>
            ))}
          </select>
          <div className="row-actions" role="group" aria-label="Zeitraum">
            <button
              type="button"
              className={span === 12 ? "button" : "button button-quiet"}
              aria-pressed={span === 12}
              onClick={() => setSpan(12)}
            >
              12 Monate
            </button>
            <button
              type="button"
              className={span === 36 ? "button" : "button button-quiet"}
              aria-pressed={span === 36}
              onClick={() => setSpan(36)}
            >
              36 Monate
            </button>
          </div>
          <p className="status-line" aria-live="polite">
            <span>{loading ? "Umsatz wird geladen …" : `${missing} von ${rows.length} Monaten fehlend`}</span>
          </p>
          <div className="table-scroll">
            <table className="month-table">
              <caption className="hint">Umsatz in Euro. Leere Felder bleiben fehlend.</caption>
              <thead>
                <tr>
                  <th scope="col">Monat</th>
                  <th scope="col">Umsatz</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.month} className={row.missing || row.invalid ? "is-missing" : undefined}>
                    <th scope="row">{row.label}</th>
                    <td>
                      <input
                        aria-label={`Umsatz ${row.label}`}
                        inputMode="decimal"
                        value={activeDrafts[row.month] ?? ""}
                        placeholder="fehlend"
                        onChange={(event) => edit(row.month, event.target.value)}
                      />
                    </td>
                    <td>
                      {row.invalid ? (
                        <span className="badge badge-missing">ungültig</span>
                      ) : row.missing ? (
                        <span className="badge badge-missing">fehlend</span>
                      ) : (
                        <span className="badge">erfasst</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          <button
            type="button"
            className="button"
            disabled={!canSave || !storeId || saving || invalid}
            onClick={() => {
              if (!storeId) return;
              void onSave(rows.map((row) => ({ month: row.month, revenueEur: row.revenueEur })));
            }}
          >
            {saving ? "Speichern …" : "Umsatz speichern"}
          </button>
        </div>
      )}
    </section>
  );
}
