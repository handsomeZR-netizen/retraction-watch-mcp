export interface ExtractedDocument {
  fullText: string;
  pages: ExtractedPage[];
  metadata: Record<string, unknown>;
  source: "pdf" | "docx" | "latex" | "ocr";
  ocrUsed: boolean;
  warnings: string[];
}

export interface ExtractedPage {
  index: number;
  text: string;
}

export interface ExtractMetadataInput {
  fullText: string;
  pages: ExtractedPage[];
  source: "pdf" | "docx" | "latex" | "ocr";
}

export interface ManuscriptHeaderMeta {
  title: string | null;
  authors: ManuscriptAuthor[];
  doi: string | null;
  abstract: string | null;
}

export interface ManuscriptAuthor {
  name: string;
  email: string | null;
  affiliation: string | null;
  orcid: string | null;
}

export interface RawReference {
  raw: string;
  index: number;
}

export interface StructuredReference {
  raw: string;
  title: string | null;
  authors: string[];
  year: number | null;
  doi: string | null;
  pmid: string | null;
  journal: string | null;
  source: "regex_doi" | "regex_pmid" | "regex_text" | "llm" | "bibtex";
}

export interface IngestProgressEvent {
  stage:
    | "uploaded"
    | "text_extracted"
    | "metadata_extracted"
    | "authors_screened"
    | "refs_segmented"
    | "refs_structured"
    | "screening"
    | "done"
    | "error";
  message?: string;
  detail?: Record<string, unknown>;
}

export type IngestProgressSink = (event: IngestProgressEvent) => void;
