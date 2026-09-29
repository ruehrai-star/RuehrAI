"use client";

import { useState, type FormEvent } from "react";
import type { StoreLocation } from "@/lib/api";
import { toStoreWrite, validateStoreDraft, type StoreDraft } from "@/lib/locations/model";

const EMPTY: StoreDraft = { label: "", street: "", postalCode: "", city: "" };

interface StoreSectionProps {
  stores: StoreLocation[];
  canSave: boolean;
  pendingId: string | null;
  error: string | null;
  notice: string | null;
  onCreate: (draft: ReturnType<typeof toStoreWrite>) => Promise<void>;
  onUpdate: (id: string, draft: ReturnType<typeof toStoreWrite>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function StoreSection({
  stores,
  canSave,
  pendingId,
  error,
  notice,
  onCreate,
  onUpdate,
  onDelete,
}: StoreSectionProps) {
  const [draft, setDraft] = useState<StoreDraft>(EMPTY);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  function updateField(field: keyof StoreDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validateStoreDraft(draft);
    if (problem) {
      setFormError(problem);
      return;
    }
    setFormError(null);
    const next = toStoreWrite(draft);
    if (editingId) {
      await onUpdate(editingId, next);
      setEditingId(null);
    } else {
      await onCreate(next);
    }
    setDraft(EMPTY);
  }

  function beginEdit(store: StoreLocation) {
    setEditingId(store.id);
    setConfirmId(null);
    setFormError(null);
    setDraft({
      label: store.label ?? "",
      street: store.street,
      postalCode: store.postalCode,
      city: store.city,
    });
  }

  return (
    <section className="section-card" id="filialadressen" aria-labelledby="filialadressen-title">
      <h2 id="filialadressen-title">Filialadressen</h2>
      <p className="stub-copy">
        Adressen der bestehenden Filialen. Mehrere Standorte können angelegt, bearbeitet und entfernt werden.
      </p>
      <p className="hint">Beispiel: drei Läden in verschiedenen Straßen. Jede Adresse wird einzeln gespeichert.</p>

      <form className="stack" onSubmit={onSubmit}>
        <h3>{editingId ? "Filiale bearbeiten" : "Filiale hinzufügen"}</h3>
        <label htmlFor="store-name">Bezeichnung</label>
        <input
          id="store-name"
          value={draft.label}
          required
          autoComplete="organization"
          onChange={(event) => updateField("label", event.target.value)}
        />
        <label htmlFor="store-street">Straße</label>
        <input
          id="store-street"
          value={draft.street}
          required
          autoComplete="street-address"
          onChange={(event) => updateField("street", event.target.value)}
        />
        <div className="field-row">
          <div className="stack">
            <label htmlFor="store-plz">PLZ</label>
            <input
              id="store-plz"
              inputMode="numeric"
              autoComplete="postal-code"
              pattern="[0-9]{5}"
              required
              value={draft.postalCode}
              onChange={(event) => updateField("postalCode", event.target.value)}
            />
          </div>
          <div className="stack">
            <label htmlFor="store-city">Ort</label>
            <input
              id="store-city"
              required
              autoComplete="address-level2"
              value={draft.city}
              onChange={(event) => updateField("city", event.target.value)}
            />
          </div>
        </div>
        {formError ? (
          <p className="message message-error" role="alert">
            {formError}
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
        <div className="row-actions">
          <button type="submit" className="button" disabled={!canSave || pendingId !== null}>
            {pendingId ? "Speichern …" : editingId ? "Änderungen speichern" : "Filiale speichern"}
          </button>
          {editingId ? (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                setEditingId(null);
                setDraft(EMPTY);
                setFormError(null);
              }}
            >
              Abbrechen
            </button>
          ) : null}
        </div>
      </form>

      <div className="results-head">
        <h3>Gespeicherte Adressen</h3>
        <span>
          {stores.length} {stores.length === 1 ? "Filiale" : "Filialen"}
        </span>
      </div>
      {stores.length === 0 ? <p className="message">Noch keine Filialadresse.</p> : null}
      <ul className="store-list">
        {stores.map((store) => (
          <li key={store.id} className="store-row">
            <strong>{store.label || "Filiale"}</strong>
            <span>
              {store.street}, {store.postalCode} {store.city}
            </span>
            <div className="row-actions">
              <button type="button" className="button button-quiet" onClick={() => beginEdit(store)}>
                Bearbeiten
              </button>
              {confirmId === store.id ? (
                <button
                  type="button"
                  className="button button-danger"
                  disabled={pendingId !== null}
                  onClick={() => {
                    setConfirmId(null);
                    void onDelete(store.id);
                  }}
                >
                  Endgültig entfernen
                </button>
              ) : (
                <button type="button" className="button button-quiet" onClick={() => setConfirmId(store.id)}>
                  Entfernen
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
