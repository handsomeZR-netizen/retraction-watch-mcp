import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import {
  findUserById,
  getUserLlmSettings,
  setUserLlmSettings,
  type UserLlmSettings,
} from "@/lib/db/users";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z
  .object({
    enabled: z.boolean().optional(),
    baseUrl: z.string().url().optional(),
    apiKey: z.string().optional(),
    model: z.string().optional(),
    enableHeaderParse: z.boolean().optional(),
    clear: z.boolean().optional(),
  })
  .strict();

function publicSettings(s: UserLlmSettings | null): UserLlmSettings & { hasApiKey: boolean } {
  return {
    enabled: s?.enabled ?? false,
    baseUrl: s?.baseUrl ?? "",
    apiKey: s?.apiKey ? "***" : "",
    model: s?.model ?? "",
    enableHeaderParse: s?.enableHeaderParse ?? false,
    hasApiKey: Boolean(s?.apiKey),
  };
}

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const user = findUserById(auth.user.id);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(publicSettings(getUserLlmSettings(user)));
}

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = Schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "验证失败", issues: parsed.error.issues }, { status: 400 });
  }
  if (parsed.data.clear) {
    setUserLlmSettings(auth.user.id, null);
    writeAudit({
      userId: auth.user.id,
      action: "change_settings",
      detail: { kind: "llm.clear" },
      ip: getRequestIp(req.headers),
      userAgent: req.headers.get("user-agent"),
    });
    return NextResponse.json(publicSettings(null));
  }
  const user = findUserById(auth.user.id);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });
  const existing = getUserLlmSettings(user) ?? {};
  const merged: UserLlmSettings = {
    enabled: parsed.data.enabled ?? existing.enabled ?? false,
    baseUrl: parsed.data.baseUrl ?? existing.baseUrl ?? "",
    model: parsed.data.model ?? existing.model ?? "",
    enableHeaderParse:
      parsed.data.enableHeaderParse ?? existing.enableHeaderParse ?? false,
    apiKey: typeof parsed.data.apiKey === "string" && parsed.data.apiKey.length > 0
      ? parsed.data.apiKey
      : existing.apiKey,
  };
  setUserLlmSettings(auth.user.id, merged);
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "llm" },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json(publicSettings(merged));
}
