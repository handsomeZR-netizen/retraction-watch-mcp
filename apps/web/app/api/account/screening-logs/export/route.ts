import { requireUser } from "@/lib/auth/guard";
import { iterateScreeningLogs } from "@/lib/db/screening-logs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const CSV_COLS = [
  "id",
  "created_at",
  "scope",
  "file_name",
  "file_type",
  "bytes",
  "title",
  "verdict",
  "refs_total",
  "refs_confirmed",
  "refs_likely",
  "refs_possible",
  "authors_confirmed",
  "authors_likely",
  "authors_possible",
] as const;

export async function GET(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  if (format !== "json" && format !== "csv" && format !== "ndjson") {
    return NextResponse.json({ error: "format must be json|csv|ndjson" }, { status: 400 });
  }
  const filters = { scopeUserId: auth.user.id };
  const filename = `my-screening-logs-${new Date().toISOString().slice(0, 10)}.${format}`;

  if (format === "json") {
    const all = Array.from(iterateScreeningLogs(filters));
    return new Response(JSON.stringify(all, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      try {
        if (format === "csv") {
          controller.enqueue(encoder.encode(CSV_COLS.join(",") + "\n"));
          for (const row of iterateScreeningLogs(filters)) {
            const r = row as unknown as Record<string, unknown>;
            controller.enqueue(
              encoder.encode(CSV_COLS.map((c) => csvEscape(r[c])).join(",") + "\n"),
            );
          }
        } else {
          for (const row of iterateScreeningLogs(filters)) {
            controller.enqueue(encoder.encode(JSON.stringify(row) + "\n"));
          }
        }
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type":
        format === "csv" ? "text/csv; charset=utf-8" : "application/x-ndjson",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
