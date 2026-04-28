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
      authors: result.metadata.authors.map((a) => ({
        name: a.name,
        // Public viewer should NOT see contact details / ORCID — those belong
        // to a logged-in workspace member.
        affiliation: a.affiliation,
        email: null,
        orcid: null,
      })),
      doi: result.metadata.doi,
      abstract: null,
    },
    screenedReferences: result.screenedReferences.map((r) => ({
      reference: {
        ...r.reference,
      },
      result: {
        verdict: r.result.verdict,
        score: r.result.score,
        reviewRequired: r.result.reviewRequired,
        matchedFields: r.result.matchedFields,
        // Strip evidence + candidates + nearMisses + policyVersion: those
        // are internal scoring artifacts.
        evidence: [],
        bestCandidate: r.result.bestCandidate
          ? { record: publicRecord(r.result.bestCandidate.record) }
          : null,
        candidates: [],
        nearMisses: [],
        input: r.result.input,
        policyVersion: r.result.policyVersion,
      },
    })),
    screenedAuthors: result.screenedAuthors.map((a) => ({
      author: {
        name: a.author.name,
        affiliation: a.author.affiliation,
        email: null,
        orcid: null,
      },
      verdict: a.verdict,
      score: a.score,
      matchedRecord: a.matchedRecord ? publicRecord(a.matchedRecord) : null,
      matchedFields: a.matchedFields,
      evidence: [],
    })),
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
