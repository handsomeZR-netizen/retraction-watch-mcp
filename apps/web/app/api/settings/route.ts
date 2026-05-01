import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/guard";
import { getRequestIp } from "@/lib/auth/validate";
import { loadConfig, publicConfig, saveConfig } from "@/lib/config";
import { writeAudit } from "@/lib/db/audit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SaveSchema = z.object({
  llm: z
    .object({
      enabled: z.boolean().optional(),
      baseUrl: z.string().url().optional(),
      apiKey: z.string().optional(),
      model: z.string().optional(),
      enableHeaderParse: z.boolean().optional(),
    })
    .optional(),
  ocr: z
    .object({
      cloudEnabled: z.boolean().optional(),
    })
    .optional(),
  retention: z
    .object({
      keepUploads: z.boolean().optional(),
      keepHours: z.number().int().min(1).max(24 * 30).optional(),
    })
    .optional(),
  enrichment: z
    .object({
      enabled: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  const config = await loadConfig();
  return NextResponse.json(publicConfig(config));
}

export async function POST(req: Request) {
  const auth = await requireAdmin();
  if ("response" in auth) return auth.response;
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = SaveSchema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const current = await loadConfig();
  const next = await saveConfig({
    llm: { ...current.llm, ...(parsed.data.llm ?? {}) },
    ocr: { ...current.ocr, ...(parsed.data.ocr ?? {}) },
    retention: { ...current.retention, ...(parsed.data.retention ?? {}) },
    enrichment: { ...current.enrichment, ...(parsed.data.enrichment ?? {}) },
  });
  writeAudit({
    userId: auth.user.id,
    action: "change_settings",
    detail: {
      kind: "settings.update",
      fields: Object.keys(parsed.data),
    },
    ip: getRequestIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  });
  return NextResponse.json(publicConfig(next));
}
