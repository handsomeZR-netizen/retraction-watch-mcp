import { describe, expect, it } from "vitest";
import { stripPreambleSentinels } from "./preamble.js";

describe("stripPreambleSentinels", () => {
  it("returns input unchanged when no preamble header is found", () => {
    const lines = [
      "A Useful Title for the Paper",
      "Alice Doe, Bob Smith",
      "University of Example",
    ];
    const result = stripPreambleSentinels(lines);
    expect(result.stripped).toBe(false);
    expect(result.lines).toBe(lines);
  });

  it("strips Elsevier Highlights block including bullets and resumes at the second title", () => {
    const lines = [
      "Highlights",
      "Learnable Graph ODE Networks for Anomaly Detection",
      "Miao Xu, Lizeng Zhang, Peiyu Hou",
      "• We combine dynamic time warping (DTW) with adaptive latent graphs",
      "throttling-rotational-velocity chain between vehicular network messages",
      "and address the limitations of previous work in modeling.",
      "• We express spatiotemporal dynamics as a graphical ODE",
      "Learnable Graph ODE Networks for Anomaly Detection in CAN-FD",
      "Vehicle Networks",
      "Miao Xua, Lizeng Zhangb and Peiyu Houc",
      "aSchool of Civil Engineering, Beihua University",
    ];
    const result = stripPreambleSentinels(lines);
    expect(result.stripped).toBe(true);
    expect(result.lines[0]).toMatch(/Learnable Graph ODE Networks/);
    expect(result.lines).toContain("Miao Xua, Lizeng Zhangb and Peiyu Houc");
    // Bullets must be gone
    expect(result.lines.every((l) => !l.startsWith("•"))).toBe(true);
  });

  it("strips a Graphical Abstract block", () => {
    const lines = [
      "Graphical Abstract",
      "Some Paper Title",
      "Picture caption goes here for several lines.",
      "and continues with lowercase",
      "Real Article Title Here",
      "Author One, Author Two",
    ];
    const result = stripPreambleSentinels(lines);
    expect(result.stripped).toBe(true);
    // Either lands on the second title or at least past the header
    expect(result.lines.some((l) => l === "Real Article Title Here")).toBe(true);
  });

  it("falls back gracefully when nothing follows the preamble header", () => {
    const lines = ["Highlights"];
    const result = stripPreambleSentinels(lines);
    expect(result.stripped).toBe(false);
  });
});
