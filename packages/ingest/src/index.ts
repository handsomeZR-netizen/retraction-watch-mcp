export { extractPdf } from "./pdf.js";
export { extractDocx } from "./docx.js";
export { extractLatex } from "./latex.js";
export { ocrFallback } from "./ocr.js";
export { extractHeaderMetadata } from "./metadata.js";
export { locateAndSplitReferences, regexStructure } from "./refs.js";
export {
  DeepseekLlmClient,
  type LlmConfig,
  type LlmCallStats,
} from "./llm-client.js";
export { screenManuscript, type ScreenManuscriptInput, type ScreenManuscriptOptions } from "./screen-manuscript.js";
export type {
  ExtractedDocument,
  ExtractedPage,
  ManuscriptAuthor,
  ManuscriptHeaderMeta,
  RawReference,
  StructuredReference,
  IngestProgressEvent,
  IngestProgressSink,
} from "./types.js";
