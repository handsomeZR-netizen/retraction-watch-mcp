import { randomUUID } from "node:crypto";
import {
  BALANCED_POLICY,
  screenAuthor,
  screenReference,
  type AuthorScreenResult,
  type FileType,
  type ManuscriptScreenResult,
  type ManuscriptVerdict,
  type ScreenReferenceInput,
  type ScreenReferenceResult,
  type ScreeningPolicy,
  type RetractionWatchRepository,
  CONSEQUENTIAL_USE_WARNING,
} from "@rw/core";
import { extractDocx } from "./docx.js";
import { extractLatex } from "./latex.js";
import { extractPdf } from "./pdf.js";
import { extractHeaderMetadata } from "./metadata.js";
import { locateAndSplitReferences, regexStructure } from "./refs.js";
import { DeepseekLlmClient, type LlmConfig } from "./llm-client.js";
import { ocrFallback } from "./ocr.js";
import type {
  ExtractedDocument,
  IngestProgressSink,
  RawReference,
  StructuredReference,
} from "./types.js";

export interface ScreenManuscriptInput {
  manuscriptId?: string;
  fileName: string;
  fileType: FileType;
  buffer: Buffer;
}

export interface ScreenManuscriptOptions {
  policy?: ScreeningPolicy;
  llm?: LlmConfig;
  llmHeader?: boolean;
  cloudOcr?: boolean;
  progress?: IngestProgressSink;
}

export async function screenManuscript(
  repository: RetractionWatchRepository,
  input: ScreenManuscriptInput,
  options: ScreenManuscriptOptions = {},
): Promise<ManuscriptScreenResult> {
  const policy = options.policy ?? BALANCED_POLICY;
  const progress = options.progress ?? (() => {});
  const manuscriptId = input.manuscriptId ?? randomUUID();

  let extracted: ExtractedDocument & { bibReferences?: StructuredReference[] };
  let bibReferences: StructuredReference[] = [];

  if (input.fileType === "pdf") {
    extracted = await extractPdf(input.buffer, {
      ocrFallback: (b) => ocrFallback(b, { cloudEnabled: options.cloudOcr ?? false }),
    });
  } else if (input.fileType === "docx") {
    extracted = await extractDocx(input.buffer);
  } else if (input.fileType === "latex") {
    const lx = await extractLatex(input.buffer, input.fileName);
    extracted = lx;
    bibReferences = lx.bibReferences;
  } else {
    throw new Error(`Unsupported file type: ${input.fileType}`);
  }

  progress({
    stage: "text_extracted",
    message: `已提取 ${extracted.fullText.length} 字符（${extracted.pages.length} 页）`,
    detail: { ocrUsed: extracted.ocrUsed, warnings: extracted.warnings },
  });

  const llmClient = options.llm ? new DeepseekLlmClient(options.llm) : null;

  let metadata = extractHeaderMetadata({
    fullText: extracted.fullText,
    pages: extracted.pages,
    source: extracted.source,
  });
  if (llmClient && options.llmHeader) {
    const headerSlice = extracted.pages.slice(0, 2).map((p) => p.text).join("\n").slice(0, 8000);
    const llmHeader = await llmClient.parseHeader(headerSlice).catch(() => null);
    if (llmHeader) {
      metadata = mergeHeader(metadata, llmHeader);
    }
  }

  progress({
    stage: "metadata_extracted",
    message: `识别到 ${metadata.authors.length} 位作者${metadata.title ? `；标题: ${metadata.title}` : ""}`,
    detail: { metadata },
  });

  const screenedAuthors: AuthorScreenResult[] =
    metadata.authors.length === 0
      ? []
      : await Promise.all(
          metadata.authors.map((author) =>
            screenAuthor(repository, author, { policy }),
          ),
        );
  const authorHits = screenedAuthors.filter(
    (a) => a.verdict === "confirmed" || a.verdict === "likely_match" || a.verdict === "possible_match",
  );
  progress({
    stage: "authors_screened",
    message: `作者撤稿史比对：${screenedAuthors.length} 位${authorHits.length > 0 ? `，命中 ${authorHits.length}` : ""}`,
    detail: { count: screenedAuthors.length, hits: authorHits.length },
  });

  const rawRefs: RawReference[] =
    bibReferences.length > 0
      ? []
      : locateAndSplitReferences(extracted);
  progress({
    stage: "refs_segmented",
    message: `参考文献分割：${bibReferences.length + rawRefs.length} 条`,
    detail: { count: bibReferences.length + rawRefs.length },
  });

  const { structured: regexStructured, unresolved } = regexStructure(rawRefs);

  let llmStructured: StructuredReference[] = [];
  if (llmClient && unresolved.length > 0) {
    llmStructured = await llmClient.structureReferences(unresolved);
  }

  const allStructured: StructuredReference[] = [
    ...bibReferences,
    ...regexStructured,
    ...llmStructured,
  ];

  progress({
    stage: "refs_structured",
    message: `结构化参考文献：${allStructured.length} 条`,
    detail: {
      llmCalls: llmClient?.stats.refsCalls ?? 0,
      regexHits: regexStructured.length,
      llmHits: llmStructured.length,
      bibHits: bibReferences.length,
    },
  });

  const screened: { reference: StructuredReference; result: ScreenReferenceResult }[] = [];
  for (let i = 0; i < allStructured.length; i += 1) {
    const ref = allStructured[i];
    const screenInput: ScreenReferenceInput = {
      raw: ref.raw,
      title: ref.title,
      authors: ref.authors,
      year: ref.year,
      doi: ref.doi,
      pmid: ref.pmid,
      journal: ref.journal,
    };
    const result = await screenReference(repository, screenInput, policy);
    screened.push({ reference: ref, result });
    if ((i + 1) % 5 === 0 || i === allStructured.length - 1) {
      progress({
        stage: "screening",
        message: `${i + 1}/${allStructured.length} 已比对`,
        detail: { progress: i + 1, total: allStructured.length },
      });
    }
  }

  const totals = countTotals(screened, screenedAuthors);
  const verdict = decideVerdict(totals, extracted.warnings);

  const result: ManuscriptScreenResult = {
    manuscriptId,
    fileName: input.fileName,
    fileType: input.fileType,
    metadata,
    screenedReferences: screened.map((s) => ({
      reference: {
        raw: s.reference.raw,
        title: s.reference.title,
        authors: s.reference.authors,
        year: s.reference.year,
        doi: s.reference.doi,
        pmid: s.reference.pmid,
        journal: s.reference.journal,
        source: s.reference.source,
      },
      result: s.result,
    })),
    screenedAuthors,
    verdict,
    totals,
    warnings: extracted.warnings,
    network: {
      deepseekCalls: (llmClient?.stats.refsCalls ?? 0) + (llmClient?.stats.headerCalls ?? 0),
      crossrefCalls: 0,
      cloudOcrCalls: 0,
    },
    consequentialUseWarning: CONSEQUENTIAL_USE_WARNING,
    generatedAt: new Date().toISOString(),
    sourceVersion: repository.getSourceSnapshot(),
    policyVersion: policy.policyVersion,
  };

  progress({
    stage: "done",
    message: `${verdict}: ${totals.confirmed} confirmed / ${totals.likely} likely / ${totals.possible} possible / ${totals.clean} clean`,
    detail: { verdict, totals, manuscriptId },
  });

  return result;
}

function mergeHeader(
  base: ReturnType<typeof extractHeaderMetadata>,
  llm: ReturnType<typeof extractHeaderMetadata>,
): ReturnType<typeof extractHeaderMetadata> {
  return {
    title: base.title ?? llm.title,
    doi: base.doi ?? llm.doi,
    authors:
      llm.authors.length >= base.authors.length ? llm.authors : base.authors,
    abstract: base.abstract ?? llm.abstract,
  };
}

function countTotals(
  items: { result: ScreenReferenceResult }[],
  authors: AuthorScreenResult[],
) {
  const totals = {
    references: items.length,
    confirmed: 0,
    likely: 0,
    possible: 0,
    clean: 0,
    authorsConfirmed: 0,
    authorsLikely: 0,
    authorsPossible: 0,
  };
  for (const item of items) {
    switch (item.result.verdict) {
      case "confirmed":
        totals.confirmed += 1;
        break;
      case "likely_match":
        totals.likely += 1;
        break;
      case "possible_match":
        totals.possible += 1;
        break;
      default:
        totals.clean += 1;
    }
  }
  for (const a of authors) {
    switch (a.verdict) {
      case "confirmed":
        totals.authorsConfirmed += 1;
        break;
      case "likely_match":
        totals.authorsLikely += 1;
        break;
      case "possible_match":
        totals.authorsPossible += 1;
        break;
      default:
        break;
    }
  }
  return totals;
}

function decideVerdict(totals: ReturnType<typeof countTotals>, warnings: string[] = []): ManuscriptVerdict {
  if (totals.confirmed > 0 || totals.authorsConfirmed > 0) return "FAIL";
  if (
    totals.likely > 0 ||
    totals.possible > 0 ||
    totals.authorsLikely > 0 ||
    totals.authorsPossible > 0
  )
    return "REVIEW";
  if (warnings.includes("text_extraction_empty") && totals.references === 0) return "REVIEW";
  return "PASS";
}
