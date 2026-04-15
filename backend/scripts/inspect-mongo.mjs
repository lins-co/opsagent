// One-off MongoDB introspection — lists all collections, counts, sample docs, and inferred field schemas.
// Run: node backend/scripts/inspect-mongo.mjs
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const uri = process.env.MONGO_URI;
if (!uri) {
  console.error("MONGO_URI not set");
  process.exit(1);
}

function inferType(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return v.length ? `array<${inferType(v[0])}>` : "array<empty>";
  if (v instanceof Date) return "date";
  return typeof v;
}

function buildSchema(docs) {
  const fields = new Map();
  for (const doc of docs) {
    for (const [k, v] of Object.entries(doc)) {
      if (!fields.has(k)) {
        fields.set(k, { types: new Set(), nonNullCount: 0, samples: [] });
      }
      const f = fields.get(k);
      const t = inferType(v);
      f.types.add(t);
      if (v !== null && v !== undefined && v !== "") f.nonNullCount++;
      if (f.samples.length < 3 && v !== null && v !== undefined && v !== "") {
        const s = typeof v === "object" ? JSON.stringify(v).slice(0, 100) : String(v).slice(0, 80);
        if (!f.samples.includes(s)) f.samples.push(s);
      }
    }
  }
  return fields;
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db();
console.log(`\nDatabase: ${db.databaseName}\n`);

const collections = await db.listCollections().toArray();
console.log(`Found ${collections.length} collections:\n`);

const summary = [];

for (const c of collections) {
  const name = c.name;
  const coll = db.collection(name);
  const count = await coll.countDocuments();
  const samples = await coll.find({}).limit(50).toArray();
  const schema = buildSchema(samples);

  console.log("=".repeat(70));
  console.log(`📦 ${name} — ${count} docs`);
  console.log("=".repeat(70));

  for (const [field, info] of schema) {
    const types = [...info.types].join("|");
    const fillRate = samples.length ? Math.round((info.nonNullCount / samples.length) * 100) : 0;
    console.log(`  ${field.padEnd(35)} ${types.padEnd(20)} fill:${fillRate}%  e.g. ${info.samples.slice(0, 2).join(" / ")}`);
  }

  summary.push({ name, count, fields: [...schema.keys()] });
  console.log("");
}

console.log("\n\n========== SUMMARY ==========");
for (const s of summary) {
  console.log(`${s.name.padEnd(35)} ${String(s.count).padStart(7)} docs  ${s.fields.length} fields`);
}

await client.close();
