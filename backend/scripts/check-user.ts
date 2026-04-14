import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(
  `SELECT u.name, u.email, u.phone, u.is_active, r.name as role
   FROM users u JOIN roles r ON u.role_id = r.id
   WHERE u.email = 'rpatel@emoenergy.in'`
);
if (r.rows.length) {
  const u = r.rows[0];
  console.log(`Name: ${u.name} | Role: ${u.role} | Phone: ${u.phone} | Active: ${u.is_active}`);
} else {
  console.log("NOT FOUND");
}
await pool.end();
process.exit(0);
