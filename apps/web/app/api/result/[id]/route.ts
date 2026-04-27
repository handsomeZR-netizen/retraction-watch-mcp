import { NextResponse } from "next/server";
import { getResult } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const result = await getResult(id);
  if (!result) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(result);
}
