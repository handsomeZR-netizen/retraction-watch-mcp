import { DEFAULT_DB_PATH, resolveDbPath } from "../config.js";
import {
  normalizeDoi,
  normalizeName,
  normalizePmid,
  normalizeText,
  titleTokens,
  toPinyin,
} from "../matching/normalize.js";
import { getOne, getRows, openSqliteFile, type SqlDatabase, type SqlValue } from "./sql.js";
import type {
  RwRecord,
  ScreenPersonInput,
  ScreenReferenceInput,
  SourceSnapshot,
} from "./types.js";

interface RwRecordRow {
  record_id: string;
  title: string;
  subject: string;
  institution: string;
  journal: string;
  publisher: string;
  country: string;
  author: string;
  urls: string;
  article_type: string;
  retraction_date: string;
  retraction_doi: string;
  retraction_pubmed_id: string;
  original_paper_date: string;
  original_paper_doi: string;
  original_paper_pubmed_id: string;
  retraction_nature: string;
  reason: string;
  paywalled: string;
  notes: string;
  raw_json: string;
}

export class RetractionWatchRepository {
  private constructor(private readonly db: SqlDatabase) {}

  static async open(dbPath = DEFAULT_DB_PATH): Promise<RetractionWatchRepository> {
    const resolvedDbPath = resolveDbPath(dbPath);
    try {
      return new RetractionWatchRepository(await openSqliteFile(resolvedDbPath));
    } catch (err) {
      const code = (err as { code?: string }).code ?? "";
      if (code === "ENOENT" || (err instanceof Error && /unable to open|no such file/i.test(err.message))) {
        throw new Error(
          `Local Retraction Watch database not found at ${resolvedDbPath}. Run "rw-import" first, or pass --db-path / set RW_MCP_DB_PATH to an existing database.`,
        );
      }
      throw err;
    }
  }

  close(): void {
    this.db.close();
  }

  getSourceSnapshot(): SourceSnapshot | null {
    const row = getOne<Record<string, unknown>>(
      this.db,
      `SELECT
        imported_at, csv_url, readme_url, csv_sha256, csv_bytes,
        generated_on, source_commit, row_count, policy_version
       FROM source_snapshots WHERE id = 1`,
    );
    if (!row) {
      return null;
    }
    return {
      importedAt: String(row.imported_at),
      csvUrl: String(row.csv_url),
      readmeUrl: String(row.readme_url),
      csvSha256: String(row.csv_sha256),
      csvBytes: Number(row.csv_bytes),
      generatedOn: row.generated_on ? String(row.generated_on) : null,
      sourceCommit: row.source_commit ? String(row.source_commit) : null,
      rowCount: Number(row.row_count),
      policyVersion: String(row.policy_version),
    };
  }

  getRecordById(recordId: string): RwRecord | null {
    const row = getOne<RwRecordRow>(
      this.db,
      "SELECT * FROM rw_records WHERE record_id = ?",
      [recordId],
    );
    return row ? mapRecord(row) : null;
  }

  getRecordsByDoi(doi: string, noticeTypes?: string[], limit = 20): RwRecord[] {
    const normalizedDoi = normalizeDoi(doi);
    if (!normalizedDoi) {
      return [];
    }
    return this.getRecordsByIndexedValue("doi", normalizedDoi, noticeTypes, limit);
  }

  getRecordsByPmid(pmid: string, noticeTypes?: string[], limit = 20): RwRecord[] {
    const normalizedPmid = normalizePmid(pmid);
    if (!normalizedPmid) {
      return [];
    }
    return this.getRecordsByIndexedValue("pmid", normalizedPmid, noticeTypes, limit);
  }

  findCandidateRecords(input: ScreenPersonInput, noticeTypes: string[], limit: number): RwRecord[] {
    const hardIds: string[] = [];
    const softIds: string[] = [];
    const seen = new Set<string>();
    const normalizedName = normalizeName(input.name);
    const normalizedDoi = normalizeDoi(input.doi);
    const normalizedPmid = normalizePmid(input.pmid);
    const addHard = (recordId: string) => {
      if (seen.has(recordId)) return;
      seen.add(recordId);
      hardIds.push(recordId);
    };
    const addSoft = (recordId: string) => {
      if (seen.has(recordId)) return;
      seen.add(recordId);
      softIds.push(recordId);
    };

    if (normalizedDoi) {
      for (const row of this.getIdsByIndexedValue("doi", normalizedDoi, noticeTypes, 200)) {
        addHard(row.record_id);
      }
    }

    if (normalizedPmid) {
      for (const row of this.getIdsByIndexedValue("pmid", normalizedPmid, noticeTypes, 200)) {
        addHard(row.record_id);
      }
    }

    if (normalizedName.normalized) {
      const exactValues = normalizedName.variants;
      for (const row of this.getIdsByAuthorExact(exactValues, noticeTypes, 200)) {
        addSoft(row.record_id);
      }

      if (normalizedName.signature) {
        for (const row of this.getIdsByAuthorSignature(normalizedName.signature, noticeTypes, 300)) {
          addSoft(row.record_id);
        }
      }

      if (normalizedName.surname) {
        for (const row of this.getIdsByAuthorSurname(normalizedName.surname, noticeTypes, 500)) {
          addSoft(row.record_id);
        }
      }
    }

    if (seen.size === 0 && input.institution) {
      const normalizedInstitution = normalizeText(input.institution);
      const tokens = normalizedInstitution.split(" ").filter((token) => token.length > 3).slice(0, 3);
      for (const token of tokens) {
        for (const row of this.getIdsByInstitutionToken(token, noticeTypes, 100)) {
          addSoft(row.record_id);
        }
      }
    }

    const hardRecords = this.getRecordsByIds(hardIds, noticeTypes, hardIds.length);
    const softLimit = Math.max(limit * 8, 100);
    const softRecords = this.getRecordsByIds(softIds, noticeTypes, softLimit);
    return [...hardRecords, ...softRecords].slice(0, Math.max(limit, hardRecords.length));
  }

  findReferenceCandidates(
    input: ScreenReferenceInput,
    noticeTypes: string[],
    limit = 30,
  ): RwRecord[] {
    const ids = new Set<string>();
    const normalizedDoi = normalizeDoi(input.doi ?? "");
    const normalizedPmid = normalizePmid(input.pmid ?? "");
    if (normalizedDoi) {
      for (const row of this.getIdsByIndexedValue("doi", normalizedDoi, noticeTypes, 50)) {
        ids.add(row.record_id);
      }
    }
    if (normalizedPmid) {
      for (const row of this.getIdsByIndexedValue("pmid", normalizedPmid, noticeTypes, 50)) {
        ids.add(row.record_id);
      }
    }

    const authors = Array.isArray(input.authors) ? input.authors : [];
    for (const author of authors.slice(0, 5)) {
      if (!author) continue;
      const norm = normalizeName(author);
      if (norm.surname) {
        for (const row of this.getIdsByAuthorSurname(norm.surname, noticeTypes, 200)) {
          ids.add(row.record_id);
        }
      }
      if (norm.signature) {
        for (const row of this.getIdsByAuthorSignature(norm.signature, noticeTypes, 200)) {
          ids.add(row.record_id);
        }
      }
      if (norm.isChinese) {
        const pyTokens = toPinyin(author).split(/\s+/).filter(Boolean);
        const pySurname = pyTokens.at(0) ?? "";
        if (pySurname) {
          for (const row of this.getIdsByAuthorSurname(pySurname, noticeTypes, 200)) {
            ids.add(row.record_id);
          }
        }
      }
    }

    const tokens = [...titleTokens(input.title ?? "")].slice(0, 12);
    let injected = 0;
    for (const token of tokens) {
      if (token.length < 3) continue;
      for (const row of this.getIdsByTitleToken(token, noticeTypes, 80)) {
        ids.add(row.record_id);
      }
      injected += 1;
      if (injected >= 6 || ids.size >= limit * 8) break;
    }

    return this.getRecordsByIds([...ids], noticeTypes, Math.max(limit * 4, 80));
  }

  private getIdsByTitleToken(
    token: string,
    noticeTypes: string[],
    limit: number,
  ): { record_id: string }[] {
    if (!token || token.length < 3) return [];
    const { clause, params } = noticeTypeClause(noticeTypes);
    return getRows<{ record_id: string }>(
      this.db,
      `SELECT DISTINCT r.record_id
       FROM rw_records r
       WHERE r.searchable_text LIKE ? ${clause}
       LIMIT ?`,
      [`%${token}%`, ...params, limit],
    );
  }

  private getRecordsByIndexedValue(
    kind: "doi" | "pmid",
    value: string,
    noticeTypes: string[] | undefined,
    limit: number,
  ): RwRecord[] {
    const rows = this.getIdsByIndexedValue(kind, value, noticeTypes ?? [], limit);
    return this.getRecordsByIds(rows.map((row) => row.record_id), noticeTypes ?? [], limit);
  }

  private getIdsByIndexedValue(
    kind: "doi" | "pmid",
    value: string,
    noticeTypes: string[],
    limit: number,
  ): { record_id: string }[] {
    const typeClause = kind === "doi" ? "doi_type IN ('original', 'retraction')" : "doi_type IN ('original_pmid', 'retraction_pmid')";
    const { clause, params } = noticeTypeClause(noticeTypes);
    return getRows<{ record_id: string }>(
      this.db,
      `SELECT DISTINCT r.record_id
       FROM rw_dois d
       JOIN rw_records r ON r.record_id = d.record_id
       WHERE d.doi = ? AND ${typeClause} ${clause}
       LIMIT ?`,
      [value, ...params, limit],
    );
  }

  private getIdsByAuthorExact(
    normalizedNames: string[],
    noticeTypes: string[],
    limit: number,
  ): { record_id: string }[] {
    if (normalizedNames.length === 0) {
      return [];
    }
    const namePlaceholders = normalizedNames.map(() => "?").join(", ");
    const { clause, params } = noticeTypeClause(noticeTypes);
    return getRows<{ record_id: string }>(
      this.db,
      `SELECT DISTINCT r.record_id
       FROM rw_authors a
       JOIN rw_records r ON r.record_id = a.record_id
       WHERE a.normalized_name IN (${namePlaceholders}) ${clause}
       LIMIT ?`,
      [...normalizedNames, ...params, limit],
    );
  }

  private getIdsByAuthorSignature(
    signature: string,
    noticeTypes: string[],
    limit: number,
  ): { record_id: string }[] {
    const { clause, params } = noticeTypeClause(noticeTypes);
    return getRows<{ record_id: string }>(
      this.db,
      `SELECT DISTINCT r.record_id
       FROM rw_authors a
       JOIN rw_records r ON r.record_id = a.record_id
       WHERE a.signature = ? ${clause}
       LIMIT ?`,
      [signature, ...params, limit],
    );
  }

  private getIdsByAuthorSurname(
    surname: string,
    noticeTypes: string[],
    limit: number,
  ): { record_id: string }[] {
    const { clause, params } = noticeTypeClause(noticeTypes);
    return getRows<{ record_id: string }>(
      this.db,
      `SELECT DISTINCT r.record_id
       FROM rw_authors a
       JOIN rw_records r ON r.record_id = a.record_id
       WHERE a.surname = ? ${clause}
       LIMIT ?`,
      [surname, ...params, limit],
    );
  }

  private getIdsByInstitutionToken(
    token: string,
    noticeTypes: string[],
    limit: number,
  ): { record_id: string }[] {
    const { clause, params } = noticeTypeClause(noticeTypes);
    return getRows<{ record_id: string }>(
      this.db,
      `SELECT DISTINCT r.record_id
       FROM rw_institutions i
       JOIN rw_records r ON r.record_id = i.record_id
       WHERE i.normalized_institution LIKE ? ${clause}
       LIMIT ?`,
      [`%${token}%`, ...params, limit],
    );
  }

  private getRecordsByIds(ids: string[], noticeTypes: string[], limit: number): RwRecord[] {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return [];
    }
    const idPlaceholders = uniqueIds.map(() => "?").join(", ");
    const { clause, params } = noticeTypeClause(noticeTypes);
    const rows = getRows<RwRecordRow>(
      this.db,
      `SELECT *
       FROM rw_records r
       WHERE r.record_id IN (${idPlaceholders}) ${clause}
       LIMIT ?`,
      [...uniqueIds, ...params, limit],
    );
    const order = new Map(uniqueIds.map((id, index) => [id, index]));
    return rows
      .sort((left, right) => (order.get(left.record_id) ?? 0) - (order.get(right.record_id) ?? 0))
      .map(mapRecord);
  }
}

function noticeTypeClause(noticeTypes: string[]): { clause: string; params: SqlValue[] } {
  if (noticeTypes.length === 0) {
    return { clause: "", params: [] };
  }
  return {
    clause: `AND r.retraction_nature IN (${noticeTypes.map(() => "?").join(", ")})`,
    params: noticeTypes,
  };
}

function mapRecord(row: RwRecordRow): RwRecord {
  return {
    recordId: row.record_id,
    title: row.title,
    subject: row.subject,
    institution: row.institution,
    journal: row.journal,
    publisher: row.publisher,
    country: row.country,
    author: row.author,
    urls: row.urls,
    articleType: row.article_type,
    retractionDate: row.retraction_date,
    retractionDoi: row.retraction_doi,
    retractionPubMedId: row.retraction_pubmed_id,
    originalPaperDate: row.original_paper_date,
    originalPaperDoi: row.original_paper_doi,
    originalPaperPubMedId: row.original_paper_pubmed_id,
    retractionNature: row.retraction_nature,
    reason: row.reason,
    paywalled: row.paywalled,
    notes: row.notes,
    rawJson: row.raw_json,
  };
}
