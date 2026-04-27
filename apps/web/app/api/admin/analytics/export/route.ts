import { requireAdmin } from "@/lib/auth/guard";
import { iterateScreeningLogs, type LogFilters } from "@/lib/db/screening-logs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function parseFilters(url: URL): LogFilters {
  const filters: LogFilters = {};
  const verdictRaw = url.searchParams.getAll("verdict");
  const verdictAllowed = new Set(["PASS", "REVIEW", "FAIL"]);
  const verdict = verdictRaw.filter((v) => verdictAllowed.has(v)) as Array<"PASS" | "REVIEW" | "FAIL">;
  if (verdict.length > 0) filters.verdict = verdict;
  const from = url.searchParams.get("from");
  if (from) filters.since = from;
  const to = url.searchParams.get("to");
  if (to) filters.until = to;
  const search = url.searchParams.get("search");
  if (search) filters.search = search;
  const userId = url.searchParams.get("userId");
  if (userId) filters.userId = userId;
  return filters;
}

const CSV_COLS = [
  "id",
  "created_at",
  "user_id",
  "workspace_id",
  "scope",
  "file_name",
  "file_type",
  "bytes",
  "sha256",
  "title",
  "verdict",
  "refs_total",
  "refs_confirmed",
  "refs_likely",
  "refs_possible",
  "authors_confirmed",
  "authors_likely",
  "authors_possible",
  "llm_calls",
  "policy_version",
] as const;

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export async function GET(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;

  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  const filters = parseFilters(url);

  if (format !== "json" && format !== "csv" && format !== "ndjson") {
    return NextResponse.json({ error: "format must be json|csv|ndjson" }, { status: 400 });
  }

  const filename = `screening-logs-${new Date().toISOString().slice(0, 10)}.${format}`;

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
            const line = CSV_COLS.map((c) => csvEscape(r[c])).join(",") + "\n";
            controller.enqueue(encoder.encode(line));
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
