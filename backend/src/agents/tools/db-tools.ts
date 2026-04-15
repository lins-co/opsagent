import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getMongoData,
  queryMongo,
  aggregateMongo,
  type DirectCollection,
} from "../../db/connectors/mongodb.js";
import type { Document } from "mongodb";
import { smartExport } from "../../lib/csv-export.js";

// ══════════════════════════════════════════════════════════════════
// EMO date parsing — handles "M/D/YYYY h:mm am/pm" and ISO.
// ══════════════════════════════════════════════════════════════════
function parseEmoDate(raw: any): Date | null {
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
    const m = parseInt(minutes || "0");
    const s = parseInt(seconds || "0");
    if (ampm) {
      if (ampm.toLowerCase() === "pm" && h < 12) h += 12;
      if (ampm.toLowerCase() === "am" && h === 12) h = 0;
    }
    return new Date(parseInt(year), parseInt(month) - 1, parseInt(day), h, m, s);
  }
  return null;
}

function matchesDateFilter(doc: any, dateField: string, dateFrom?: string, dateTo?: string): boolean {
  if (!dateFrom && !dateTo) return true;
  const dt = parseEmoDate(doc[dateField]);
  if (!dt) return false;
  if (dateFrom && dt < new Date(dateFrom + "T00:00:00")) return false;
  if (dateTo && dt > new Date(dateTo + "T23:59:59")) return false;
  return true;
}

function matchesFilters(doc: any, filters: Record<string, string>): boolean {
  for (const [field, value] of Object.entries(filters)) {
    const docVal = doc[field];
    if (docVal === undefined || docVal === null) return false;
    if (!String(docVal).toLowerCase().includes(value.toLowerCase())) return false;
  }
  return true;
}

function coerceNumber(raw: any): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (typeof raw === "number") return isNaN(raw) ? null : raw;
  const num = parseFloat(String(raw).replace(/[₹,\s]/g, ""));
  return isNaN(num) ? null : num;
}

// ══════════════════════════════════════════════════════════════════
// Collection routing tables
// ══════════════════════════════════════════════════════════════════

// Hot cache (in-memory). Map tool-facing name → key on AppData.
const HOT_MAP: Record<string, string> = {
  vehicles: "Vehicletracker",
  complaints: "Newcomplaintresponses",
  battery_complaints: "Complaindatabase",
  deployments: "Deployementresponses",
  returns: "Vehiclereturnresponses",
  rentals: "Rentingdatabase",
  battery_telemetry: "BatteryInfo",
  chargers: "Charger",
  charger_tickets: "Chargerresponse",
  kazam_charger_tickets: "kazamdata",
  payment_links: "manuallinkgenerations",
  rent_links: "chatbotrent2",
};

// Direct-query (server-side). Map tool-facing name → real MongoDB name.
const DIRECT_MAP: Record<string, DirectCollection> = {
  payments: "Gencash",
  invoices: "zohobilling",
  factory_batteries: "Factorydatabase",
  rental_history: "HistoricalRentingdatabase",
};

// Fields that are REAL Date type in MongoDB — we can filter natively (fast, indexed).
// For string-date fields we fall back to JS post-filtering.
const NATIVE_DATE_FIELDS: Record<string, string[]> = {
  payments: ["receivedAt", "transactionDateTime"],
  invoices: ["transactionDateTime", "createdAt", "receivedAt"],
  factory_batteries: [],
  rental_history: ["UpdatedAt"],
};

const ESSENTIAL_FIELDS: Record<string, string[]> = {
  vehicles: ["Vehicle ID", "Status", "Location", "Model", "Vendor", "Rider Name", "Battery ID", "Last Active Date"],
  complaints: ["Ticket", "Vehicle ID", "Purpose of Form Fillup?", "Complaint Status", "Location", "Created Time", "Your Name"],
  battery_complaints: ["Ticket ID", "Vehicle ID/Chasis No", "Battery ID", "Issue", "Resolved Type", "Location", "Technician Name", "Created Time"],
  deployments: ["Vehicle ID", "Location", "Vendor", "Rider Name", "Rider Deployment Zone", "Battery Serial No", "Rent Start Date", "Created Time"],
  returns: ["Vehicle ID", "Location", "Reason of return", "Status", "Created Time", "Your Name"],
  rentals: ["Vehicle ID", "Rider Name", "Status", "Location", "Rent Amount", "Balance Amount", "Rent Start Date", "Rent Due Date", "Rent Status", "AmountStatus", "Perday_Collection_Amount", "Payment Weeks Paid", "Deposit Amount", "Active Days Current Month", "Model", "Vendor"],
  payments: ["txnId", "orderId", "amount", "status", "txnSource", "type", "receivedAt", "customerDetails", "invoiced", "vehicleId"],
  invoices: ["zohoInvoiceNumber", "zohoInvoiceStatus", "zohoInvoiceTotal", "Vehicle ID", "Rider Name", "amount", "txnSource", "status", "transactionDateTime", "taxBreakdown", "Location"],
  payment_links: ["orderId", "customerName", "customerPhone", "linkId", "paymentLink", "createdAt"],
  rent_links: ["Vehicle ID", "Rider Name", "Rider Contact No", "Rent Amount", "Location", "Rent Due Date", "orderId", "paymentLink", "createdatetime"],
  factory_batteries: ["Battery ID", "Status", "Location", "Dispatched", "Deployed City", "Dispatch Date", "Last Modified time", "Pack Type", "Frequency of Complaints", "Repair Count", "Replace Count", "Count of Issues raised"],
  battery_telemetry: ["batteryId", "bmsId", "imei", "mode", "status", "soc", "voltage"],
  chargers: ["Charger ID", "Status", "Location", "Address", "Issue", "Issue by ops", "Issue by kazam"],
  charger_tickets: ["Ticket ID", "Charger ID", "Location (City)", "Address", "Issue", "Details", "POC Name", "POC Phone Number", "Issue Resolved", "Resolved Timestamp", "Issue by kazam", "Created Time"],
  kazam_charger_tickets: ["Ticket ID", "Charger ID", "Location (City)", "Issue", "Issue Category", "Description", "Issue Resolved", "Resolved Timestamp", "Created Time"],
  rental_history: ["Vehicle ID", "Rider Name", "Status", "Location", "Rent Amount", "Balance Amount", "Rent Start Date", "Return Date", "Total Active Days", "AmountStatus"],
};

const ALL_COLLECTIONS = [...Object.keys(HOT_MAP), ...Object.keys(DIRECT_MAP)] as const;
type CollectionName = (typeof ALL_COLLECTIONS)[number];

// ══════════════════════════════════════════════════════════════════
// Build a MongoDB filter from the user's simple string filters.
// - Case-insensitive regex match on string values (matches "delhi" to "Delhi")
// - Date fields that are real Date type get native $gte/$lte
// - Other filters pass through as exact / regex
// ══════════════════════════════════════════════════════════════════
function buildMongoFilter(
  collection: string,
  filters: Record<string, string> | undefined,
  dateField: string | undefined,
  dateFrom: string | undefined,
  dateTo: string | undefined,
): { mongoFilter: Record<string, any>; jsPostFilter?: (doc: any) => boolean } {
  const mongoFilter: Record<string, any> = {};
  const isNative = dateField && (NATIVE_DATE_FIELDS[collection] || []).includes(dateField);

  if (filters) {
    for (const [field, value] of Object.entries(filters)) {
      // Escape regex meta, then contains-match, case-insensitive.
      const safe = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      mongoFilter[field] = { $regex: safe, $options: "i" };
    }
  }

  if (dateField && (dateFrom || dateTo) && isNative) {
    const clause: Record<string, any> = {};
    if (dateFrom) clause.$gte = new Date(dateFrom + "T00:00:00");
    if (dateTo) clause.$lte = new Date(dateTo + "T23:59:59");
    mongoFilter[dateField] = clause;
    return { mongoFilter };
  }

  if (dateField && (dateFrom || dateTo)) {
    // String date field — fetch more docs and JS-filter.
    return {
      mongoFilter,
      jsPostFilter: (doc: any) => matchesDateFilter(doc, dateField, dateFrom, dateTo),
    };
  }

  return { mongoFilter };
}

// ══════════════════════════════════════════════════════════════════
// query_collection — unified path
// ══════════════════════════════════════════════════════════════════

export const queryCollectionTool = tool(
  async ({ collection, filters, dateField, dateFrom, dateTo, limit }) => {
    const coll = collection as string;
    let filtered: any[] = [];
    let total = 0;

    if (coll in HOT_MAP) {
      const data = getMongoData();
      if (!data) return JSON.stringify({ error: "Hot cache not loaded" });
      const docs = (data as any)[HOT_MAP[coll]] || [];
      filtered = docs;
      if (filters && Object.keys(filters).length > 0) {
        filtered = filtered.filter((d) => matchesFilters(d, filters as Record<string, string>));
      }
      if (dateField && (dateFrom || dateTo)) {
        filtered = filtered.filter((d) => matchesDateFilter(d, dateField, dateFrom, dateTo));
      }
      total = filtered.length;
    } else if (coll in DIRECT_MAP) {
      const { mongoFilter, jsPostFilter } = buildMongoFilter(coll, filters as any, dateField, dateFrom, dateTo);
      // Fetch enough docs to support post-filter + CSV export. Cap at 500.
      const fetchLimit = jsPostFilter ? 500 : Math.min(Math.max(limit || 50, 100), 500);
      const docs = await queryMongo(DIRECT_MAP[coll], mongoFilter, {
        limit: fetchLimit,
        sort: { _id: -1 },
      });
      filtered = jsPostFilter ? docs.filter(jsPostFilter) : docs;
      total = filtered.length;
    } else {
      return JSON.stringify({ error: `Unknown collection: ${coll}. Use: ${ALL_COLLECTIONS.join(", ")}` });
    }

    if (total === 0) return JSON.stringify({ total: 0, records: [] });

    const fields = ESSENTIAL_FIELDS[coll] || Object.keys(filtered[0] || {}).slice(0, 10);
    const compact = filtered.map((d) => {
      const row: Record<string, any> = {};
      for (const f of fields) {
        const v = (d as any)[f];
        // Flatten nested value-wrapped objects like {"":"KA50EN3807"}.
        if (v && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
          const keys = Object.keys(v);
          if (keys.length === 1 && keys[0] === "") row[f] = (v as any)[""];
          else row[f] = JSON.stringify(v).slice(0, 200);
        } else {
          row[f] = v ?? "";
        }
      }
      return row;
    });

    const result = smartExport(compact, `${coll}_query`, 15);
    if (result.mode === "inline") {
      return JSON.stringify({ total, records: result.records });
    } else {
      return JSON.stringify({
        total,
        csvDownload: result.export.downloadUrl,
        csvFile: result.export.fileName,
        sample: result.sample,
        note: `${total} records exported to CSV. Show sample table and provide download link: [Download CSV](${result.export.downloadUrl})`,
      });
    }
  },
  {
    name: "query_collection",
    description: `Query EMO's MongoDB with flexible filters. Filters are case-insensitive contains-matches.

OPS: vehicles, complaints, battery_complaints, deployments, returns, rentals, rental_history.
FINANCE: payments (Gencash), invoices (zohobilling), payment_links, rent_links.
ASSETS: factory_batteries (Factorydatabase), battery_telemetry, chargers, charger_tickets, kazam_charger_tickets.

KEY FIELDS & ENUMS:
- payments: "status" ("SUCCESS"|"FAILED"), "txnSource" ("Rent"|"DeploymentRent"|"Deposit"), "type" ("PAYIN"), "amount" (number), "customerDetails.customerMobile" (string), "vehicleId", "orderId". Prefer "receivedAt" for date filters.
- invoices: "zohoInvoiceStatus" ("sent"|"paid"|"overdue"), "zohoInvoiceTotal" (number), "Vehicle ID", "Rider Name", "Location", "taxBreakdown.total". Prefer "transactionDateTime" for date filters.
- rentals: "Status" ("Active"|"Lock"|"Pending"), "Rent Status" ("Paid"|"Unpaid"), "AmountStatus" ("Collected"|"Failed"), "Balance Amount" (NEGATIVE = rider owes).
- factory_batteries: "Battery ID" (ZEAA*/ZEN-E*), "Status" ("New Sale"|"Pending"|"Rework"), "Frequency of Complaints", "Repair Count", "Replace Count". No reliable Date field — avoid date filters.
- battery_telemetry: "batteryId", "bmsId", "soc" (0-100), "voltage", "mode" ("Idle"|"Running"|"Unknown"), "status" ("in_use"|"available").
- vehicles: "Vehicle ID", "Status" ("Active"|"Under Maintenance"|"Accidental"|"Ready to Deploy"), "Location".

DATE FILTERS: pass dateField + dateFrom/dateTo (YYYY-MM-DD). For payments use "receivedAt"; for invoices use "transactionDateTime". Other collections use string dates (still work).`,
    schema: z.object({
      collection: z.enum(ALL_COLLECTIONS as any),
      filters: z.record(z.string(), z.string()).optional().describe('Field→value pairs, e.g. {"status":"SUCCESS","txnSource":"Rent"}'),
      dateField: z.string().optional(),
      dateFrom: z.string().optional().describe("Start date YYYY-MM-DD"),
      dateTo: z.string().optional().describe("End date YYYY-MM-DD"),
      limit: z.number().optional().default(50),
    }),
  },
);

// ══════════════════════════════════════════════════════════════════
// aggregate_data — unified path
// For direct collections, use a real $group pipeline (fast, indexed).
// For hot collections, keep JS path (zero network, already in RAM).
// ══════════════════════════════════════════════════════════════════

export const aggregateDataTool = tool(
  async ({ collection, groupBy, operation, filters, dateField, dateFrom, dateTo, sumField }) => {
    const coll = collection as string;

    // ─────── Direct path (MongoDB pipeline) ───────
    if (coll in DIRECT_MAP) {
      const { mongoFilter, jsPostFilter } = buildMongoFilter(coll, filters as any, dateField, dateFrom, dateTo);

      // If we need a JS post-filter (string-date field), fetch matching docs and compute in JS.
      if (jsPostFilter) {
        const docs = await queryMongo(DIRECT_MAP[coll], mongoFilter, { limit: 500 });
        const kept = docs.filter(jsPostFilter);
        return JSON.stringify(computeAggregateInJs(kept, operation, groupBy, sumField));
      }

      const pipeline: any[] = [];
      if (Object.keys(mongoFilter).length > 0) pipeline.push({ $match: mongoFilter });

      if (operation === "count") {
        if (groupBy) {
          pipeline.push({ $group: { _id: `$${groupBy}`, count: { $sum: 1 } } });
          pipeline.push({ $sort: { count: -1 } });
          pipeline.push({ $limit: 50 });
          const rows = await aggregateMongo(DIRECT_MAP[coll], pipeline);
          return JSON.stringify({
            totalGroups: rows.length,
            groupBy,
            breakdown: rows.map((r) => ({ [groupBy!]: r._id ?? "Unknown", count: r.count })),
          });
        }
        pipeline.push({ $count: "total" });
        const rows = await aggregateMongo(DIRECT_MAP[coll], pipeline);
        return JSON.stringify({ total: rows[0]?.total || 0 });
      }

      if (operation === "sum" && sumField) {
        // Coerce numeric-or-string values with $convert to preserve accuracy.
        const numExpr = { $convert: { input: `$${sumField}`, to: "double", onError: 0, onNull: 0 } };
        if (groupBy) {
          pipeline.push({
            $group: {
              _id: `$${groupBy}`,
              total: { $sum: numExpr },
              count: { $sum: 1 },
            },
          });
          pipeline.push({ $sort: { total: -1 } });
          pipeline.push({ $limit: 50 });
          const rows = await aggregateMongo(DIRECT_MAP[coll], pipeline);
          const grand = rows.reduce((a, r) => a + (r.total || 0), 0);
          return JSON.stringify({
            total: Math.round(grand * 100) / 100,
            breakdown: rows.map((r) => ({
              [groupBy!]: r._id ?? "Unknown",
              total: Math.round(r.total * 100) / 100,
              count: r.count,
            })),
          });
        }
        pipeline.push({
          $group: { _id: null, total: { $sum: numExpr }, count: { $sum: 1 } },
        });
        const rows = await aggregateMongo(DIRECT_MAP[coll], pipeline);
        const r = rows[0] || { total: 0, count: 0 };
        return JSON.stringify({ total: Math.round(r.total * 100) / 100, recordsWithValue: r.count });
      }

      if (operation === "avg" && sumField) {
        const numExpr = { $convert: { input: `$${sumField}`, to: "double", onError: null, onNull: null } };
        pipeline.push({
          $group: {
            _id: groupBy ? `$${groupBy}` : null,
            average: { $avg: numExpr },
            count: { $sum: 1 },
          },
        });
        const rows = await aggregateMongo(DIRECT_MAP[coll], pipeline);
        if (groupBy) {
          return JSON.stringify({
            breakdown: rows.map((r) => ({
              [groupBy!]: r._id ?? "Unknown",
              average: r.average ? Math.round(r.average * 100) / 100 : 0,
              count: r.count,
            })),
          });
        }
        const r = rows[0] || { average: 0, count: 0 };
        return JSON.stringify({ average: r.average ? Math.round(r.average * 100) / 100 : 0, recordsWithValue: r.count });
      }

      if (operation === "unique" && groupBy) {
        pipeline.push({ $group: { _id: `$${groupBy}` } });
        pipeline.push({ $limit: 200 });
        const rows = await aggregateMongo(DIRECT_MAP[coll], pipeline);
        const values = rows.map((r) => r._id).filter((v) => v !== null && v !== undefined);
        return JSON.stringify({ field: groupBy, uniqueCount: values.length, values: values.slice(0, 50) });
      }

      return JSON.stringify({ error: `Operation ${operation} not supported for direct collection` });
    }

    // ─────── Hot cache path (JS) ───────
    if (!(coll in HOT_MAP)) return JSON.stringify({ error: `Unknown collection: ${coll}` });

    const data = getMongoData();
    if (!data) return JSON.stringify({ error: "Data not loaded" });

    let docs = (data as any)[HOT_MAP[coll]] as any[];
    if (!docs) return JSON.stringify({ error: "Collection missing" });

    if (filters && Object.keys(filters).length > 0) {
      docs = docs.filter((d) => matchesFilters(d, filters as Record<string, string>));
    }
    if (dateField && (dateFrom || dateTo)) {
      docs = docs.filter((d) => matchesDateFilter(d, dateField, dateFrom, dateTo));
    }
    return JSON.stringify(computeAggregateInJs(docs, operation, groupBy, sumField));
  },
  {
    name: "aggregate_data",
    description: `Count, sum, average, or unique values with optional groupBy. Runs server-side via MongoDB pipelines for large collections (payments, invoices, factory_batteries, rental_history).

RECIPES:
- TOTAL COLLECTED TODAY: collection="payments", operation="sum", sumField="amount", filters={"status":"SUCCESS"}, dateField="receivedAt", dateFrom=today, dateTo=today
- COLLECTIONS BY SOURCE THIS MONTH: collection="payments", operation="sum", sumField="amount", groupBy="txnSource", filters={"status":"SUCCESS"}, dateField="receivedAt", dateFrom=first-of-month
- FAILED TXNS TODAY: collection="payments", operation="count", filters={"status":"FAILED"}, dateField="receivedAt", dateFrom=today, dateTo=today
- TOTAL OUTSTANDING RENT (rider owes): collection="rentals", operation="sum", sumField="Balance Amount" (negative value → rider owes)
- UNPAID INVOICES COUNT: collection="invoices", operation="count", filters={"zohoInvoiceStatus":"sent"}
- REVENUE BY LOCATION: collection="invoices", operation="sum", sumField="zohoInvoiceTotal", groupBy="Location"
- BATTERIES BY STATUS: collection="factory_batteries", operation="count", groupBy="Status"
- TOP PROBLEM BATTERIES: collection="factory_batteries", operation="sum", sumField="Frequency of Complaints", groupBy="Battery ID"
- PAYMENTS FOR A RIDER: collection="payments", filters={"customerDetails.customerMobile":"<phone>"}

NUMERIC FIELDS: payments.amount, invoices.zohoInvoiceTotal, rentals.{Rent Amount, Balance Amount, Deposit Amount}, factory_batteries.{Frequency of Complaints, Repair Count, Replace Count}, battery_telemetry.{soc, voltage}.`,
    schema: z.object({
      collection: z.enum(ALL_COLLECTIONS as any),
      operation: z.enum(["count", "unique", "sum", "avg"]),
      groupBy: z.string().optional(),
      sumField: z.string().optional(),
      filters: z.record(z.string(), z.string()).optional(),
      dateField: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  },
);

function computeAggregateInJs(
  docs: any[],
  operation: string,
  groupBy: string | undefined,
  sumField: string | undefined,
): any {
  if (operation === "count") {
    if (groupBy) {
      const counts: Record<string, number> = {};
      for (const d of docs) {
        const key = String(d[groupBy] ?? "Unknown");
        counts[key] = (counts[key] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      return { total: docs.length, groupBy, breakdown: sorted.slice(0, 50).map(([k, v]) => ({ [groupBy]: k, count: v })) };
    }
    return { total: docs.length };
  }

  if (operation === "unique") {
    const values = [...new Set(docs.map((d) => d[groupBy!]).filter((v) => v !== null && v !== undefined && v !== ""))];
    return { field: groupBy, uniqueCount: values.length, values: values.slice(0, 50) };
  }

  if (operation === "sum" && sumField) {
    let total = 0;
    let parsed = 0;
    const grouped: Record<string, number> = {};
    const groupedCount: Record<string, number> = {};
    for (const d of docs) {
      const num = coerceNumber(d[sumField]);
      if (num === null) continue;
      total += num;
      parsed++;
      if (groupBy) {
        const key = String(d[groupBy] ?? "Unknown");
        grouped[key] = (grouped[key] || 0) + num;
        groupedCount[key] = (groupedCount[key] || 0) + 1;
      }
    }
    const result: any = { total: Math.round(total * 100) / 100, recordsWithValue: parsed, totalRecords: docs.length };
    if (groupBy) {
      result.breakdown = Object.entries(grouped)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 50)
        .map(([k, v]) => ({ [groupBy]: k, total: Math.round(v * 100) / 100, count: groupedCount[k] }));
    }
    return result;
  }

  if (operation === "avg" && sumField) {
    let total = 0;
    let count = 0;
    for (const d of docs) {
      const num = coerceNumber(d[sumField]);
      if (num === null) continue;
      total += num;
      count++;
    }
    return { average: count > 0 ? Math.round((total / count) * 100) / 100 : 0, recordsWithValue: count, totalRecords: docs.length };
  }

  return { total: docs.length };
}

import { whatsappTools } from "./whatsapp-tools.js";
import { runAnalysisTool } from "./sandbox.js";
import { memoryTools } from "./memory-tools.js";

export const dbTools = [queryCollectionTool, aggregateDataTool];
export const allTools = [...dbTools, ...whatsappTools, ...memoryTools, runAnalysisTool];

export async function executeTool(name: string, args: any): Promise<string> {
  const toolMap: Record<string, any> = {};
  for (const t of allTools) toolMap[t.name] = t;
  const tool = toolMap[name];
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
  const result = await tool.invoke(args);
  return typeof result === "string" ? result : JSON.stringify(result);
}
