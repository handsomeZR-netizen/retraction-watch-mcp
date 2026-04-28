import path from "node:path";
import { extractDoi, extractYear } from "@rw/core";
import type { ExtractedDocument, StructuredReference } from "./types.js";

const ZIP_MAX_ENTRIES = 200;
const ZIP_MAX_ENTRY_BYTES = 10 * 1024 * 1024;
const ZIP_MAX_TOTAL_BYTES = 50 * 1024 * 1024;

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
    // Collapse horizontal whitespace, but preserve newlines so the metadata
    // extractor can still find a title/author block by line.
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
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
      let entries = 0;
      let totalUncompressed = 0;
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        zip.close();
        reject(new Error(`zip-archive-limit-exceeded: ${reason}`));
      };
      zip.on("entry", (entry) => {
        if (settled) return;
        entries += 1;
        if (entries > ZIP_MAX_ENTRIES) {
          fail("max entries exceeded");
          return;
        }
        if (isUnsafeZipEntryName(entry.fileName)) {
          fail("unsafe entry path");
          return;
        }
        if (path.extname(entry.fileName).toLowerCase() === ".zip") {
          fail("nested zip not allowed");
          return;
        }
        if (/\/$/.test(entry.fileName)) {
          zip.readEntry();
          return;
        }
        if (entry.uncompressedSize > ZIP_MAX_ENTRY_BYTES) {
          fail("max entry bytes exceeded");
          return;
        }
        totalUncompressed += entry.uncompressedSize;
        if (totalUncompressed > ZIP_MAX_TOTAL_BYTES) {
          fail("max total bytes exceeded");
          return;
        }
        const ext = path.extname(entry.fileName).toLowerCase();
        if (ext !== ".tex" && ext !== ".bib") {
          zip.readEntry();
          return;
        }
        zip.openReadStream(entry, (e, stream) => {
          if (settled) return;
          if (e || !stream) {
            reject(e ?? new Error(`zip stream open failed: ${entry.fileName}`));
            return;
          }
          const chunks: Buffer[] = [];
          let bytes = 0;
          stream.on("data", (c: Buffer) => {
            bytes += c.byteLength;
            if (bytes > ZIP_MAX_ENTRY_BYTES) {
              fail("max entry bytes exceeded");
              stream.destroy();
              return;
            }
            chunks.push(c);
          });
          stream.on("end", () => {
            if (settled) return;
            out.push({
              name: entry.fileName,
              text: Buffer.concat(chunks).toString("utf8"),
            });
            zip.readEntry();
          });
          stream.on("error", reject);
        });
      });
      zip.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(out);
      });
      zip.on("error", reject);
      zip.readEntry();
    });
  });
}

function isUnsafeZipEntryName(fileName: string): boolean {
  const normalized = fileName.replace(/\\/g, "/");
  return (
    normalized.split("/").includes("..") ||
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(fileName)
  );
}
