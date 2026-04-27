import Papa from "papaparse";
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { getManuscript } from "@/lib/db/manuscripts";
import { getResult } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const row = getManuscript(id);
  if (!row || row.user_id !== auth.user.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const url = new URL(req.url);
  const format = (url.searchParams.get("format") ?? "json").toLowerCase();
  const result = await getResult(id);
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (format === "csv") {
    const rows = result.screenedReferences.map((s) => ({
      verdict: s.result.verdict,
      score: s.result.score,
      title: s.reference.title ?? "",
      authors: s.reference.authors.join("; "),
      year: s.reference.year ?? "",
      doi: s.reference.doi ?? "",
      journal: s.reference.journal ?? "",
      raw: s.reference.raw,
      retracted_record_id: s.result.bestCandidate?.record.recordId ?? "",
      retracted_title: s.result.bestCandidate?.record.title ?? "",
      retraction_reason: s.result.bestCandidate?.record.reason ?? "",
      retraction_date: s.result.bestCandidate?.record.retractionDate ?? "",
    }));
    const csv = Papa.unparse(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="rw-screen-${id}.csv"`,
      },
    });
  }

  return new Response(JSON.stringify(result, null, 2), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition":
        format === "download"
          ? `attachment; filename="rw-screen-${id}.json"`
          : "inline",
    },
  });
}
