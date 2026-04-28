import { NextResponse } from "next/server";
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
  // Return only what the read-only share view needs. Notes / assignee / audit
  // detail are intentionally NOT exposed.
  return NextResponse.json({
    manuscriptId: row.id,
    fileName: row.file_name,
    fileType: row.file_type,
    bytes: row.bytes,
    expiresAt: share.expires_at,
    result,
  });
}
