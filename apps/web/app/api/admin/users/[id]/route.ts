import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import { getAppDb } from "@/lib/db/app-db";
import {
  countActiveAdmins,
  findUserById,
  forceLogoutUserForAdmin,
  setUserDisabled,
  setUserRoleForAdmin,
} from "@/lib/db/users";
import { getRequestIp } from "@/lib/auth/validate";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PatchSchema = z.union([
  z.object({ disabled: z.boolean() }).strict(),
  z.object({ role: z.enum(["user", "admin"]) }).strict(),
  z.object({ forceLogout: z.literal(true) }).strict(),
]);

function assertSameOrigin(req: Request): NextResponse | null {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const origin = req.headers.get("origin");
  if (origin && origin !== new URL(req.url).origin) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return null;
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const csrfResponse = assertSameOrigin(req);
  if (csrfResponse) return csrfResponse;
  const { id } = await params;
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
  const operation = parsed.data;

  if ("disabled" in operation) {
    const disabled = operation.disabled;
    if (id === auth.user.id) {
      return NextResponse.json({ error: "不能禁用自己的账户" }, { status: 400 });
    }
    if (target.disabled === (disabled ? 1 : 0)) {
      return NextResponse.json({ ok: true });
    }
    try {
      getAppDb().transaction(() => {
        setUserDisabled(target.id, disabled);
        writeAudit({
          userId: auth.user.id,
          action: "admin_disable_user",
          detail: {
            kind: "admin.disable",
            targetUserId: target.id,
            disabled,
            sensitive: {
              targetUsername: target.username,
              targetDisplayName: target.display_name,
            },
          },
          ip: getRequestIp(req.headers),
          userAgent: req.headers.get("user-agent"),
        });
      })();
    } catch {
      return NextResponse.json({ error: "审计日志写入失败" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if ("role" in operation) {
    const role = operation.role;
    if (
      target.id === auth.user.id &&
      target.role === "admin" &&
      role === "user" &&
      countActiveAdmins() <= 1
    ) {
      return NextResponse.json({ error: "不能移除最后一个管理员" }, { status: 400 });
    }
    if (target.role === role) {
      return NextResponse.json({ ok: true });
    }
    try {
      getAppDb().transaction(() => {
        setUserRoleForAdmin(target.id, role);
        writeAudit({
          userId: auth.user.id,
          action: "admin_role_change",
          detail: {
            kind: "admin.role",
            targetUserId: target.id,
            previousRole: target.role,
            nextRole: role,
            sensitive: {
              targetUsername: target.username,
              targetDisplayName: target.display_name,
            },
          },
          ip: getRequestIp(req.headers),
          userAgent: req.headers.get("user-agent"),
        });
      })();
    } catch {
      return NextResponse.json({ error: "审计日志写入失败" }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (target.id === auth.user.id) {
    return NextResponse.json({ error: "不能强制注销自己的会话" }, { status: 400 });
  }
  try {
    getAppDb().transaction(() => {
      forceLogoutUserForAdmin(target.id);
      writeAudit({
        userId: auth.user.id,
        action: "admin_force_logout",
        detail: {
          kind: "admin.force_logout",
          targetUserId: target.id,
          forced: true,
          sensitive: {
            targetUsername: target.username,
            targetDisplayName: target.display_name,
          },
        },
        ip: getRequestIp(req.headers),
        userAgent: req.headers.get("user-agent"),
      });
    })();
  } catch {
    return NextResponse.json({ error: "审计日志写入失败" }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
