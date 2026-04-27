import { NextResponse } from "next/server";
import { getCurrentUser, type CurrentUser } from "./session";

export async function requireUser(): Promise<
  { user: CurrentUser } | { response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  return { user };
}

export async function requireAdmin(): Promise<
  { user: CurrentUser } | { response: NextResponse }
> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      response: NextResponse.json({ error: "unauthorized" }, { status: 401 }),
    };
  }
  if (user.role !== "admin") {
    return {
      response: NextResponse.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  return { user };
}
