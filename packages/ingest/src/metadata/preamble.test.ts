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

  it("does not treat a later Graphical Abstract section as a leading preamble", () => {
    const lines = [
      "A brain stem circuit integrating reflexive and anticipatory",
      "salivation",
      "Gyujin Park1, Hojoon Lee1,2,3,*",
      "Northwestern University",
      "Graphical Abstract",
      "*Correspondence: hojoon.lee@northwestern.edu.",
    ];
    const result = stripPreambleSentinels(lines);
    expect(result.stripped).toBe(false);
    expect(result.lines[0]).toBe("A brain stem circuit integrating reflexive and anticipatory");
  });

  it("strips Elsevier COVID resource centre and ScienceDirect boilerplate", () => {
    const lines = [
      "Since January 2020 Elsevier has created a COVID-19 resource centre with",
      "free information in English and Mandarin on the novel coronavirus COVID-19.",
      "The COVID-19 resource centre is hosted on Elsevier Connect, the",
      "company's public news and information website.",
      "Elsevier hereby grants permission to make all its COVID-19-related",
      "research that is available on the COVID-19 resource centre - including",
      "this research content - immediately available in PubMed Central and other",
      "publicly funded repositories, such as the WHO COVID database with rights",
      "for unrestricted research re-use and analyses in any form or by any means",
      "with acknowledgement of the original source. These permissions are",
      "granted for free by Elsevier for as long as the COVID-19 resource centre",
      "remains active.",
      "ScienceDirect",
      "ScienceDirectAvailable online at www.sciencedirect.comProcedia Computer Science 220",
      "1877-0509 © 2023 The Authors. Published by Elsevier B.V.",
      "10.1016/j.procs.2023.03.074",
      "Available online at www.sciencedirect.com",
      "Procedia Computer Science 00 (2023) 000-000",
      "www.elsevier.com/locate/procedia",
      "The 6th International Conference on Smart Communities",
      "March 15-17, 2023, Leuven, Belgium",
      "A Distributed Data Mesh Paradigm for an Event-based Smart Communities",
      "Monitoring Product",
    ];
    const result = stripPreambleSentinels(lines);
    expect(result.stripped).toBe(true);
    expect(result.lines[0]).toBe("A Distributed Data Mesh Paradigm for an Event-based Smart Communities");
    expect(result.lines).not.toContain("Since January 2020 Elsevier has created a COVID-19 resource centre with");
  });

  it("falls back gracefully when nothing follows the preamble header", () => {
    const lines = ["Highlights"];
    const result = stripPreambleSentinels(lines);
    expect(result.stripped).toBe(false);
  });
});
