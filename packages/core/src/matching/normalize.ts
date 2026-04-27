import { pinyin } from "pinyin-pro";

const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "qq.com",
  "163.com",
  "126.com",
  "sina.com",
]);

const INSTITUTION_STOP_WORDS = new Set([
  "the",
  "of",
  "and",
  "for",
  "department",
  "dept",
  "school",
  "college",
  "faculty",
  "institute",
  "center",
  "centre",
  "laboratory",
  "lab",
  "university",
  "hospital",
  "medical",
  "research",
  "science",
  "sciences",
]);

const TITLE_STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "of",
  "in",
  "on",
  "for",
  "and",
  "or",
  "to",
  "at",
  "by",
  "with",
  "from",
  "as",
  "is",
  "are",
  "be",
  "this",
  "that",
  "these",
  "those",
  "via",
  "using",
  "based",
]);

const CHINESE_CHAR_RE = /[一-鿿]/;
const CHINESE_CHAR_GLOBAL_RE = /[一-鿿]/g;

export const DOI_REGEX = /\b10\.\d{4,9}\/[^\s)\]>"<]+/i;
export const YEAR_REGEX = /(?:19|20)\d{2}/;
export const PMID_REGEX = /(?:pmid[:\s]*|pubmed[:\s]+)(\d{5,9})/i;
export const EMAIL_REGEX = /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,24}/g;
export const ORCID_REGEX = /\b(?:https?:\/\/orcid\.org\/)?(\d{4}-\d{4}-\d{4}-\d{3}[\dX])\b/g;

export function extractDoi(text: string): string | null {
  if (!text) return null;
  const m = text.match(DOI_REGEX);
  if (!m) return null;
  return m[0].replace(/[.,;\)]+$/, "").toLowerCase();
}

export function extractYear(text: string): number | null {
  if (!text) return null;
  const m = text.match(YEAR_REGEX);
  return m ? Number(m[0]) : null;
}

export function extractPmid(text: string): string | null {
  if (!text) return null;
  const m = text.match(PMID_REGEX);
  return m ? m[1] : null;
}

export type FileType = "pdf" | "docx" | "latex" | "unknown";
export type ManuscriptVerdict = "PASS" | "REVIEW" | "FAIL";
export type IngestStage =
  | "uploaded"
  | "text_extracted"
  | "metadata_extracted"
  | "refs_segmented"
  | "refs_structured"
  | "screening"
  | "done"
  | "error";

const FILE_TYPE_BY_EXT: Record<string, FileType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".tex": "latex",
  ".zip": "latex",
};

export function inferFileType(fileName: string): FileType {
  const dot = fileName.lastIndexOf(".");
  if (dot < 0) return "unknown";
  return FILE_TYPE_BY_EXT[fileName.slice(dot).toLowerCase()] ?? "unknown";
}

export interface NormalizedName {
  original: string;
  normalized: string;
  tokens: string[];
  surname: string;
  initials: string;
  signature: string;
  variants: string[];
  isChinese: boolean;
  pinyin: string | null;
}

export function isLikelyChinese(value: string): boolean {
  return CHINESE_CHAR_RE.test(value);
}

export function toPinyin(value: string): string {
  if (!isLikelyChinese(value)) {
    return "";
  }
  try {
    const result = pinyin(value, {
      toneType: "none",
      type: "string",
      nonZh: "consecutive",
      v: true,
    });
    return typeof result === "string" ? result.toLowerCase() : "";
  } catch {
    return "";
  }
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[‘’]/g, "'")
    .replace(/[‐-―]/g, "-")
    .replace(/[　-〿＀-￯]/g, " ")
    .toLowerCase()
    .replace(/[^a-z0-9一-鿿]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function splitSemicolonList(value: string): string[] {
  return value
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function normalizeDoi(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || /^unavailable$/i.test(raw)) {
    return "";
  }
  return raw
    .replace(/^https?:\/\/(dx\.)?doi\.org\//i, "")
    .replace(/^doi:\s*/i, "")
    .trim()
    .toLowerCase();
}

export function normalizePmid(value: string | undefined): string {
  const raw = (value ?? "").trim();
  if (!raw || raw === "0") {
    return "";
  }
  return raw.replace(/\D+/g, "");
}

export function normalizeEmailDomain(email: string | undefined): string {
  const raw = (email ?? "").trim().toLowerCase();
  if (!raw) {
    return "";
  }
  const atIndex = raw.lastIndexOf("@");
  const domain = (atIndex >= 0 ? raw.slice(atIndex + 1) : raw)
    .replace(/^www\./, "")
    .replace(/[^a-z0-9.-]/g, "");
  return domain.includes(".") ? domain : "";
}

export function isPublicEmailDomain(domain: string): boolean {
  return PUBLIC_EMAIL_DOMAINS.has(domain);
}

export function normalizeName(name: string): NormalizedName {
  const original = name;
  const isChinese = isLikelyChinese(name);
  const pinyinForm = isChinese ? toPinyin(name) : null;
  const basis = isChinese && pinyinForm ? pinyinForm : name;
  return buildName(original, basis, isChinese, pinyinForm);
}

export function normalizeNameWithPinyin(name: string): NormalizedName {
  return normalizeName(name);
}

function buildName(
  original: string,
  basis: string,
  isChinese: boolean,
  pinyinForm: string | null,
): NormalizedName {
  const normalized = normalizeText(basis);
  const tokens = normalized.split(" ").filter(Boolean);
  const surname = tokens.at(-1) ?? "";
  const initials = tokens.map((token) => token[0] ?? "").join("");
  const signature = [surname, initials].filter(Boolean).join(":");
  const reversed = tokens.length > 1 ? [...tokens].reverse().join(" ") : normalized;
  const compactInitial =
    tokens.length > 1 && tokens[0] ? `${tokens[0][0] ?? ""} ${surname}` : normalized;

  const variants = new Set<string>();
  if (normalized) variants.add(normalized);
  if (reversed) variants.add(reversed);
  if (compactInitial) variants.add(compactInitial);

  if (isChinese && tokens.length > 1) {
    const reversedTokens = [...tokens].reverse();
    variants.add(reversedTokens.join(" "));
    if (reversedTokens.length > 1) {
      const surnameFirstInitials = `${reversedTokens[0]} ${reversedTokens
        .slice(1)
        .map((t) => t[0] ?? "")
        .join("")}`;
      variants.add(surnameFirstInitials);
    }
  }

  return {
    original,
    normalized,
    tokens,
    surname,
    initials,
    signature,
    variants: [...variants].filter(Boolean),
    isChinese,
    pinyin: pinyinForm,
  };
}

export function normalizeInstitution(value: string): string {
  return normalizeText(value);
}

export function significantInstitutionTokens(value: string): Set<string> {
  return new Set(
    normalizeInstitution(value)
      .split(" ")
      .filter((token) => token.length > 2 && !INSTITUTION_STOP_WORDS.has(token)),
  );
}

export function tokenOverlapScore(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  return intersection / Math.min(left.size, right.size);
}

export function jaccardSimilarity(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 && right.size === 0) {
    return 0;
  }
  let intersection = 0;
  for (const token of left) {
    if (right.has(token)) {
      intersection += 1;
    }
  }
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function domainTokens(domain: string): Set<string> {
  const root = domain.split(".").slice(0, -1).join(".");
  return new Set(
    normalizeText(root)
      .split(" ")
      .flatMap((token) => token.split(/[-.]/))
      .filter((token) => token.length > 2),
  );
}

export function normalizeTitle(value: string): string {
  if (!value) return "";
  const stripped = value
    .replace(/^[\s"'“”‘’]+/, "")
    .replace(/[\s"'“”‘’\.\?,;:!]+$/, "");
  if (isLikelyChinese(stripped)) {
    const chineseOnly = stripped.replace(CHINESE_CHAR_GLOBAL_RE, "$&");
    return normalizeText(chineseOnly);
  }
  return normalizeText(stripped);
}

export function titleTokens(value: string): Set<string> {
  const normalized = normalizeTitle(value);
  if (!normalized) return new Set();
  const tokens = new Set<string>();
  for (const part of normalized.split(" ")) {
    if (!part) continue;
    if (CHINESE_CHAR_RE.test(part)) {
      if (part.length === 1) {
        tokens.add(part);
      } else {
        for (let i = 0; i < part.length - 1; i += 1) {
          const bigram = part.slice(i, i + 2);
          if (bigram.length === 2) tokens.add(bigram);
        }
      }
    } else if (part.length > 2 && !TITLE_STOP_WORDS.has(part)) {
      tokens.add(part);
    } else if (/^\d{4}$/.test(part)) {
      tokens.add(part);
    }
  }
  return tokens;
}
