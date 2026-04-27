import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import { findUserById, setUserDisabled } from "@/lib/db/users";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PatchSchema = z.object({ disabled: z.boolean() }).strict();

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const { id } = await params;
  if (id === auth.user.id) {
    return NextResponse.json({ error: "不能禁用自己的账户" }, { status: 400 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "字段不合法" }, { status: 400 });
  }
  const target = findUserById(id);
  if (!target) return NextResponse.json({ error: "用户不存在" }, { status: 404 });
  setUserDisabled(target.id, parsed.data.disabled);
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: { kind: "admin.disable", target: target.id, disabled: parsed.data.disabled },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json({ ok: true });
}
