import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import type { Document } from "mongodb";
import type { AppData } from "../db/mongo.js";
import { buildDataContext } from "./schema.js";

// ---- Provider detection ----

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

type Provider = "anthropic" | "gemini";

function detectProvider(): Provider {
  if (ANTHROPIC_KEY && ANTHROPIC_KEY !== "your-anthropic-api-key-here") return "anthropic";
  if (GEMINI_KEY && GEMINI_KEY !== "your-gemini-api-key-here") return "gemini";
  throw new Error("No API key configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY in .env");
}

const PROVIDER = detectProvider();
console.log(`  [llm] Using provider: ${PROVIDER}`);

// ---- Token-efficient system prompt ----

let cachedDataContext: string | null = null;
let cachedDataLoadedAt: Date | null = null;

function getSystemPrompt(data: AppData): string {
  if (!cachedDataContext || cachedDataLoadedAt !== data.loadedAt) {
    cachedDataContext = buildDataContext(data as any);
    cachedDataLoadedAt = data.loadedAt;
  }
  const today = new Date().toISOString().split("T")[0];
  return [
    `EV fleet ops agent. Use tools to query data. Be concise. Markdown tables for results. Today: ${today}`,
    `All tools support date filtering: pass date_field (e.g. "Created Time"), date_from, date_to as YYYY-MM-DD.`,
    `aggregate_data supports: count, group_by, unique_values, sum, avg. Use sum_field for sum/avg.`,
    `For rent/payment totals: use aggregate_data with collection="Rentingdatabase", operation="sum", sum_field="Collections". This auto-parses nested payment entries and filters by date_from/date_to. Do NOT pass date_field for Collections sums.`,
    `Perday_Collection_Amount is a simple numeric field (per-day rate). Rent Amount is the weekly rent. Balance Amount is outstanding balance.`,
    cachedDataContext,
  ].join("\n");
}

// ---- Session management with TTL ----

const SESSION_TTL_MS = 30 * 60 * 1000;
const MAX_SESSIONS = 50;

interface SessionEntry<T> {
  data: T;
  lastAccess: number;
}

class SessionStore<T> {
  private store = new Map<string, SessionEntry<T>>();

  get(id: string): T | undefined {
    const entry = this.store.get(id);
    if (!entry) return undefined;
    entry.lastAccess = Date.now();
    return entry.data;
  }

  set(id: string, data: T): void {
    if (this.store.size >= MAX_SESSIONS && !this.store.has(id)) {
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, entry] of this.store) {
        if (entry.lastAccess < oldestTime) {
          oldestTime = entry.lastAccess;
          oldestKey = key;
        }
      }
      if (oldestKey) this.store.delete(oldestKey);
    }
    this.store.set(id, { data, lastAccess: Date.now() });
  }

  delete(id: string): void {
    this.store.delete(id);
  }

  cleanup(): number {
    const now = Date.now();
    let removed = 0;
    for (const [key, entry] of this.store) {
      if (now - entry.lastAccess > SESSION_TTL_MS) {
        this.store.delete(key);
        removed++;
      }
    }
    return removed;
  }

  get size(): number {
    return this.store.size;
  }
}

// ---- Date parsing (for tool date filters) ----

function parseDocDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  const s = String(val).trim();
  if (!s) return null;

  // Handle "M/D/YYYY, h:mm[:ss] am/pm" or "M/D/YYYY h:mm[:ss]am/pm"
  const mdyTime = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (mdyTime) {
    const [, month, day, year, rawHour, min, sec, ampm] = mdyTime;
    let hour = parseInt(rawHour!, 10);
    if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
    if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
    return new Date(parseInt(year!, 10), parseInt(month!, 10) - 1, parseInt(day!, 10), hour, parseInt(min!, 10), sec ? parseInt(sec, 10) : 0);
  }

  // Handle "M/D/YYYY"
  const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return new Date(parseInt(mdy[3]!, 10), parseInt(mdy[1]!, 10) - 1, parseInt(mdy[2]!, 10));
  }

  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// ---- Tool execution ----

const MAX_TOOL_ITERATIONS = 5;
const TOOL_RESULT_LIMIT = 10;
const MAX_STRING_LEN = 100;

// Essential fields per collection (sent to LLM in tool results)
const ESSENTIAL_FIELDS: Record<string, string[]> = {
  Vehicletracker: ["Vehicle ID", "Status", "Location", "Vendor", "Rider Name", "Rider Contact No", "Model"],
  Newcomplaintresponses: ["Vehicle ID", "Ticket", "Location", "Complaint Status", "Purpose of Form Fillup?", "Your Name", "Created Time", "Comments (if any)"],
  Vehiclereturnresponses: ["Vehicle ID", "Ticket", "Location", "Reason of return", "Your Name", "Created Time"],
  Deployementresponses: ["Vehicle ID", "Location", "Your Name", "Created Time", "Rider Deployment Zone", "Battery Serial No", "Rent Start Date"],
  Rentingdatabase: ["Vehicle ID", "Location", "Rider Name", "Rent Amount", "Rent Due Date", "AmountStatus", "Status", "Perday_Collection_Amount", "Prepaid_Collection", "Last_Modified_Time", "Locked DateTime", "Balance Amount", "Rent Status"],
  Complaindatabase: ["Ticket ID", "Battery ID", "Vehicle ID", "Location", "Complain Status", "Issue", "Technician Name", "Created Time", "Resolved Type", "Resolved timestamp", "Solution", "Vendor", "Vehicle Type"],
};

function filterDocs(
  docs: Document[],
  filters: Record<string, string | undefined>,
): Document[] {
  let results = docs;
  for (const [field, value] of Object.entries(filters)) {
    if (!value) continue;
    results = results.filter((doc) => {
      const docVal = String(doc[field] || "");
      return docVal.toLowerCase().includes(value.toLowerCase());
    });
  }
  return results;
}

function filterByDateRange(
  docs: Document[],
  dateField: string,
  dateFrom?: string,
  dateTo?: string,
): Document[] {
  if (!dateField || (!dateFrom && !dateTo)) return docs;
  const from = dateFrom ? new Date(dateFrom + "T00:00:00") : null;
  const to = dateTo ? new Date(dateTo + "T23:59:59.999") : null;

  return docs.filter((doc) => {
    const dt = parseDocDate(doc[dateField]);
    if (!dt) return false;
    if (from && dt < from) return false;
    if (to && dt > to) return false;
    return true;
  });
}

function cleanDoc(doc: Document, collectionName?: string): Record<string, any> {
  const essentials = collectionName ? ESSENTIAL_FIELDS[collectionName] : undefined;
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(doc)) {
    if (k === "_id") continue;
    if (v === null || v === undefined || v === "") continue;
    if (essentials && !essentials.includes(k)) continue;
    // Skip nested objects/arrays (e.g. Collections) to avoid token waste
    if (typeof v === "object" && !(v instanceof Date)) continue;
    if (typeof v === "string" && v.length > MAX_STRING_LEN) {
      clean[k] = v.slice(0, MAX_STRING_LEN) + "...";
    } else {
      clean[k] = v;
    }
  }
  return clean;
}

function executeTool(
  name: string,
  input: Record<string, any>,
  data: AppData
): string {
  const limit = Math.min(input.limit || TOOL_RESULT_LIMIT, TOOL_RESULT_LIMIT);

  // Common date filter applied to any tool
  const applyDateFilter = (docs: Document[]): Document[] => {
    if (input.date_field && (input.date_from || input.date_to)) {
      return filterByDateRange(docs, input.date_field, input.date_from, input.date_to);
    }
    return docs;
  };

  try {
    switch (name) {
      case "query_vehicles": {
        let all = filterDocs(data.Vehicletracker, {
          "Vehicle ID": input.vehicle_id, Status: input.status,
          Location: input.location, Vendor: input.vendor,
        });
        all = applyDateFilter(all);
        return JSON.stringify({
          total: all.length,
          records: all.slice(0, limit).map(d => cleanDoc(d, "Vehicletracker")),
        });
      }
      case "query_complaints": {
        let all = filterDocs(data.Newcomplaintresponses, {
          "Vehicle ID": input.vehicle_id, "Complaint Status": input.status,
          "Purpose of Form Fillup?": input.purpose, Location: input.location,
          "Your Name": input.operator_name,
        });
        all = applyDateFilter(all);
        return JSON.stringify({
          total: all.length,
          records: all.slice(0, limit).map(d => cleanDoc(d, "Newcomplaintresponses")),
        });
      }
      case "query_returns": {
        let all = filterDocs(data.Vehiclereturnresponses, {
          "Vehicle ID": input.vehicle_id, Location: input.location,
          "Reason of return": input.reason,
        });
        all = applyDateFilter(all);
        return JSON.stringify({
          total: all.length,
          records: all.slice(0, limit).map(d => cleanDoc(d, "Vehiclereturnresponses")),
        });
      }
      case "query_deployments": {
        let all = filterDocs(data.Deployementresponses, {
          "Vehicle ID": input.vehicle_id, Location: input.location,
          "Your Name": input.operator_name,
        });
        all = applyDateFilter(all);
        return JSON.stringify({
          total: all.length,
          records: all.slice(0, limit).map(d => cleanDoc(d, "Deployementresponses")),
        });
      }
      case "query_rentals": {
        let docs = filterDocs(data.Rentingdatabase, {
          "Vehicle ID": input.vehicle_id,
          Location: input.location,
          AmountStatus: input.amount_status,
          Status: input.status,
        });
        if (input.overdue_only) {
          const now = new Date();
          docs = docs.filter((d) => {
            const due = d["Rent Due Date"];
            if (!due) return false;
            const dueDate = new Date(String(due));
            return !isNaN(dueDate.getTime()) && dueDate < now;
          });
        }
        docs = applyDateFilter(docs);
        return JSON.stringify({
          total: docs.length,
          records: docs.slice(0, limit).map(d => cleanDoc(d, "Rentingdatabase")),
        });
      }
      case "query_battery_complaints": {
        let all = filterDocs(data.Complaindatabase, {
          "Vehicle ID": input.vehicle_id, "Battery ID": input.battery_id,
          "Complain Status": input.status, "Technician Name": input.technician,
          Issue: input.issue, Vendor: input.vendor, "Vehicle Type": input.vehicle_type,
          "Resolved Type": input.resolved_type,
        });
        all = applyDateFilter(all);
        return JSON.stringify({
          total: all.length,
          records: all.slice(0, limit).map(d => cleanDoc(d, "Complaindatabase")),
        });
      }
      case "aggregate_data": {
        const VALID_COLLECTIONS = [
          "Vehicletracker", "Newcomplaintresponses", "Vehiclereturnresponses",
          "Deployementresponses", "Rentingdatabase", "Complaindatabase",
        ] as const;
        if (!VALID_COLLECTIONS.includes(input.collection)) {
          return JSON.stringify({ error: `Unknown collection: ${input.collection}` });
        }
        const collection = (data as any)[input.collection] as Document[];
        let docs = collection;

        // Field value filter
        if (input.filter_field && input.filter_value) {
          docs = docs.filter((d) =>
            String(d[input.filter_field] || "").toLowerCase().includes(input.filter_value.toLowerCase())
          );
        }

        // Date range filter — skip for Collections sum (date filter applied at payment entry level)
        const isCollectionsSum = (input.operation === "sum" || input.operation === "avg")
          && input.sum_field === "Collections" && input.collection === "Rentingdatabase";
        if (!isCollectionsSum) {
          docs = applyDateFilter(docs);
        }

        if (input.operation === "count") {
          return JSON.stringify({ count: docs.length });
        }
        if (input.operation === "group_by") {
          if (!input.field) return JSON.stringify({ error: "field required" });
          const groups: Record<string, number> = {};
          for (const doc of docs) {
            const key = String(doc[input.field] || "(empty)");
            groups[key] = (groups[key] || 0) + 1;
          }
          return JSON.stringify(
            Object.fromEntries(Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 20))
          );
        }
        if (input.operation === "unique_values") {
          if (!input.field) return JSON.stringify({ error: "field required" });
          const unique = [...new Set(docs.map((d) => String(d[input.field] || "")).filter(Boolean))];
          return JSON.stringify({ count: unique.length, values: unique.slice(0, 30) });
        }
        if (input.operation === "sum" || input.operation === "avg") {
          if (!input.sum_field) return JSON.stringify({ error: "sum_field required" });

          // Special handling: Collections is a nested payment object, not a number
          if (input.sum_field === "Collections" && input.collection === "Rentingdatabase") {
            let total = 0;
            let paymentCount = 0;
            const from = input.date_from ? new Date(input.date_from + "T00:00:00") : null;
            const to = input.date_to ? new Date(input.date_to + "T23:59:59.999") : null;

            for (const doc of docs) {
              const collections = doc["Collections"];
              if (!collections || typeof collections !== "object") continue;
              for (const month of Object.values(collections as Record<string, any>)) {
                if (!month || typeof month !== "object") continue;
                for (const week of Object.values(month as Record<string, any>)) {
                  if (!Array.isArray(week)) continue;
                  for (const entry of week) {
                    if (!entry || typeof entry !== "object") continue;
                    const amt = Number(entry.amount);
                    if (isNaN(amt)) continue;
                    if (from || to) {
                      const dt = parseDocDate(entry.date);
                      if (!dt) continue;
                      if (from && dt < from) continue;
                      if (to && dt > to) continue;
                    }
                    total += amt;
                    paymentCount++;
                  }
                }
              }
            }
            if (input.operation === "avg") {
              const avg = paymentCount > 0 ? total / paymentCount : 0;
              return JSON.stringify({ avg: Math.round(avg * 100) / 100, sum: total, count: paymentCount });
            }
            return JSON.stringify({ sum: total, count: paymentCount, total_records: docs.length });
          }

          // Standard numeric field sum/avg
          let total = 0;
          let validCount = 0;
          for (const doc of docs) {
            const val = Number(doc[input.sum_field]);
            if (!isNaN(val)) { total += val; validCount++; }
          }
          if (input.operation === "avg") {
            const avg = validCount > 0 ? total / validCount : 0;
            return JSON.stringify({ avg: Math.round(avg * 100) / 100, sum: total, count: validCount });
          }
          return JSON.stringify({ sum: total, count: validCount, total_records: docs.length });
        }
        return JSON.stringify({ error: "Unknown operation. Use: count, group_by, unique_values, sum, avg" });
      }
      default:
        return JSON.stringify({ error: `Unknown tool: ${name}` });
    }
  } catch (err: any) {
    console.error(`  [tool-error] ${name}: ${err.message}`);
    return JSON.stringify({ error: `Tool execution failed: ${err.message}` });
  }
}

// ==============================
// TOOL DEFINITIONS (shared schema)
// ==============================

// Common date filter params for all tools
const DATE_FILTER_PROPS_ANTHROPIC = {
  date_field: { type: "string" as const, description: "Field name to filter by date (e.g. Created Time, Rent Due Date, Last_Modified_Time, Locked DateTime, Resolved timestamp)" },
  date_from: { type: "string" as const, description: "Start date YYYY-MM-DD inclusive" },
  date_to: { type: "string" as const, description: "End date YYYY-MM-DD inclusive" },
};

const DATE_FILTER_PROPS_GEMINI: Record<string, any> = {
  date_field: { type: SchemaType.STRING, description: "Field name to filter by date" },
  date_from: { type: SchemaType.STRING, description: "Start date YYYY-MM-DD" },
  date_to: { type: SchemaType.STRING, description: "End date YYYY-MM-DD" },
};

const anthropicTools: Anthropic.Messages.Tool[] = [
  {
    name: "query_vehicles",
    description: "Search Vehicletracker. Fields: Vehicle ID, Status, Location, Vendor, Rider Name, Rider Contact No, Model.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" },
        status: { type: "string", description: "Active|Under Maintenance|Ready to Deploy|Accidental|Locked|Recovered" },
        location: { type: "string" },
        vendor: { type: "string" },
        ...DATE_FILTER_PROPS_ANTHROPIC,
      },
      required: [],
    },
  },
  {
    name: "query_complaints",
    description: "Search Newcomplaintresponses. Fields: Vehicle ID, Ticket, Location, Complaint Status, Purpose of Form Fillup?, Your Name, Created Time.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, status: { type: "string" },
        purpose: { type: "string", description: "New Complaint|Resolve Complaint" },
        location: { type: "string" }, operator_name: { type: "string" },
        ...DATE_FILTER_PROPS_ANTHROPIC,
      },
      required: [],
    },
  },
  {
    name: "query_returns",
    description: "Search Vehiclereturnresponses. Fields: Vehicle ID, Ticket, Location, Reason of return, Your Name, Created Time.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, location: { type: "string" },
        reason: { type: "string" },
        ...DATE_FILTER_PROPS_ANTHROPIC,
      },
      required: [],
    },
  },
  {
    name: "query_deployments",
    description: "Search Deployementresponses. Fields: Vehicle ID, Location, Your Name, Created Time, Rider Deployment Zone, Battery Serial No, Rent Start Date.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, location: { type: "string" },
        operator_name: { type: "string" },
        ...DATE_FILTER_PROPS_ANTHROPIC,
      },
      required: [],
    },
  },
  {
    name: "query_rentals",
    description: "Search Rentingdatabase. Fields: Vehicle ID, Location, Rider Name, Rent Amount, Rent Due Date, AmountStatus, Status, Collections, Perday_Collection_Amount, Prepaid_Collection, Last_Modified_Time.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" },
        location: { type: "string" },
        amount_status: { type: "string", description: "Filter by AmountStatus" },
        status: { type: "string", description: "Filter by Status (e.g. Lock)" },
        overdue_only: { type: "boolean" },
        ...DATE_FILTER_PROPS_ANTHROPIC,
      },
      required: [],
    },
  },
  {
    name: "query_battery_complaints",
    description: "Search Complaindatabase. Fields: Ticket ID, Battery ID, Vehicle ID, Location, Complain Status (Resolved|Pending), Issue, Technician Name, Created Time, Resolved Type (Repair|Replace), Solution, Vendor, Vehicle Type.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, battery_id: { type: "string" },
        status: { type: "string", description: "Complain Status: Resolved or Pending" },
        technician: { type: "string" },
        issue: { type: "string" },
        vendor: { type: "string" },
        vehicle_type: { type: "string" },
        resolved_type: { type: "string", description: "Repair or Replace" },
        ...DATE_FILTER_PROPS_ANTHROPIC,
      },
      required: [],
    },
  },
  {
    name: "aggregate_data",
    description: "Aggregate any collection. Operations: count, group_by (field required), unique_values (field required), sum (sum_field required), avg (sum_field required). Supports filter_field+filter_value and date range filtering.",
    input_schema: {
      type: "object" as const,
      properties: {
        collection: { type: "string", enum: ["Vehicletracker", "Newcomplaintresponses", "Vehiclereturnresponses", "Deployementresponses", "Rentingdatabase", "Complaindatabase"] },
        operation: { type: "string", enum: ["count", "group_by", "unique_values", "sum", "avg"] },
        field: { type: "string", description: "Field for group_by or unique_values" },
        sum_field: { type: "string", description: "Field to sum/avg. Numeric: Rent Amount, Perday_Collection_Amount, Balance Amount, Ticket closure time (in days). Special: Collections (nested payment object in Rentingdatabase — automatically parses entries and sums amounts, date filtering applies to payment dates)" },
        filter_field: { type: "string" }, filter_value: { type: "string" },
        ...DATE_FILTER_PROPS_ANTHROPIC,
      },
      required: ["collection", "operation"],
    },
  },
];

const geminiToolDeclarations: FunctionDeclaration[] = [
  {
    name: "query_vehicles",
    description: "Search Vehicletracker. Fields: Vehicle ID, Status, Location, Vendor, Rider Name, Rider Contact No, Model.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING },
        status: { type: SchemaType.STRING, description: "Active|Under Maintenance|Ready to Deploy|Accidental|Locked|Recovered" },
        location: { type: SchemaType.STRING },
        vendor: { type: SchemaType.STRING },
        ...DATE_FILTER_PROPS_GEMINI,
      },
    },
  },
  {
    name: "query_complaints",
    description: "Search Newcomplaintresponses. Fields: Vehicle ID, Ticket, Location, Complaint Status, Purpose of Form Fillup?, Your Name, Created Time.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, status: { type: SchemaType.STRING },
        purpose: { type: SchemaType.STRING, description: "New Complaint|Resolve Complaint" },
        location: { type: SchemaType.STRING }, operator_name: { type: SchemaType.STRING },
        ...DATE_FILTER_PROPS_GEMINI,
      },
    },
  },
  {
    name: "query_returns",
    description: "Search Vehiclereturnresponses. Fields: Vehicle ID, Ticket, Location, Reason of return, Your Name, Created Time.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, location: { type: SchemaType.STRING },
        reason: { type: SchemaType.STRING },
        ...DATE_FILTER_PROPS_GEMINI,
      },
    },
  },
  {
    name: "query_deployments",
    description: "Search Deployementresponses. Fields: Vehicle ID, Location, Your Name, Created Time, Rider Deployment Zone, Battery Serial No, Rent Start Date.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, location: { type: SchemaType.STRING },
        operator_name: { type: SchemaType.STRING },
        ...DATE_FILTER_PROPS_GEMINI,
      },
    },
  },
  {
    name: "query_rentals",
    description: "Search Rentingdatabase. Fields: Vehicle ID, Location, Rider Name, Rent Amount, Rent Due Date, AmountStatus, Status, Collections, Perday_Collection_Amount, Prepaid_Collection.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING },
        location: { type: SchemaType.STRING },
        amount_status: { type: SchemaType.STRING },
        status: { type: SchemaType.STRING },
        overdue_only: { type: SchemaType.BOOLEAN },
        ...DATE_FILTER_PROPS_GEMINI,
      },
    },
  },
  {
    name: "query_battery_complaints",
    description: "Search Complaindatabase. Fields: Ticket ID, Battery ID, Vehicle ID, Location, Complain Status, Issue, Technician Name, Created Time, Resolved Type, Solution, Vendor, Vehicle Type.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, battery_id: { type: SchemaType.STRING },
        status: { type: SchemaType.STRING }, technician: { type: SchemaType.STRING },
        issue: { type: SchemaType.STRING }, vendor: { type: SchemaType.STRING },
        vehicle_type: { type: SchemaType.STRING }, resolved_type: { type: SchemaType.STRING },
        ...DATE_FILTER_PROPS_GEMINI,
      },
    },
  },
  {
    name: "aggregate_data",
    description: "Aggregate any collection. Operations: count, group_by, unique_values, sum, avg. Supports date range + field filtering.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        collection: { type: SchemaType.STRING, description: "Collection name" },
        operation: { type: SchemaType.STRING, description: "count|group_by|unique_values|sum|avg" },
        field: { type: SchemaType.STRING, description: "For group_by/unique_values" },
        sum_field: { type: SchemaType.STRING, description: "Numeric field for sum/avg" },
        filter_field: { type: SchemaType.STRING },
        filter_value: { type: SchemaType.STRING },
        ...DATE_FILTER_PROPS_GEMINI,
      },
      required: ["collection", "operation"],
    },
  },
];

// ==============================
// RETRY & HISTORY
// ==============================

async function callWithRetry<T>(
  fn: () => Promise<T>,
  maxRetries = 2,
  label = "API"
): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.error?.type === "rate_limit_error"
        || err?.message?.includes("429") || err?.message?.includes("rate");
      if (!isRateLimit || attempt === maxRetries) throw err;
      const waitMs = 3000 * (attempt + 1); // 3s, 6s
      console.log(`  [rate-limit] ${label}: Waiting ${waitMs / 1000}s before retry ${attempt + 1}/${maxRetries}...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Unreachable");
}

// Per-provider timeout wrapper
const PROVIDER_TIMEOUT_MS = 90_000; // 90s per provider

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${PROVIDER_TIMEOUT_MS / 1000}s)`)), PROVIDER_TIMEOUT_MS)
    ),
  ]);
}

function trimAnthropicHistory(messages: Anthropic.Messages.MessageParam[]): Anthropic.Messages.MessageParam[] {
  if (messages.length <= 4) return messages;
  const keepIntact = 4;
  const trimmed: Anthropic.Messages.MessageParam[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]!;
    if (i < messages.length - keepIntact) {
      if (msg.role === "user" && Array.isArray(msg.content)) {
        const toolCount = (msg.content as any[]).filter((b: any) => b.type === "tool_result").length;
        if (toolCount > 0) {
          trimmed.push({ role: "user", content: `[${toolCount} tool result(s)]` });
          continue;
        }
      }
      if (msg.role === "assistant" && Array.isArray(msg.content)) {
        const textBlocks = (msg.content as any[]).filter((b: any) => b.type === "text");
        if (textBlocks.length > 0) {
          trimmed.push({ role: "assistant", content: textBlocks });
          continue;
        }
        trimmed.push({ role: "assistant", content: [{ type: "text" as const, text: "[tool calls]" }] });
        continue;
      }
    }
    trimmed.push(msg);
  }
  return trimmed;
}

// ==============================
// ANTHROPIC PROVIDER
// ==============================

const anthropicSessions = new SessionStore<Anthropic.Messages.MessageParam[]>();
const anthropicClient = ANTHROPIC_KEY ? new Anthropic() : null;

async function chatAnthropic(sessionId: string, userMessage: string, data: AppData): Promise<string> {
  if (!anthropicClient) throw new Error("Anthropic not configured");

  const messages = anthropicSessions.get(sessionId) || [];
  if (!anthropicSessions.get(sessionId)) anthropicSessions.set(sessionId, messages);

  const systemPrompt = getSystemPrompt(data);
  const snapshotLen = messages.length; // For rollback on failure
  messages.push({ role: "user", content: userMessage });

  const createMsg = (msgs: Anthropic.Messages.MessageParam[]) =>
    callWithRetry(
      () =>
        anthropicClient.messages.create({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 1024,
          system: systemPrompt,
          tools: anthropicTools,
          messages: msgs,
        }),
      2,
      "anthropic"
    );

  try {
    let response = await createMsg(messages);
    let toolIterations = 0;

    while (response.stop_reason === "tool_use" && toolIterations < MAX_TOOL_ITERATIONS) {
      toolIterations++;
      messages.push({ role: "assistant", content: response.content });
      const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
      for (const block of response.content) {
        if (block.type === "tool_use") {
          console.log(`  [tool] ${block.name}(${JSON.stringify(block.input)})`);
          toolResults.push({
            type: "tool_result",
            tool_use_id: block.id,
            content: executeTool(block.name, block.input as Record<string, any>, data),
          });
        }
      }
      messages.push({ role: "user", content: toolResults });
      response = await createMsg(messages);
    }

    const answer = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    messages.push({ role: "assistant", content: response.content });

    if (response.usage) {
      console.log(`  [tokens] in=${response.usage.input_tokens} out=${response.usage.output_tokens}`);
    }

    if (messages.length > 6) {
      anthropicSessions.set(sessionId, trimAnthropicHistory(messages.slice(-6)));
    }
    return answer;
  } catch (err) {
    // Rollback session to pre-request state to avoid corruption
    messages.length = snapshotLen;
    throw err;
  }
}

// ==============================
// GEMINI PROVIDER
// ==============================

const geminiSessions = new SessionStore<Array<{ role: string; parts: any[] }>>();
const geminiClient = GEMINI_KEY ? new GoogleGenerativeAI(GEMINI_KEY) : null;

async function chatGemini(sessionId: string, userMessage: string, data: AppData): Promise<string> {
  if (!geminiClient) throw new Error("Gemini not configured");
  const systemPrompt = getSystemPrompt(data);

  const model = geminiClient.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: systemPrompt,
    tools: [{ functionDeclarations: geminiToolDeclarations }],
  });

  const history = geminiSessions.get(sessionId) || [];
  const historySnapshot = [...history]; // For rollback on failure
  if (!geminiSessions.get(sessionId)) geminiSessions.set(sessionId, history);

  const chatSession = model.startChat({ history });

  try {
    let response = await callWithRetry(
      () => chatSession.sendMessage(userMessage),
      1,
      "gemini"
    );
    let result = response.response;

    let iterations = 0;
    while (iterations < MAX_TOOL_ITERATIONS) {
      iterations++;
      const calls = result.functionCalls();
      if (!calls || calls.length === 0) break;

      const functionResponses = calls.map((call) => {
        console.log(`  [tool] ${call.name}(${JSON.stringify(call.args)})`);
        const toolResult = executeTool(call.name, call.args as Record<string, any>, data);
        return {
          functionResponse: {
            name: call.name,
            response: JSON.parse(toolResult),
          },
        };
      });

      response = await callWithRetry(
        () => chatSession.sendMessage(functionResponses),
        1,
        "gemini"
      );
      result = response.response;
    }

    const answer = result.text();

    const updatedHistory = await chatSession.getHistory();
    geminiSessions.set(sessionId, updatedHistory.length > 10 ? updatedHistory.slice(-10) : updatedHistory);

    return answer;
  } catch (err) {
    // Rollback session to pre-request state to avoid corruption
    geminiSessions.set(sessionId, historySnapshot);
    throw err;
  }
}

// ==============================
// PUBLIC API
// ==============================

export async function chat(sessionId: string, userMessage: string, data: AppData): Promise<string> {
  const providers: Array<{ name: string; fn: () => Promise<string> }> = [];

  // Anthropic (Claude) is primary, Gemini is fallback
  if (ANTHROPIC_KEY && ANTHROPIC_KEY !== "your-anthropic-api-key-here") {
    providers.push({ name: "anthropic", fn: () => withTimeout(chatAnthropic(sessionId, userMessage, data), "anthropic") });
  }
  if (GEMINI_KEY && GEMINI_KEY !== "your-gemini-api-key-here") {
    providers.push({ name: "gemini", fn: () => withTimeout(chatGemini(sessionId, userMessage, data), "gemini") });
  }

  if (providers.length === 0) {
    return "No LLM provider configured. Please set ANTHROPIC_API_KEY or GEMINI_API_KEY in .env";
  }

  const errors: string[] = [];
  for (const provider of providers) {
    try {
      console.log(`  [llm] Trying ${provider.name}...`);
      return await provider.fn();
    } catch (err: any) {
      const msg = err.message?.slice(0, 100) || "Unknown error";
      console.log(`  [llm] ${provider.name} failed: ${msg}`);
      errors.push(`${provider.name}: ${msg}`);
    }
  }

  return `LLM providers unavailable. Please try again in a minute, or rephrase to match a known query pattern.`;
}

export function clearSession(sessionId: string) {
  anthropicSessions.delete(sessionId);
  geminiSessions.delete(sessionId);
}

export function cleanupSessions(): number {
  return anthropicSessions.cleanup() + geminiSessions.cleanup();
}
