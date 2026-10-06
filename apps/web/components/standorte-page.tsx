"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type {
  MonthlyRevenuePoint,
  MonthlyRevenuePointWrite,
  SearchHit,
  StoreLocation,
  StoreLocationWrite,
  TargetRegion,
} from "@/lib/api";
import { getLocationApi } from "@/lib/locations/api";
import { toTargetRegionWrite } from "@/lib/locations/model";
import { usePersistedMarkedKey } from "./use-persisted-marked-key";
import {
  addRegionToFront,
  nextMarkedKeyAfterAdd,
  nextMarkedKeyAfterRemove,
  removeRegion,
} from "@/lib/locations/regions";
import { errorText } from "@/lib/user-message";
import { POST_STANDORTE_HREF } from "@/lib/verlauf/model";
import { MarkedRegionMissingNotice } from "./marked-region-missing";
import { RegionSection } from "./region-section";
import { RevenueSection } from "./revenue-section";
import { useSession } from "./session-provider";
import { StoreSection } from "./store-section";

export function StandortePage() {
  const { session } = useSession();
  const api = getLocationApi();
  const [regions, setRegions] = useState<TargetRegion[]>([]);
  const [markedKey, setMarkedKey, markedMissing] = usePersistedMarkedKey(regions);
  const [stores, setStores] = useState<StoreLocation[]>([]);
  const [loadedEmail, setLoadedEmail] = useState<string | null>(null);
  const [storeId, setStoreId] = useState<string | null>(null);
  const [revenue, setRevenue] = useState<MonthlyRevenuePoint[]>([]);
  const [revenueStoreId, setRevenueStoreId] = useState<string | null>(null);
  const [regionAdding, setRegionAdding] = useState(false);
  const [regionRemovingKey, setRegionRemovingKey] = useState<string | null>(null);
  const [storePending, setStorePending] = useState<string | null>(null);
  const [revenueSaving, setRevenueSaving] = useState(false);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [revenueError, setRevenueError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [regionNotice, setRegionNotice] = useState<string | null>(null);
  const [storeNotice, setStoreNotice] = useState<string | null>(null);
  const [revenueNotice, setRevenueNotice] = useState<string | null>(null);

  const loading = Boolean(session && loadedEmail !== session.email);
  const visibleRegions = loadedEmail === session?.email ? regions : [];
  const visibleMarkedKey = loadedEmail === session?.email ? markedKey : null;
  const visibleMarkedMissing = loadedEmail === session?.email && markedMissing;
  const visibleStores = loadedEmail === session?.email ? stores : [];
  const revenueLoading = Boolean(session && storeId && revenueStoreId !== storeId);
  const visibleRevenue = revenueStoreId === storeId ? revenue : [];

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const email = session.email;
    Promise.all([api.listTargetRegions(), api.listStores()])
      .then(([nextRegions, nextStores]) => {
        if (cancelled) return;
        setRegions(nextRegions);
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
    if (!session || !storeId) return;
    let cancelled = false;
    const requestedId = storeId;
    api
      .listStoreRevenue(requestedId)
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

  async function addRegion(hit: SearchHit) {
    setRegionAdding(true);
    setRegionError(null);
    setRegionNotice(null);
    try {
      const added = await api.addTargetRegion(toTargetRegionWrite(hit));
      setRegions((current) => {
        const next = addRegionToFront(current, added);
        setMarkedKey(nextMarkedKeyAfterAdd(current, added, markedKey));
        return next;
      });
    } finally {
      setRegionAdding(false);
    }
  }

  async function deleteRegion(key: string) {
    setRegionRemovingKey(key);
    setRegionError(null);
    setRegionNotice(null);
    try {
      await api.removeTargetRegion(key);
      setRegions((current) => {
        setMarkedKey(nextMarkedKeyAfterRemove(current, key, markedKey));
        return removeRegion(current, key);
      });
    } catch (caught) {
      setRegionError(errorText(caught, "Zielregion konnte nicht entfernt werden."));
    } finally {
      setRegionRemovingKey(null);
    }
  }

  async function createStore(draft: StoreLocationWrite) {
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

  async function updateStore(id: string, draft: StoreLocationWrite) {
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

  async function saveRevenue(rows: MonthlyRevenuePointWrite[]) {
    if (!storeId) return;
    setRevenueSaving(true);
    setRevenueError(null);
    setRevenueNotice(null);
    try {
      const saved = await api.putStoreRevenue(storeId, rows);
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
        <p className="stub-copy">Zielregionen, Filialadressen und Umsatz stehen nach der Anmeldung zur Verfügung.</p>
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
      <p className="stub-copy">Zielregionen, bestehende Filialen und monatlicher Umsatz für das angemeldete Konto.</p>
      <nav className="section-nav" aria-label="Standort-Eingaben">
        <a href="#zielregion">Zielregionen</a>
        <a href="#filialadressen">Filialadressen</a>
        <a href="#umsatz">Umsatz</a>
      </nav>
      <div className="auth-actions">
        <Link href={POST_STANDORTE_HREF} className="button">
          Verlauf
        </Link>
        <Link href="/musteranalyse" className="button button-quiet">
          Musteranalyse
        </Link>
      </div>
      {loading ? <p className="message">Standorte werden geladen …</p> : null}
      {loadError ? (
        <p className="message message-error" role="alert">
          {loadError}
        </p>
      ) : null}
      {visibleMarkedMissing ? <MarkedRegionMissingNotice /> : null}
      <RegionSection
        items={visibleRegions}
        markedKey={visibleMarkedKey}
        adding={regionAdding}
        removingKey={regionRemovingKey}
        error={regionError}
        notice={regionNotice}
        onMark={setMarkedKey}
        onAdd={addRegion}
        onRemove={deleteRegion}
        onDismissError={() => setRegionError(null)}
      />
      <StoreSection
        stores={visibleStores}
        canSave
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
        canSave
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
