import fs from "node:fs";
import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { findUserById, type UserRow } from "@/lib/db/users";

export interface SessionData {
  userId?: string;
  role?: "user" | "admin";
  sessionVersion?: number;
}

const DEV_SECRET = "dev-only-rw-screen-session-secret-change-me-in-production-32bytes";

/**
 * Resolve the session secret from one of:
 *   1. RW_SESSION_SECRET (raw value)
 *   2. RW_SESSION_SECRET_FILE (path; read at startup; supports docker secrets)
 *   3. dev fallback (NODE_ENV !== production only)
 */
function resolveSessionSecret(): string {
  const raw = process.env.RW_SESSION_SECRET?.trim();
  if (raw) return raw;
  const file = process.env.RW_SESSION_SECRET_FILE?.trim();
  if (file) {
    try {
      const value = fs.readFileSync(file, "utf8").trim();
      if (value) return value;
    } catch (err) {
      throw new Error(`failed to read RW_SESSION_SECRET_FILE=${file}: ${err}`);
    }
  }
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "RW_SESSION_SECRET (or RW_SESSION_SECRET_FILE) must be set in production.",
    );
  }
  console.warn(
    "[auth] WARNING: RW_SESSION_SECRET is not set; using an insecure development-only session secret.",
  );
  return DEV_SECRET;
}

const SECRET = resolveSessionSecret();

const sessionOptions: SessionOptions = {
  cookieName: "rw_screen_session",
  password: SECRET,
  cookieOptions: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  const store = await cookies();
  return getIronSession<SessionData>(store, sessionOptions);
}

export interface CurrentUser {
  id: string;
  username: string;
  displayName: string | null;
  role: "user" | "admin";
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const session = await getSession();
  if (!session.userId) return null;
  const user = findUserById(session.userId);
  if (!user || user.disabled) return null;
  if (user.session_version !== session.sessionVersion) return null;
  return {
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
  };
}

export async function loginAs(user: UserRow): Promise<void> {
  const session = await getSession();
  session.userId = user.id;
  session.role = user.role;
  session.sessionVersion = user.session_version;
  await session.save();
}

export async function destroySession(): Promise<void> {
  const session = await getSession();
  session.destroy();
}
