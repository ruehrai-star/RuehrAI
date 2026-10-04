import { ApiError } from "../api/types.ts";
import type {
  AddressInput,
  AddressPairResult,
  AddressSide,
  AddressTopic,
  PlaceName,
  SharedTopic,
  TopicLevel,
} from "./types.ts";
import { TOPIC_LEVELS } from "./types.ts";

const ROUTE = "POST /address-pair";

export function parseAddressPair(body: unknown): AddressPairResult {
  if (!body || typeof body !== "object") {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  const raw = body as {
    left?: unknown;
    right?: unknown;
    shared?: unknown;
  };
  return {
    left: parseSide(raw.left),
    right: parseSide(raw.right),
    shared: parseShared(raw.shared),
  };
}

function parseSide(body: unknown): AddressSide {
  if (!body || typeof body !== "object") {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  const raw = body as {
    input?: unknown;
    resolution?: unknown;
    gemeinde?: unknown;
    kreis?: unknown;
    land?: unknown;
    topics?: unknown;
  };
  const input = parseInput(raw.input);
  if (raw.resolution === "unknown") {
    return {
      input,
      resolution: "unknown",
      gemeinde: null,
      kreis: null,
      land: null,
      topics: [],
    };
  }
  const gemeinde = readPlace(raw.gemeinde);
  const kreis = readPlace(raw.kreis);
  if (!gemeinde || !kreis) {
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
    gemeinde,
    kreis,
    land: readPlace(raw.land),
    topics: parseTopics(raw.topics),
  };
}

function parseInput(body: unknown): AddressInput {
  if (!body || typeof body !== "object") {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  const raw = body as { street?: unknown; postalCode?: unknown; city?: unknown };
  if (typeof raw.street !== "string" || typeof raw.postalCode !== "string" || typeof raw.city !== "string") {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  return {
    street: raw.street,
    postalCode: raw.postalCode,
    city: raw.city,
  };
}

function readPlace(value: unknown): PlaceName | null {
  if (typeof value === "string") {
    const name = value.trim();
    return name ? { name } : null;
  }
  if (!value || typeof value !== "object") return null;
  const raw = value as { name?: unknown; label?: unknown };
  const name = typeof raw.name === "string" ? raw.name.trim() : typeof raw.label === "string" ? raw.label.trim() : "";
  return name ? { name } : null;
}

function parseTopics(body: unknown): AddressTopic[] {
  if (body == null) return [];
  if (!Array.isArray(body)) {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  return body.map(parseTopic);
}

function parseTopic(body: unknown): AddressTopic {
  if (!body || typeof body !== "object") {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  const raw = body as { id?: unknown; level?: unknown; status?: unknown; value?: unknown };
  if (typeof raw.id !== "string" || !raw.id.trim() || !isTopicLevel(raw.level)) {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  if (raw.status === "absent") {
    return { id: raw.id, level: raw.level, status: "absent" };
  }
  if (raw.status === "present") {
    return { id: raw.id, level: raw.level, status: "present", value: raw.value };
  }
  throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
}

function parseShared(body: unknown): SharedTopic[] {
  if (body == null) return [];
  if (!Array.isArray(body)) {
    throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
  }
  return body.map((item) => {
    if (!item || typeof item !== "object") {
      throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
    }
    const raw = item as { id?: unknown; level?: unknown; left?: unknown; right?: unknown };
    if (typeof raw.id !== "string" || !raw.id.trim() || !isTopicLevel(raw.level)) {
      throw new ApiError(`Antwort von ${ROUTE} ist ungültig.`, 502);
    }
    return { id: raw.id, level: raw.level, left: raw.left, right: raw.right };
  });
}

function isTopicLevel(value: unknown): value is TopicLevel {
  return typeof value === "string" && (TOPIC_LEVELS as readonly string[]).includes(value);
}
