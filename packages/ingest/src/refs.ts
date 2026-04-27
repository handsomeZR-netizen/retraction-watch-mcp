import { extractDoi, extractPmid, extractYear, YEAR_REGEX } from "@rw/core";
import type {
  ExtractedDocument,
  RawReference,
  StructuredReference,
} from "./types.js";

const SECTION_HEADERS = [
  "References",
  "REFERENCES",
  "参考文献",
  "Bibliography",
  "BIBLIOGRAPHY",
  "Cited Works",
  "Works Cited",
  "Literature Cited",
];

export function locateAndSplitReferences(doc: ExtractedDocument): RawReference[] {
  const text = doc.fullText;
  if (!text) return [];
  const start = findReferencesStart(text);
  if (start < 0) return [];
  const tail = text.slice(start);
  const block = trimToReferences(tail);
  const entries = splitEntries(block);
  return entries.map((raw, index) => ({ raw: raw.trim(), index }));
}

function findReferencesStart(text: string): number {
  let bestIdx = -1;
  for (const header of SECTION_HEADERS) {
    const re = new RegExp(`(?:^|\\n)\\s*${escapeRegex(header)}\\s*\\n`, "g");
    let match: RegExpExecArray | null;
    while ((match = re.exec(text)) !== null) {
      if (match.index > bestIdx) {
        bestIdx = match.index;
      }
    }
  }
  return bestIdx;
}

function trimToReferences(tail: string): string {
  const stopHeaders = [
    "Acknowledgements",
    "Acknowledgments",
    "Appendix",
    "Author Contributions",
    "Conflict of Interest",
    "Funding",
    "Supplementary",
    "致谢",
  ];
  let end = tail.length;
  for (const h of stopHeaders) {
    const re = new RegExp(`\\n\\s*${escapeRegex(h)}\\s*\\n`, "i");
    const m = tail.match(re);
    if (m && m.index !== undefined && m.index < end && m.index > 200) {
      end = m.index;
    }
  }
  return tail.slice(0, end);
}

function splitEntries(block: string): string[] {
  const cleaned = block.replace(/\r/g, "").trim();
  const lines = cleaned.split(/\n+/);
  const numberedRe = /^\s*(?:\[(\d{1,3})\]|(\d{1,3})\.)\s+/;
  const isNumbered = lines.slice(0, 30).filter((l) => numberedRe.test(l)).length >= 5;

  if (isNumbered) {
    const out: string[] = [];
    let current = "";
    for (const line of lines) {
      if (numberedRe.test(line)) {
        if (current.trim()) out.push(current);
        current = line.replace(numberedRe, "");
      } else {
        current += " " + line.trim();
      }
    }
    if (current.trim()) out.push(current);
    return out
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter((s) => s.length > 25);
  }

  const blocks = cleaned.split(/\n{2,}/).map((b) => b.replace(/\n/g, " ").replace(/\s+/g, " ").trim());
  return blocks.filter((b) => b.length > 25 && /\d{4}/.test(b));
}

export function regexStructure(refs: RawReference[]): {
  structured: StructuredReference[];
  unresolved: RawReference[];
} {
  const structured: StructuredReference[] = [];
  const unresolved: RawReference[] = [];
  for (const ref of refs) {
    const doi = extractDoi(ref.raw);
    const pmid = extractPmid(ref.raw);
    if (doi || pmid) {
      structured.push({
        raw: ref.raw,
        title: heuristicTitle(ref.raw),
        authors: heuristicAuthors(ref.raw),
        year: extractYear(ref.raw),
        doi,
        pmid,
        journal: heuristicJournal(ref.raw),
        source: doi ? "regex_doi" : "regex_pmid",
      });
    } else {
      unresolved.push(ref);
    }
  }
  return { structured, unresolved };
}

function heuristicTitle(text: string): string | null {
  const yearMatch = text.match(YEAR_REGEX);
  let after = text;
  if (yearMatch && yearMatch.index !== undefined) {
    after = text.slice(yearMatch.index + yearMatch[0].length);
  }
  after = after.replace(/^[\s\)\.,]+/, "");
  const firstChunk = after.split(/[\.\?]\s+(?=[A-Z一-鿿])/)[0] ?? after;
  const cleaned = firstChunk.replace(/\s+/g, " ").trim();
  if (!cleaned) return null;
  return cleaned.length > 250 ? cleaned.slice(0, 250) : cleaned;
}

function heuristicAuthors(text: string): string[] {
  const yearMatch = text.match(YEAR_REGEX);
  let head = text;
  if (yearMatch && yearMatch.index !== undefined) {
    head = text.slice(0, yearMatch.index);
  }
  head = head.replace(/^\s*\[\d+\]\s*/, "").trim();
  if (!head) return [];
  const parts = head
    .split(/,\s+|;\s+|\band\s+|&\s+/i)
    .map((p) => p.trim())
    .filter((p) => p.length > 1 && p.length < 80);
  const names: string[] = [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    if (/^\s*[A-Z]\.?(?:\s*[A-Z]\.?)*\s*$/.test(part) && names.length > 0) {
      names[names.length - 1] = `${names[names.length - 1]} ${part}`.trim();
    } else if (/[A-Za-z一-鿿]/.test(part)) {
      names.push(part);
    }
    if (names.length >= 8) break;
  }
  return names;
}

function heuristicJournal(text: string): string | null {
  const titleStart = heuristicTitle(text);
  if (!titleStart) return null;
  const idx = text.indexOf(titleStart);
  if (idx < 0) return null;
  const after = text.slice(idx + titleStart.length);
  const m = after.match(/[\.\?]\s*([A-Z][^\.,;]{3,80})[\.,]/);
  return m ? m[1].trim() : null;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
