"use client";

import { useMemo, useState } from "react";
import type { MonthlyRevenuePoint, MonthlyRevenuePointWrite, StoreLocation } from "@/lib/api";
import { draftsForPoints, revenueYears, rowsForYear } from "@/lib/locations/model";

interface RevenueSectionProps {
  stores: StoreLocation[];
  storeId: string | null;
  saved: MonthlyRevenuePoint[];
  canSave: boolean;
  loading: boolean;
  saving: boolean;
  error: string | null;
  notice: string | null;
  onSelectStore: (id: string) => void;
  onSave: (rows: MonthlyRevenuePointWrite[]) => Promise<void>;
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
  const years = useMemo(() => revenueYears(new Date()), []);
  const [year, setYear] = useState(years[years.length - 1] ?? new Date().getUTCFullYear());
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftStore, setDraftStore] = useState<string | null>(null);

  const savedDrafts = draftsForPoints(saved);
  const displayDrafts = draftStore === storeId ? { ...savedDrafts, ...drafts } : savedDrafts;
  const rows = rowsForYear(year, saved, displayDrafts);
  const missing = rows.filter((row) => row.missing).length;
  const invalid = rows.some((row) => row.invalid);

  function edit(key: string, value: string) {
    const base = draftStore === storeId ? drafts : draftsForPoints(saved);
    setDraftStore(storeId);
    setDrafts({ ...base, [key]: value });
  }

  return (
    <section className="section-card" id="umsatz" aria-labelledby="umsatz-title">
      <h2 id="umsatz-title">Umsatz</h2>
      <p className="stub-copy">
        Monatlicher Umsatz der letzten drei Jahre je Standort. Jahr und Monat stehen in der Tabelle. Leere
        Monate sind fehlend. 0 € ist ein echter Wert. Höchstens 36 Monate.
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
                {store.label || "Filiale"} · {store.postalCode} {store.city}
              </option>
            ))}
          </select>
          <div className="row-actions" role="group" aria-label="Jahr">
            {years.map((entry) => (
              <button
                key={entry}
                type="button"
                className={entry === year ? "button" : "button button-quiet"}
                aria-pressed={entry === year}
                onClick={() => setYear(entry)}
              >
                {entry}
              </button>
            ))}
          </div>
          <p className="status-line" aria-live="polite">
            <span>
              {loading ? "Umsatz wird geladen …" : `Jahr ${year}: ${missing} von ${rows.length} Monaten fehlend`}
            </span>
          </p>
          <div className="table-scroll">
            <table className="month-table">
              <caption className="hint">Umsatz in Euro für {year}. Leere Felder bleiben fehlend.</caption>
              <thead>
                <tr>
                  <th scope="col">Jahr</th>
                  <th scope="col">Monat</th>
                  <th scope="col">Umsatz</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = `${row.year}-${row.monthNumber}`;
                  return (
                    <tr key={key} className={row.missing || row.invalid ? "is-missing" : undefined}>
                      <td>{row.year}</td>
                      <th scope="row">
                        {row.monthNumber}
                        <span className="hint"> {row.monthName}</span>
                      </th>
                      <td>
                        <input
                          aria-label={`Umsatz ${row.year} Monat ${row.monthNumber}`}
                          inputMode="decimal"
                          value={displayDrafts[key] ?? ""}
                          placeholder="fehlend"
                          onChange={(event) => edit(key, event.target.value)}
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
                  );
                })}
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
              void onSave(
                rows.map((row) => ({
                  year: row.year,
                  month: row.month,
                  revenueEur: row.revenueEur,
                })),
              );
            }}
          >
            {saving ? "Speichern …" : `Umsatz ${year} speichern`}
          </button>
        </div>
      )}
    </section>
  );
}
