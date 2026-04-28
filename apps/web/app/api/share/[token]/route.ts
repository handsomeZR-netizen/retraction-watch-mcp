import { NextResponse } from "next/server";
import type { ManuscriptScreenResult } from "@rw/core";
import { resolveActiveShare } from "@/lib/db/manuscript-shares";
import { getManuscript } from "@/lib/db/manuscripts";
import { getResult } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const share = resolveActiveShare(token);
  if (!share) {
    return NextResponse.json({ error: "share link invalid or expired" }, { status: 404 });
  }
  const row = getManuscript(share.manuscript_id);
  if (!row || row.status !== "done") {
    return NextResponse.json({ error: "manuscript not available" }, { status: 404 });
  }
  const result = await getResult(row.id);
  if (!result) {
    return NextResponse.json({ error: "result not available" }, { status: 404 });
  }
  // Strip internal fields before returning. Full RW record bodies, evidence
  // arrays, near-misses, candidate lists, source snapshot, network call
  // counters, abstract, author email/orcid, and the raw manuscriptId are all
  // omitted. The share viewer only needs the public summary that the page
  // actually renders.
  return NextResponse.json({
    fileName: row.file_name,
    fileType: row.file_type,
    bytes: row.bytes,
    expiresAt: share.expires_at,
    result: toShareDto(result),
  });
}

function toShareDto(result: ManuscriptScreenResult) {
  // Build the DTO so sensitive keys (email, orcid, evidence, candidates,
  // nearMisses, abstract, network, sourceVersion, manuscriptId) are ABSENT
  // — not present-but-null/empty. Even an empty array of `evidence` leaks
  // the shape of the internal model.
  return {
    fileName: result.fileName,
    fileType: result.fileType,
    verdict: result.verdict,
    totals: result.totals,
    generatedAt: result.generatedAt,
    policyVersion: result.policyVersion,
    consequentialUseWarning: result.consequentialUseWarning,
    metadata: {
      title: result.metadata.title,
      authors: result.metadata.authors.map((a) => {
        const out: { name: string; affiliation?: string } = { name: a.name };
        if (a.affiliation) out.affiliation = a.affiliation;
        return out;
      }),
      doi: result.metadata.doi,
    },
    screenedReferences: result.screenedReferences.map((r) => ({
      reference: { ...r.reference },
      result: {
        verdict: r.result.verdict,
        score: r.result.score,
        reviewRequired: r.result.reviewRequired,
        matchedFields: r.result.matchedFields,
        bestCandidate: r.result.bestCandidate
          ? { record: publicRecord(r.result.bestCandidate.record) }
          : null,
        input: r.result.input,
        policyVersion: r.result.policyVersion,
      },
    })),
    screenedAuthors: result.screenedAuthors.map((a) => {
      const author: { name: string; affiliation?: string } = { name: a.author.name };
      if (a.author.affiliation) author.affiliation = a.author.affiliation;
      const out: {
        author: typeof author;
        verdict: typeof a.verdict;
        score: number;
        matchedFields: string[];
        matchedRecord?: ReturnType<typeof publicRecord>;
      } = {
        author,
        verdict: a.verdict,
        score: a.score,
        matchedFields: a.matchedFields,
      };
      if (a.matchedRecord) out.matchedRecord = publicRecord(a.matchedRecord);
      return out;
    }),
  };
}

function publicRecord(rec: import("@rw/core").RwRecord) {
  // Public shares only need enough to render the badge expansion: title,
  // journal, retraction reason/date, and authors. We expose the recordId so
  // the receiver can cross-check on retractionwatch.com if they want.
  return {
    recordId: rec.recordId,
    title: rec.title,
    journal: rec.journal,
    author: rec.author,
    retractionDate: rec.retractionDate,
    originalPaperDate: rec.originalPaperDate,
    retractionNature: rec.retractionNature,
    reason: rec.reason,
    originalPaperDoi: rec.originalPaperDoi,
    retractionDoi: rec.retractionDoi,
  };
}
