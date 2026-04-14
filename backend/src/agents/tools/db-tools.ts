import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getMongoData } from "../../db/connectors/mongodb.js";
import { smartExport } from "../../lib/csv-export.js";

// ── Helper: parse EMO date formats ──
// Handles: "2/5/2025 12:53pm", "4/22/2025, 3:50pm", "6/8/2025", "M/D/YYYY h:mm am/pm"
function parseEmoDate(raw: any): Date | null {
  if (!raw) return null;
  if (raw instanceof Date) return raw;

  const str = String(raw).trim();
  if (!str) return null;

  // Try native parse first (works for ISO dates)
  const native = new Date(str);
  if (!isNaN(native.getTime()) && native.getFullYear() > 2000) return native;

  // Parse M/D/YYYY with optional time
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

// ── Helper: flexible date filter ──
function matchesDateFilter(doc: any, dateField: string, dateFrom?: string, dateTo?: string): boolean {
  if (!dateFrom && !dateTo) return true;
  const dt = parseEmoDate(doc[dateField]);
  if (!dt) return false;
  if (dateFrom) {
    const from = new Date(dateFrom + "T00:00:00");
    if (dt < from) return false;
  }
  if (dateTo) {
    const to = new Date(dateTo + "T23:59:59");
    if (dt > to) return false;
  }
  return true;
}

// ── Helper: flexible field filter ──
function matchesFilters(doc: any, filters: Record<string, string>): boolean {
  for (const [field, value] of Object.entries(filters)) {
    const docVal = doc[field];
    if (docVal === undefined || docVal === null) return false;
    if (!String(docVal).toLowerCase().includes(value.toLowerCase())) return false;
  }
  return true;
}

// ── Tool: Query any collection ──
export const queryCollectionTool = tool(
  async ({ collection, filters, dateField, dateFrom, dateTo, limit }) => {
    const data = getMongoData();
    if (!data) return JSON.stringify({ error: "Data not loaded" });

    const collectionMap: Record<string, any[]> = {
      vehicles: data.Vehicletracker || [],
      complaints: data.Newcomplaintresponses || [],
      battery_complaints: data.Complaindatabase || [],
      deployments: data.Deployementresponses || [],
      returns: data.Vehiclereturnresponses || [],
      rentals: data.Rentingdatabase || [],
    };

    const docs = collectionMap[collection];
    if (!docs) return JSON.stringify({ error: `Unknown collection: ${collection}. Use: ${Object.keys(collectionMap).join(", ")}` });

    let filtered = docs;

    // Apply field filters
    if (filters && Object.keys(filters).length > 0) {
      filtered = filtered.filter((d) => matchesFilters(d, filters as Record<string, string>));
    }

    // Apply date filter
    if (dateField && (dateFrom || dateTo)) {
      filtered = filtered.filter((d) => matchesDateFilter(d, dateField, dateFrom as string, dateTo as string));
    }

    const total = filtered.length;

    // Smart export — inline if small, CSV if large
    if (total === 0) return JSON.stringify({ total: 0, records: [] });

    // Pick essential fields only to save tokens
    const essentialFields: Record<string, string[]> = {
      vehicles: ["Vehicle ID", "Status", "Location", "Model", "Vendor", "Rider Name", "Battery ID", "Last Active Date"],
      complaints: ["Ticket", "Vehicle ID", "Purpose of Form Fillup?", "Complaint Status", "Location", "Created Time", "Your Name"],
      battery_complaints: ["Ticket ID", "Vehicle ID/Chasis No", "Battery ID", "Issue", "Resolved Type", "Location", "Technician Name", "Created Time"],
      deployments: ["Vehicle ID", "Location", "Vendor", "Rider Name", "Rider Deployment Zone", "Battery Serial No", "Rent Start Date", "Created Time"],
      returns: ["Vehicle ID", "Location", "Reason of return", "Status", "Created Time", "Your Name"],
      rentals: ["Vehicle ID", "Rider Name", "Status", "Location", "Rent Amount", "Balance Amount", "Rent Start Date", "Rent Due Date", "Rent Status", "AmountStatus", "Perday_Collection_Amount", "Payment Weeks Paid", "Deposit Amount", "Active Days Current Month", "Model", "Vendor"],
    };

    const fields = essentialFields[collection] || Object.keys(filtered[0] || {}).slice(0, 10);
    const compact = filtered.map((d) => {
      const row: Record<string, any> = {};
      for (const f of fields) { row[f] = d[f] ?? ""; }
      return row;
    });

    const result = smartExport(compact, `${collection}_query`, 15);

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
    description: `Query EMO's MongoDB collections with flexible filters. Collections: vehicles, complaints, battery_complaints, deployments, returns, rentals.
Key fields — vehicles: "Status", "Location", "Model", "Vehicle ID". deployments: "Location", "Created Time", "Rider Deployment Zone". complaints: "Complaint Status", "Location", "Vehicle ID". battery_complaints: "Issue", "Vehicle ID/Chasis No", "Location". returns: "Reason of return", "Location".
rentals: "Status", "Location", "Vehicle ID", "Rent Amount" (number, weekly rent), "Balance Amount" (number, outstanding), "Deposit Amount" (number), "Perday_Collection_Amount" (daily rate), "Payment Weeks Paid" (number), "Rent Status" (Paid/Unpaid), "AmountStatus" (Collected/etc), "Rent Start Date", "Rent Due Date".
Use dateField + dateFrom/dateTo for date filtering. For rentals use dateField="Rent Start Date".`,
    schema: z.object({
      collection: z.enum(["vehicles", "complaints", "battery_complaints", "deployments", "returns", "rentals"]),
      filters: z.record(z.string(), z.string()).optional().describe("Field-value pairs to filter by, e.g. {\"Location\": \"Delhi\", \"Status\": \"Active\"}"),
      dateField: z.string().optional().describe("Field name containing the date, e.g. 'Created Time'"),
      dateFrom: z.string().optional().describe("Start date YYYY-MM-DD"),
      dateTo: z.string().optional().describe("End date YYYY-MM-DD"),
      limit: z.number().optional().default(50).describe("Max records to return"),
    }),
  }
);

// ── Tool: Aggregate/count data ──
export const aggregateDataTool = tool(
  async ({ collection, groupBy, operation, filters, dateField, dateFrom, dateTo, sumField }) => {
    const data = getMongoData();
    if (!data) return JSON.stringify({ error: "Data not loaded" });

    const collectionMap: Record<string, any[]> = {
      vehicles: data.Vehicletracker || [],
      complaints: data.Newcomplaintresponses || [],
      battery_complaints: data.Complaindatabase || [],
      deployments: data.Deployementresponses || [],
      returns: data.Vehiclereturnresponses || [],
      rentals: data.Rentingdatabase || [],
    };

    let docs = collectionMap[collection];
    if (!docs) return JSON.stringify({ error: `Unknown collection` });

    // Apply filters
    if (filters && Object.keys(filters).length > 0) {
      docs = docs.filter((d) => matchesFilters(d, filters as Record<string, string>));
    }
    if (dateField && (dateFrom || dateTo)) {
      docs = docs.filter((d) => matchesDateFilter(d, dateField, dateFrom as string, dateTo as string));
    }

    if (operation === "count") {
      if (groupBy) {
        const counts: Record<string, number> = {};
        docs.forEach((d) => {
          const key = String(d[groupBy] || "Unknown");
          counts[key] = (counts[key] || 0) + 1;
        });
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
        return JSON.stringify({ total: docs.length, groupBy, breakdown: sorted.map(([k, v]) => ({ [groupBy]: k, count: v })) });
      }
      return JSON.stringify({ total: docs.length });
    }

    if (operation === "unique") {
      const values = [...new Set(docs.map((d) => d[groupBy!]).filter(Boolean))];
      return JSON.stringify({ field: groupBy, uniqueCount: values.length, values: values.slice(0, 50) });
    }

    if (operation === "sum" && sumField) {
      let total = 0;
      let parsed = 0;
      for (const d of docs) {
        const raw = d[sumField];
        if (raw === null || raw === undefined || raw === "") continue;
        const num = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[₹,\s]/g, ""));
        if (!isNaN(num)) { total += num; parsed++; }
      }
      const result: any = { total: Math.round(total * 100) / 100, recordsWithValue: parsed, totalRecords: docs.length };
      if (groupBy) {
        const grouped: Record<string, number> = {};
        for (const d of docs) {
          const key = String(d[groupBy] || "Unknown");
          const raw = d[sumField];
          if (raw === null || raw === undefined || raw === "") continue;
          const num = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[₹,\s]/g, ""));
          if (!isNaN(num)) grouped[key] = (grouped[key] || 0) + num;
        }
        result.breakdown = Object.entries(grouped).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ [groupBy]: k, total: Math.round(v * 100) / 100 }));
      }
      return JSON.stringify(result);
    }

    if (operation === "avg" && sumField) {
      let total = 0;
      let count = 0;
      for (const d of docs) {
        const raw = d[sumField];
        if (raw === null || raw === undefined || raw === "") continue;
        const num = typeof raw === "number" ? raw : parseFloat(String(raw).replace(/[₹,\s]/g, ""));
        if (!isNaN(num)) { total += num; count++; }
      }
      return JSON.stringify({ average: count > 0 ? Math.round((total / count) * 100) / 100 : 0, recordsWithValue: count, totalRecords: docs.length });
    }

    return JSON.stringify({ total: docs.length });
  },
  {
    name: "aggregate_data",
    description: `Count, sum, average, or get unique values from a collection. Use for "how many vehicles?", "total rent collected", "average balance", "breakdown by location".
For rent/payment totals: use collection="rentals", operation="sum", sumField="Rent Amount" or "Balance Amount".
Key numeric fields — rentals: "Rent Amount", "Balance Amount". vehicles: (no numeric fields). complaints/battery_complaints: (no numeric fields).`,
    schema: z.object({
      collection: z.enum(["vehicles", "complaints", "battery_complaints", "deployments", "returns", "rentals"]),
      operation: z.enum(["count", "unique", "sum", "avg"]).describe("'count' for counting, 'sum' for totals, 'avg' for averages, 'unique' for distinct values"),
      groupBy: z.string().optional().describe("Field to group by, e.g. 'Status', 'Location'"),
      sumField: z.string().optional().describe("Numeric field to sum/average, e.g. 'Rent Amount', 'Balance Amount'"),
      filters: z.record(z.string(), z.string()).optional(),
      dateField: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
    }),
  }
);

import { whatsappTools } from "./whatsapp-tools.js";
import { runAnalysisTool } from "./sandbox.js";
import { memoryTools } from "./memory-tools.js";

export const dbTools = [queryCollectionTool, aggregateDataTool];
export const allTools = [...dbTools, ...whatsappTools, ...memoryTools, runAnalysisTool];

// Helper to execute a tool call by name — avoids TS union type issues
export async function executeTool(name: string, args: any): Promise<string> {
  const toolMap: Record<string, any> = {};
  for (const t of allTools) { toolMap[t.name] = t; }
  const tool = toolMap[name];
  if (!tool) return JSON.stringify({ error: `Unknown tool: ${name}` });
  const result = await tool.invoke(args);
  return typeof result === "string" ? result : JSON.stringify(result);
}
