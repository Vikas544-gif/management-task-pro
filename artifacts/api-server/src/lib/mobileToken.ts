import { createHmac, timingSafeEqual } from "node:crypto";

const SECRET = process.env.SESSION_SECRET;
if (!SECRET) {
  throw new Error("SESSION_SECRET environment variable is required for mobile auth tokens.");
}

function sign(payload: string): string {
  return createHmac("sha256", SECRET!).update(payload).digest("base64url");
}

/**
 * Create a signed bearer token for mobile clients. Format: `<uid>.<epoch>.<sig>`
 * where `sig = HMAC-SHA256("<uid>.<epoch>")` keyed by SESSION_SECRET. Mirrors the
 * signed session cookie the web app uses, but travels in the Authorization
 * header because React Native has no persistent cookie jar across app restarts.
 * The HMAC makes the token unforgeable — a raw `<uid>.<epoch>` would not be.
 */
export function createMobileToken(userId: number, epoch: number): string {
  const payload = `${userId}.${epoch}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * Verify a mobile bearer token. Returns its `{ uid, epoch }` when the signature
 * is valid, or `null` otherwise. Epoch freshness (matching the current global
 * auth epoch) is checked by the caller, exactly like the cookie path.
 */
export function verifyMobileToken(token: string): { uid: number; epoch: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uidStr, epochStr, sig] = parts;
  const expected = sign(`${uidStr}.${epochStr}`);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return null;
  const uid = parseInt(uidStr, 10);
  const epoch = parseInt(epochStr, 10);
  if (Number.isNaN(uid) || Number.isNaN(epoch)) return null;
  return { uid, epoch };
}
