import { randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { consumeRateLimit, ensureDatabase, hashToken, writeAuditEvent } from "@/app/lib/database";
import { hashPassword, verifyPassword } from "@/app/lib/password";

export const SESSION_COOKIE = "tip_admin_session";
const SESSION_HOURS = 12;

export type AdminRole = "super_admin" | "admin";

export type AdminUser = {
  id: string;
  email: string;
  displayName: string;
  role: AdminRole;
  mustChangePassword: boolean;
  csrfToken: string;
};

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function generateTemporaryPassword() {
  return `${randomBytes(9).toString("base64url")}!${randomBytes(4).toString("hex")}`;
}

export async function createInitialSuperAdmin(
  email: string,
  displayName: string,
  password: string,
) {
  const db = await ensureDatabase();
  const existing = await db.execute(
    "SELECT COUNT(*) AS count FROM users WHERE role = 'super_admin'",
  );
  if (Number(existing.rows[0]?.count ?? 0) > 0) {
    throw new Error("A super-admin already exists");
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.execute({
    sql: `INSERT INTO users
      (id, email, display_name, role, password_hash, must_change_password,
       active, created_at, updated_at)
      VALUES (?, ?, ?, 'super_admin', ?, 0, 1, ?, ?)`,
    args: [id, normalizeEmail(email), displayName.trim(), await hashPassword(password), now, now],
  });
  await writeAuditEvent(id, "bootstrap", "user", id, { role: "super_admin" });
  return id;
}

export async function login(
  email: string,
  password: string,
  remoteIdentifier: string,
) {
  const allowed = await consumeRateLimit(
    "admin-login",
    `${remoteIdentifier}:${normalizeEmail(email)}`,
    5,
    15 * 60 * 1000,
  );
  if (!allowed) throw new Error("Too many sign-in attempts. Try again later.");

  const db = await ensureDatabase();
  const result = await db.execute({
    sql: `SELECT id, email, display_name, role, password_hash,
                 must_change_password, temporary_password_expires_at
          FROM users WHERE email = ? AND active = 1 LIMIT 1`,
    args: [normalizeEmail(email)],
  });
  const row = result.rows[0];
  const passwordMatches = await verifyPassword(
    password,
    row ? String(row.password_hash) : undefined,
  );
  if (!row || !passwordMatches) {
    throw new Error("Invalid email or password");
  }
  if (
    Number(row.must_change_password) === 1 &&
    row.temporary_password_expires_at &&
    Date.parse(String(row.temporary_password_expires_at)) < Date.now()
  ) {
    throw new Error("This temporary password has expired. Ask a super-admin to reset it.");
  }

  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  const sessionId = randomUUID();
  await db.batch(
    [
      {
        sql: `INSERT INTO sessions
          (id, user_id, token_hash, csrf_token, expires_at, created_at, last_seen_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
        args: [
          sessionId,
          String(row.id),
          hashToken(token),
          csrfToken,
          expires.toISOString(),
          now.toISOString(),
          now.toISOString(),
        ],
      },
      {
        sql: "UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?",
        args: [now.toISOString(), now.toISOString(), String(row.id)],
      },
    ],
    "write",
  );
  await writeAuditEvent(String(row.id), "login", "session", sessionId);
  return { token, expires };
}

export function setSessionCookie(
  response: NextResponse,
  token: string,
  expires: Date,
) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires,
  });
}

export async function getAdminSession(
  request: NextRequest,
): Promise<AdminUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await ensureDatabase();
  const result = await db.execute({
    sql: `SELECT u.id, u.email, u.display_name, u.role, u.must_change_password,
                 s.csrf_token, s.id AS session_id, s.expires_at
          FROM sessions s
          JOIN users u ON u.id = s.user_id
          WHERE s.token_hash = ? AND u.active = 1
          LIMIT 1`,
    args: [hashToken(token)],
  });
  const row = result.rows[0];
  if (!row) return null;
  if (Date.parse(String(row.expires_at)) <= Date.now()) {
    await db.execute({ sql: "DELETE FROM sessions WHERE id = ?", args: [String(row.session_id)] });
    return null;
  }
  await db.execute({
    sql: "UPDATE sessions SET last_seen_at = ? WHERE id = ?",
    args: [new Date().toISOString(), String(row.session_id)],
  });
  return {
    id: String(row.id),
    email: String(row.email),
    displayName: String(row.display_name),
    role: String(row.role) as AdminRole,
    mustChangePassword: Number(row.must_change_password) === 1,
    csrfToken: String(row.csrf_token),
  };
}

export function assertCsrf(request: NextRequest, user: AdminUser) {
  if (request.headers.get("x-tip-csrf") !== user.csrfToken) {
    throw new Error("Invalid request token. Refresh the admin panel and try again.");
  }
}

export async function logout(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const db = await ensureDatabase();
  await db.execute({ sql: "DELETE FROM sessions WHERE token_hash = ?", args: [hashToken(token)] });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
