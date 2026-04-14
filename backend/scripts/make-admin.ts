import dotenv from "dotenv";
dotenv.config();
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

const email = "linsvarghese@emoenergy.in";

// Find user
const userResult = await pool.query("SELECT u.id, u.name, r.name as role_name FROM users u JOIN roles r ON u.role_id = r.id WHERE u.email = $1", [email]);
if (!userResult.rows.length) { console.log("User not found"); process.exit(1); }
console.log(`User: ${userResult.rows[0].name} | Current role: ${userResult.rows[0].role_name}`);

// Find admin role
const roleResult = await pool.query("SELECT id FROM roles WHERE name = 'admin'");
if (!roleResult.rows.length) { console.log("Admin role not found"); process.exit(1); }

// Update
await pool.query("UPDATE users SET role_id = $1 WHERE email = $2", [roleResult.rows[0].id, email]);
console.log(`DONE: ${userResult.rows[0].name} (${email}) is now admin`);

await pool.end();
process.exit(0);
