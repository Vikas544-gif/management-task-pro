import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { isBoss, isAllCentersViewer } from "../lib/scope";
import { getAuthEpoch } from "../lib/authEpoch";
import { verifyMobileToken } from "../lib/mobileToken";

export type AuthUser = typeof usersTable.$inferSelect;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

/** Name of the signed httpOnly cookie that carries the logged-in user id. */
export const SESSION_COOKIE = "iss_uid";

/**
 * Gate that rejects any request lacking a valid signed session cookie.
 * On success it loads the user row and attaches it to `req.user` so route
 * handlers can do server-side authorization/scoping. This is the single point
 * that turns the previously wide-open API into an authenticated one.
 */
/**
 * Resolve the session identity from the request. The web app authenticates via
 * the signed httpOnly cookie; mobile (Expo) clients have no persistent cookie
 * jar, so they send a signed bearer token in the Authorization header instead.
 * Cookie takes precedence when both are present. Returns `{ uid, epoch }` where
 * `epoch` is validated against the current global auth epoch by the caller.
 */
function resolveSession(req: Request): { uid: number; epoch: number } | null {
  // Cookie format is `<userId>.<authEpoch>`. Legacy cookies carrying only the id
  // (no epoch) parse to a NaN epoch and fall through.
  const raw = req.signedCookies?.[SESSION_COOKIE];
  if (raw) {
    const [uidStr, epochStr] = String(raw).split(".");
    const uid = parseInt(uidStr, 10);
    const epoch = parseInt(epochStr ?? "", 10);
    if (!Number.isNaN(uid) && !Number.isNaN(epoch)) return { uid, epoch };
  }
  // Bearer token (mobile). HMAC-signed, so it can't be forged.
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    const verified = verifyMobileToken(header.slice("Bearer ".length).trim());
    if (verified) return verified;
  }
  return null;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const session = resolveSession(req);
  if (!session) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const { uid, epoch } = session;
  // A mismatching epoch means an admin pressed "force everyone to re-login"
  // since this session was issued, so it is no longer valid.
  const currentEpoch = await getAuthEpoch();
  if (epoch !== currentEpoch) {
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, uid));
  if (!user) {
    res.clearCookie(SESSION_COOKIE);
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  req.user = user;
  next();
}

/**
 * Gate that only allows Boss/Management and all-centers viewers (MIS/Director)
 * through — the same role set the client uses for the Dashboard, Reports and
 * Email Settings pages. Mounted after `requireAuth`, so `req.user` is present.
 * This re-enforces those page restrictions server-side so they can't be
 * bypassed with a direct API call.
 */
export function requireBossOrMis(req: Request, res: Response, next: NextFunction): void {
  const u = req.user;
  if (!u || (!isBoss(u) && !isAllCentersViewer(u))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  next();
}
