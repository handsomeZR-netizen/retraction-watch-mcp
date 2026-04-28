import { describe, expect, it, vi } from "vitest";

const unpdf = vi.hoisted(() => {
  const pdf = {
    destroy: vi.fn(async () => {}),
  };
  return {
    pdf,
    getDocumentProxy: vi.fn(async () => pdf),
    extractText: vi.fn(async () => ({
      totalPages: 1,
      text: ["Title\n\nReferences\n[1] Smith J. Sample title. 2020."],
    })),
    getMeta: vi.fn(async () => ({ info: { Title: "Title" }, metadata: {} })),
  };
});

vi.mock("unpdf", () => ({
  getDocumentProxy: unpdf.getDocumentProxy,
  extractText: unpdf.extractText,
  getMeta: unpdf.getMeta,
}));

import { extractPdf } from "./pdf.js";

describe("extractPdf resource cleanup", () => {
  it("reuses one PDF document and destroys it after extraction", async () => {
    const result = await extractPdf(Buffer.from("%PDF-1.7\n%%EOF"));

    expect(result.fullText).toContain("References");
    expect(result.metadata).toEqual({ Title: "Title" });
    expect(unpdf.getDocumentProxy).toHaveBeenCalledTimes(1);
    expect(unpdf.extractText).toHaveBeenCalledWith(unpdf.pdf, { mergePages: false });
    expect(unpdf.getMeta).toHaveBeenCalledWith(unpdf.pdf);
    expect(unpdf.pdf.destroy).toHaveBeenCalledTimes(1);
  });
});
