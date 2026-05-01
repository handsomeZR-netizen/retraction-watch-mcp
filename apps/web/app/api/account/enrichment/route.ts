import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth/guard";
import { writeAudit } from "@/lib/db/audit";
import { getRequestIp } from "@/lib/auth/validate";
import {
  findUserById,
  getUserEnrichmentContactEmail,
  setUserEnrichmentContactEmail,
} from "@/lib/db/users";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Per-user external-enrichment contact email. Used as the polite-pool
// `mailto:` for Crossref / OpenAlex / Europe PMC requests fired during this
// user's manuscript parses. There is intentionally no global fallback —
// without a per-user email, external DOI lookup is skipped entirely.
const Schema = z
  .object({
    contactEmail: z
      .string()
      .max(200)
      .refine((v) => v === "" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), {
        message: "必须是有效邮箱地址或留空",
      })
      .optional(),
    clear: z.boolean().optional(),
  })
  .strict();

export async function GET() {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  const email = getUserEnrichmentContactEmail(auth.user.id);
  return NextResponse.json({ contactEmail: email ?? "", hasContactEmail: Boolean(email) });
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
  const user = findUserById(auth.user.id);
  if (!user) return NextResponse.json({ error: "not found" }, { status: 404 });

  if (parsed.data.clear) {
    setUserEnrichmentContactEmail(auth.user.id, null);
  } else if (typeof parsed.data.contactEmail === "string") {
    setUserEnrichmentContactEmail(auth.user.id, parsed.data.contactEmail);
  } else {
    return NextResponse.json(
      { error: "需要提供 contactEmail 或 clear=true" },
      { status: 400 },
    );
  }

  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: {
      kind: parsed.data.clear ? "enrichment.clear" : "enrichment.email",
    },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });

  const email = getUserEnrichmentContactEmail(auth.user.id);
  return NextResponse.json({ contactEmail: email ?? "", hasContactEmail: Boolean(email) });
}
