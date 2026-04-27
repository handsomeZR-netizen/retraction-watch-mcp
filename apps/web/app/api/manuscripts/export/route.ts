import { NextResponse } from "next/server";
import { requireUser } from "@/lib/auth/guard";
import { activeScope } from "@/lib/auth/scope";
import { listManuscriptsForScope } from "@/lib/db/manuscripts";
import { getResult } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const scope = activeScope(auth.user);
  const rows = listManuscriptsForScope(scope, { limit: 10_000 });
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(
        encoder.encode(
          JSON.stringify({
            type: "manifest",
            user: { id: auth.user.id, username: auth.user.username },
            count: rows.length,
            exported_at: new Date().toISOString(),
          }) + "\n",
        ),
      );
      for (const row of rows) {
        const result = await getResult(row.id);
        controller.enqueue(
          encoder.encode(
            JSON.stringify({
              type: "manuscript",
              id: row.id,
              file_name: row.file_name,
              uploaded_at: row.uploaded_at,
              status: row.status,
              verdict: row.verdict,
              result: result ?? null,
            }) + "\n",
          ),
        );
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="rw-screen-history-${auth.user.id}.ndjson"`,
    },
  });
}
