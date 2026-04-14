import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const MONGO_URI = process.env.MONGO_URI!;
if (!MONGO_URI) {
  console.error("MONGO_URI not found in .env");
  process.exit(1);
}

const COLLECTIONS = [
  "Vehicletracker",
  "Newcomplaintresponses",
  "Vehiclereturnresponses",
  "Deployementresponses",
  "Rentingdatabase",
  "Complaindatabase",
];

async function main() {
  console.log("Connecting to MongoDB...");
  const client = new MongoClient(MONGO_URI);
  await client.connect();
  console.log("Connected!\n");

  const db = client.db();
  console.log(`Database: ${db.databaseName}\n`);

  for (const collName of COLLECTIONS) {
    console.log("=".repeat(80));
    console.log(`COLLECTION: ${collName}`);
    console.log("=".repeat(80));

    const coll = db.collection(collName);
    const totalCount = await coll.countDocuments();
    console.log(`Total documents: ${totalCount}\n`);

    // Sample 3 documents
    const samples = await coll.find({}).limit(3).toArray();
    console.log(`--- Sample Documents (${samples.length}) ---`);
    for (let i = 0; i < samples.length; i++) {
      console.log(`\n  Document ${i + 1}:`);
      for (const [key, value] of Object.entries(samples[i])) {
        if (key === "_id") {
          console.log(`    ${key}: ${value}`);
          continue;
        }
        const valStr = typeof value === "object" && value !== null
          ? JSON.stringify(value).slice(0, 200)
          : String(value).slice(0, 200);
        console.log(`    ${key}: ${valStr}`);
      }
    }

    // Discover ALL unique field names across the entire collection
    // Use aggregation to get field names from a larger sample
    const fieldSample = await coll.find({}).limit(100).toArray();
    const allFields = new Set<string>();
    for (const doc of fieldSample) {
      for (const key of Object.keys(doc)) {
        allFields.add(key);
      }
    }
    const fieldList = Array.from(allFields).sort();
    console.log(`\n--- All Unique Fields (${fieldList.length}) ---`);
    console.log(`  ${fieldList.join(", ")}`);

    // For key fields, get unique value counts
    // Identify likely status/category fields (non-ID, non-date, short string values)
    const KEY_FIELD_PATTERNS = [
      /status/i, /location/i, /type/i, /vendor/i, /model/i, /zone/i,
      /purpose/i, /reason/i, /issue/i, /resolved/i, /solution/i,
      /amountstatus/i, /rent\s?status/i, /complaint/i, /complain/i,
    ];

    console.log(`\n--- Unique Value Counts for Key Fields ---`);

    // Get all docs for value analysis (or limit to 500 for large collections)
    const allDocs = await coll.find({}).limit(2000).toArray();

    for (const field of fieldList) {
      if (field === "_id") continue;

      const isKeyField = KEY_FIELD_PATTERNS.some(p => p.test(field));
      if (!isKeyField) continue;

      const valueCounts: Record<string, number> = {};
      for (const doc of allDocs) {
        const val = doc[field];
        if (val === null || val === undefined || val === "") continue;
        const str = String(val).trim();
        if (str.length > 100) continue; // skip long values
        valueCounts[str] = (valueCounts[str] || 0) + 1;
      }

      const uniqueCount = Object.keys(valueCounts).length;
      if (uniqueCount === 0) continue;

      console.log(`\n  ${field} (${uniqueCount} unique values):`);
      // Sort by count descending
      const sorted = Object.entries(valueCounts).sort((a, b) => b[1] - a[1]);
      for (const [val, count] of sorted.slice(0, 25)) {
        console.log(`    "${val}": ${count}`);
      }
      if (sorted.length > 25) {
        console.log(`    ... and ${sorted.length - 25} more`);
      }
    }

    console.log("\n");
  }

  await client.close();
  console.log("Done.");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
