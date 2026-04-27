import type { MatchCandidate, RwRecord, ScreenPersonResult } from "./data/types.js";

export function toPublicRecord(record: RwRecord): Omit<RwRecord, "rawJson"> & {
  authors: string[];
  institutions: string[];
  reasons: string[];
} {
  const { rawJson: _rawJson, ...publicRecord } = record;
  return {
    ...publicRecord,
    authors: splitList(record.author),
    institutions: splitList(record.institution),
    reasons: splitList(record.reason),
  };
}

export function toPublicCandidate(candidate: MatchCandidate) {
  return {
    ...candidate,
    record: toPublicRecord(candidate.record),
  };
}

export function toPublicScreenResult(result: ScreenPersonResult) {
  return {
    ...result,
    candidates: result.candidates.map(toPublicCandidate),
    nearMisses: result.nearMisses.map(toPublicCandidate),
  };
}

export function jsonText(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

function splitList(value: string): string[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}
