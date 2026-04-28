import { describe, expect, it } from "vitest";
import {
  isPublicEmailDomain,
  jaccardSimilarity,
  normalizeDoi,
  normalizeEmailDomain,
  normalizeName,
  normalizeTitle,
  titleTokens,
  toPinyin,
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
    expect(name.isChinese).toBe(false);
  });

  it("treats public email domains as non-evidence", () => {
    expect(normalizeEmailDomain("User@Gmail.com")).toBe("gmail.com");
    expect(isPublicEmailDomain("gmail.com")).toBe(true);
    expect(isPublicEmailDomain("example.edu")).toBe(false);
  });

  it("scores token overlap against the smaller token set", () => {
    expect(tokenOverlapScore(new Set(["harvard", "medical"]), new Set(["harvard", "medical", "school"]))).toBe(1);
  });

  it("converts a Chinese name to pinyin form", () => {
    const py = toPinyin("张伟");
    expect(py).toMatch(/zhang\s*wei/);
  });

  it("normalizes Chinese names through pinyin so they share signature with English form", () => {
    const cn = normalizeName("张伟");
    const en = normalizeName("Wei Zhang");
    expect(cn.isChinese).toBe(true);
    expect(cn.pinyin).toBeTruthy();
    expect(cn.surname).toBeTruthy();
    expect(en.surname).toBe(cn.tokens.includes("zhang") ? "zhang" : en.surname);
  });

  it("uses surname-first order for Chinese names", () => {
    const cn = normalizeName("王伟");
    expect(cn.surname).toBe("wang");
    expect(cn.surname).not.toBe("wei");
  });

  it("strips trailing punctuation and ignores stop words in title tokens", () => {
    const tokens = titleTokens("The Use of Machine Learning for Health Outcomes.");
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("machine")).toBe(true);
    expect(tokens.has("learning")).toBe(true);
    expect(tokens.has("outcomes")).toBe(true);
  });

  it("uses bigrams for Chinese title tokens", () => {
    const tokens = titleTokens("机器学习用于健康预测");
    expect(tokens.size).toBeGreaterThan(0);
    const arr = [...tokens];
    expect(arr.every((token) => token.length === 2 || /[一-鿿]/.test(token))).toBe(true);
  });

  it("computes Jaccard similarity", () => {
    const a = new Set(["machine", "learning", "health"]);
    const b = new Set(["learning", "health", "outcomes"]);
    expect(jaccardSimilarity(a, b)).toBeCloseTo(2 / 4, 2);
  });

  it("normalizeTitle strips quotes and trailing periods", () => {
    expect(normalizeTitle('"A Study of Things."')).toBe("a study of things");
  });
});
