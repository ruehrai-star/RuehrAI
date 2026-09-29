"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { getLocationApi, LOCATION_CONTRACT_MESSAGE } from "@/lib/locations/api";
import {
  type MonthlyRevenue,
  type RegionDraft,
  type StoreAddress,
  type StoreDraft,
  type TargetRegion,
} from "@/lib/locations/model";
import { errorText } from "@/lib/user-message";
import { RegionSection } from "./region-section";
import { RevenueSection } from "./revenue-section";
import { useSession } from "./session-provider";
import { StoreSection } from "./store-section";

export function StandortePage() {
  const { session } = useSession();
  const api = getLocationApi();
  const [region, setRegion] = useState<TargetRegion | null>(null);
  const [stores, setStores] = useState<StoreAddress[]>([]);
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<MonthlyRevenue[]>([]);
  const [revenueStoreId, setRevenueStoreId] = useState<string | null>(null);
  const [regionSaving, setRegionSaving] = useState(false);
  const [storePending, setStorePending] = useState<string | null>(null);
  const [revenueSaving, setRevenueSaving] = useState(false);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regionNotice, setRegionNotice] = useState<string | null>(null);
  const [storeNotice, setStoreNotice] = useState<string | null>(null);
  const [revenueNotice, setRevenueNotice] = useState<string | null>(null);

  const loading = Boolean(session && api && loadedEmail !== session.email);
  const visibleRegion = loadedEmail === session?.email ? region : null;
  const visibleStores = loadedEmail === session?.email ? stores : [];
  const revenueLoading = Boolean(session && api && storeId && revenueStoreId !== storeId);
  const visibleRevenue = revenueStoreId === storeId ? revenue : [];

  useEffect(() => {
    if (!session || !api) return;
    let cancelled = false;
    const email = session.email;
    Promise.all([api.loadRegion(), api.listStores()])
      .then(([nextRegion, nextStores]) => {
        if (cancelled) return;
        setRegion(nextRegion);
        setStores(nextStores);
        setStoreId((current) =>
          current && nextStores.some((store) => store.id === current) ? current : (nextStores[0]?.id ?? null),
        );
        setLoadedEmail(email);
        setLoadError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setLoadError(errorText(caught, "Standorte konnten nicht geladen werden."));
        setLoadedEmail(email);
      });
    return () => {
      cancelled = true;
    };
  }, [session, api]);

  useEffect(() => {
    if (!session || !api || !storeId) return;
    let cancelled = false;
    const requestedId = storeId;
    api
      .listRevenue(requestedId)
      .then((rows) => {
        if (cancelled) return;
        setRevenue(rows);
        setRevenueStoreId(requestedId);
        setRevenueError(null);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        setRevenue([]);
        setRevenueStoreId(requestedId);
        setRevenueError(errorText(caught, "Umsatz konnte nicht geladen werden."));
      });
    return () => {
      cancelled = true;
    };
  }, [session, api, storeId]);

  async function saveRegion(draft: RegionDraft) {
    if (!api) return;
    setRegionSaving(true);
    setRegionError(null);
    setRegionNotice(null);
    try {
      const saved = await api.saveRegion(draft);
      setRegion(saved);
      setRegionNotice("Zielregion gespeichert.");
    } catch (caught) {
      setRegionError(errorText(caught, "Zielregion konnte nicht gespeichert werden."));
    } finally {
      setRegionSaving(false);
    }
  }

  async function createStore(draft: StoreDraft) {
    if (!api) return;
    setStorePending("create");
    setStoreError(null);
    setStoreNotice(null);
    try {
      const created = await api.createStore(draft);
      setStores((current) => [...current, created]);
      setStoreId((current) => current ?? created.id);
      setStoreNotice("Filiale gespeichert.");
    } catch (caught) {
      setStoreError(errorText(caught, "Filiale konnte nicht gespeichert werden."));
    } finally {
      setStorePending(null);
    }
  }

  async function updateStore(id: string, draft: StoreDraft) {
    if (!api) return;
    setStorePending(id);
    setStoreError(null);
    setStoreNotice(null);
    try {
      const updated = await api.updateStore(id, draft);
      setStores((current) => current.map((store) => (store.id === id ? updated : store)));
      setStoreNotice("Filiale gespeichert.");
    } catch (caught) {
      setStoreError(errorText(caught, "Filiale konnte nicht gespeichert werden."));
    } finally {
      setStorePending(null);
    }
  }

  async function deleteStore(id: string) {
    if (!api) return;
    setStorePending(id);
    setStoreError(null);
    setStoreNotice(null);
    try {
      await api.deleteStore(id);
      const next = stores.filter((store) => store.id !== id);
      setStores(next);
      if (storeId === id) setStoreId(next[0]?.id ?? null);
      setStoreNotice("Filiale entfernt.");
    } catch (caught) {
      setStoreError(errorText(caught, "Filiale konnte nicht entfernt werden."));
    } finally {
      setStorePending(null);
    }
  }

  async function saveRevenue(rows: MonthlyRevenue[]) {
    if (!api || !storeId) return;
    setRevenueSaving(true);
    setRevenueError(null);
    setRevenueNotice(null);
    try {
      const saved = await api.saveRevenue(storeId, rows);
      setRevenue(saved);
      setRevenueNotice("Umsatz gespeichert.");
    } catch (caught) {
      setRevenueError(errorText(caught, "Umsatz konnte nicht gespeichert werden."));
    } finally {
      setRevenueSaving(false);
    }
  }

  if (!session) {
    return (
      <main className="sheet" id="inhalt">
        <p className="stub-kicker">Standorte</p>
        <h1>Anmeldung erforderlich</h1>
        <p className="stub-copy">Zielregion, Filialadressen und Umsatz stehen nach der Anmeldung zur Verfügung.</p>
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
    <main className="sheet" id="inhalt">
      <p className="stub-kicker">Standort-Eingaben</p>
      <h1>Standorte</h1>
      <p className="stub-copy">Zielregion, bestehende Filialen und monatlicher Umsatz für das angemeldete Konto.</p>
      <nav className="section-nav" aria-label="Standort-Eingaben">
        <a href="#zielregion">Zielregion</a>
        <a href="#filialadressen">Filialadressen</a>
        <a href="#umsatz">Umsatz</a>
      </nav>
      {api ? null : (
        <p className="banner" role="status">
          {LOCATION_CONTRACT_MESSAGE}
        </p>
      )}
      {loading ? <p className="message">Standorte werden geladen …</p> : null}
      {loadError ? (
        <p className="message message-error" role="alert">
          {loadError}
        </p>
      ) : null}
      <RegionSection
        saved={visibleRegion}
        canSave={api !== null}
        saving={regionSaving}
        error={regionError}
        notice={regionNotice}
        onSave={saveRegion}
      />
      <StoreSection
        stores={visibleStores}
        canSave={api !== null}
        pendingId={storePending}
        error={storeError}
        notice={storeNotice}
        onCreate={createStore}
        onUpdate={updateStore}
        onDelete={deleteStore}
      />
      <RevenueSection
        stores={visibleStores}
        storeId={storeId}
        saved={visibleRevenue}
        canSave={api !== null}
        loading={revenueLoading}
        saving={revenueSaving}
        error={revenueError}
        notice={revenueNotice}
        onSelectStore={setStoreId}
        onSave={saveRevenue}
      />
    </main>
  );
}
