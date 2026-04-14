import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  const id = crypto.randomUUID();
  const hash = await bcrypt.hash("emo@2026", 10);

  const now = new Date();
  const res = await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role_id, org_node_id, phone, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)
     RETURNING id, name`,
    [id, "Kushagra", "kushagra@emoenergy.in", hash, "a1b2c3d4-0000-0000-0000-000000000000", "67231232-8bc8-4eda-845d-b32cdf647d73", "919695277111", now, now]
  );

  console.log("DONE:", res.rows[0].name, "added as CEO");
  console.log("  Email: styagi@emoenergy.in");
  console.log("  Phone: +91 9820989677 (WhatsApp linked)");
  console.log("  Password: emo@2026");
} catch (e: any) {
  console.log("ERROR:", e.message);
}

await pool.end();
process.exit(0);
