import crypto from "node:crypto";
import { parse } from "csv-parse/sync";
import {
  DEFAULT_DB_PATH,
  POLICY_VERSION,
  RW_COMMIT_API_URL,
  RW_CSV_URL,
  RW_README_URL,
  resolveDbPath,
} from "../config.js";
import {
  normalizeDoi,
  normalizeInstitution,
  normalizeName,
  normalizePmid,
  normalizeText,
  splitSemicolonList,
} from "../matching/normalize.js";
import { createSchema } from "./schema.js";
import { createEmptySqlite, runInTransaction, runMany, saveSqliteFile } from "./sql.js";
import type { RawRwRecord, SourceSnapshot } from "./types.js";

export interface ImportOptions {
  dbPath?: string;
  csvUrl?: string;
  readmeUrl?: string;
  commitApiUrl?: string;
}

export interface ImportResult {
  dbPath: string;
  snapshot: SourceSnapshot;
}

const REQUEST_HEADERS = {
  "user-agent": "retraction-watch-mcp/0.1.0 (local research tool)",
};

export async function importRetractionWatchData(
  options: ImportOptions = {},
): Promise<ImportResult> {
  const dbPath = resolveDbPath(options.dbPath ?? DEFAULT_DB_PATH);
  const csvUrl = options.csvUrl ?? RW_CSV_URL;
  const readmeUrl = options.readmeUrl ?? RW_README_URL;
  const commitApiUrl = options.commitApiUrl ?? RW_COMMIT_API_URL;

  const [csvText, readmeText, sourceCommit] = await Promise.all([
    fetchText(csvUrl),
    fetchText(readmeUrl).catch(() => ""),
    fetchCommitSha(commitApiUrl).catch(() => null),
  ]);

  const rows = parseCsv(csvText);
  const csvBytes = Buffer.byteLength(csvText, "utf8");
  const csvSha256 = crypto.createHash("sha256").update(csvText).digest("hex");
  const generatedOn = parseGeneratedOn(readmeText);
  const importedAt = new Date().toISOString();

  const db = await createEmptySqlite();
  let snapshot: SourceSnapshot | null = null;
  try {
    createSchema(db);
    runInTransaction(db, () => {
    runMany(
      db,
      `INSERT INTO rw_records (
        record_id, title, subject, institution, journal, publisher, country,
        author, urls, article_type, retraction_date, retraction_doi,
        retraction_pubmed_id, original_paper_date, original_paper_doi,
        original_paper_pubmed_id, retraction_nature, reason, paywalled,
        notes, raw_json, searchable_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      rows.map((row, index) => {
        const record = toCanonicalRecord(row, index);
        return [
          record.recordId,
          record.title,
          record.subject,
          record.institution,
          record.journal,
          record.publisher,
          record.country,
          record.author,
          record.urls,
          record.articleType,
          record.retractionDate,
          record.retractionDoi,
          record.retractionPubMedId,
          record.originalPaperDate,
          record.originalPaperDoi,
          record.originalPaperPubMedId,
          record.retractionNature,
          record.reason,
          record.paywalled,
          record.notes,
          JSON.stringify(row),
          normalizeText(
            [
              record.title,
              record.author,
              record.institution,
              record.journal,
              record.publisher,
              record.country,
              record.reason,
              record.originalPaperDoi,
              record.retractionDoi,
            ].join(" "),
          ),
        ];
      }),
    );

    runMany(
      db,
      `INSERT INTO rw_authors (
        record_id, author_name, normalized_name, surname, initials, signature
      ) VALUES (?, ?, ?, ?, ?, ?)`,
      rows.flatMap((row, index) => {
        const recordId = makeRecordId(row, index);
        return splitSemicolonList(row.Author ?? "").map((author) => {
          const normalized = normalizeName(author);
          return [
            recordId,
            author,
            normalized.normalized,
            normalized.surname,
            normalized.initials,
            normalized.signature,
          ];
        });
      }),
    );

    runMany(
      db,
      `INSERT INTO rw_institutions (
        record_id, institution_text, normalized_institution
      ) VALUES (?, ?, ?)`,
      rows.flatMap((row, index) => {
        const recordId = makeRecordId(row, index);
        return splitSemicolonList(row.Institution ?? "").map((institution) => [
          recordId,
          institution,
          normalizeInstitution(institution),
        ]);
      }),
    );

    runMany(
      db,
      `INSERT INTO rw_dois (record_id, doi_type, doi) VALUES (?, ?, ?)`,
      rows.flatMap((row, index) => {
        const recordId = makeRecordId(row, index);
        const dois: string[][] = [];
        const originalDoi = normalizeDoi(row.OriginalPaperDOI);
        const retractionDoi = normalizeDoi(row.RetractionDOI);
        const originalPmid = normalizePmid(row.OriginalPaperPubMedID);
        const retractionPmid = normalizePmid(row.RetractionPubMedID);
        if (originalDoi) dois.push([recordId, "original", originalDoi]);
        if (retractionDoi) dois.push([recordId, "retraction", retractionDoi]);
        if (originalPmid) dois.push([recordId, "original_pmid", originalPmid]);
        if (retractionPmid) dois.push([recordId, "retraction_pmid", retractionPmid]);
        return dois;
      }),
    );

    snapshot = {
      importedAt,
      csvUrl,
      readmeUrl,
      csvSha256,
      csvBytes,
      generatedOn,
      sourceCommit,
      rowCount: rows.length,
      policyVersion: POLICY_VERSION,
    };

    runMany(
      db,
      `INSERT INTO source_snapshots (
        id, imported_at, csv_url, readme_url, csv_sha256, csv_bytes,
        generated_on, source_commit, row_count, policy_version
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        [
          snapshot.importedAt,
          snapshot.csvUrl,
          snapshot.readmeUrl,
          snapshot.csvSha256,
          snapshot.csvBytes,
          snapshot.generatedOn,
          snapshot.sourceCommit,
          snapshot.rowCount,
          snapshot.policyVersion,
        ],
      ],
    );
    });

    if (!snapshot) {
      throw new Error("Import did not produce a snapshot.");
    }
    await saveSqliteFile(db, dbPath);
    return { dbPath, snapshot };
  } finally {
    db.close();
  }
}

function parseCsv(csvText: string): RawRwRecord[] {
  return parse(csvText, {
    bom: true,
    columns: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: false,
  }) as RawRwRecord[];
}

function toCanonicalRecord(row: RawRwRecord, index: number) {
  return {
    recordId: makeRecordId(row, index),
    title: clean(row.Title),
    subject: clean(row.Subject),
    institution: clean(row.Institution),
    journal: clean(row.Journal),
    publisher: clean(row.Publisher),
    country: clean(row.Country),
    author: clean(row.Author),
    urls: clean(row.URLS),
    articleType: clean(row.ArticleType),
    retractionDate: clean(row.RetractionDate),
    retractionDoi: normalizeDoi(row.RetractionDOI),
    retractionPubMedId: normalizePmid(row.RetractionPubMedID),
    originalPaperDate: clean(row.OriginalPaperDate),
    originalPaperDoi: normalizeDoi(row.OriginalPaperDOI),
    originalPaperPubMedId: normalizePmid(row.OriginalPaperPubMedID),
    retractionNature: clean(row.RetractionNature),
    reason: clean(row.Reason),
    paywalled: clean(row.Paywalled),
    notes: clean(row.Notes),
  };
}

function makeRecordId(row: RawRwRecord, index: number): string {
  return clean(row["Record ID"]) || `row-${index + 1}`;
}

function clean(value: string | undefined): string {
  return (value ?? "").trim();
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
  }
  return response.text();
}

async function fetchCommitSha(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) {
    return null;
  }
  const json = (await response.json()) as { id?: string };
  return json.id ?? null;
}

function parseGeneratedOn(readmeText: string): string | null {
  const match = readmeText.match(/generated on ([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
  return match?.[1] ?? null;
}
