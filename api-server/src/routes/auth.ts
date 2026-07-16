import { Router } from "express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { LoginBody } from "@workspace/api-zod";
import { requireAuth, requireBossOrMis, SESSION_COOKIE, type AuthUser } from "../middlewares/auth";
import { getAuthEpoch, bumpAuthEpoch } from "../lib/authEpoch";
import { createMobileToken } from "../lib/mobileToken";

const router = Router();

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

const COOKIE_OPTS = {
  httpOnly: true,
  signed: true,
  sameSite: "lax",
  maxAge: THIRTY_DAYS_MS,
  path: "/",
} as const;

async function userPayload(user: AuthUser) {
  const managers = await db.select({ id: usersTable.id, name: usersTable.name }).from(usersTable);
  const managerMap = new Map(managers.map((m) => [m.id, m.name]));
  const { password: _password, createdAt, ...rest } = user;
  return {
    ...rest,
    createdAt: createdAt.toISOString(),
    reportsToName: user.reportsTo ? (managerMap.get(user.reportsTo) ?? null) : null,
  };
}

router.post("/login", async (req, res) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid input" });
  const { username, password } = parsed.data;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.username, username));
  if (!user || user.password !== password) {
    return res.status(401).json({ error: "Invalid credentials" });
  }
  // Issue a signed, httpOnly session cookie carrying `<userId>.<authEpoch>`.
  // Signed with SESSION_SECRET so it can't be forged. The epoch lets an admin
  // invalidate every outstanding session at once (see /force-relogin).
  const epoch = await getAuthEpoch();
  res.cookie(SESSION_COOKIE, `${user.id}.${epoch}`, COOKIE_OPTS);
  // Also return a signed bearer token so mobile (Expo) clients — which have no
  // persistent cookie jar — can authenticate via the Authorization header. The
  // web app ignores this field and keeps using the cookie.
  const token = createMobileToken(user.id, epoch);
  return res.json({ ...(await userPayload(user)), token });
});

// Returns the currently authenticated user (used by the client to bootstrap
// its session instead of trusting localStorage).
router.get("/me", requireAuth, async (req, res) => {
  return res.json(await userPayload(req.user!));
});

router.post("/logout", (_req, res) => {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  return res.json({ success: true });
});

// Admin-only: invalidate every outstanding session by bumping the global auth
// epoch. All existing cookies become stale (their epoch no longer matches), so
// everyone is forced to log in again — used after a republish so all users land
// on the fresh version. The caller's own cookie is re-issued with the new epoch
// so the admin who pressed the button stays logged in.
router.post("/force-relogin", requireAuth, requireBossOrMis, async (req, res) => {
  const next = await bumpAuthEpoch();
  res.cookie(SESSION_COOKIE, `${req.user!.id}.${next}`, COOKIE_OPTS);
  return res.json({ success: true });
});

export default router;
