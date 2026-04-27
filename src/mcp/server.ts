import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { RetractionWatchRepository } from "../data/repository.js";
import { screenPerson, scoreCandidate } from "../matching/matcher.js";
import { jsonText, toPublicCandidate, toPublicRecord, toPublicScreenResult } from "../output.js";
import { BALANCED_POLICY, policyMetadata, resolvePolicyForInput, type ScreeningPolicy } from "../policy.js";
import { registerScreeningPrompts } from "./prompts.js";

const noticeTypesSchema = z.array(z.string().min(1)).optional();

export interface RunMcpServerOptions {
  dbPath?: string;
  policy?: ScreeningPolicy;
}

const screenPersonSchema = {
  name: z.string().min(1).describe("Person name to screen."),
  email: z.string().optional().describe("Optional email. Only the domain is used as weak evidence."),
  institution: z.string().optional().describe("Optional institution or affiliation."),
  doi: z.string().optional().describe("Optional original paper DOI or retraction notice DOI."),
  pmid: z.string().optional().describe("Optional original paper PMID or retraction notice PMID."),
  include_notice_types: noticeTypesSchema.describe("Optional RetractionNature filter."),
  limit: z.number().int().min(1).max(50).optional(),
  strict_mode: z.boolean().optional().describe("Use strict mode for this call: only DOI/PMID exact matches become formal matches."),
};

export async function runMcpServer(options: RunMcpServerOptions = {}): Promise<void> {
  const repository = await RetractionWatchRepository.open(options.dbPath);
  const activePolicy = options.policy ?? BALANCED_POLICY;
  const server = new McpServer({
    name: "retraction-watch-mcp",
    version: "0.1.0",
  });
  registerScreeningPrompts(server);

  server.tool(
    "screen_person",
    "Screen one person against the local Retraction Watch index using conservative, explainable matching.",
    screenPersonSchema,
    async (input) => {
      const result = await screenPerson(repository, input, activePolicy);
      return jsonContent(toPublicScreenResult(result));
    },
  );

  server.tool(
    "screen_batch",
    "Screen multiple people against the local Retraction Watch index.",
    {
      people: z.array(z.object(screenPersonSchema)).min(1).max(50),
      include_notice_types: noticeTypesSchema.describe("Optional default RetractionNature filter for every person."),
      limit_per_person: z.number().int().min(1).max(50).optional(),
    },
    async (input) => {
      const results = [];
      for (const person of input.people) {
        results.push(
          toPublicScreenResult(
            await screenPerson(repository, {
              ...person,
              include_notice_types: person.include_notice_types ?? input.include_notice_types,
              limit: person.limit ?? input.limit_per_person,
            }, activePolicy),
          ),
        );
      }
      return jsonContent({ results });
    },
  );

  server.tool(
    "lookup_record",
    "Return one Retraction Watch record by Record ID.",
    {
      record_id: z.string().min(1),
    },
    async ({ record_id }) => {
      const record = repository.getRecordById(record_id);
      return jsonContent(record ? toPublicRecord(record) : { record_id, found: false });
    },
  );

  server.tool(
    "lookup_doi",
    "Return records whose original paper DOI or retraction notice DOI exactly matches the provided DOI.",
    {
      doi: z.string().min(1),
      include_notice_types: noticeTypesSchema,
      limit: z.number().int().min(1).max(50).optional(),
    },
    async ({ doi, include_notice_types, limit }) => {
      const records = repository
        .getRecordsByDoi(doi, include_notice_types, limit ?? 20)
        .map(toPublicRecord);
      return jsonContent({ doi, records });
    },
  );

  server.tool(
    "explain_match",
    "Explain how one query scores against one Retraction Watch record.",
    {
      query: z.object(screenPersonSchema),
      record_id: z.string().min(1),
    },
    async ({ query, record_id }) => {
      const record = repository.getRecordById(record_id);
      if (!record) {
        return jsonContent({ record_id, found: false });
      }
      return jsonContent(toPublicCandidate(scoreCandidate(record, query, resolvePolicyForInput(query, activePolicy))));
    },
  );

  server.tool(
    "get_source_versions",
    "Return local data source version and match policy metadata.",
    {},
    async () => jsonContent({ sourceSnapshot: repository.getSourceSnapshot(), activePolicy: policyMetadata(activePolicy) }),
  );

  server.resource("source-version", "rw://source-version", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: jsonText({ sourceSnapshot: repository.getSourceSnapshot(), activePolicy: policyMetadata(activePolicy) }),
      },
    ],
  }));

  server.resource("match-policy", "rw://match-policy/current", async (uri) => ({
    contents: [
      {
        uri: uri.href,
        mimeType: "application/json",
        text: jsonText(policyMetadata(activePolicy)),
      },
    ],
  }));

  server.resource(
    "record",
    new ResourceTemplate("rw://record/{record_id}", { list: undefined }),
    async (uri, variables) => {
      const recordId = String(variables.record_id);
      const record = repository.getRecordById(recordId);
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: jsonText(record ? toPublicRecord(record) : { record_id: recordId, found: false }),
          },
        ],
      };
    },
  );

  const transport = new StdioServerTransport();

  const close = () => {
    repository.close();
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
  process.once("exit", close);

  await server.connect(transport);
}

function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        mimeType: "application/json",
        text: jsonText(value),
      },
    ],
  };
}
