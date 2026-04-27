import { NextResponse } from "next/server";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const repo = await getRepository();
    const snapshot = repo.getSourceSnapshot();
    return NextResponse.json({
      ok: true,
      database: {
        rowCount: snapshot?.rowCount ?? 0,
        generatedOn: snapshot?.generatedOn ?? null,
        importedAt: snapshot?.importedAt ?? null,
        policyVersion: snapshot?.policyVersion ?? null,
      },
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 503 },
    );
  }
}
