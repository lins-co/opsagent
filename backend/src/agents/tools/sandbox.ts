import vm from "vm";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getMongoData,
  getCollectionStats,
  queryMongo,
  aggregateMongo,
  DIRECT_COLLECTIONS,
  type DirectCollection,
} from "../../db/connectors/mongodb.js";

// ── Sandbox timeout ──
const SANDBOX_TIMEOUT_MS = 15_000; // 15 seconds max execution
const MAX_OUTPUT_LENGTH = 8000; // Truncate output to save tokens

// ── Build the data context injected into every sandbox ──
function buildSandboxContext() {
  const data = getMongoData();
  if (!data) return {};

  return {
    // Raw collections
    vehicles: data.Vehicletracker || [],
    deployments: data.Deployementresponses || [],
    complaints: data.Newcomplaintresponses || [],
    batteryComplaints: data.Complaindatabase || [],
    returns: data.Vehiclereturnresponses || [],
    rentals: data.Rentingdatabase || [],

    // Stats
    stats: getCollectionStats(),
    today: new Date().toISOString().split("T")[0],
    now: new Date().toISOString(),
  };
}

// ── Safe date parser (same as db-tools) ──
function parseDate(raw: any): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;
  const str = String(raw).trim();
  if (!str) return null;
  const native = new Date(str);
  if (!isNaN(native.getTime()) && native.getFullYear() > 2000) return native;
  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[,\s]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?/i);
  if (match) {
    let [, month, day, year, hours, minutes, seconds, ampm] = match;
    let h = parseInt(hours || "0");
    if (ampm?.toLowerCase() === "pm" && h < 12) h += 12;
    if (ampm?.toLowerCase() === "am" && h === 12) h = 0;
    return new Date(parseInt(year!), parseInt(month!) - 1, parseInt(day!), h, parseInt(minutes || "0"), parseInt(seconds || "0"));
  }
  return null;
}

// ── Utility functions available in sandbox ──
const sandboxUtils = {
  parseDate,

  // Filter by date range
  filterByDate(docs: any[], dateField: string, from: string, to?: string): any[] {
    const fromDate = new Date(from + "T00:00:00");
    const toDate = to ? new Date(to + "T23:59:59") : new Date();
    return docs.filter((d: any) => {
      const dt = parseDate(d[dateField]);
      return dt && dt >= fromDate && dt <= toDate;
    });
  },

  // Group and count
  groupBy(docs: any[], field: string): Record<string, number> {
    const result: Record<string, number> = {};
    docs.forEach((d: any) => {
      const key = String(d[field] || "Unknown");
      result[key] = (result[key] || 0) + 1;
    });
    return result;
  },

  // Sum a numeric field
  sum(docs: any[], field: string): number {
    let total = 0;
    for (const d of docs) {
      const raw = d[field];
      const num = typeof raw === "number" ? raw : parseFloat(String(raw || "0").replace(/[₹,\s]/g, ""));
      if (!isNaN(num)) total += num;
    }
    return Math.round(total * 100) / 100;
  },

  // Average a numeric field
  avg(docs: any[], field: string): number {
    let total = 0;
    let count = 0;
    for (const d of docs) {
      const raw = d[field];
      const num = typeof raw === "number" ? raw : parseFloat(String(raw || "0").replace(/[₹,\s]/g, ""));
      if (!isNaN(num)) { total += num; count++; }
    }
    return count > 0 ? Math.round((total / count) * 100) / 100 : 0;
  },

  // Unique values
  unique(docs: any[], field: string): string[] {
    return [...new Set(docs.map((d: any) => d[field]).filter(Boolean).map(String))];
  },

  // Top N by count
  topN(docs: any[], field: string, n = 10): { value: string; count: number }[] {
    const counts = sandboxUtils.groupBy(docs, field);
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([value, count]) => ({ value, count }));
  },

  // Cross-tabulate two fields
  crossTab(docs: any[], field1: string, field2: string): Record<string, Record<string, number>> {
    const result: Record<string, Record<string, number>> = {};
    docs.forEach((d: any) => {
      const k1 = String(d[field1] || "Unknown");
      const k2 = String(d[field2] || "Unknown");
      if (!result[k1]) result[k1] = {};
      result[k1][k2] = (result[k1][k2] || 0) + 1;
    });
    return result;
  },

  // Trend over time (group by date)
  trend(docs: any[], dateField: string, granularity: "day" | "week" | "month" = "day"): { period: string; count: number }[] {
    const buckets: Record<string, number> = {};
    docs.forEach((d: any) => {
      const dt = parseDate(d[dateField]);
      if (!dt) return;
      let key: string;
      if (granularity === "day") key = dt.toISOString().split("T")[0];
      else if (granularity === "week") {
        const weekStart = new Date(dt);
        weekStart.setDate(dt.getDate() - dt.getDay() + 1);
        key = `W${weekStart.toISOString().split("T")[0]}`;
      } else {
        key = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
      }
      buckets[key] = (buckets[key] || 0) + 1;
    });
    return Object.entries(buckets).sort().map(([period, count]) => ({ period, count }));
  },
};

// ── Execute code in sandbox (async — supports `await fetchMongo(...)`) ──
async function executeInSandbox(code: string): Promise<string> {
  const dataContext = buildSandboxContext();
  const output: string[] = [];

  // Live-query helpers (the agent can await these inside the sandbox).
  // They hit MongoDB with indexes, so pulling filtered slices is fast.
  const mongoHelpers = {
    // Generic filter-based fetch against any big collection.
    fetchMongo: async (collection: string, filter: any = {}, limit = 2000) => {
      if (!DIRECT_COLLECTIONS.includes(collection as DirectCollection)) {
        throw new Error(
          `fetchMongo: unknown collection '${collection}'. Use one of: ${DIRECT_COLLECTIONS.join(", ")}`,
        );
      }
      return queryMongo(collection as DirectCollection, filter, {
        limit: Math.min(limit, 10_000),
        sort: { _id: -1 },
      });
    },

    // Full aggregation pipeline — for the tough cases (bucketing, $dateFromString, $facet, etc).
    aggregateMongo: async (collection: string, pipeline: any[]) => {
      if (!DIRECT_COLLECTIONS.includes(collection as DirectCollection)) {
        throw new Error(
          `aggregateMongo: unknown collection '${collection}'. Use one of: ${DIRECT_COLLECTIONS.join(", ")}`,
        );
      }
      return aggregateMongo(collection as DirectCollection, pipeline);
    },

    // Convenience shorthands used in most finance questions.
    fetchPayments: async (filter: any = {}, limit = 5000) =>
      queryMongo("Gencash", filter, { limit: Math.min(limit, 10_000), sort: { receivedAt: -1 } }),
    fetchInvoices: async (filter: any = {}, limit = 5000) =>
      queryMongo("zohobilling", filter, { limit: Math.min(limit, 10_000), sort: { transactionDateTime: -1 } }),
    fetchFactoryBatteries: async (filter: any = {}, limit = 5000) =>
      queryMongo("Factorydatabase", filter, { limit: Math.min(limit, 10_000) }),
    fetchRentalHistory: async (filter: any = {}, limit = 5000) =>
      queryMongo("HistoricalRentingdatabase", filter, { limit: Math.min(limit, 10_000), sort: { _id: -1 } }),
  };

  const sandbox: any = {
    ...dataContext,
    ...sandboxUtils,
    ...mongoHelpers,
    console: {
      log: (...args: any[]) =>
        output.push(args.map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a))).join(" ")),
      table: (data: any) => output.push(JSON.stringify(data, null, 2)),
    },
    JSON,
    Math,
    Date,
    Promise,
    parseInt,
    parseFloat,
    isNaN,
    Number,
    String,
    Array,
    Object,
    Map,
    Set,
    RegExp,
    result: null,
  };

  const context = vm.createContext(sandbox);

  // Wrap in async IIFE so `await fetchMongo(...)` works.
  const wrappedCode = `
    (async () => {
      try {
        ${code}
      } catch (e) {
        console.log("ERROR: " + (e?.message || String(e)));
      }
    })()
  `;

  try {
    const runPromise = vm.runInContext(wrappedCode, context, {
      timeout: SANDBOX_TIMEOUT_MS,
      filename: "analysis.js",
    }) as Promise<void>;

    // vm's timeout only covers sync portions. Enforce a wall-clock timeout for async code too.
    const wallTimeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("WALL_TIMEOUT")), SANDBOX_TIMEOUT_MS + 5_000),
    );

    await Promise.race([runPromise, wallTimeout]);

    let finalOutput = output.join("\n");
    if (sandbox.result !== null && sandbox.result !== undefined) {
      const resultStr =
        typeof sandbox.result === "object" ? JSON.stringify(sandbox.result, null, 2) : String(sandbox.result);
      finalOutput = finalOutput ? `${finalOutput}\n\nRESULT:\n${resultStr}` : resultStr;
    }

    if (!finalOutput.trim()) {
      finalOutput = "(No output. Use console.log() or set `result = ...` to return data.)";
    }

    if (finalOutput.length > MAX_OUTPUT_LENGTH) {
      finalOutput = finalOutput.slice(0, MAX_OUTPUT_LENGTH) + "\n\n...(truncated)";
    }

    return finalOutput;
  } catch (err: any) {
    if (err?.code === "ERR_SCRIPT_EXECUTION_TIMEOUT" || err?.message === "WALL_TIMEOUT") {
      return "ERROR: Code execution timed out (15s limit). Narrow the filters (smaller date window, specific location) or run fewer fetches.";
    }
    return `ERROR: ${err?.message || String(err)}`;
  }
}

// ── The tool ──
export const runAnalysisTool = tool(
  async ({ code, goal }) => {
    console.log(`  [Sandbox] Running analysis: ${goal}`);
    const startTime = Date.now();
    const output = await executeInSandbox(code);
    const elapsed = Date.now() - startTime;
    console.log(`  [Sandbox] Done in ${elapsed}ms (${output.length} chars)`);
    return output;
  },
  {
    name: "run_analysis",
    description: `Execute JavaScript in a sandboxed VM with full access to EMO data.
USE THIS whenever a question can't be answered by a single query_collection or aggregate_data call — correlations, multi-step logic, cross-collection joins, rolling windows, exotic grouping, per-rider payment behaviour, anomaly detection, "vehicles with X AND Y", etc.
NEVER compute numbers in your head. If the math is non-trivial, run it here.

IN-MEMORY COLLECTIONS (preloaded, zero-latency):
- vehicles[], deployments[], complaints[], batteryComplaints[], returns[], rentals[]

LIVE MONGO HELPERS (use await — fetches from DB with indexes):
- await fetchPayments(filter, limit)        → Gencash (18k+)
- await fetchInvoices(filter, limit)        → zohobilling (10k+)
- await fetchFactoryBatteries(filter, limit)→ Factorydatabase (11k+)
- await fetchRentalHistory(filter, limit)   → HistoricalRentingdatabase (3k+)
- await fetchMongo(name, filter, limit)     → generic; name = "Gencash"|"zohobilling"|"Factorydatabase"|"HistoricalRentingdatabase"
- await aggregateMongo(name, pipeline)      → full Mongo aggregation pipeline for the tough cases
Filters accept real Mongo operators: { status: "SUCCESS", receivedAt: { $gte: new Date("2026-04-01") } }

UTILS:
- parseDate(val), filterByDate(docs, field, from, to?)
- groupBy(docs, field)  — {value: count}
- sum(docs, field) / avg(docs, field) — auto-coerces "1250"/"1,250"/1250
- unique(docs, field), topN(docs, field, n)
- crossTab(docs, f1, f2), trend(docs, dateField, "day"|"week"|"month")
- today, now — current date strings
- console.log() and set \`result = ...\` to return data

EXAMPLES:

// How much did each location collect this month from rent, and how many riders paid?
const start = new Date(today.slice(0, 7) + "-01");
const txns = await fetchPayments({ status: "SUCCESS", txnSource: { $regex: "rent", $options: "i" }, receivedAt: { $gte: start } }, 10000);
const byLoc = {};
for (const t of txns) {
  // Join to rental to get Location
  const r = rentals.find(x => x["Vehicle ID"] && t.vehicleId === x["Vehicle ID"]);
  const loc = r?.Location || "Unknown";
  byLoc[loc] = byLoc[loc] || { total: 0, riders: new Set() };
  byLoc[loc].total += Number(t.amount) || 0;
  byLoc[loc].riders.add(t.customerDetails?.customerMobile);
}
result = Object.fromEntries(Object.entries(byLoc).map(([k, v]) => [k, { total: v.total, uniqueRiders: v.riders.size }]));

// Riders with 2+ failed payments in last 7 days
const sevenDaysAgo = new Date(Date.now() - 7 * 864e5);
const fails = await fetchPayments({ status: "FAILED", receivedAt: { $gte: sevenDaysAgo } }, 5000);
const perRider = groupBy(fails, (d) => d.customerDetails?.customerMobile);
result = Object.entries(perRider).filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]);

// Outstanding balance vs total paid for each Active rental
const report = [];
for (const r of rentals.filter(r => r.Status === "Active")) {
  const paid = await fetchPayments({ "customerDetails.customerMobile": String(r["Rider Contact No"]), status: "SUCCESS" }, 200);
  report.push({ vehicle: r["Vehicle ID"], rider: r["Rider Name"], balance: r["Balance Amount"], totalPaid: sum(paid, "amount") });
}
result = report;

ACCURACY RULES:
- Every number in your reply must come from \`result\` or \`console.log\` output. Do not invent or round creatively.
- Filters on txnSource or Location should be case-insensitive ({ $regex: "rent", $options: "i" }) — the source data has casing drift.
- Balance Amount is NEGATIVE when the rider owes money. Flip the sign when reporting "outstanding".
- Cap fetches (limit parameter) — don't pull all 18k payments if you only need one month.`,
    schema: z.object({
      goal: z.string().describe("Brief description of what the analysis aims to find"),
      code: z.string().describe("JavaScript to execute. Async — you can use await. Use console.log() or set `result`."),
    }),
  },
);
