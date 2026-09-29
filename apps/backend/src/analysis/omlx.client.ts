import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

const TIMEOUT_MS = 8_000;

export const DEFAULT_EMBEDDING_MODEL =
  "rg113/jina-embeddings-v5-text-small-retrieval-mlx-oQ8";
export const DEFAULT_EMBEDDING_DIM = 1024;

export type EmbedFailure =
  | "embeddings_disabled"
  | "embeddings_unconfigured"
  | "embeddings_unreachable"
  | "embeddings_rejected";

export type EmbedOutcome =
  | { ok: true; vector: number[] }
  | { ok: false; reason: EmbedFailure };

export type ChatOutcome = { ok: true; content: string } | { ok: false; reason: string };

/**
 * Local OpenAI-compatible client for oMLX on Eule (`/v1/embeddings`,
 * `/v1/chat/completions`). Clients never call this host; only the backend does.
 *
 * When `OMLX_API_KEY` is set, every request sends `Authorization: Bearer`.
 * oMLX also accepts `x-api-key` (Anthropic SDK); Bearer is the OpenAI path
 * and is enough for both endpoints. The key is never logged.
 *
 * A missing key, missing server, or HTTP 401 is a normal STAGE/CI case.
 * Callers keep the SQL and heuristic fallbacks.
 */
@Injectable()
export class OmlxClient {
  private readonly logger = new Logger(OmlxClient.name);
  private embedWarned = false;
  private chatWarned = false;

  constructor(private readonly config: ConfigService) {}

  vectorGate(): "ready" | EmbedFailure {
    if (this.flagOff("ANALYSIS_VECTOR_SEARCH")) return "embeddings_disabled";
    if (!this.baseUrl("EMBEDDINGS_BASE_URL")) return "embeddings_unconfigured";
    return "ready";
  }

  async embed(input: string): Promise<EmbedOutcome> {
    const gate = this.vectorGate();
    if (gate !== "ready") return { ok: false, reason: gate };
    const baseUrl = this.baseUrl("EMBEDDINGS_BASE_URL");
    if (!baseUrl) return { ok: false, reason: "embeddings_unconfigured" };

    try {
      const response = await fetch(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: this.requestHeaders(),
        body: JSON.stringify({
          model: this.config.get<string>("EMBEDDING_MODEL")?.trim() || DEFAULT_EMBEDDING_MODEL,
          input,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.warnOnce("embed", `embeddings HTTP ${response.status}`);
        return { ok: false, reason: "embeddings_rejected" };
      }
      const body = (await response.json()) as {
        data?: Array<{ embedding?: unknown }>;
      };
      const embedding = body.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || embedding.some((value) => typeof value !== "number")) {
        this.warnOnce("embed", "embeddings response has no numeric vector");
        return { ok: false, reason: "embeddings_rejected" };
      }
      const vector = embedding as number[];
      if (vector.length !== this.embeddingDim() || vector.some((value) => !Number.isFinite(value))) {
        this.warnOnce("embed", `embeddings dimension ${vector.length} does not match configured dim`);
        return { ok: false, reason: "embeddings_rejected" };
      }
      return { ok: true, vector };
    } catch (error) {
      this.warnOnce("embed", error instanceof Error ? error.message : "embeddings request failed");
      return { ok: false, reason: "embeddings_unreachable" };
    }
  }

  llmEnabled(): boolean {
    return this.llmBaseUrl() !== null && this.llmModel() !== null;
  }

  async complete(system: string, user: string): Promise<ChatOutcome> {
    const baseUrl = this.llmBaseUrl();
    const model = this.llmModel();
    if (!baseUrl || !model) return { ok: false, reason: "llm_unconfigured" };

    try {
      const response = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.requestHeaders(),
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        this.warnOnce("chat", `chat HTTP ${response.status}`);
        return { ok: false, reason: "llm_rejected" };
      }
      const body = (await response.json()) as {
        choices?: Array<{ message?: { content?: unknown } }>;
      };
      const content = messageContent(body.choices?.[0]?.message?.content);
      if (!content) {
        this.warnOnce("chat", "chat response has no message content");
        return { ok: false, reason: "llm_rejected" };
      }
      return { ok: true, content };
    } catch (error) {
      this.warnOnce("chat", error instanceof Error ? error.message : "chat request failed");
      return { ok: false, reason: "llm_unreachable" };
    }
  }

  private llmBaseUrl(): string | null {
    return this.baseUrl("LLM_BASE_URL") ?? this.baseUrl("EMBEDDINGS_BASE_URL");
  }

  private llmModel(): string | null {
    const model = this.config.get<string>("LLM_MODEL")?.trim();
    return model ? model : null;
  }

  private embeddingDim(): number {
    const parsed = Number(this.config.get<string>("EMBEDDING_DIM") ?? DEFAULT_EMBEDDING_DIM);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 8192) return DEFAULT_EMBEDDING_DIM;
    return parsed;
  }

  private baseUrl(key: "EMBEDDINGS_BASE_URL" | "LLM_BASE_URL"): string | null {
    const raw = this.config.get<string>(key)?.trim();
    if (!raw) return null;
    return raw.replace(/\/+$/, "");
  }

  /** Bearer only. An unset or blank key omits the header so local oMLX without auth still works. */
  private requestHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "content-type": "application/json" };
    const apiKey = this.config.get<string>("OMLX_API_KEY")?.trim();
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    return headers;
  }

  private flagOff(key: string): boolean {
    const value = this.config.get<string>(key)?.trim().toLowerCase();
    return value === "0" || value === "false" || value === "off";
  }

  private warnOnce(kind: "embed" | "chat", detail: string): void {
    if (kind === "embed") {
      if (this.embedWarned) return;
      this.embedWarned = true;
    } else {
      if (this.chatWarned) return;
      this.chatWarned = true;
    }
    this.logger.warn(`oMLX ${kind} unavailable (${detail}). Analysis continues without it.`);
  }
}

function messageContent(content: unknown): string | null {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return null;
  const text = content
    .map((part) => {
      if (typeof part === "string") return part;
      if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
        return part.text;
      }
      return "";
    })
    .join("")
    .trim();
  return text || null;
}
