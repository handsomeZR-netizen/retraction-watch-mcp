import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  BALANCED_POLICY,
  screenAuthor,
  screenReference,
  type AuthorScreenResult,
  type FileType,
  type ManuscriptScreenResult,
  type ManuscriptVerdict,
  type ParseTraceEntry,
  type ScreenReferenceInput,
  type ScreenReferenceResult,
  type ScreeningPolicy,
  type RetractionWatchRepository,
  CONSEQUENTIAL_USE_WARNING,
} from "@rw/core";
import { extractDocx } from "./docx.js";
import { extractLatex } from "./latex.js";
import { extractPdf } from "./pdf.js";
import { extractPdfLayoutAware } from "./pdf-layout.js";
import { extractHeaderMetadata } from "./metadata/index.js";
import {
  heuristicStructureReferences,
  locateAndSplitReferences,
  regexStructure,
} from "./refs.js";
import { DeepseekLlmClient, LlmExtractionClient, type LlmConfig } from "./llm-client.js";
import { ocrFallback } from "./ocr.js";
import { extractCandidates } from "./pipeline/extract-candidates.js";
import { enrichMetadata, type EnrichmentClients } from "./pipeline/enrich-metadata.js";
import { CrossrefClient } from "./external/crossref.js";
import { EuropePmcClient } from "./external/europepmc.js";
import { HttpClient } from "./external/http-client.js";
import { ExternalCache } from "./external/cache.js";
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
  /**
   * Opt out of the four-stage enriched pipeline. Defaults ON; set env
   * `RW_USE_ENRICHED_PIPELINE=0` to force-disable. When enabled, references go
   * through `extractCandidates` → `enrichMetadata` (Crossref/EPMC + LLM
   * fusion) before screening. Crossref enrichment is skipped if no contact
   * mailto is supplied via `enrichmentContact` or `RW_CONTACT_EMAIL`, but
   * LLM-only enrichment (when an LLM client is configured) still runs.
   */
  enrichedPipeline?: boolean;
  enrichmentContact?: string;
  enrichmentCachePath?: string;
  /**
   * Cap on Crossref network calls per manuscript (default 60). Forwarded
   * to `enrichMetadata.limits.maxCrossrefCalls`. Once reached, remaining
   * refs in this manuscript skip Crossref but other steps still run.
   */
  maxCrossrefCalls?: number;
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

  const enrichedPipeline =
    options.enrichedPipeline ?? process.env.RW_USE_ENRICHED_PIPELINE !== "0";
  // Open the external cache up-front so the LLM client can reuse it for
  // structured-ref result caching even on legacy paths. The same instance is
  // later threaded into Crossref/EPMC clients when enriched is on.
  const externalCachePath =
    options.enrichmentCachePath ?? join(process.cwd(), ".local-app-db", "external-cache.sqlite");
  const externalCache: ExternalCache | null =
    options.llm || enrichedPipeline ? new ExternalCache(externalCachePath) : null;
  const llmClient = options.llm
    ? new LlmExtractionClient(options.llm, { cache: externalCache ?? undefined })
    : null;

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

  // Always run the text-based reference splitter, even when bibReferences
  // already contains parsed entries. A custom citation macro or partial
  // \bibitem block could still leave references unparsed; merging both
  // sources avoids silently dropping them. Duplicates collapse later via
  // structured DOI/title comparison in the screening loop.
  let split = locateAndSplitReferences(extracted);
  let rawRefs: RawReference[] = split.refs;

  // Layout-aware re-extraction (PDF only): when the regex splitter signaled
  // it can't locate the References section (typical for double-column papers
  // whose flat-text reading order ate the header), re-read the PDF with bbox
  // info and column detection, then re-split. This is deterministic and
  // budget-free, so we try it BEFORE the LLM segmenter.
  let layoutAwareUsed = false;
  // Track which fullText `split.referencesStartIndex` indexes into so the LLM
  // tail slice below uses the matching source. If layout-aware wins, the
  // offsets are from layoutDoc.fullText, not from extracted.fullText.
  let activeFullText = extracted.fullText;
  if (split.needsLlmFallback && input.fileType === "pdf") {
    const layoutDoc = await extractPdfLayoutAware(input.buffer).catch(() => null);
    if (layoutDoc && layoutDoc.fullText.length > 200) {
      const split2 = locateAndSplitReferences({
        ...layoutDoc,
        warnings: extracted.warnings,
      });
      if (split2.refs.length > split.refs.length) {
        split = split2;
        rawRefs = split2.refs;
        activeFullText = layoutDoc.fullText;
        layoutAwareUsed = true;
      }
    }
  }

  // LLM-segmenter fallback: when both the regex layer and the layout-aware
  // re-extraction couldn't find enough refs, ask the LLM to identify ref
  // boundaries directly. Strictly opt-in (requires llmClient); fails open
  // (returns 0 refs) if the LLM is unreachable.
  let llmSegmented = 0;
  if (split.needsLlmFallback && llmClient) {
    const tailStart = split.referencesStartIndex >= 0
      ? split.referencesStartIndex
      : Math.max(0, activeFullText.length - 12_000);
    const tail = activeFullText.slice(tailStart);
    const segmented = await llmClient.segmentReferences(tail).catch(() => []);
    if (segmented.length > rawRefs.length) {
      llmSegmented = segmented.length;
      rawRefs = segmented;
    }
  }

  progress({
    stage: "refs_segmented",
    message: llmSegmented > 0
      ? `参考文献分割：${bibReferences.length + rawRefs.length} 条（LLM 兜底切出 ${llmSegmented}）`
      : layoutAwareUsed
        ? `参考文献分割：${bibReferences.length + rawRefs.length} 条（双栏布局重读救回）`
        : `参考文献分割：${bibReferences.length + rawRefs.length} 条`,
    detail: {
      count: bibReferences.length + rawRefs.length,
      llmSegmented,
      layoutAwareUsed,
    },
  });

  let allStructured: StructuredReference[];
  let parseTrace: ParseTraceEntry[] | undefined;
  const enrichmentTelemetry = {
    crossrefCalls: 0,
    epmcCalls: 0,
    llmCalls: 0,
    enrichmentFailures: 0,
    cacheHits: 0,
  };

  if (enrichedPipeline) {
    const candidates = extractCandidates(rawRefs);
    const { unresolved } = regexStructure(rawRefs);
    const clients = buildEnrichmentClients(options, llmClient, externalCache);
    const enrichResult = await enrichMetadata(
      candidates,
      unresolved,
      {
        crossref: clients.crossref,
        europepmc: clients.europepmc,
        llm: clients.llm,
      },
      { maxCrossrefCalls: options.maxCrossrefCalls },
    );
    allStructured = dedupeStructuredRefs([...bibReferences, ...enrichResult.references]);
    parseTrace = enrichResult.trace;
    enrichmentTelemetry.crossrefCalls = enrichResult.telemetry.crossrefCalls;
    enrichmentTelemetry.epmcCalls = enrichResult.telemetry.epmcCalls;
    enrichmentTelemetry.llmCalls = enrichResult.telemetry.llmCalls;
    enrichmentTelemetry.enrichmentFailures = enrichResult.telemetry.enrichmentFailures;
    enrichmentTelemetry.cacheHits = externalCache?.stats.hits ?? 0;
    progress({
      stage: "refs_structured",
      message: `结构化参考文献：${allStructured.length} 条 (enriched)`,
      detail: {
        llmCalls: enrichResult.telemetry.llmCalls,
        crossrefCalls: enrichResult.telemetry.crossrefCalls,
        epmcCalls: enrichResult.telemetry.epmcCalls,
        cacheHits: enrichmentTelemetry.cacheHits,
        bibHits: bibReferences.length,
      },
    });
  } else {
    const { structured: regexStructured, unresolved } = regexStructure(rawRefs);
    let llmStructured: StructuredReference[] = [];
    if (llmClient && unresolved.length > 0) {
      llmStructured = await llmClient.structureReferences(unresolved);
    }
    const heuristicStructured = llmClient
      ? []
      : heuristicStructureReferences(unresolved);
    allStructured = dedupeStructuredRefs([
      ...bibReferences,
      ...regexStructured,
      ...llmStructured,
      ...heuristicStructured,
    ]);
    progress({
      stage: "refs_structured",
      message: `结构化参考文献：${allStructured.length} 条`,
      detail: {
        llmCalls: llmClient?.stats.refsCalls ?? 0,
        regexHits: regexStructured.length,
        heuristicHits: heuristicStructured.length,
        llmHits: llmStructured.length,
        bibHits: bibReferences.length,
      },
    });
  }

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
        provenance: s.reference.provenance,
      },
      result: s.result,
    })),
    screenedAuthors,
    verdict,
    totals,
    warnings: extracted.warnings,
    network: {
      deepseekCalls: (llmClient?.stats.refsCalls ?? 0) + (llmClient?.stats.headerCalls ?? 0),
      crossrefCalls: enrichmentTelemetry.crossrefCalls,
      cloudOcrCalls: 0,
      epmcCalls: enrichmentTelemetry.epmcCalls,
      llmCalls: enrichmentTelemetry.llmCalls,
      cacheHits: enrichmentTelemetry.cacheHits,
      enrichmentFailures: enrichmentTelemetry.enrichmentFailures,
    },
    consequentialUseWarning: CONSEQUENTIAL_USE_WARNING,
    generatedAt: new Date().toISOString(),
    sourceVersion: repository.getSourceSnapshot(),
    policyVersion: policy.policyVersion,
    parseTrace,
    pipelineVariant: enrichedPipeline ? "enriched" : "legacy",
  };

  if (externalCache) {
    externalCache.close();
  }

  progress({
    stage: "done",
    message: `${verdict}: ${totals.confirmed} confirmed / ${totals.likely} likely / ${totals.possible} possible / ${totals.clean} clean`,
    detail: { verdict, totals, manuscriptId },
  });

  return result;
}

interface BuiltEnrichmentClients {
  crossref?: CrossrefClient;
  europepmc?: EuropePmcClient;
  llm?: LlmExtractionClient;
}

function buildEnrichmentClients(
  options: ScreenManuscriptOptions,
  llmClient: LlmExtractionClient | null,
  cache: ExternalCache | null,
): BuiltEnrichmentClients {
  const contact = options.enrichmentContact ?? process.env.RW_CONTACT_EMAIL;
  if (!contact || !cache) {
    // Without a contact mailto we won't hit Crossref / EPMC (the polite-pool
    // User-Agent constructor would reject), but LLM-only enrichment can
    // still help refs whose regex extraction failed.
    return { llm: llmClient ?? undefined };
  }
  const http = new HttpClient({
    userAgent: `rw-screen/0.4.11 (mailto:${contact})`,
    timeoutMs: 15_000,
    maxRetries: 3,
    perHostConcurrency: 3,
  });
  return {
    crossref: new CrossrefClient(http, cache),
    europepmc: new EuropePmcClient(http, cache),
    llm: llmClient ?? undefined,
  };
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

export function countTotals(
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

/**
 * Drop duplicate references from the merged bib + regex + llm pool. A bib
 * entry and its regex-fallback parse for the same line should only count once.
 * Identity priority: normalized DOI > normalized PMID > lowercased title >
 * first 200 chars of the raw text.
 */
function dedupeStructuredRefs(refs: StructuredReference[]): StructuredReference[] {
  const seen = new Set<string>();
  const out: StructuredReference[] = [];
  for (const ref of refs) {
    const key =
      (ref.doi ? `doi:${ref.doi.toLowerCase().trim()}` : "") ||
      (ref.pmid ? `pmid:${ref.pmid.trim()}` : "") ||
      (ref.title ? `title:${ref.title.toLowerCase().replace(/\s+/g, " ").trim()}` : "") ||
      `raw:${(ref.raw ?? "").slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(ref);
  }
  return out;
}

export function decideVerdict(totals: ReturnType<typeof countTotals>, warnings: string[] = []): ManuscriptVerdict {
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
