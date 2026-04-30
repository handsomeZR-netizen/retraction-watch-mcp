import { describe, expect, it, vi } from "vitest";

const openAiMock = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("openai", () => ({
  default: class OpenAI {
    chat = {
      completions: {
        create: openAiMock.create,
      },
    };
  },
}));

import { DeepseekLlmClient } from "./llm-client.js";

describe("DeepseekLlmClient malformed responses", () => {
  it("falls back to raw references when the model emits malformed JSON", async () => {
    openAiMock.create.mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"references": [',
          },
        },
      ],
    });

    const client = new DeepseekLlmClient({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "sk-test",
      model: "test-model",
    });

    const refs = await client.structureReferences(
      [{ index: 0, raw: "Smith J. A sample article. Journal. 2020." }],
      { maxRetries: 0 },
    );

    expect(refs).toEqual([
      {
        raw: "Smith J. A sample article. Journal. 2020.",
        title: null,
        authors: [],
        year: null,
        doi: null,
        pmid: null,
        journal: null,
        source: "llm",
      },
    ]);
    expect(client.stats.failures).toBe(1);
  });
});

describe("DeepseekLlmClient.segmentReferences", () => {
  it("parses a JSON array of ref strings and wraps them as RawReference[]", async () => {
    openAiMock.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              references: [
                "Smith J, Lee K. Title one. Journal A 2020;1:1.",
                "Doe R, Patel V. Title two. Journal B 2021;2:2.",
                "Chen X. Title three. Journal C 2022;3:3.",
              ],
            }),
          },
        },
      ],
    });
    const client = new DeepseekLlmClient({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "sk-test",
      model: "test-model",
    });
    const tail = "References ".padEnd(500, "x"); // ≥ 200 chars to clear the size guard
    const refs = await client.segmentReferences(tail);
    expect(refs).toHaveLength(3);
    expect(refs[0].index).toBe(0);
    expect(refs[0].raw).toMatch(/^Smith J/);
    expect(client.stats.segmentCalls).toBe(1);
    expect(client.stats.totalRefsSegmented).toBe(3);
  });

  it("returns an empty array on malformed JSON without throwing", async () => {
    openAiMock.create.mockResolvedValueOnce({
      choices: [{ message: { content: "{not-json" } }],
    });
    const client = new DeepseekLlmClient({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "sk-test",
      model: "test-model",
    });
    const refs = await client.segmentReferences("a".repeat(500));
    expect(refs).toEqual([]);
    expect(client.stats.failures).toBe(1);
  });

  it("filters out items that are too short or too long", async () => {
    openAiMock.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              references: [
                "x", // too short
                "Smith J. A real ref. 2020.",
                "z".repeat(2500), // too long (merged blob)
                "Doe R. Another ref. 2021.",
              ],
            }),
          },
        },
      ],
    });
    const client = new DeepseekLlmClient({
      baseUrl: "https://llm.example.test/v1",
      apiKey: "sk-test",
      model: "test-model",
    });
    const refs = await client.segmentReferences("a".repeat(500));
    expect(refs).toHaveLength(2);
    expect(refs.map((r) => r.raw)).toEqual([
      "Smith J. A real ref. 2020.",
      "Doe R. Another ref. 2021.",
    ]);
  });
});

describe("DeepseekLlmClient.structureReferences caching", () => {
  it("caches batches by (model, prompt-version, payload) so re-runs skip the LLM", async () => {
    openAiMock.create.mockReset();
    openAiMock.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            content: JSON.stringify({
              references: [
                {
                  index: 0,
                  raw: "Smith J. A sample article. Journal. 2020.",
                  title: "A sample article",
                  authors: ["Smith J."],
                  year: 2020,
                  journal: "Journal",
                  doi: null,
                },
              ],
            }),
          },
        },
      ],
    });

    const memCache = new Map<string, unknown>();
    const cache = {
      get<T>(key: string): T | null {
        return (memCache.get(key) as T | undefined) ?? null;
      },
      set<T>(key: string, value: T): void {
        memCache.set(key, value);
      },
    };
    const refs = [{ index: 0, raw: "Smith J. A sample article. Journal. 2020." }];

    const clientA = new DeepseekLlmClient(
      {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "sk-test",
        model: "test-model",
      },
      { cache },
    );
    const firstOut = await clientA.structureReferences(refs);
    expect(firstOut[0]?.title).toBe("A sample article");
    expect(openAiMock.create).toHaveBeenCalledTimes(1);
    expect(clientA.stats.refsBatchCacheHits).toBe(0);

    // Second client (a fresh process) reuses the same cache. No LLM call,
    // refsBatchCacheHits goes up, refsCalls stays 0.
    const clientB = new DeepseekLlmClient(
      {
        baseUrl: "https://llm.example.test/v1",
        apiKey: "sk-test",
        model: "test-model",
      },
      { cache },
    );
    const secondOut = await clientB.structureReferences(refs);
    expect(secondOut).toEqual(firstOut);
    expect(openAiMock.create).toHaveBeenCalledTimes(1);
    expect(clientB.stats.refsBatchCacheHits).toBe(1);
    expect(clientB.stats.refsCalls).toBe(0);
  });
});
