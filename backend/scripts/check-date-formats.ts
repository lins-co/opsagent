import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const client = new MongoClient(process.env.MONGO_URI!);
await client.connect();
const db = client.db();

const collections = ["Deployementresponses", "Newcomplaintresponses", "Vehiclereturnresponses", "Rentingdatabase"];

for (const name of collections) {
  const docs = await db.collection(name).find({}).limit(5).toArray();
  console.log(`\n=== ${name} ===`);

  // Find all fields that might contain dates
  const dateFields = ["Created Time", "created_time", "createdTime", "Date", "date",
    "Rent Start Date", "Return Date", "Deployed Date", "DeployementDate", "Last Modified",
    "Last Active Date", "LastPaymentdate", "LastDuedate"];

  for (const doc of docs.slice(0, 2)) {
    console.log("---");
    for (const field of dateFields) {
      if (doc[field] !== undefined) {
        console.log(`  ${field}: "${doc[field]}" (type: ${typeof doc[field]})`);
      }
    }
    // Also check all keys for anything with "date" or "time" in the name
    for (const key of Object.keys(doc)) {
      if (/date|time|created|modified/i.test(key) && !dateFields.includes(key)) {
        console.log(`  ${key}: "${doc[key]}" (type: ${typeof doc[key]})`);
      }
    }
  }
}

await client.close();
process.exit(0);
