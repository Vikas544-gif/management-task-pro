import { db, appSettingsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

// A single global integer baked into every session cookie at login. Bumping it
// (admin "force everyone to re-login") makes every previously-issued cookie
// stale, so all users are logged out at once. Stored in app_settings so it
// survives restarts and republishes.
const AUTH_EPOCH_KEY = "authEpoch";

export async function getAuthEpoch(): Promise<number> {
  const [row] = await db
    .select()
    .from(appSettingsTable)
    .where(eq(appSettingsTable.key, AUTH_EPOCH_KEY));
  const n = row ? parseInt(row.value, 10) : 0;
  return Number.isNaN(n) ? 0 : n;
}

export async function bumpAuthEpoch(): Promise<number> {
  // Atomic increment in a single statement so concurrent calls can't collapse
  // to the same value (lost increment). Starts at 1 on first bump (matching the
  // default epoch of 0 used before any sessions were invalidated).
  const [row] = await db
    .insert(appSettingsTable)
    .values({ key: AUTH_EPOCH_KEY, value: "1" })
    .onConflictDoUpdate({
      target: appSettingsTable.key,
      set: { value: sql`(${appSettingsTable.value}::int + 1)::text` },
    })
    .returning({ value: appSettingsTable.value });
  const n = row ? parseInt(row.value, 10) : 1;
  return Number.isNaN(n) ? 1 : n;
}
