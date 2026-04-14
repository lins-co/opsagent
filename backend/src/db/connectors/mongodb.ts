import { MongoClient, type Db, type Collection, type Document } from "mongodb";
import { env } from "../../config/env.js";

interface AppData {
  Vehicletracker: Document[];
  Newcomplaintresponses: Document[];
  Vehiclereturnresponses: Document[];
  Deployementresponses: Document[];
  Rentingdatabase: Document[];
  Complaindatabase: Document[];
}

let client: MongoClient | null = null;
let cachedData: AppData | null = null;
let lastLoadedAt: Date | null = null;

const COLLECTION_NAMES = [
  "Vehicletracker",
  "Newcomplaintresponses",
  "Vehiclereturnresponses",
  "Deployementresponses",
  "Rentingdatabase",
  "Complaindatabase",
] as const;

export async function connectMongo(): Promise<void> {
  if (client) return;

  client = new MongoClient(env.MONGO_URI);
  await client.connect();
  console.log("Connected to MongoDB Atlas");
}

export async function loadMongoData(): Promise<AppData> {
  if (cachedData && lastLoadedAt && Date.now() - lastLoadedAt.getTime() < 5 * 60 * 1000) {
    return cachedData;
  }

  if (!client) await connectMongo();
  const db = client!.db();

  const data: Record<string, Document[]> = {};
  for (const name of COLLECTION_NAMES) {
    const docs = await db.collection(name).find({}).toArray();
    data[name] = docs;
    console.log(`  Loaded ${docs.length} docs from ${name}`);
  }

  cachedData = data as unknown as AppData;
  lastLoadedAt = new Date();
  return cachedData;
}

export function getMongoData(): AppData | null {
  return cachedData;
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    cachedData = null;
  }
}

// Query helper — search a collection by field/value with optional limit
export function queryCollection(
  collectionName: keyof AppData,
  filter?: Record<string, any>,
  limit = 20
): Document[] {
  if (!cachedData) return [];
  const docs = cachedData[collectionName] || [];

  if (!filter || Object.keys(filter).length === 0) {
    return docs.slice(0, limit);
  }

  return docs
    .filter((doc) => {
      return Object.entries(filter).every(([key, value]) => {
        const docVal = doc[key];
        if (docVal === undefined || docVal === null) return false;
        if (typeof value === "string") {
          return String(docVal).toLowerCase().includes(value.toLowerCase());
        }
        return docVal === value;
      });
    })
    .slice(0, limit);
}

// Get collection stats
export function getCollectionStats(): Record<string, number> {
  if (!cachedData) return {};
  const stats: Record<string, number> = {};
  for (const name of COLLECTION_NAMES) {
    stats[name] = cachedData[name]?.length || 0;
  }
  return stats;
}
