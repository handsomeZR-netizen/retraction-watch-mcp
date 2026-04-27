import { NextResponse } from "next/server";
import { z } from "zod";
import {
  BALANCED_POLICY,
  STRICT_POLICY,
  screenPerson,
  toPublicScreenResult,
} from "@rw/core";
import { requireUser } from "@/lib/auth/guard";
import { getRepository } from "@/lib/repository";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const Schema = z.object({
  name: z.string().min(1),
  email: z.string().optional(),
  institution: z.string().optional(),
  doi: z.string().optional(),
  pmid: z.string().optional(),
  include_notice_types: z.array(z.string()).optional(),
  limit: z.number().int().min(1).max(50).optional(),
  strict_mode: z.boolean().optional(),
});

export async function POST(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;
  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = Schema.safeParse(payload);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const repo = await getRepository();
  const policy = parsed.data.strict_mode ? STRICT_POLICY : BALANCED_POLICY;
  const result = await screenPerson(repo, parsed.data, policy);
  return NextResponse.json(toPublicScreenResult(result));
}
