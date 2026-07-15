import jwt from "jsonwebtoken";
import { serialize, parse } from "cookie";
import type { VercelRequest, VercelResponse } from "@vercel/node";

const COOKIE_NAME = "mtp_session";
const SECRET = process.env.JWT_SECRET || "change-me-in-vercel-env-vars";

export interface SessionUser {
  id: number;
  name: string;
  username: string;
  role: string;
  department: string;
  center: string | null;
}

export function signSession(user: SessionUser): string {
  // 12h token; the client calls /api/auth/me on load to re-validate.
  return jwt.sign(user, SECRET, { expiresIn: "12h" });
}

export function setSessionCookie(res: VercelResponse, token: string) {
  res.setHeader(
    "Set-Cookie",
    serialize(COOKIE_NAME, token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 12,
    })
  );
}

export function clearSessionCookie(res: VercelResponse) {
  res.setHeader(
    "Set-Cookie",
    serialize(COOKIE_NAME, "", { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 0 })
  );
}

export function getSessionUser(req: VercelRequest): SessionUser | null {
  const cookies = parse(req.headers.cookie || "");
  const token = cookies[COOKIE_NAME];
  if (!token) return null;
  try {
    return jwt.verify(token, SECRET) as SessionUser;
  } catch {
    return null;
  }
}

/** Use at the top of any protected /api route. Sends 401 and returns null if not logged in. */
export function requireUser(req: VercelRequest, res: VercelResponse): SessionUser | null {
  const user = getSessionUser(req);
  if (!user) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }
  return user;
}
