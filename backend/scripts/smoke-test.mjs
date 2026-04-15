// Smoke-test the new MongoDB direct-query + index paths.
import { MongoClient } from "mongodb";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const client = new MongoClient(process.env.MONGO_URI);
await client.connect();
const db = client.db();

console.log("\n── Test 1: Total SUCCESS payments (Gencash, full collection) ──");
const t1 = Date.now();
const r1 = await db.collection("Gencash").aggregate([
  { $match: { status: "SUCCESS" } },
  { $group: { _id: null, total: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } }, count: { $sum: 1 } } },
]).toArray();
console.log(`  ${Date.now() - t1}ms → total=₹${r1[0]?.total?.toLocaleString("en-IN")}, count=${r1[0]?.count}`);

console.log("\n── Test 2: Payments by txnSource ──");
const t2 = Date.now();
const r2 = await db.collection("Gencash").aggregate([
  { $match: { status: "SUCCESS" } },
  { $group: { _id: "$txnSource", total: { $sum: { $convert: { input: "$amount", to: "double", onError: 0, onNull: 0 } } }, count: { $sum: 1 } } },
  { $sort: { total: -1 } },
]).toArray();
console.log(`  ${Date.now() - t2}ms`);
for (const r of r2) console.log(`    ${r._id}: ₹${r.total.toLocaleString("en-IN")} (${r.count} txns)`);

console.log("\n── Test 3: Recent 5 SUCCESS payments (uses index on status+receivedAt) ──");
const t3 = Date.now();
const r3 = await db.collection("Gencash").find({ status: "SUCCESS" }).sort({ receivedAt: -1 }).limit(5).toArray();
console.log(`  ${Date.now() - t3}ms → ${r3.length} docs`);
for (const p of r3) {
  console.log(`    ${p.orderId}  ₹${p.amount}  ${p.txnSource}  ${p.customerDetails?.customerName}  ${p.receivedAt?.toISOString?.()}`);
}

console.log("\n── Test 4: Invoice revenue by Location ──");
const t4 = Date.now();
const r4 = await db.collection("zohobilling").aggregate([
  { $group: { _id: "$Location", total: { $sum: { $convert: { input: "$zohoInvoiceTotal", to: "double", onError: 0, onNull: 0 } } }, count: { $sum: 1 } } },
  { $sort: { total: -1 } },
  { $limit: 10 },
]).toArray();
console.log(`  ${Date.now() - t4}ms`);
for (const r of r4) console.log(`    ${r._id || "(no location)"}: ₹${r.total.toLocaleString("en-IN")} (${r.count})`);

console.log("\n── Test 5: Top problem batteries (Factorydatabase) ──");
const t5 = Date.now();
const r5 = await db.collection("Factorydatabase").find({ "Frequency of Complaints": { $gt: 0 } })
  .sort({ "Frequency of Complaints": -1 }).limit(10).toArray();
console.log(`  ${Date.now() - t5}ms → ${r5.length} docs`);
for (const b of r5) console.log(`    ${b["Battery ID"]}  freq=${b["Frequency of Complaints"]}  repairs=${b["Repair Count"]}  replaces=${b["Replace Count"]}`);

await client.close();
