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
    openAiMock.create.mockResolvedValueOnce({
      choices: [
        {
          message: {
            tool_calls: [
              { function: { arguments: '{"references": [' } },
            ],
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
