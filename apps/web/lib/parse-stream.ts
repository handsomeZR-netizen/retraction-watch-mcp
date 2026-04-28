import { NextResponse } from "next/server";
import { canAccessManuscript } from "@/lib/auth/scope";
import type { CurrentUser } from "@/lib/auth/session";
import { getManuscript } from "@/lib/db/manuscripts";
import { hasParseState, subscribeParseProgress } from "@/lib/parse-runner";
import { createSseStream, sseHeaders } from "@/lib/sse";

export function parseStreamResponse(
  manuscriptId: string,
  user: CurrentUser,
): Response | NextResponse {
  const row = getManuscript(manuscriptId);
  if (!row || !canAccessManuscript(user, row)) {
    return NextResponse.json({ error: "manuscript not found" }, { status: 404 });
  }

  // Recovery case: DB says `parsing` but no runner state exists in this
  // process. Either the process restarted while a job was in-flight (the
  // startup hook flips it to error) OR the row was carried over from another
  // replica. Either way, hanging the SSE forever is the worst outcome — emit
  // a synthetic error frame and tell the client to retry via /api/parse/start.
  if (row.status === "parsing" && !hasParseState(manuscriptId)) {
    const { stream, sink } = createSseStream();
    sink.write({
      stage: "error",
      message: "parser was interrupted; please re-run from the dashboard",
      manuscriptId,
    });
    sink.close();
    return new Response(stream, { headers: sseHeaders() });
  }

  const { stream, sink } = createSseStream();
  let closed = false;
  let unsubscribe: (() => void) | null = null;
  const close = () => {
    if (closed) return;
    closed = true;
    unsubscribe?.();
    sink.close();
  };
  unsubscribe = subscribeParseProgress(manuscriptId, (event) => {
    sink.write(event);
    if (event.stage === "done" || event.stage === "error") {
      close();
    }
  });
  if (closed) unsubscribe();

  if (row.status === "done") {
    sink.write({ stage: "done", manuscriptId, message: "already done" });
    close();
  } else if (row.status === "error" && row.error) {
    sink.write({ stage: "error", message: row.error });
    close();
  }

  return new Response(stream, { headers: sseHeaders() });
}
