import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const client = new MongoClient(process.env.MONGO_URI!);
await client.connect();
const db = client.db();

const docs = await db.collection("Rentingdatabase").find({}).limit(3).toArray();

for (const doc of docs) {
  console.log("\n=== RECORD ===");
  for (const [key, val] of Object.entries(doc)) {
    if (key === "_id") continue;
    if (val === null || val === undefined || val === "") continue;
    const type = typeof val;
    const preview = type === "string" ? `"${String(val).slice(0, 80)}"` : val;
    console.log(`  ${key}: ${preview} (${type})`);
  }
}

// Also check numeric-looking fields across more docs
console.log("\n=== NUMERIC FIELD SCAN (first 50 docs) ===");
const sample = await db.collection("Rentingdatabase").find({}).limit(50).toArray();
const numericFields = new Set<string>();
for (const doc of sample) {
  for (const [key, val] of Object.entries(doc)) {
    if (val === null || val === undefined || val === "") continue;
    const num = typeof val === "number" ? val : parseFloat(String(val).replace(/[₹,\s]/g, ""));
    if (!isNaN(num) && num > 0 && /amount|rent|balance|collect|payment|price|charge|due/i.test(key)) {
      numericFields.add(key);
    }
  }
}
console.log("Fields with numeric values:", [...numericFields].join(", "));

// Show sample values for each
for (const field of numericFields) {
  const vals = sample.map(d => d[field]).filter(v => v !== null && v !== undefined && v !== "").slice(0, 5);
  console.log(`  ${field}: ${vals.map(v => `${v} (${typeof v})`).join(", ")}`);
}

await client.close();
process.exit(0);
