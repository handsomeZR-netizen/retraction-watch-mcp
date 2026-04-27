import { EMAIL_REGEX, ORCID_REGEX, extractDoi } from "@rw/core";
import type {
  ExtractMetadataInput,
  ManuscriptAuthor,
  ManuscriptHeaderMeta,
} from "./types.js";

export function extractHeaderMetadata(input: ExtractMetadataInput): ManuscriptHeaderMeta {
  const text = headerSlice(input);
  const title = extractTitle(text);
  const doi = extractDoi(text);
  const authors = extractAuthors(text);

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

function extractTitle(text: string): string | null {
  const lines = text.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
    const candidate = lines[i];
    if (
      candidate.length >= 10 &&
      candidate.length <= 250 &&
      !/^abstract$/i.test(candidate) &&
      !/^doi[: ]/i.test(candidate) &&
      candidate.split(/\s+/).length >= 3
    ) {
      return candidate;
    }
  }
  return null;
}

function extractAuthors(text: string): ManuscriptAuthor[] {
  const emails = unique(text.match(EMAIL_REGEX) ?? []);
  const orcids = unique(extractAllOrcids(text));

  const authorBlock = sliceAuthorBlock(text);
  const candidateNames = parseNamesFromBlock(authorBlock);

  if (candidateNames.length === 0) {
    return emails.map((email) => ({
      name: email.split("@")[0],
      email,
      affiliation: null,
      orcid: orcids[0] ?? null,
    }));
  }

  return candidateNames.map((name, idx) => ({
    name,
    email: emails[idx] ?? null,
    orcid: orcids[idx] ?? null,
    affiliation: guessAffiliation(authorBlock, name),
  }));
}

function sliceAuthorBlock(text: string): string {
  const titleEnd = text.split(/\n/).findIndex((l) => /^abstract$/i.test(l.trim()));
  if (titleEnd > 0) {
    return text
      .split(/\n/)
      .slice(0, titleEnd)
      .join("\n");
  }
  return text.slice(0, Math.min(text.length, 4000));
}

function parseNamesFromBlock(block: string): string[] {
  const lines = block.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const candidates: string[] = [];
  for (const line of lines) {
    if (line.length < 4 || line.length > 220) continue;
    if (/^(abstract|keywords?|introduction|table of contents)$/i.test(line)) continue;
    if (/@/.test(line) || /https?:\/\//.test(line)) continue;
    if (/^doi[: ]/i.test(line)) continue;
    if (looksLikeNameLine(line)) {
      for (const part of line.split(/[,;]| and | & |·/i)) {
        const cleaned = part.replace(/[\d\*†-⁳⁴-⁹†‡§¶]/g, "").trim();
        if (cleaned && /^[A-Z一-鿿]/.test(cleaned)) {
          candidates.push(cleaned);
        }
      }
      if (candidates.length >= 1) break;
    }
  }
  return unique(candidates);
}

function looksLikeNameLine(line: string): boolean {
  const tokens = line.split(/\s+/);
  if (tokens.length < 2) return false;
  const lettersOnly = tokens.filter((t) => /^[A-Z][A-Za-z'.\-]+$/.test(t)).length;
  if (lettersOnly >= 2) return true;
  if (/[一-鿿]{2,}/.test(line)) return true;
  return false;
}

function guessAffiliation(block: string, name: string): string | null {
  const idx = block.indexOf(name);
  if (idx < 0) return null;
  const tail = block.slice(idx + name.length, idx + name.length + 400);
  const lines = tail.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/(University|Institute|College|Hospital|Laboratory|Department|大学|学院|医院|研究所|研究院)/i.test(line)) {
      return line;
    }
  }
  return null;
}

function extractAllOrcids(text: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  ORCID_REGEX.lastIndex = 0;
  while ((m = ORCID_REGEX.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function unique<T>(values: Iterable<T>): T[] {
  return [...new Set(values)];
}

function extractAbstract(fullText: string): string | null {
  const m = fullText.match(/abstract\s*[\.:\-]?\s*\n?([\s\S]{20,2000}?)(?:\n\s*\n|introduction\s*\n|keywords?\s*[:：])/i);
  return m ? m[1].trim() : null;
}
