import { describe, expect, it } from "vitest";
import {
  isPublicEmailDomain,
  normalizeDoi,
  normalizeEmailDomain,
  normalizeName,
  tokenOverlapScore,
} from "./normalize.js";

describe("normalization", () => {
  it("normalizes DOI variants", () => {
    expect(normalizeDoi("https://doi.org/10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeDoi("doi: 10.1000/ABC")).toBe("10.1000/abc");
    expect(normalizeDoi("Unavailable")).toBe("");
  });

  it("builds conservative name signatures", () => {
    const name = normalizeName("Jóse M. Merigó");
    expect(name.normalized).toBe("jose m merigo");
    expect(name.surname).toBe("merigo");
    expect(name.initials).toBe("jmm");
    expect(name.signature).toBe("merigo:jmm");
  });

  it("treats public email domains as non-evidence", () => {
    expect(normalizeEmailDomain("User@Gmail.com")).toBe("gmail.com");
    expect(isPublicEmailDomain("gmail.com")).toBe(true);
    expect(isPublicEmailDomain("example.edu")).toBe(false);
  });

  it("scores token overlap against the smaller token set", () => {
    expect(tokenOverlapScore(new Set(["harvard", "medical"]), new Set(["harvard", "medical", "school"]))).toBe(1);
  });
});

