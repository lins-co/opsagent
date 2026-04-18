import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const now = new Date();

// Reset granular flags to ON, then use the master mute for the "pause" behavior.
// Digest mode ON by default now — prevents DM spam.
const settings: [string, string][] = [
  ["bot.muted", "false"],
  ["bot.muted_until", "\"\""],
  ["bot.muted_reason", "\"\""],
  ["pm.dms_enabled", "true"],
  ["pm.group_followups_enabled", "true"],
  ["pm.dm_digest_mode", "true"],
  ["pm.dm_digest_hour_ist", "9"],
  ["pm.dm_digest_min_items", "1"],
];

for (const [key, jsonValue] of settings) {
  await pool.query(
    `INSERT INTO app_settings (key, value, updated_at, created_at)
     VALUES ($1, $2::jsonb, $3, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
    [key, jsonValue, now],
  );
}

console.log("DONE: Notification defaults set:");
console.log("  bot.muted = false");
console.log("  pm.dms_enabled = true");
console.log("  pm.dm_digest_mode = true (batched, 1 per user per day)");
console.log("  pm.dm_digest_hour_ist = 9 (9 AM IST)");

await pool.end();
process.exit(0);
