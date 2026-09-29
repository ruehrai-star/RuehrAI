import { ConfigService } from "@nestjs/config";
import { OmlxClient } from "./omlx.client";

function client(env: Record<string, string | undefined>): OmlxClient {
  const config = {
    get: (key: string) => env[key],
  } as ConfigService;
  return new OmlxClient(config);
}

describe("OmlxClient", () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it("does not call the network when the embeddings URL is unset", async () => {
    const outcome = await client({}).embed("München Bevölkerung");
    expect(outcome).toEqual({ ok: false, reason: "embeddings_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(client({}).llmEnabled()).toBe(false);
  });

  it("stays on the SQL path when vector search is switched off", async () => {
    const outcome = await client({
      ANALYSIS_VECTOR_SEARCH: "0",
      EMBEDDINGS_BASE_URL: "http://localhost:8000/v1",
    }).embed("query");
    expect(outcome).toEqual({ ok: false, reason: "embeddings_disabled" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts to the local embeddings endpoint and checks the dimension", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1, 0.2] }] }),
    });
    const outcome = await client({
      EMBEDDINGS_BASE_URL: "http://localhost:8000/v1/",
      EMBEDDING_MODEL: "rg113/jina-embeddings-v5-text-small-retrieval-mlx-oQ8",
      EMBEDDING_DIM: "2",
    }).embed("Bevölkerung Haushalte");
    expect(outcome).toEqual({ ok: true, vector: [0.1, 0.2] });
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/embeddings",
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(body.model).toBe("rg113/jina-embeddings-v5-text-small-retrieval-mlx-oQ8");
    expect(body.input).toBe("Bevölkerung Haushalte");
  });

  it("rejects a vector whose dimension does not match", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [{ embedding: [0.1] }] }),
    });
    const outcome = await client({
      EMBEDDINGS_BASE_URL: "http://localhost:8000/v1",
      EMBEDDING_DIM: "1024",
    }).embed("query");
    expect(outcome).toEqual({ ok: false, reason: "embeddings_rejected" });
  });

  it("reports an unreachable embeddings server without throwing", async () => {
    fetchMock.mockRejectedValue(new Error("connect ECONNREFUSED"));
    const outcome = await client({
      EMBEDDINGS_BASE_URL: "http://localhost:8000/v1",
    }).embed("query");
    expect(outcome).toEqual({ ok: false, reason: "embeddings_unreachable" });
  });

  it("uses LLM_BASE_URL when set and EMBEDDINGS_BASE_URL otherwise", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "{\"summary\":\"ok\"}" } }] }),
    });
    const shared = client({
      EMBEDDINGS_BASE_URL: "http://localhost:8000/v1",
      LLM_MODEL: "local-chat",
    });
    expect(shared.llmEnabled()).toBe(true);
    await shared.complete("system", "user");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:8000/v1/chat/completions",
      expect.objectContaining({ method: "POST" }),
    );

    fetchMock.mockClear();
    await client({
      EMBEDDINGS_BASE_URL: "http://localhost:8000/v1",
      LLM_BASE_URL: "http://127.0.0.1:8000/v1",
      LLM_MODEL: "local-chat",
    }).complete("system", "user");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:8000/v1/chat/completions",
    );
  });
});
