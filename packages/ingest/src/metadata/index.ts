/**
 * Header metadata extractor entry point. Slices the first ~2 pages, strips any
 * Elsevier-style preamble (Highlights, Graphical Abstract, Article Info), then
 * delegates to title/author submodules.
 */

import { extractDoi } from "@rw/core";
import type { ExtractMetadataInput, ManuscriptHeaderMeta } from "../types.js";
import { extractAuthors } from "./authors.js";
import { stripPreambleSentinels } from "./preamble.js";
import { extractTitle } from "./title.js";

export { extractTitle } from "./title.js";
export { extractAuthors } from "./authors.js";
export { stripPreambleSentinels } from "./preamble.js";

export function extractHeaderMetadata(input: ExtractMetadataInput): ManuscriptHeaderMeta {
  const text = headerSlice(input);
  const allLines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const { lines } = stripPreambleSentinels(allLines);

  const title = extractTitle(lines);
  const doi = extractDoi(text);
  const authors = extractAuthors(lines, text);

  return {
    title,
    doi,
    authors,
    abstract: extractAbstract(input.fullText),
  };
}

function headerSlice(input: ExtractMetadataInput): string {
  if (input.pages.length > 0) {
    return input.pages.slice(0, 2).map((p) => p.text).join("\n");
  }
  return input.fullText.slice(0, 8000);
}

function extractAbstract(fullText: string): string | null {
  const m = fullText.match(
    /abstract\s*[\.:\-]?\s*\n?([\s\S]{20,2000}?)(?:\n\s*\n|introduction\s*\n|keywords?\s*[:：])/i,
  );
  return m ? m[1].trim() : null;
}
