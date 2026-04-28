import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractHeaderMetadata } from "./metadata/index.js";
import { extractPdf } from "./pdf.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "__fixtures__/elsevier-samples");

async function parseFixture(name: string) {
  const buffer = fs.readFileSync(path.join(FIXTURE_DIR, name));
  const doc = await extractPdf(buffer);
  return extractHeaderMetadata({
    fullText: doc.fullText,
    pages: doc.pages,
    source: doc.source,
  });
}

describe("Elsevier preprint fixtures: end-to-end metadata extraction", () => {
  it("mental-health.pdf yields exactly 3 authors with non-noise names", async () => {
    const meta = await parseFixture("mental-health.pdf");
    expect(meta.title).toMatch(/Exploring the Relationship/);
    const names = meta.authors.map((a) => a.name);
    expect(names).toEqual(["Mira Chen", "Ethan Zhao", "Lena Park"]);
    // No bullet text or affiliation fragments leaked in
    expect(names.every((n) => !n.startsWith("•"))).toBe(true);
    expect(names.every((n) => !/Singapore|China\.?$|Department/.test(n))).toBe(true);
    // Each author has an affiliation
    for (const a of meta.authors) {
      expect(a.affiliation).toBeTruthy();
      expect(a.affiliation).toMatch(/University|School/);
    }
  });

  it("can-fd.pdf yields exactly 3 authors with footnote-mapped affiliations", async () => {
    const meta = await parseFixture("can-fd.pdf");
    expect(meta.title).toMatch(/Learnable Graph ODE/);
    const names = meta.authors.map((a) => a.name);
    expect(names).toEqual(["Miao Xu", "Lizeng Zhang", "Peiyu Hou"]);
    // Miao Xu's affiliation must be Beihua, NOT Haomo (footnote 'a' not 'b')
    expect(meta.authors[0].affiliation).toMatch(/Beihua University/);
    // No leaked title/keyword fragments
    expect(names.every((n) => !/Vehicle Networks|Anomaly Detection|Haomo|Ltd/.test(n))).toBe(true);
  });

  it("regression guard: no fixture parses to more than 5 authors", async () => {
    for (const name of ["mental-health.pdf", "can-fd.pdf"]) {
      const meta = await parseFixture(name);
      expect(meta.authors.length, name).toBeLessThanOrEqual(5);
      expect(meta.authors.length, name).toBeGreaterThanOrEqual(2);
    }
  });
});
