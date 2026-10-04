"use client";

import Link from "next/link";
import { useReducer, type FormEvent } from "react";
import { getAddressApi } from "@/lib/addresses/api";
import {
  ADDRESS_COPY,
  addressPageView,
  emptyAddressPageState,
  reduceAddressPage,
  toAddressPairRequest,
  type AddressPageView,
  type TopicRowView,
  type ValueCell,
} from "@/lib/addresses/model";
import { ADDRESS_CITY_MAX, ADDRESS_STREET_MAX, type AddressInput } from "@/lib/addresses/types";
import { useSession } from "./session-provider";

export function AdressenPage() {
  const { session } = useSession();
  const api = getAddressApi();
  const [state, dispatch] = useReducer(reduceAddressPage, undefined, emptyAddressPageState);
  const view = addressPageView(state);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!view.canEvaluate) return;
    dispatch({ type: "submit" });
    try {
      const result = await api.evaluateAddressPair(toAddressPairRequest(state.left, state.right));
      dispatch({ type: "success", result });
    } catch {
      dispatch({ type: "failure" });
    }
  }

  if (!session) {
    return (
      <main className="sheet" id="inhalt">
        <p className="stub-kicker">{ADDRESS_COPY.kicker}</p>
        <h1>{ADDRESS_COPY.title}</h1>
        <p className="stub-copy">{ADDRESS_COPY.signedOut}</p>
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
    <main className="sheet" id="inhalt" aria-busy={state.running}>
      <p className="stub-kicker">{ADDRESS_COPY.kicker}</p>
      <h1>{ADDRESS_COPY.title}</h1>
      <p className="stub-copy">{ADDRESS_COPY.intro}</p>

      {view.hint ? <p className="banner">{view.hint}</p> : null}
      {view.runningText ? (
        <p className="message" role="status" aria-live="polite">
          {view.runningText}
        </p>
      ) : null}
      {view.failedText ? (
        <p className="message message-error" role="alert">
          {view.failedText}
        </p>
      ) : null}

      <form className="stack" onSubmit={onSubmit}>
        <div className="address-grid">
          <AddressFields
            title={ADDRESS_COPY.leftTitle}
            prefix="left"
            draft={state.left}
            onChange={(field, value) => dispatch({ type: "change", side: "left", field, value })}
          />
          <AddressFields
            title={ADDRESS_COPY.rightTitle}
            prefix="right"
            draft={state.right}
            onChange={(field, value) => dispatch({ type: "change", side: "right", field, value })}
          />
        </div>
        <div className="auth-actions">
          <button type="submit" className="button" disabled={!view.canEvaluate}>
            {ADDRESS_COPY.evaluate}
          </button>
        </div>
      </form>

      {view.showResult ? <ResultBlocks view={view} /> : null}
    </main>
  );
}

function AddressFields({
  title,
  prefix,
  draft,
  onChange,
}: {
  title: string;
  prefix: "left" | "right";
  draft: AddressInput;
  onChange: (field: keyof AddressInput, value: string) => void;
}) {
  const streetId = `${prefix}-street`;
  const postalId = `${prefix}-postal`;
  const cityId = `${prefix}-city`;
  return (
    <fieldset className="section-card address-block">
      <legend className="address-legend">{title}</legend>
      <label htmlFor={streetId}>{ADDRESS_COPY.street}</label>
      <input
        id={streetId}
        name={streetId}
        autoComplete={prefix === "left" ? "street-address" : "off"}
        required
        maxLength={ADDRESS_STREET_MAX}
        value={draft.street}
        onChange={(event) => onChange("street", event.target.value)}
      />
      <div className="field-row">
        <div className="stack">
          <label htmlFor={postalId}>{ADDRESS_COPY.postalCode}</label>
          <input
            id={postalId}
            name={postalId}
            inputMode="numeric"
            autoComplete={prefix === "left" ? "postal-code" : "off"}
            pattern="[0-9]{5}"
            maxLength={5}
            required
            value={draft.postalCode}
            onChange={(event) => onChange("postalCode", event.target.value)}
          />
        </div>
        <div className="stack">
          <label htmlFor={cityId}>{ADDRESS_COPY.city}</label>
          <input
            id={cityId}
            name={cityId}
            autoComplete={prefix === "left" ? "address-level2" : "off"}
            required
            maxLength={ADDRESS_CITY_MAX}
            value={draft.city}
            onChange={(event) => onChange("city", event.target.value)}
          />
        </div>
      </div>
    </fieldset>
  );
}

function ResultBlocks({ view }: { view: AddressPageView }) {
  return (
    <div className="address-results">
      {view.left ? <AddressResult block={view.left} /> : null}
      {view.right ? <AddressResult block={view.right} /> : null}
      <section className="section-card" aria-labelledby="shared-title">
        <h2 id="shared-title">{ADDRESS_COPY.sharedTitle}</h2>
        {view.sharedEmptyText ? <p className="message">{view.sharedEmptyText}</p> : null}
        {view.sharedRows.length > 0 ? (
          <ul className="criterion-list">
            {view.sharedRows.map((row) => (
              <li key={`${row.level}-${row.id}`} className="criterion">
                <p className="hit-label">{row.label}</p>
                <div className="shared-values">
                  <ValueCells title={ADDRESS_COPY.leftTitle} cells={row.left} />
                  <ValueCells title={ADDRESS_COPY.rightTitle} cells={row.right} />
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
    </div>
  );
}

function AddressResult({ block }: { block: NonNullable<AddressPageView["left"]> }) {
  const headingId = block.title === ADDRESS_COPY.leftTitle ? "adresse-1-result" : "adresse-2-result";
  return (
    <section className="section-card" aria-labelledby={headingId}>
      <h2 id={headingId}>{block.title}</h2>
      <p className="summary-line">
        {block.street}, {block.city}
      </p>
      {block.resolutionUnknown ? <p className="message">{block.unknownText}</p> : null}
      {block.gemeinde ? (
        <p className="hint">
          {ADDRESS_COPY.gemeinde} {block.gemeinde}
        </p>
      ) : null}
      {block.kreis ? (
        <p className="hint">
          {ADDRESS_COPY.kreis} {block.kreis}
        </p>
      ) : null}
      {block.land ? (
        <p className="hint">
          {ADDRESS_COPY.land} {block.land}
        </p>
      ) : null}
      {block.sections.map((section) => (
        <div key={section.level} className="stack">
          <h3>{section.title}</h3>
          <ul className="criterion-list">
            {section.rows.map((row) => (
              <TopicRow key={`${row.level}-${row.id}`} row={row} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function TopicRow({ row }: { row: TopicRowView }) {
  return (
    <li className="criterion">
      <p className="hit-label">{row.label}</p>
      {row.present ? <ValueCells cells={row.cells} /> : <p className="message">{row.absentText}</p>}
    </li>
  );
}

function ValueCells({ title, cells }: { title?: string; cells: ValueCell[] }) {
  if (cells.length === 0) return title ? <p className="hint">{title}</p> : null;
  return (
    <div className="topic-cells">
      {title ? <p className="hint">{title}</p> : null}
      {cells.map((cell, index) => (
        <p key={`${cell.label}-${index}`} className="message">
          {cell.label ? `${cell.label}: ${cell.text}` : cell.text}
        </p>
      ))}
    </div>
  );
}
