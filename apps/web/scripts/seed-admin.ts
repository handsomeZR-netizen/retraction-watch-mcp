/**
 * One-shot CLI to seed (or re-seed) an admin user.
 *
 * Usage:
 *   ADMIN_USERNAME=alice ADMIN_PASSWORD='pa55w0rd' npm run seed-admin -w @rw/web
 *
 * - If a user with the given username already exists, the password is
 *   updated and the role is forced to "admin".
 * - The plaintext password never touches disk; it is bcrypt-hashed
 *   before insert/update.
 * - The DB lives at ~/.config/rw-screen/app.sqlite (or
 *   $RW_APP_DB_DIR/app.sqlite if that env var is set).
 */

import { nanoid } from "nanoid";
import bcrypt from "bcryptjs";
import { getAppDb } from "../lib/db/app-db";
import { findUserByUsername } from "../lib/db/users";

const username = process.env.ADMIN_USERNAME?.trim();
const password = process.env.ADMIN_PASSWORD;

if (!username) {
  console.error("ADMIN_USERNAME env var is required");
  process.exit(1);
}
if (!password || password.length < 8) {
  console.error("ADMIN_PASSWORD env var is required and must be >= 8 chars");
  process.exit(1);
}

const hash = await bcrypt.hash(password, 12);
const db = getAppDb();
const existing = findUserByUsername(username);
const now = new Date().toISOString();

if (existing) {
  db.prepare(
    `UPDATE users SET password_hash = ?, role = 'admin', disabled = 0,
       session_version = session_version + 1
     WHERE id = ?`,
  ).run(hash, existing.id);
  console.log(`Updated existing user "${username}" to admin and rotated password.`);
} else {
  db.prepare(
    `INSERT INTO users (id, username, password_hash, display_name, role, created_at)
     VALUES (?, ?, ?, ?, 'admin', ?)`,
  ).run(nanoid(), username, hash, null, now);
  console.log(`Created admin user "${username}".`);
}

console.log("Done.");
process.exit(0);
