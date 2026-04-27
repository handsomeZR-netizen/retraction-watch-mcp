import type { SqlDatabase } from "./sql.js";

export function createSchema(db: SqlDatabase): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    DROP TABLE IF EXISTS source_snapshots;
    DROP TABLE IF EXISTS rw_dois;
    DROP TABLE IF EXISTS rw_institutions;
    DROP TABLE IF EXISTS rw_authors;
    DROP TABLE IF EXISTS rw_records;

    CREATE TABLE source_snapshots (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      imported_at TEXT NOT NULL,
      csv_url TEXT NOT NULL,
      readme_url TEXT NOT NULL,
      csv_sha256 TEXT NOT NULL,
      csv_bytes INTEGER NOT NULL,
      generated_on TEXT,
      source_commit TEXT,
      row_count INTEGER NOT NULL,
      policy_version TEXT NOT NULL
    );

    CREATE TABLE rw_records (
      record_id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      subject TEXT NOT NULL,
      institution TEXT NOT NULL,
      journal TEXT NOT NULL,
      publisher TEXT NOT NULL,
      country TEXT NOT NULL,
      author TEXT NOT NULL,
      urls TEXT NOT NULL,
      article_type TEXT NOT NULL,
      retraction_date TEXT NOT NULL,
      retraction_doi TEXT NOT NULL,
      retraction_pubmed_id TEXT NOT NULL,
      original_paper_date TEXT NOT NULL,
      original_paper_doi TEXT NOT NULL,
      original_paper_pubmed_id TEXT NOT NULL,
      retraction_nature TEXT NOT NULL,
      reason TEXT NOT NULL,
      paywalled TEXT NOT NULL,
      notes TEXT NOT NULL,
      raw_json TEXT NOT NULL,
      searchable_text TEXT NOT NULL
    );

    CREATE TABLE rw_authors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL REFERENCES rw_records(record_id) ON DELETE CASCADE,
      author_name TEXT NOT NULL,
      normalized_name TEXT NOT NULL,
      surname TEXT NOT NULL,
      initials TEXT NOT NULL,
      signature TEXT NOT NULL
    );

    CREATE TABLE rw_institutions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL REFERENCES rw_records(record_id) ON DELETE CASCADE,
      institution_text TEXT NOT NULL,
      normalized_institution TEXT NOT NULL
    );

    CREATE TABLE rw_dois (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      record_id TEXT NOT NULL REFERENCES rw_records(record_id) ON DELETE CASCADE,
      doi_type TEXT NOT NULL,
      doi TEXT NOT NULL
    );

    CREATE INDEX idx_rw_authors_normalized ON rw_authors(normalized_name);
    CREATE INDEX idx_rw_authors_signature ON rw_authors(signature);
    CREATE INDEX idx_rw_authors_surname ON rw_authors(surname);
    CREATE INDEX idx_rw_institutions_norm ON rw_institutions(normalized_institution);
    CREATE INDEX idx_rw_dois_doi ON rw_dois(doi);
    CREATE INDEX idx_rw_records_nature ON rw_records(retraction_nature);
  `);
}

