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

export interface NormalizedName {
  original: string;
  normalized: string;
  tokens: string[];
  surname: string;
  initials: string;
  signature: string;
  variants: string[];
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/[’‘]/g, "'")
    .replace(/[\u2010-\u2015]/g, "-")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
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
  const normalized = normalizeText(name);
  const tokens = normalized.split(" ").filter(Boolean);
  const surname = tokens.at(-1) ?? "";
  const initials = tokens.map((token) => token[0]).join("");
  const signature = [surname, initials].filter(Boolean).join(":");
  const reversed = tokens.length > 1 ? [...tokens].reverse().join(" ") : normalized;
  const compactInitial = tokens.length > 1 ? `${tokens[0][0]} ${surname}` : normalized;
  const variants = Array.from(new Set([normalized, reversed, compactInitial].filter(Boolean)));

  return {
    original: name,
    normalized,
    tokens,
    surname,
    initials,
    signature,
    variants,
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

export function domainTokens(domain: string): Set<string> {
  const root = domain.split(".").slice(0, -1).join(".");
  return new Set(
    normalizeText(root)
      .split(" ")
      .flatMap((token) => token.split(/[-.]/))
      .filter((token) => token.length > 2),
  );
}

