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
    const re = new RegExp(
      `(?:^|\\n)\\s*${escapeRegex(header)}[\\s\\d.:;,()\\-]*(?:\\n|$)`,
      "g",
    );
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
  const lineHeadRe =
    /^\s*(?:\[(?:\d{1,3}|[A-Za-z][A-Za-z+\-]{0,12}\d{2,4}[a-z]?)\]|\(\d{1,3}\)|\d{1,3}\.)\s+/;
  const isNumberedByLine =
    lines.slice(0, 40).filter((l) => lineHeadRe.test(l)).length >= 4;

  if (isNumberedByLine) {
    const out: string[] = [];
    let current = "";
    for (const line of lines) {
      if (lineHeadRe.test(line)) {
        if (current.trim()) out.push(current);
        current = line.replace(lineHeadRe, "");
      } else {
        current += " " + line.trim();
      }
    }
    if (current.trim()) out.push(current);
    return out
      .map((s) => fixSplitDoi(s.replace(/\s+/g, " ").trim()))
      .filter((s) => s.length > 25);
  }

  const authorYearOut = splitAuthorYear(lines);
  if (authorYearOut.length >= 4) return authorYearOut;

  const flat = cleaned.replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  const inlineNumberedRe =
    /(?:^|[\.\)\s])(?:\[(\d{1,3})\]|(\d{1,3})\.)(?=\s+[A-Z][a-zA-Z'\-]+(?:,|\s+[A-Z]))/g;
  const matches = [...flat.matchAll(inlineNumberedRe)];
  if (matches.length >= 4) {
    const out: string[] = [];
    for (let i = 0; i < matches.length; i += 1) {
      const start = matches[i].index ?? 0;
      const end = i + 1 < matches.length ? matches[i + 1].index ?? flat.length : flat.length;
      out.push(
        fixSplitDoi(
          flat.slice(start, end).replace(/^[\.\)\s]*/, "").replace(lineHeadRe, "").trim(),
        ),
      );
    }
    return out.filter((s) => s.length > 25);
  }

  const blocks = cleaned
    .split(/\n{2,}/)
    .map((b) => fixSplitDoi(b.replace(/\n/g, " ").replace(/\s+/g, " ").trim()));
  return blocks.filter((b) => b.length > 25 && /\d{4}/.test(b));
}

function splitAuthorYear(rawLines: string[]): string[] {
  const lines = rawLines
    .map((l) =>
      l
        .replace(/^\s*(?:References?|REFERENCES|Bibliography|参考文献)[\d\s.:;,()\-]*$/i, "")
        .replace(/(\d{1,4})\s*$/, "")
        .trim(),
    )
    .filter(Boolean);

  const isAuthorStart = (l: string): boolean => {
    if (l.length < 8) return false;
    if (/^\[(?:\d{1,3}|[A-Za-z][A-Za-z+\-]{0,12}\d{2,4}[a-z]?)\]\s+/.test(l)) return true;
    if (/^[A-Z][a-zA-Z'\-]+,\s+[A-Z]\.?/.test(l)) return true;
    if (/^[A-Z][a-zA-Z'\-]+,\s*[A-Z][a-z]?\.\s*[A-Z]?\.?,/.test(l)) return true;
    if (/^[A-Z][a-z]+\s+[A-Z][a-zA-Z'\-]+(?:,|\s+and\s+|\s+et\s+al)/.test(l)) return true;
    if (/^[A-Z][a-z]+\s+[A-Z][a-zA-Z'\-]+\.\s/.test(l)) return true;
    if (/^[\u4e00-\u9fff]{2,4}[,，\s]/.test(l)) return true;
    return false;
  };

  const out: string[] = [];
  let current = "";
  for (const l of lines) {
    if (isAuthorStart(l) && current.trim()) {
      out.push(current.trim());
      current = l;
    } else {
      current = current ? current + " " + l : l;
    }
  }
  if (current.trim()) out.push(current.trim());
  return out
    .map((s) => fixSplitDoi(s.replace(/\s+/g, " ").trim()))
    .filter((s) => s.length > 30 && /\d{4}/.test(s));
}

function fixSplitDoi(text: string): string {
  return text.replace(
    /(10\.\d{4,9}\/[\w./-]*?)\s+([a-z0-9][\w./-]*)/gi,
    (full, head: string, tail: string) => {
      if (/\s/.test(tail)) return full;
      if (head.length + tail.length > 120) return full;
      return head + tail;
    },
  );
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
