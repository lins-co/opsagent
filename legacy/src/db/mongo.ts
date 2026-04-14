import { MongoClient, type Db, type Document } from "mongodb";
import dotenv from "dotenv";

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
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

async function connectWithRetry(maxRetries = 3): Promise<MongoClient> {
  if (!MONGO_URI) {
    throw new Error("MONGO_URI is not set in environment variables");
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const c = new MongoClient(MONGO_URI, {
        serverSelectionTimeoutMS: 10000,
        connectTimeoutMS: 10000,
      });
      await c.connect();
      return c;
    } catch (err: any) {
      console.error(`  MongoDB connection attempt ${attempt}/${maxRetries} failed: ${err.message}`);
      if (attempt === maxRetries) throw err;
      const waitMs = 3000 * attempt;
      console.log(`  Retrying in ${waitMs / 1000}s...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Unreachable");
}

export async function loadData(): Promise<AppData> {
  if (cachedData) return cachedData;

  if (!client) {
    console.log("Connecting to MongoDB...");
    client = await connectWithRetry();
  }
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

export async function reloadData(): Promise<AppData> {
  cachedData = null;
  // Verify connection is alive, reconnect if stale
  if (client) {
    try {
      await client.db("admin").command({ ping: 1 });
    } catch {
      console.log("  MongoDB connection stale, reconnecting...");
      try { await client.close(); } catch {}
      client = null;
    }
  }
  return loadData();
}

export function getData(): AppData | null {
  return cachedData;
}

export async function shutdown(): Promise<void> {
  if (client) {
    console.log("Closing MongoDB connection...");
    await client.close();
    client = null;
  }
}
