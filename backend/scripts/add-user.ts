import pg from "pg";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

try {
  let roleRes = await pool.query("SELECT id FROM roles WHERE name = 'coo'");
  let roleId: string;

  if (!roleRes.rows.length) {
    const ceoPerms = await pool.query("SELECT permissions FROM roles WHERE name = 'ceo'");
    const perms = ceoPerms.rows[0]?.permissions || { view_all_data: true, manage_users: true, manage_alerts: true, view_audit: true, view_llm_usage: true };
    const rid = crypto.randomUUID();
    await pool.query("INSERT INTO roles (id, name, permissions) VALUES ($1, 'coo', $2)", [rid, JSON.stringify(perms)]);
    roleId = rid;
    console.log("Created COO role");
  } else {
    roleId = roleRes.rows[0].id;
  }

  const orgRes = await pool.query("SELECT id FROM org_nodes WHERE level = 0 LIMIT 1");
  const orgId = orgRes.rows[0]?.id;

  const id = crypto.randomUUID();
  const hash = await bcrypt.hash("emo@2026", 10);
  const now = new Date();

  await pool.query(
    `INSERT INTO users (id, name, email, password_hash, role_id, org_node_id, phone, is_active, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8, $9)`,
    [id, "Mrinal", "mrinal@emoenergy.in", hash, roleId, orgId, "919892458877", now, now]
  );

  console.log("DONE: Mrinal added as COO");
  console.log("  Email: mrinal@emoenergy.in");
  console.log("  Phone: +91 9892458877");
  console.log("  Password: emo@2026");
} catch (e: any) {
  console.log("ERROR:", e.message);
}

await pool.end();
process.exit(0);
