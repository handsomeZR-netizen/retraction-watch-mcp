import { NextResponse } from "next/server";
import { z } from "zod";
import { loadConfig, publicConfig, saveConfig } from "@/lib/config";

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
});

export async function GET() {
  const config = await loadConfig();
  return NextResponse.json(publicConfig(config));
}

export async function POST(req: Request) {
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
  });
  return NextResponse.json(publicConfig(next));
}
