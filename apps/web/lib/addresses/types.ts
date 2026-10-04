/** Address-pair contract used by the Adressen page. Backend is not in this repo. */

export const TOPIC_LEVELS = ["gemeinde", "kreis", "land"] as const;
export type TopicLevel = (typeof TOPIC_LEVELS)[number];

export const TOPIC_STATUSES = ["present", "absent"] as const;
export type TopicStatus = (typeof TOPIC_STATUSES)[number];

export type AddressResolution = "resolved" | "unknown";

export interface AddressInput {
  street: string;
  postalCode: string;
  city: string;
}

export interface PlaceName {
  name: string;
}

export interface AddressTopic {
  id: string;
  level: TopicLevel;
  status: TopicStatus;
  /** Stored Brain row. Omitted when `status` is `absent`. */
  value?: unknown;
}

export interface AddressSide {
  input: AddressInput;
  resolution: AddressResolution;
  gemeinde: PlaceName | null;
  kreis: PlaceName | null;
  land: PlaceName | null;
  topics: AddressTopic[];
}

export interface SharedTopic {
  id: string;
  level: TopicLevel;
  left: unknown;
  right: unknown;
}

export interface AddressPairResult {
  left: AddressSide;
  right: AddressSide;
  shared: SharedTopic[];
}

export interface AddressPairRequest {
  left: AddressInput;
  right: AddressInput;
}
