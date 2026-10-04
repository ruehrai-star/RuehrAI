import type {
  AddressInput,
  AddressPairRequest,
  AddressPairResult,
  AddressSide,
  AddressTopic,
  SharedTopic,
  TopicLevel,
} from "./types.ts";

/** UX: Zwei Adressen, 4 Oct 2026. These strings are the product labels. */
export const ADDRESS_COPY = {
  title: "Adressen",
  kicker: "Zwei Adressen",
  nav: "Adressen",
  intro: "Zwei Adressen auswerten. Brain löst die Zahlen nur über die PLZ.",
  leftTitle: "Adresse 1",
  rightTitle: "Adresse 2",
  street: "Straße",
  postalCode: "PLZ",
  city: "Stadt",
  evaluate: "Auswerten",
  running: "Auswertung läuft …",
  failed: "Auswertung fehlgeschlagen.",
  sameAddress: "Beide Eingaben sind dieselbe Adresse.",
  samePlz: "Beide Adressen liegen in derselben PLZ. Die Zahlen sind dieselben.",
  unknownResolution: "Die PLZ löst nicht genau eine Gemeinde und einen Kreis auf.",
  absent: "liegt nicht vor",
  sharedTitle: "Gemeinsam",
  sharedEmpty: "Keine gemeinsamen Parameter.",
  signedOut: "Die Adressen stehen nach der Anmeldung zur Verfügung.",
  gemeinde: "Gemeinde",
  kreis: "Kreis",
  land: "Land",
} as const;

export const EMPTY_ADDRESS: AddressInput = { street: "", postalCode: "", city: "" };

export const GEMEINDE_CORE_IDS = [
  "pendler",
  "breitband",
  "bundestagswahl",
  "gerda",
  "gemeindeverzeichnis",
  "zensus2022",
  "bevoelkerung",
  "wanderungen",
] as const;

export const GEMEINDE_EXTRA_IDS = [
  "unfallatlas",
  "rwi-redx",
  "wwk",
  "boris",
  "pks",
  "open-nrw",
] as const;

export const KREIS_CORE_IDS = [
  "pks",
  "destatis",
  "vgrdl",
  "pendler",
  "unfallatlas",
  "arbeitsmarkt",
] as const;

export const LAND_IDS = ["pendler", "dehoga", "kba", "baugenehmigungen", "kmk"] as const;

const MULTI_LEVEL_IDS = new Set(["pendler", "pks", "unfallatlas"]);

const TOPIC_LABELS: Record<string, string> = {
  pendler: "Pendler",
  breitband: "Breitband",
  bundestagswahl: "Bundestagswahl",
  gerda: "GERDA",
  gemeindeverzeichnis: "Gemeindeverzeichnis",
  zensus2022: "Zensus 2022",
  bevoelkerung: "Bevölkerung",
  wanderungen: "Wanderungen",
  unfallatlas: "Unfallatlas",
  "rwi-redx": "RWI-REDX",
  wwk: "WWK",
  boris: "BORIS",
  pks: "PKS",
  "open-nrw": "Open.NRW",
  destatis: "Destatis",
  vgrdl: "VGRdL",
  arbeitsmarkt: "Arbeitsmarkt",
  dehoga: "DEHOGA",
  kba: "KBA",
  baugenehmigungen: "Baugenehmigungen",
  kmk: "KMK",
};

const LEVEL_LABELS: Record<TopicLevel, string> = {
  gemeinde: ADDRESS_COPY.gemeinde,
  kreis: ADDRESS_COPY.kreis,
  land: ADDRESS_COPY.land,
};

const GEBAEUDE_KEYS = ["gebaeude", "gebäude", "Gebäude", "buildings"] as const;
const WOHNUNGEN_KEYS = ["wohnungen", "Wohnungen", "dwellings"] as const;
const ZENSUS_ALIAS_KEYS = new Set<string>([...GEBAEUDE_KEYS, ...WOHNUNGEN_KEYS]);

export interface ValueCell {
  label: string;
  text: string;
}

export interface TopicRowView {
  id: string;
  level: TopicLevel;
  label: string;
  present: boolean;
  absentText: string | null;
  cells: ValueCell[];
}

export interface AddressBlockView {
  title: string;
  street: string;
  city: string;
  resolutionUnknown: boolean;
  unknownText: string | null;
  gemeinde: string | null;
  kreis: string | null;
  land: string | null;
  sections: { level: TopicLevel; title: string; rows: TopicRowView[] }[];
}

export interface SharedRowView {
  id: string;
  level: TopicLevel;
  label: string;
  left: ValueCell[];
  right: ValueCell[];
}

export interface AddressPageState {
  left: AddressInput;
  right: AddressInput;
  running: boolean;
  failed: boolean;
  result: AddressPairResult | null;
}

export type AddressPageAction =
  | { type: "change"; side: "left" | "right"; field: keyof AddressInput; value: string }
  | { type: "submit" }
  | { type: "success"; result: AddressPairResult }
  | { type: "failure" };

export interface AddressPageView {
  canEvaluate: boolean;
  hint: string | null;
  running: boolean;
  failed: boolean;
  failedText: string | null;
  runningText: string | null;
  showResult: boolean;
  left: AddressBlockView | null;
  right: AddressBlockView | null;
  sharedRows: SharedRowView[];
  sharedEmpty: boolean;
  sharedEmptyText: string | null;
  visibleText: string;
}

const numberFormat = new Intl.NumberFormat("de-DE");

export function emptyAddressPageState(): AddressPageState {
  return {
    left: { ...EMPTY_ADDRESS },
    right: { ...EMPTY_ADDRESS },
    running: false,
    failed: false,
    result: null,
  };
}

export function isValidPostalCode(value: string): boolean {
  return /^[0-9]{5}$/.test(value.trim());
}

export function isValidAddress(draft: AddressInput): boolean {
  return draft.street.trim().length > 0 && isValidPostalCode(draft.postalCode) && draft.city.trim().length > 0;
}

export function canEvaluate(left: AddressInput, right: AddressInput): boolean {
  return isValidAddress(left) && isValidAddress(right);
}

export function toAddressPairRequest(left: AddressInput, right: AddressInput): AddressPairRequest {
  return {
    left: trimAddress(left),
    right: trimAddress(right),
  };
}

export function trimAddress(draft: AddressInput): AddressInput {
  return {
    street: draft.street.trim(),
    postalCode: draft.postalCode.trim(),
    city: draft.city.trim(),
  };
}

export function inputHint(left: AddressInput, right: AddressInput): string | null {
  if (!canEvaluate(left, right)) return null;
  if (sameAddress(left, right)) return ADDRESS_COPY.sameAddress;
  if (left.postalCode.trim() === right.postalCode.trim()) return ADDRESS_COPY.samePlz;
  return null;
}

export function sameAddress(left: AddressInput, right: AddressInput): boolean {
  return (
    left.street.trim() === right.street.trim() &&
    left.postalCode.trim() === right.postalCode.trim() &&
    left.city.trim() === right.city.trim()
  );
}

export function reduceAddressPage(state: AddressPageState, action: AddressPageAction): AddressPageState {
  switch (action.type) {
    case "change":
      return {
        ...state,
        [action.side]: { ...state[action.side], [action.field]: action.value },
        result: null,
        failed: false,
        running: false,
      };
    case "submit":
      if (!canEvaluate(state.left, state.right) || state.running) return state;
      return { ...state, running: true, failed: false, result: null };
    case "success":
      return { ...state, running: false, failed: false, result: action.result };
    case "failure":
      return { ...state, running: false, failed: true, result: null };
    default:
      return state;
  }
}

export function topicLabel(id: string, level: TopicLevel): string {
  const name = TOPIC_LABELS[id] ?? id;
  if (MULTI_LEVEL_IDS.has(id)) return `${name} · ${LEVEL_LABELS[level]}`;
  return name;
}

export function topicCells(id: string, value: unknown): ValueCell[] {
  if (id === "zensus2022") return zensus2022Cells(value);
  return genericCells(value);
}

export function zensus2022Cells(value: unknown): ValueCell[] {
  const cells: ValueCell[] = [];
  const gebaeude = pickPresentCell(value, GEBAEUDE_KEYS);
  const wohnungen = pickPresentCell(value, WOHNUNGEN_KEYS);
  if (gebaeude !== undefined) cells.push({ label: "Gebäude", text: formatValue(gebaeude) });
  if (wohnungen !== undefined) cells.push({ label: "Wohnungen", text: formatValue(wohnungen) });
  if (isRecord(value)) {
    for (const [key, cell] of Object.entries(value)) {
      if (ZENSUS_ALIAS_KEYS.has(key) || !isPresentCell(cell)) continue;
      cells.push({ label: key, text: formatValue(cell) });
    }
  }
  return cells;
}

export function addressPageView(state: AddressPageState): AddressPageView {
  const hint = inputHint(state.left, state.right);
  const showResult = Boolean(state.result) && !state.running && !state.failed;
  const left = showResult && state.result ? addressBlockView(ADDRESS_COPY.leftTitle, state.result.left) : null;
  const right = showResult && state.result ? addressBlockView(ADDRESS_COPY.rightTitle, state.result.right) : null;
  const sharedRows = showResult && state.result ? sharedRowViews(state.result) : [];
  const sharedEmpty = showResult && sharedRows.length === 0;
  const view: AddressPageView = {
    canEvaluate: canEvaluate(state.left, state.right) && !state.running,
    hint,
    running: state.running,
    failed: state.failed,
    failedText: state.failed ? ADDRESS_COPY.failed : null,
    runningText: state.running ? ADDRESS_COPY.running : null,
    showResult,
    left,
    right,
    sharedRows,
    sharedEmpty,
    sharedEmptyText: sharedEmpty ? ADDRESS_COPY.sharedEmpty : null,
    visibleText: "",
  };
  view.visibleText = collectVisibleText(view, state);
  return view;
}

export function addressBlockView(title: string, side: AddressSide): AddressBlockView {
  if (side.resolution === "unknown") {
    return {
      title,
      street: side.input.street,
      city: side.input.city,
      resolutionUnknown: true,
      unknownText: ADDRESS_COPY.unknownResolution,
      gemeinde: null,
      kreis: null,
      land: null,
      sections: [],
    };
  }
  return {
    title,
    street: side.input.street,
    city: side.input.city,
    resolutionUnknown: false,
    unknownText: null,
    gemeinde: side.gemeinde?.name ?? null,
    kreis: side.kreis?.name ?? null,
    land: side.land?.name ?? null,
    sections: [
      { level: "gemeinde", title: ADDRESS_COPY.gemeinde, rows: gemeindeRows(side.topics) },
      { level: "kreis", title: ADDRESS_COPY.kreis, rows: kreisRows(side.topics) },
      { level: "land", title: ADDRESS_COPY.land, rows: landRows(side.topics) },
    ],
  };
}

function gemeindeRows(topics: AddressTopic[]): TopicRowView[] {
  return [...GEMEINDE_CORE_IDS, ...GEMEINDE_EXTRA_IDS].map((id) => rowFor(id, "gemeinde", topics));
}

function kreisRows(topics: AddressTopic[]): TopicRowView[] {
  const extras = extraKreisIds(topics);
  return [...KREIS_CORE_IDS, ...extras].map((id) => rowFor(id, "kreis", topics));
}

function landRows(topics: AddressTopic[]): TopicRowView[] {
  return LAND_IDS.map((id) => rowFor(id, "land", topics));
}

function extraKreisIds(topics: AddressTopic[]): string[] {
  const known = new Set<string>(KREIS_CORE_IDS);
  const extras: string[] = [];
  for (const topic of topics) {
    if (topic.level !== "kreis" || known.has(topic.id) || extras.includes(topic.id)) continue;
    extras.push(topic.id);
  }
  return extras;
}

function rowFor(id: string, level: TopicLevel, topics: AddressTopic[]): TopicRowView {
  const topic = topics.find((item) => item.id === id && item.level === level);
  if (topic?.status === "present") {
    return {
      id,
      level,
      label: topicLabel(id, level),
      present: true,
      absentText: null,
      cells: topicCells(id, topic.value),
    };
  }
  return {
    id,
    level,
    label: topicLabel(id, level),
    present: false,
    absentText: ADDRESS_COPY.absent,
    cells: [],
  };
}

function sharedRowViews(result: AddressPairResult): SharedRowView[] {
  const leftPresent = presentIndex(result.left);
  const rightPresent = presentIndex(result.right);
  const seen = new Set<string>();
  const rows: SharedRowView[] = [];

  function add(id: string, level: TopicLevel) {
    const key = `${level}:${id}`;
    const left = leftPresent.get(key);
    const right = rightPresent.get(key);
    if (!left || !right || seen.has(key)) return;
    seen.add(key);
    rows.push({
      id,
      level,
      label: topicLabel(id, level),
      left: topicCells(id, left.value),
      right: topicCells(id, right.value),
    });
  }

  for (const topic of result.shared) add(topic.id, topic.level);
  for (const topic of leftPresent.values()) add(topic.id, topic.level);
  return rows;
}

function presentIndex(side: AddressSide): Map<string, AddressTopic> {
  const map = new Map<string, AddressTopic>();
  if (side.resolution !== "resolved") return map;
  for (const topic of side.topics) {
    if (topic.status !== "present") continue;
    map.set(`${topic.level}:${topic.id}`, topic);
  }
  return map;
}

function genericCells(value: unknown): ValueCell[] {
  if (!isPresentCell(value)) return [];
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, cell]) => isPresentCell(cell))
      .map(([label, cell]) => ({ label, text: formatValue(cell) }));
  }
  return [{ label: "", text: formatValue(value) }];
}

function pickPresentCell(value: unknown, keys: readonly string[]): unknown {
  if (!isRecord(value)) return undefined;
  for (const key of keys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    const cell = value[key];
    if (isPresentCell(cell)) return cell;
  }
  return undefined;
}

function isPresentCell(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) return numberFormat.format(value);
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (Array.isArray(value)) {
    return value
      .filter((item) => isPresentCell(item))
      .map((item) => formatValue(item))
      .join(", ");
  }
  if (isRecord(value)) {
    return Object.entries(value)
      .filter(([, cell]) => isPresentCell(cell))
      .map(([key, cell]) => `${key}: ${formatValue(cell)}`)
      .join(" · ");
  }
  return String(value);
}

function collectVisibleText(view: AddressPageView, state: AddressPageState): string {
  const parts = [
    ADDRESS_COPY.title,
    ADDRESS_COPY.leftTitle,
    ADDRESS_COPY.rightTitle,
    ADDRESS_COPY.street,
    ADDRESS_COPY.postalCode,
    ADDRESS_COPY.city,
    ADDRESS_COPY.evaluate,
    view.hint,
    view.runningText,
    view.failedText,
  ];
  if (view.showResult) {
    parts.push(ADDRESS_COPY.sharedTitle);
    parts.push(view.sharedEmptyText);
    for (const block of [view.left, view.right]) {
      if (!block) continue;
      parts.push(block.title, block.street, block.city, block.unknownText, block.gemeinde, block.kreis, block.land);
      for (const section of block.sections) {
        parts.push(section.title);
        for (const row of section.rows) {
          parts.push(row.label, row.absentText);
          for (const cell of row.cells) parts.push(cell.label, cell.text);
        }
      }
    }
    for (const row of view.sharedRows) {
      parts.push(row.label);
      for (const cell of [...row.left, ...row.right]) parts.push(cell.label, cell.text);
    }
  }
  parts.push(state.left.street, state.left.city, state.right.street, state.right.city);
  return parts.filter((part): part is string => typeof part === "string" && part.length > 0).join("\n");
}

export function presentSharedFromSides(left: AddressSide, right: AddressSide): SharedTopic[] {
  const rightPresent = presentIndex(right);
  const rows: SharedTopic[] = [];
  for (const [key, topic] of presentIndex(left)) {
    const other = rightPresent.get(key);
    if (!other) continue;
    rows.push({ id: topic.id, level: topic.level, left: topic.value, right: other.value });
  }
  return rows;
}
