import fs from "node:fs/promises";
import path from "node:path";
import { POLICY_VERSION } from "./config.js";

export type PolicyMode = "balanced" | "strict" | "recall" | "custom";

export interface PolicyThresholds {
  likelyMatch: number;
  possibleMatch: number;
}

export interface PolicyWeights {
  doiExact: number;
  pmidExact: number;
  nameExact: number;
  nameVariant: number;
  surnameInitials: number;
  surnameFirstInitial: number;
  institutionHighOverlap: number;
  institutionPartialOverlap: number;
  emailDomainOverlap: number;
  institutionConflictPenalty: number;
}

export interface PolicySafety {
  confirmOnlyByHardIdentifier: boolean;
  requireAuxiliaryEvidenceForLikely: boolean;
  requireManualReviewForNonConfirmed: boolean;
  publicEmailDomainPositiveEvidence: boolean;
  hardIdentifiersOnly: boolean;
}

export interface ScreeningPolicy {
  policyVersion: string;
  mode: PolicyMode;
  thresholds: PolicyThresholds;
  weights: PolicyWeights;
  safety: PolicySafety;
}

export const CONSEQUENTIAL_USE_WARNING =
  "This result must not be used as the sole basis for hiring, admission, funding, discipline, or public accusation.";

export const BALANCED_POLICY: ScreeningPolicy = {
  policyVersion: POLICY_VERSION,
  mode: "balanced",
  thresholds: {
    likelyMatch: 0.7,
    possibleMatch: 0.35,
  },
  weights: {
    doiExact: 1,
    pmidExact: 1,
    nameExact: 0.48,
    nameVariant: 0.42,
    surnameInitials: 0.35,
    surnameFirstInitial: 0.25,
    institutionHighOverlap: 0.24,
    institutionPartialOverlap: 0.14,
    emailDomainOverlap: 0.1,
    institutionConflictPenalty: -0.2,
  },
  safety: {
    confirmOnlyByHardIdentifier: true,
    requireAuxiliaryEvidenceForLikely: true,
    requireManualReviewForNonConfirmed: true,
    publicEmailDomainPositiveEvidence: false,
    hardIdentifiersOnly: false,
  },
};

export const STRICT_POLICY: ScreeningPolicy = {
  ...BALANCED_POLICY,
  policyVersion: `${POLICY_VERSION}-strict`,
  mode: "strict",
  thresholds: {
    likelyMatch: 1.01,
    possibleMatch: 1.01,
  },
  safety: {
    ...BALANCED_POLICY.safety,
    hardIdentifiersOnly: true,
  },
};

export function clonePolicy(policy: ScreeningPolicy = BALANCED_POLICY): ScreeningPolicy {
  return {
    policyVersion: policy.policyVersion,
    mode: policy.mode,
    thresholds: { ...policy.thresholds },
    weights: { ...policy.weights },
    safety: { ...policy.safety },
  };
}

export async function loadPolicy(policyArg?: string, strictMode = false): Promise<ScreeningPolicy> {
  if (strictMode) {
    return clonePolicy(STRICT_POLICY);
  }

  if (!policyArg || policyArg === "balanced") {
    return clonePolicy(BALANCED_POLICY);
  }

  if (policyArg === "strict") {
    return clonePolicy(STRICT_POLICY);
  }

  const policyPath = path.resolve(policyArg);
  const raw = JSON.parse(await fs.readFile(policyPath, "utf8")) as Partial<ScreeningPolicy>;
  return normalizePolicy(raw, policyPath);
}

export function resolvePolicyForInput(input: { strict_mode?: boolean }, basePolicy: ScreeningPolicy): ScreeningPolicy {
  return input.strict_mode ? clonePolicy(STRICT_POLICY) : basePolicy;
}

export function policyMetadata(policy: ScreeningPolicy) {
  return {
    policyVersion: policy.policyVersion,
    mode: policy.mode,
    thresholds: policy.thresholds,
    weights: policy.weights,
    safety: policy.safety,
    confirmed: "Only DOI/PMID exact matches are identity-confirming evidence.",
    likely_match: "Requires name evidence plus independent auxiliary institution or domain evidence unless a custom policy changes thresholds.",
    strict: "Strict mode keeps non-DOI/PMID matches out of formal candidates and returns them only as nearMisses.",
    email: "Only email domain is used; public domains provide no positive evidence.",
  };
}

function normalizePolicy(raw: Partial<ScreeningPolicy>, sourcePath: string): ScreeningPolicy {
  const candidate: ScreeningPolicy = {
    policyVersion: readString(raw.policyVersion, `custom-${path.basename(sourcePath, path.extname(sourcePath))}`),
    mode: readMode(raw.mode, "custom"),
    thresholds: {
      ...BALANCED_POLICY.thresholds,
      ...(isRecord(raw.thresholds) ? raw.thresholds : {}),
    },
    weights: {
      ...BALANCED_POLICY.weights,
      ...(isRecord(raw.weights) ? raw.weights : {}),
    },
    safety: {
      ...BALANCED_POLICY.safety,
      ...(isRecord(raw.safety) ? raw.safety : {}),
    },
  };

  validateNumber(candidate.thresholds.likelyMatch, "thresholds.likelyMatch");
  validateNumber(candidate.thresholds.possibleMatch, "thresholds.possibleMatch");
  for (const [key, value] of Object.entries(candidate.weights)) {
    validateNumber(value, `weights.${key}`);
  }
  return candidate;
}

function validateNumber(value: number, field: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`Invalid policy value ${field}: expected a finite number.`);
  }
}

function readString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function readMode(value: unknown, fallback: PolicyMode): PolicyMode {
  return value === "balanced" || value === "strict" || value === "recall" || value === "custom"
    ? value
    : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
