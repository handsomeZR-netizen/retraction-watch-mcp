import { cookies } from "next/headers";
import { getIronSession, type IronSession, type SessionOptions } from "iron-session";
import { findUserById, type UserRow } from "@/lib/db/users";

export interface SessionData {
  userId?: string;
  role?: "user" | "admin";
  sessionVersion?: number;
}

const SECRET =
  process.env.RW_SESSION_SECRET ??
  // dev fallback only — production must set the env var; this default is logged once below
  "dev-only-rw-screen-session-secret-change-me-in-production-32bytes";

if (
  process.env.NODE_ENV === "production" &&
  !process.env.RW_SESSION_SECRET
) {
  // Surface clearly at boot if running production without secret.
  // eslint-disable-next-line no-console
  console.warn(
    "[auth] RW_SESSION_SECRET is not set; falling back to insecure dev secret. Set a 32+ character random value in production.",
  );
}

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
