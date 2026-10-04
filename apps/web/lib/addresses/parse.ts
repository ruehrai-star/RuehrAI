import { ApiError } from "../api/types.ts";
import type {
  AddressInput,
  AddressPairResult,
  AddressResolution,
  AddressSide,
  AddressTopic,
  PlaceName,
  SharedTopic,
  TopicLevel,
} from "./types.ts";
import { ADDRESS_CITY_MAX, ADDRESS_STREET_MAX, TOPIC_LEVELS } from "./types.ts";

const ROUTE = "POST /address-pair";

export function parseAddressPair(body: unknown): AddressPairResult {
  if (!body || typeof body !== "object") invalid();
  const raw = body as { left?: unknown; right?: unknown; shared?: unknown };
  if (!("left" in raw) || !("right" in raw) || !("shared" in raw)) invalid();
  return {
    left: parseSide(raw.left),
    right: parseSide(raw.right),
    shared: parseShared(raw.shared),
  };
}

function parseSide(body: unknown): AddressSide {
  if (!body || typeof body !== "object") invalid();
  const raw = body as {
    input?: unknown;
    resolution?: unknown;
    gemeinde?: unknown;
    kreis?: unknown;
    land?: unknown;
    topics?: unknown;
  };
  if (
    !("input" in raw) ||
    !("resolution" in raw) ||
    !("gemeinde" in raw) ||
    !("kreis" in raw) ||
    !("land" in raw) ||
    !("topics" in raw)
  ) {
    invalid();
  }
  const input = parseInput(raw.input);
  const resolution = parseResolution(raw.resolution);
  if (resolution === "unknown") {
    return {
      input,
      resolution: "unknown",
      gemeinde: null,
      kreis: null,
      land: null,
      topics: [],
    };
  }
  return {
    input,
    resolution: "resolved",
    gemeinde: readPlace(raw.gemeinde),
    kreis: readPlace(raw.kreis),
    land: readPlace(raw.land),
    topics: parseTopics(raw.topics),
  };
}

function parseInput(body: unknown): AddressInput {
  if (!body || typeof body !== "object") invalid();
  const raw = body as { street?: unknown; postalCode?: unknown; city?: unknown };
  if (typeof raw.street !== "string" || typeof raw.postalCode !== "string" || typeof raw.city !== "string") {
    invalid();
  }
  if (raw.street.length < 1 || raw.street.length > ADDRESS_STREET_MAX) invalid();
  if (raw.city.length < 1 || raw.city.length > ADDRESS_CITY_MAX) invalid();
  if (!/^[0-9]{5}$/.test(raw.postalCode)) invalid();
  return {
    street: raw.street,
    postalCode: raw.postalCode,
    city: raw.city,
  };
}

function parseResolution(value: unknown): AddressResolution {
  if (value === "resolved" || value === "unknown") return value;
  invalid();
}

function readPlace(value: unknown): PlaceName | null {
  if (value === null) return null;
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const name = (value as { name?: unknown }).name;
  if (typeof name !== "string" || name.length < 1) invalid();
  return { name };
}

function parseTopics(body: unknown): AddressTopic[] {
  if (!Array.isArray(body)) invalid();
  return body.map(parseTopic);
}

function parseTopic(body: unknown): AddressTopic {
  if (!body || typeof body !== "object") invalid();
  const raw = body as { id?: unknown; level?: unknown; status?: unknown; value?: unknown };
  if (typeof raw.id !== "string" || raw.id.length < 1 || !isTopicLevel(raw.level)) invalid();
  if (raw.status === "absent") {
    return { id: raw.id, level: raw.level, status: "absent" };
  }
  if (raw.status === "present") {
    return { id: raw.id, level: raw.level, status: "present", value: raw.value };
  }
  invalid();
}

function parseShared(body: unknown): SharedTopic[] {
  if (!Array.isArray(body)) invalid();
  return body.map((item) => {
    if (!item || typeof item !== "object") invalid();
    const raw = item as { id?: unknown; level?: unknown; left?: unknown; right?: unknown };
    if (typeof raw.id !== "string" || raw.id.length < 1 || !isTopicLevel(raw.level)) invalid();
    if (!("left" in raw) || !("right" in raw)) invalid();
    return { id: raw.id, level: raw.level, left: raw.left, right: raw.right };
  });
}

function isTopicLevel(value: unknown): value is TopicLevel {
  return typeof value === "string" && (TOPIC_LEVELS as readonly string[]).includes(value);
}

function invalid(): never {
  throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
}
