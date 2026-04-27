import OpenAI from "openai";
import {
  REFS_EXTRACTION_SYSTEM_PROMPT,
  REFS_EXTRACTION_TOOL,
  HEADER_PARSE_SYSTEM_PROMPT,
  HEADER_PARSE_TOOL,
} from "./prompts/refs-extraction.js";
import type {
  ManuscriptAuthor,
  ManuscriptHeaderMeta,
  RawReference,
  StructuredReference,
} from "./types.js";

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface LlmCallStats {
  refsCalls: number;
  headerCalls: number;
  totalRefsParsed: number;
  failures: number;
}

export interface LlmRefsBatchOptions {
  batchSize?: number;
  maxRetries?: number;
}

const DEFAULT_BATCH_SIZE = 20;

export class DeepseekLlmClient {
  private readonly client: OpenAI;
  readonly stats: LlmCallStats = {
    refsCalls: 0,
    headerCalls: 0,
    totalRefsParsed: 0,
    failures: 0,
  };

  constructor(private readonly config: LlmConfig) {
    if (!config.apiKey) {
      throw new Error("LLM apiKey is empty");
    }
    if (!config.baseUrl) {
      throw new Error("LLM baseUrl is empty");
    }
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });
  }

  async structureReferences(
    refs: RawReference[],
    options: LlmRefsBatchOptions = {},
  ): Promise<StructuredReference[]> {
    if (refs.length === 0) return [];
    const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
    const out: StructuredReference[] = [];
    for (let i = 0; i < refs.length; i += batchSize) {
      const batch = refs.slice(i, i + batchSize);
      const structured = await this.structureRefsBatch(batch, options.maxRetries ?? 1);
      out.push(...structured);
    }
    return out;
  }

  async parseHeader(headerText: string): Promise<ManuscriptHeaderMeta | null> {
    if (!headerText.trim()) return null;
    this.stats.headerCalls += 1;
    try {
      const response = await this.client.chat.completions.create({
        model: this.config.model,
        temperature: 0,
        max_tokens: 1500,
        messages: [
          { role: "system", content: HEADER_PARSE_SYSTEM_PROMPT },
          {
            role: "user",
            content: `请抽取以下论文首页元数据：\n\n${headerText.slice(0, 6000)}`,
          },
        ],
        tools: [HEADER_PARSE_TOOL],
        tool_choice: { type: "function", function: { name: "emit_header" } },
      });
      const args = readToolArgs(response);
      if (!args) {
        this.stats.failures += 1;
        return null;
      }
      return normalizeHeader(args);
    } catch (err) {
      this.stats.failures += 1;
      return null;
    }
  }

  private async structureRefsBatch(
    refs: RawReference[],
    maxRetries: number,
  ): Promise<StructuredReference[]> {
    const userContent =
      "请抽取以下参考文献。\n\n" +
      refs
        .map((r) => `<ref index="${r.index}">${r.raw}</ref>`)
        .join("\n");

    let attempt = 0;
    while (attempt <= maxRetries) {
      this.stats.refsCalls += 1;
      try {
        const response = await this.client.chat.completions.create({
          model: this.config.model,
          temperature: 0,
          max_tokens: 4000,
          messages: [
            { role: "system", content: REFS_EXTRACTION_SYSTEM_PROMPT },
            { role: "user", content: userContent },
          ],
          tools: [REFS_EXTRACTION_TOOL],
          tool_choice: { type: "function", function: { name: "emit_references" } },
        });
        const args = readToolArgs(response);
        if (!args || !Array.isArray((args as { references?: unknown[] }).references)) {
          throw new Error("Empty or malformed tool response");
        }
        const out = normalizeRefs(refs, (args as { references: unknown[] }).references);
        this.stats.totalRefsParsed += out.length;
        return out;
      } catch (err) {
        attempt += 1;
        if (attempt > maxRetries) {
          this.stats.failures += 1;
          return refs.map<StructuredReference>((r) => ({
            raw: r.raw,
            title: null,
            authors: [],
            year: null,
            doi: null,
            pmid: null,
            journal: null,
            source: "llm",
          }));
        }
      }
    }
    return [];
  }
}

function readToolArgs(response: unknown): unknown {
  const root = response as {
    choices?: Array<{
      message?: {
        tool_calls?: Array<{ function?: { arguments?: string } }>;
        content?: string;
      };
    }>;
  };
  const message = root.choices?.[0]?.message;
  const argsString = message?.tool_calls?.[0]?.function?.arguments;
  if (typeof argsString === "string" && argsString.trim()) {
    try {
      return JSON.parse(argsString);
    } catch {
      return null;
    }
  }
  if (typeof message?.content === "string" && message.content.trim().startsWith("{")) {
    try {
      return JSON.parse(message.content);
    } catch {
      return null;
    }
  }
  return null;
}

function normalizeRefs(input: RawReference[], emitted: unknown[]): StructuredReference[] {
  const byIndex = new Map<number, StructuredReference>();
  for (const item of emitted) {
    const r = item as Record<string, unknown>;
    const index = typeof r.index === "number" ? r.index : null;
    if (index === null) continue;
    byIndex.set(index, {
      raw: typeof r.raw === "string" ? r.raw : (input.find((i) => i.index === index)?.raw ?? ""),
      title: typeof r.title === "string" ? r.title : null,
      authors: Array.isArray(r.authors)
        ? r.authors.filter((a): a is string => typeof a === "string")
        : [],
      year: typeof r.year === "number" ? r.year : null,
      journal: typeof r.journal === "string" ? r.journal : null,
      doi: typeof r.doi === "string" ? r.doi.toLowerCase() : null,
      pmid: null,
      source: "llm",
    });
  }
  return input.map((r) => byIndex.get(r.index) ?? {
    raw: r.raw,
    title: null,
    authors: [],
    year: null,
    doi: null,
    pmid: null,
    journal: null,
    source: "llm" as const,
  });
}

function normalizeHeader(args: unknown): ManuscriptHeaderMeta {
  const r = args as Record<string, unknown>;
  const authorsRaw = Array.isArray(r.authors) ? r.authors : [];
  const authors: ManuscriptAuthor[] = authorsRaw.map((value) => {
    const v = value as Record<string, unknown>;
    return {
      name: typeof v.name === "string" ? v.name : "",
      affiliation: typeof v.affiliation === "string" ? v.affiliation : null,
      email: typeof v.email === "string" ? v.email : null,
      orcid: typeof v.orcid === "string" ? v.orcid : null,
    };
  });
  return {
    title: typeof r.title === "string" ? r.title : null,
    doi: typeof r.doi === "string" ? r.doi.toLowerCase() : null,
    authors: authors.filter((a) => a.name),
    abstract: null,
  };
}
