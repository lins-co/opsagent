import pg from "pg";
import dotenv from "dotenv";
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
const r = await pool.query(
  `SELECT u.name, u.email, u.phone, u.is_active, r.name as role
   FROM users u JOIN roles r ON u.role_id = r.id
   WHERE u.email IN ('styagi@emoenergy.in', 'kushagra@emoenergy.in')`
);
for (const u of r.rows) {
  console.log(`${u.name} | ${u.role} | phone: ${u.phone || 'NONE'} | active: ${u.is_active} | WA bot: ${u.phone ? 'YES' : 'NO'}`);
}
await pool.end();
process.exit(0);
