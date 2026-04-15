import { MongoClient, type Db, type Document } from "mongodb";
import { env } from "../../config/env.js";

// ══════════════════════════════════════════════════════════════════
// Hybrid MongoDB access:
//  (1) Hot cache for small, hot collections (< 10k docs each, used
//      repeatedly by the in-process sandbox and quick lookups).
//  (2) Direct server-side queries for large/volatile collections
//      (Gencash, zohobilling, Factorydatabase, HistoricalRenting).
// ══════════════════════════════════════════════════════════════════

interface AppData {
  Vehicletracker: Document[];
  Newcomplaintresponses: Document[];
  Vehiclereturnresponses: Document[];
  Deployementresponses: Document[];
  Rentingdatabase: Document[];
  Complaindatabase: Document[];
  BatteryInfo: Document[];
  Charger: Document[];
  Chargerresponse: Document[];
  kazamdata: Document[];
  manuallinkgenerations: Document[];
  chatbotrent2: Document[];
}

let client: MongoClient | null = null;
let cachedData: AppData | null = null;
let lastLoadedAt: Date | null = null;

// Collections kept in RAM (small, used by sandbox + hot lookups).
// ~14k docs total, ~55 MB JS heap.
const HOT_COLLECTIONS = [
  "Vehicletracker",
  "Newcomplaintresponses",
  "Vehiclereturnresponses",
  "Deployementresponses",
  "Rentingdatabase",
  "Complaindatabase",
  "BatteryInfo",
  "Charger",
  "Chargerresponse",
  "kazamdata",
  "manuallinkgenerations",
  "chatbotrent2",
] as const;

// Big collections queried on-demand against MongoDB (never bulk-loaded).
// Whitelisted here to prevent the LLM from referencing arbitrary collections.
export const DIRECT_COLLECTIONS = [
  "Gencash",
  "zohobilling",
  "Factorydatabase",
  "HistoricalRentingdatabase",
] as const;

export type DirectCollection = (typeof DIRECT_COLLECTIONS)[number];

export async function connectMongo(): Promise<void> {
  if (client) return;
  client = new MongoClient(env.MONGO_URI);
  await client.connect();
  console.log("Connected to MongoDB Atlas");
}

export function getDb(): Db {
  if (!client) throw new Error("MongoDB not connected — call connectMongo() first");
  return client.db();
}

export async function loadMongoData(): Promise<AppData> {
  if (cachedData && lastLoadedAt && Date.now() - lastLoadedAt.getTime() < 5 * 60 * 1000) {
    return cachedData;
  }

  if (!client) await connectMongo();
  const db = client!.db();

  const data: Record<string, Document[]> = {};
  for (const name of HOT_COLLECTIONS) {
    const docs = await db.collection(name).find({}).sort({ _id: -1 }).toArray();
    data[name] = docs;
    console.log(`  [hot] ${name}: ${docs.length} docs`);
  }

  cachedData = data as unknown as AppData;
  lastLoadedAt = new Date();
  return cachedData;
}

export function getMongoData(): AppData | null {
  return cachedData;
}

export function getCollectionStats(): Record<string, number> {
  if (!cachedData) return {};
  const stats: Record<string, number> = {};
  for (const name of HOT_COLLECTIONS) {
    stats[name] = (cachedData as any)[name]?.length || 0;
  }
  return stats;
}

// Separate per-process counters for direct-query collections — refreshed lazily.
const directCountCache: Record<string, { count: number; at: number }> = {};
export async function getDirectCollectionCount(name: DirectCollection): Promise<number> {
  const cached = directCountCache[name];
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.count;
  const count = await getDb().collection(name).estimatedDocumentCount();
  directCountCache[name] = { count, at: Date.now() };
  return count;
}

// ══════════════════════════════════════════════════════════════════
// Direct query helpers — used for Gencash / zohobilling / Factorydb /
// HistoricalRentingdatabase. These use real MongoDB operators, so
// filters, sorts and aggregations run on the server with indexes.
// ══════════════════════════════════════════════════════════════════

export async function queryMongo(
  name: DirectCollection,
  filter: Record<string, any> = {},
  opts: { limit?: number; sort?: Record<string, 1 | -1>; projection?: Record<string, 0 | 1> } = {},
): Promise<Document[]> {
  const coll = getDb().collection(name);
  let cursor = coll.find(filter);
  if (opts.projection) cursor = cursor.project(opts.projection) as any;
  if (opts.sort) cursor = cursor.sort(opts.sort);
  cursor = cursor.limit(Math.min(opts.limit ?? 50, 500));
  return cursor.toArray();
}

export async function aggregateMongo(
  name: DirectCollection,
  pipeline: any[],
): Promise<Document[]> {
  return getDb().collection(name).aggregate(pipeline, { allowDiskUse: true }).toArray();
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    cachedData = null;
  }
}

// ══════════════════════════════════════════════════════════════════
// Index creation — runs once at startup. Idempotent (createIndex is
// a no-op when the index already exists).
// ══════════════════════════════════════════════════════════════════

export async function ensureIndexes(): Promise<void> {
  const db = getDb();
  const plan: Array<{ coll: string; keys: Record<string, 1 | -1>; name?: string }> = [
    // Gencash — payment transactions
    { coll: "Gencash", keys: { status: 1, receivedAt: -1 } },
    { coll: "Gencash", keys: { txnSource: 1, status: 1 } },
    { coll: "Gencash", keys: { "customerDetails.customerMobile": 1 } },
    { coll: "Gencash", keys: { orderId: 1 } },
    { coll: "Gencash", keys: { receivedAt: -1 } },

    // zohobilling — invoices
    { coll: "zohobilling", keys: { "Vehicle ID": 1 } },
    { coll: "zohobilling", keys: { Location: 1, transactionDateTime: -1 } },
    { coll: "zohobilling", keys: { zohoInvoiceStatus: 1 } },
    { coll: "zohobilling", keys: { transactionDateTime: -1 } },
    { coll: "zohobilling", keys: { zohoInvoiceNumber: 1 } },

    // Factorydatabase — battery pack lifecycle
    { coll: "Factorydatabase", keys: { "Battery ID": 1 } },
    { coll: "Factorydatabase", keys: { Status: 1 } },
    { coll: "Factorydatabase", keys: { "Deployed City": 1 } },
    { coll: "Factorydatabase", keys: { "Frequency of Complaints": -1 } },

    // HistoricalRentingdatabase
    { coll: "HistoricalRentingdatabase", keys: { "Vehicle ID": 1 } },
    { coll: "HistoricalRentingdatabase", keys: { UpdatedAt: -1 } },
  ];

  let created = 0;
  for (const { coll, keys } of plan) {
    try {
      await db.collection(coll).createIndex(keys as any);
      created++;
    } catch (err: any) {
      // Index already exists or collection missing — non-fatal
      if (!/already exists|IndexKeySpecsConflict/.test(err?.message || "")) {
        console.warn(`  [index] ${coll} ${JSON.stringify(keys)}: ${err.message}`);
      }
    }
  }
  console.log(`  [indexes] ensured ${created} indexes across direct-query collections`);
}

// Query helper retained for legacy callers — searches the hot cache.
export function queryCollection(
  collectionName: keyof AppData,
  filter?: Record<string, any>,
  limit = 20,
): Document[] {
  if (!cachedData) return [];
  const docs = cachedData[collectionName] || [];
  if (!filter || Object.keys(filter).length === 0) return docs.slice(0, limit);
  return docs
    .filter((doc) =>
      Object.entries(filter).every(([key, value]) => {
        const docVal = doc[key];
        if (docVal === undefined || docVal === null) return false;
        if (typeof value === "string") return String(docVal).toLowerCase().includes(value.toLowerCase());
        return docVal === value;
      }),
    )
    .slice(0, limit);
}
