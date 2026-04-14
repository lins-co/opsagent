import vm from "vm";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getMongoData, getCollectionStats } from "../../db/connectors/mongodb.js";

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

// ── Execute code in sandbox ──
function executeInSandbox(code: string): string {
  const dataContext = buildSandboxContext();
  const output: string[] = [];

  // Create sandbox with data + utils + console capture
  const sandbox = {
    ...dataContext,
    ...sandboxUtils,
    console: {
      log: (...args: any[]) => output.push(args.map(a => typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)).join(" ")),
      table: (data: any) => output.push(JSON.stringify(data, null, 2)),
    },
    JSON,
    Math,
    Date,
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
    result: null as any, // Agent can set this as the return value
  };

  const context = vm.createContext(sandbox);

  try {
    // Wrap code to capture the last expression as result
    const wrappedCode = `
      try {
        ${code}
      } catch(e) {
        console.log("ERROR: " + e.message);
      }
    `;

    vm.runInContext(wrappedCode, context, {
      timeout: SANDBOX_TIMEOUT_MS,
      filename: "analysis.js",
    });

    // Build output
    let finalOutput = output.join("\n");

    // If agent set result explicitly, use that
    if (sandbox.result !== null && sandbox.result !== undefined) {
      const resultStr = typeof sandbox.result === "object"
        ? JSON.stringify(sandbox.result, null, 2)
        : String(sandbox.result);
      finalOutput = finalOutput ? `${finalOutput}\n\nRESULT:\n${resultStr}` : resultStr;
    }

    if (!finalOutput.trim()) {
      finalOutput = "(No output. Use console.log() or set `result = ...` to return data.)";
    }

    // Truncate if too long
    if (finalOutput.length > MAX_OUTPUT_LENGTH) {
      finalOutput = finalOutput.slice(0, MAX_OUTPUT_LENGTH) + "\n\n...(truncated)";
    }

    return finalOutput;
  } catch (err: any) {
    if (err.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
      return "ERROR: Code execution timed out (15s limit). Simplify your analysis.";
    }
    return `ERROR: ${err.message}`;
  }
}

// ── The tool ──
export const runAnalysisTool = tool(
  async ({ code, goal }) => {
    console.log(`  [Sandbox] Running analysis: ${goal}`);
    const startTime = Date.now();
    const output = executeInSandbox(code);
    const elapsed = Date.now() - startTime;
    console.log(`  [Sandbox] Done in ${elapsed}ms (${output.length} chars)`);
    return output;
  },
  {
    name: "run_analysis",
    description: `Execute JavaScript code in a sandboxed environment with full access to EMO's data. Use this for complex analysis that can't be done with query_collection or aggregate_data — correlations, multi-step calculations, trends, cross-tabulations, custom aggregations.

AVAILABLE IN SANDBOX:
- vehicles[], deployments[], complaints[], batteryComplaints[], returns[], rentals[] — full MongoDB data arrays
- today (string "YYYY-MM-DD"), now (ISO string)
- parseDate(val) — parses EMO date formats ("M/D/YYYY h:mm am/pm") into Date objects
- filterByDate(docs, dateField, from, to?) — filter docs by date range
- groupBy(docs, field) — returns {value: count} object
- sum(docs, field) — sum a numeric field
- avg(docs, field) — average a numeric field
- unique(docs, field) — unique values array
- topN(docs, field, n) — top N values by count
- crossTab(docs, field1, field2) — cross-tabulation matrix
- trend(docs, dateField, "day"|"week"|"month") — time series counts
- console.log() to output results
- Set result = value to return structured data

EXAMPLE:
const active = vehicles.filter(v => v.Status === "Active");
const byLocation = groupBy(active, "Location");
const rentByLocation = {};
for (const loc of Object.keys(byLocation)) {
  const locRentals = rentals.filter(r => r.Location === loc && r.Status === "Active");
  rentByLocation[loc] = { vehicles: byLocation[loc], rentals: locRentals.length, totalRent: sum(locRentals, "Rent Amount") };
}
result = rentByLocation;`,
    schema: z.object({
      goal: z.string().describe("Brief description of what the analysis aims to find"),
      code: z.string().describe("JavaScript code to execute. Use console.log() for output or set result = value."),
    }),
  }
);
