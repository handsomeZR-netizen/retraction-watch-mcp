import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export function registerScreeningPrompts(server: McpServer): void {
  server.registerPrompt(
    "screen-author",
    {
      title: "Screen Author",
      description: "Prepare a conservative Retraction Watch author-screening workflow.",
      argsSchema: {
        name: z.string().describe("Author name to screen."),
        institution: z.string().optional().describe("Optional institution or affiliation."),
        doi: z.string().optional().describe("Optional DOI to use as hard record evidence."),
      },
    },
    ({ name, institution, doi }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              `Use the Retraction Watch MCP tools to screen "${name}".`,
              institution ? `Institution: ${institution}.` : "No institution was supplied.",
              doi ? `DOI: ${doi}.` : "No DOI was supplied.",
              "Do not call this a misconduct finding. Distinguish DOI/PMID exact evidence from name-only or auxiliary evidence, and end with manual-review steps.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "review-match-result",
    {
      title: "Review Match Result",
      description: "Turn a screening JSON result into a cautious human-review summary.",
      argsSchema: {
        result_json: z.string().describe("JSON returned by screen_person or screen_batch."),
      },
    },
    ({ result_json }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Review the following Retraction Watch MCP result and write a cautious, non-accusatory summary.",
              "Requirements:",
              "1. Do not say the person committed misconduct.",
              "2. Treat likely_match and possible_match as record-level similarity only.",
              "3. Explain whether identityConfirmed is true and why.",
              "4. Mention the lack of author-affiliation mapping when relevant.",
              "5. Provide concrete manual verification steps.",
              "",
              result_json,
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "batch-integrity-check",
    {
      title: "Batch Integrity Check",
      description: "Prepare a cautious batch screening workflow for multiple people.",
      argsSchema: {
        input_description: z.string().describe("Description of the people or CSV fields to screen."),
      },
    },
    ({ input_description }) => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Plan and run a Retraction Watch batch screening workflow using screen_batch where appropriate.",
              `Input description: ${input_description}`,
              "Use strict wording in the final report: records are leads for manual review, not identity or misconduct determinations.",
              "Flag confirmed DOI/PMID hits separately from name/institution similarities.",
            ].join("\n"),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    "explain-limitations",
    {
      title: "Explain Limitations",
      description: "Explain what this Retraction Watch MCP server can and cannot establish.",
      argsSchema: {},
    },
    () => ({
      messages: [
        {
          role: "user",
          content: {
            type: "text",
            text: [
              "Explain the limitations of Retraction Watch MCP for a non-technical user.",
              "Cover these points: no email field in the source data, no author-affiliation one-to-one mapping, DOI/PMID exact matches are record evidence, name-only matches require manual review, and no_match does not prove absence.",
            ].join("\n"),
          },
        },
      ],
    }),
  );
}
