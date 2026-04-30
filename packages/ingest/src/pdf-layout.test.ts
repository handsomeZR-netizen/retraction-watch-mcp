import { describe, expect, it } from "vitest";
import { _internal } from "./pdf-layout.js";

const { detectColumns, renderColumn } = _internal;

interface Item {
  str: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

function item(str: string, x: number, y: number): Item {
  return { str, x, y, width: 50, height: 12 };
}

describe("detectColumns", () => {
  it("returns single-column for sparse pages", () => {
    const items: Item[] = Array.from({ length: 20 }, (_, i) =>
      item(`line${i}`, 100, 700 - i * 20),
    );
    expect(detectColumns(items, 600).count).toBe(1);
  });

  it("detects two columns when items are bimodally distributed across the page", () => {
    // Left column at x=100, right column at x=400, page width 600.
    const items: Item[] = [];
    for (let i = 0; i < 40; i++) {
      items.push(item(`l${i}`, 100, 700 - i * 15));
      items.push(item(`r${i}`, 400, 700 - i * 15));
    }
    const result = detectColumns(items, 600);
    expect(result.count).toBe(2);
    expect(result.splitX).toBeGreaterThan(150);
    expect(result.splitX).toBeLessThan(400);
  });

  it("stays single-column when one side is sparse (< 25% of items)", () => {
    // Mostly left column, a few stragglers on the right (page numbers etc.)
    const items: Item[] = Array.from({ length: 60 }, (_, i) =>
      item(`l${i}`, 100, 700 - i * 12),
    );
    items.push(item("pg1", 500, 50));
    items.push(item("pg2", 500, 60));
    expect(detectColumns(items, 600).count).toBe(1);
  });
});

describe("renderColumn", () => {
  it("emits items top-to-bottom, left-to-right with line breaks on y-jumps", () => {
    const items: Item[] = [
      item("Hello", 100, 700),
      item("world", 150, 700),
      item("Second", 100, 680),
      item("line", 150, 680),
      item("Para 2", 100, 600), // big y-jump → paragraph break
    ];
    const out = renderColumn([...items]);
    expect(out).toMatch(/Hello\s+world/);
    expect(out).toMatch(/Second\s+line/);
    // Para 2 should be after a blank line.
    expect(out).toMatch(/line\n\nPara 2/);
  });

  it("does not duplicate spaces between same-line items that already include trailing spaces", () => {
    const items: Item[] = [
      item("Hello ", 100, 700),
      item("world", 150, 700),
    ];
    const out = renderColumn([...items]);
    expect(out).toBe("Hello world");
  });
});
