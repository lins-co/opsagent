import { MongoClient } from "mongodb";
import dotenv from "dotenv";
dotenv.config();

const client = new MongoClient(process.env.MONGO_URI!);
await client.connect();
const db = client.db();

const collections = ["Deployementresponses", "Newcomplaintresponses", "Complaindatabase", "Vehiclereturnresponses", "Rentingdatabase"];

for (const name of collections) {
  const docs = await db.collection(name).find({}).toArray();
  const dates = docs
    .map((d) => new Date(d["Created Time"] || d["Rent Start Date"] || ""))
    .filter((d) => !isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime());

  if (dates.length > 0) {
    console.log(`${name}: ${dates[0].toISOString().split("T")[0]} → ${dates[dates.length - 1].toISOString().split("T")[0]} (${dates.length} records with dates)`);
  } else {
    console.log(`${name}: no parseable dates`);
  }
}

await client.close();
process.exit(0);
