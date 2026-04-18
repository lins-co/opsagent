import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const now = new Date();
await pool.query(
  `INSERT INTO app_settings (key, value, updated_at, created_at)
   VALUES ($1, $2::jsonb, $3, $3)
   ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at`,
  ["pm.dms_enabled", "false", now]
);
console.log("DONE: pm.dms_enabled = false (PM personal DMs are now OFF)");
await pool.end();
process.exit(0);
