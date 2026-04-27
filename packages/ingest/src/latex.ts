import path from "node:path";
import { extractDoi, extractYear } from "@rw/core";
import type { ExtractedDocument, StructuredReference } from "./types.js";

export async function extractLatex(
  buffer: Buffer,
  fileName: string,
): Promise<ExtractedDocument & { bibReferences: StructuredReference[] }> {
  const ext = path.extname(fileName).toLowerCase();
  const warnings: string[] = [];
  let texSources: { name: string; text: string }[] = [];
  let bibSources: { name: string; text: string }[] = [];

  if (ext === ".tex") {
    texSources.push({ name: fileName, text: buffer.toString("utf8") });
  } else if (ext === ".zip") {
    const extracted = await unzipToMemory(buffer);
    for (const file of extracted) {
      const e = path.extname(file.name).toLowerCase();
      if (e === ".tex") texSources.push(file);
      else if (e === ".bib") bibSources.push(file);
    }
  } else {
    warnings.push(`Unknown LaTeX file extension: ${ext}`);
  }

  const fullText = texSources.map((t) => stripLatex(t.text)).join("\n\n").trim();
  const bibReferences = parseBibReferences(bibSources);
  const inlineRefs = extractBibitems(texSources);

  return {
    fullText,
    pages: texSources.map((t, i) => ({ index: i + 1, text: stripLatex(t.text) })),
    metadata: {},
    source: "latex",
    ocrUsed: false,
    warnings,
    bibReferences: [...bibReferences, ...inlineRefs],
  };
}

function stripLatex(text: string): string {
  return text
    .replace(/%.*$/gm, "")
    .replace(/\\(begin|end)\{[^}]+\}/g, "")
    .replace(/\\[a-zA-Z*]+\s*(\[[^\]]*\])?\s*(\{[^{}]*\})?/g, " ")
    .replace(/[{}~]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractBibitems(sources: { name: string; text: string }[]): StructuredReference[] {
  const refs: StructuredReference[] = [];
  const re = /\\bibitem\s*(?:\[[^\]]*\])?\s*\{[^}]*\}\s*([\s\S]*?)(?=(?:\\bibitem)|\\end\{thebibliography\})/g;
  for (const src of sources) {
    let match: RegExpExecArray | null;
    while ((match = re.exec(src.text)) !== null) {
      const raw = stripLatex(match[1] ?? "").trim();
      if (!raw) continue;
      refs.push({
        raw,
        title: null,
        authors: [],
        year: extractYear(raw),
        doi: extractDoi(raw),
        pmid: null,
        journal: null,
        source: "bibtex",
      });
    }
  }
  return refs;
}

function parseBibReferences(sources: { name: string; text: string }[]): StructuredReference[] {
  if (sources.length === 0) return [];
  const refs: StructuredReference[] = [];
  for (const src of sources) {
    for (const entry of splitBibEntries(src.text)) {
      const fields = parseBibEntry(entry);
      if (!fields) continue;
      refs.push({
        raw: entry.trim(),
        title: stripBraces(fields.title ?? null),
        authors: parseBibAuthors(fields.author ?? ""),
        year: fields.year ? Number(fields.year) || null : null,
        doi: fields.doi ? extractDoi(fields.doi) : extractDoi(entry),
        pmid: null,
        journal: stripBraces(fields.journal ?? fields.booktitle ?? null),
        source: "bibtex",
      });
    }
  }
  return refs;
}

function splitBibEntries(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === "@" && depth === 0) {
      start = i;
    } else if (ch === "{" && start >= 0) {
      depth += 1;
    } else if (ch === "}" && start >= 0) {
      depth -= 1;
      if (depth === 0) {
        out.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return out;
}

function parseBibEntry(entry: string): Record<string, string> | null {
  const headMatch = entry.match(/^@\w+\s*\{\s*[^,]+,\s*([\s\S]*)\}\s*$/);
  if (!headMatch) return null;
  const body = headMatch[1];
  const fields: Record<string, string> = {};
  const fieldRe = /(\w+)\s*=\s*(\{(?:[^{}]|\{[^{}]*\})*\}|"[^"]*"|[^,]+)\s*,?/g;
  let m: RegExpExecArray | null;
  while ((m = fieldRe.exec(body)) !== null) {
    fields[m[1].toLowerCase()] = m[2].replace(/^[\{"]|[\}"]$/g, "").trim();
  }
  return fields;
}

function parseBibAuthors(value: string): string[] {
  if (!value) return [];
  return value
    .split(/\band\b/i)
    .map((a) => stripBraces(a)?.trim() ?? "")
    .filter(Boolean);
}

function stripBraces(value: string | null | undefined): string | null {
  if (!value) return null;
  return value.replace(/^[\{"]+|[\}"]+$/g, "").trim() || null;
}

async function unzipToMemory(
  buffer: Buffer,
): Promise<{ name: string; text: string }[]> {
  const yauzl = await import("yauzl");
  return new Promise((resolve, reject) => {
    const out: { name: string; text: string }[] = [];
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error("zip open failed"));
      zip.on("entry", (entry) => {
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        const ext = path.extname(entry.fileName).toLowerCase();
        if (ext !== ".tex" && ext !== ".bib") {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) {
            zip.readEntry();
            return;
          }
          const chunks: Buffer[] = [];
          stream.on("data", (c) => chunks.push(c));
          stream.on("end", () => {
            out.push({
              name: entry.fileName,
              text: Buffer.concat(chunks).toString("utf8"),
            });
            zip.readEntry();
          });
          stream.on("error", () => zip.readEntry());
        });
      });
      zip.on("end", () => resolve(out));
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}
