import { MongoClient, type Db, type Document } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI!;
const DB_NAME = "mydatabase";

const COLLECTIONS = [
  "Vehicletracker",
  "Newcomplaintresponses",
  "Vehiclereturnresponses",
  "Deployementresponses",
  "Rentingdatabase",
  "Complaindatabase",
] as const;

export type CollectionName = (typeof COLLECTIONS)[number];

export interface AppData {
  Vehicletracker: Document[];
  Newcomplaintresponses: Document[];
  Vehiclereturnresponses: Document[];
  Deployementresponses: Document[];
  Rentingdatabase: Document[];
  Complaindatabase: Document[];
  loadedAt: Date;
  counts: Record<CollectionName, number>;
}

let cachedData: AppData | null = null;
let client: MongoClient | null = null;

export async function loadData(): Promise<AppData> {
  if (cachedData) return cachedData;

  console.log("Connecting to MongoDB...");
  client = new MongoClient(MONGO_URI);
  await client.connect();
  const db: Db = client.db(DB_NAME);

  const data: Partial<AppData> = {};
  const counts: Partial<Record<CollectionName, number>> = {};

  for (const name of COLLECTIONS) {
    const docs = await db.collection(name).find({}).toArray();
    (data as any)[name] = docs;
    counts[name] = docs.length;
    console.log(`  ${name}: ${docs.length} rows`);
  }

  data.loadedAt = new Date();
  data.counts = counts as Record<CollectionName, number>;
  cachedData = data as AppData;

  console.log("Data loaded successfully.\n");
  return cachedData;
}

export function getData(): AppData | null {
  return cachedData;
}
