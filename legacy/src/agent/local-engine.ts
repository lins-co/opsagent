import type { Document } from "mongodb";
import type { AppData } from "../db/mongo.js";

/**
 * Local query engine — handles known query patterns directly against in-memory data.
 * No LLM call needed. Returns null if query doesn't match any pattern (fallback to LLM).
 */

// ---- Helpers ----

function parseDate(val: any): Date | null {
  try {
    if (!val) return null;
    if (val instanceof Date) return isNaN(val.getTime()) ? null : val;

    const s = String(val).trim();
    if (!s) return null;

    // Handle "M/D/YYYY, h:mm[:ss] am/pm" or "M/D/YYYY h:mm[:ss]am/pm"
    const mdyTime = s.match(
      /^(\d{1,2})\/(\d{1,2})\/(\d{4}),?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?$/i
    );
    if (mdyTime) {
      const [, month, day, year, rawHour, min, sec, ampm] = mdyTime;
      let hour = parseInt(rawHour!, 10);
      if (ampm?.toLowerCase() === "pm" && hour < 12) hour += 12;
      if (ampm?.toLowerCase() === "am" && hour === 12) hour = 0;
      return new Date(parseInt(year!, 10), parseInt(month!, 10) - 1, parseInt(day!, 10), hour, parseInt(min!, 10), sec ? parseInt(sec, 10) : 0);
    }

    // Handle "M/D/YYYY" without time
    const mdy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (mdy) {
      return new Date(parseInt(mdy[3]!, 10), parseInt(mdy[1]!, 10) - 1, parseInt(mdy[2]!, 10));
    }

    // Fallback to native Date parsing
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function today(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfWeek(): Date {
  const d = today();
  d.setDate(d.getDate() - d.getDay()); // Sunday
  return d;
}

function startOfMonth(): Date {
  const d = today();
  d.setDate(1);
  return d;
}

function startOfLastWeek(): Date {
  const d = startOfWeek();
  d.setDate(d.getDate() - 7);
  return d;
}

function endOfLastWeek(): Date {
  const d = startOfWeek();
  d.setMilliseconds(-1);
  return d;
}

function endOfToday(): Date {
  const d = today();
  d.setHours(23, 59, 59, 999);
  return d;
}

function yesterday(): Date {
  const d = today();
  d.setDate(d.getDate() - 1);
  return d;
}

function endOfYesterday(): Date {
  const d = today();
  d.setMilliseconds(-1);
  return d;
}

function startOfLastMonth(): Date {
  const d = today();
  d.setMonth(d.getMonth() - 1);
  d.setDate(1);
  return d;
}

function endOfLastMonth(): Date {
  const d = startOfMonth();
  d.setMilliseconds(-1);
  return d;
}

type TimeRange = { start: Date; end: Date };

function parseTimeRange(query: string): TimeRange | null {
  const q = query.toLowerCase();
  if (q.includes("yesterday")) return { start: yesterday(), end: endOfYesterday() };
  if (q.includes("today")) return { start: today(), end: endOfToday() };
  if (q.includes("this week")) return { start: startOfWeek(), end: endOfToday() };
  if (q.includes("last week")) return { start: startOfLastWeek(), end: endOfLastWeek() };
  if (q.includes("last month")) return { start: startOfLastMonth(), end: endOfLastMonth() };
  if (q.includes("this month")) return { start: startOfMonth(), end: endOfToday() };
  return null;
}

// ---- Regex patterns ----

const VEHICLE_ID_RE = /\b([A-Z]{2}\d{1,2}[A-Z]{2,4}\d{4,5})\b/i;
const BATTERY_ID_RE = /\b((ZEN-?E|ZEAA)[A-Z]?\d{3,5})\b/i;
const TICKET_RE = /\bticket\s*(\d+)\b/i;
const CONTACT_RE = /\b(\d{10})\b/;

const LOCATIONS = [
  "delhi", "mumbai", "kolkata", "chennai", "pune", "bengaluru", "mangalore",
  "kerala", "jammu", "kangra", "bhubneshwar", "karnal", "rohtak", "jaipur",
  "ajmer", "jalandhar", "vizag", "amritsar", "madurai", "coimbatore",
  "kochi", "hyderabad", "lucknow", "bhopal", "indore", "chandigarh",
  "nagpur", "patna", "ranchi", "guwahati", "noida", "gurgaon", "gurugram",
];

const STATUSES = [
  "Active", "Under Maintenance", "Ready to Deploy", "Accidental", "Locked", "Recovered",
];

function extractLocation(q: string): string | null {
  const lower = q.toLowerCase();
  for (const loc of LOCATIONS) {
    if (lower.includes(loc)) return loc.charAt(0).toUpperCase() + loc.slice(1);
  }
  return null;
}

function extractStatus(q: string): string | null {
  const lower = q.toLowerCase();
  for (const s of STATUSES) {
    if (lower.includes(s.toLowerCase())) return s;
  }
  if (lower.includes("maintenance")) return "Under Maintenance";
  if (lower.includes("ready")) return "Ready to Deploy";
  return null;
}

function extractVehicleId(q: string): string | null {
  const m = q.match(VEHICLE_ID_RE);
  return m && m[1] ? m[1].toUpperCase() : null;
}

function extractBatteryId(q: string): string | null {
  const m = q.match(BATTERY_ID_RE);
  return m && m[1] ? m[1].toUpperCase() : null;
}

// ---- Filtering helpers ----

function filterByField(docs: Document[], field: string, value: string, exact = false): Document[] {
  return docs.filter(d => {
    const v = String(d[field] || "");
    return exact
      ? v.toLowerCase() === value.toLowerCase()
      : v.toLowerCase().includes(value.toLowerCase());
  });
}

function filterByDateRange(docs: Document[], field: string, range: TimeRange): Document[] {
  return docs.filter(d => {
    const dt = parseDate(d[field]);
    if (!dt) return false;
    return dt >= range.start && dt <= range.end;
  });
}

function pickFields(docs: Document[], fields: string[]): Record<string, any>[] {
  return docs.map(d => {
    const obj: Record<string, any> = {};
    for (const f of fields) {
      if (d[f] !== undefined && d[f] !== null && d[f] !== "") obj[f] = d[f];
    }
    return obj;
  });
}

// ---- Collections (nested payment object) parser ----

interface PaymentEntry {
  date: Date;
  amount: number;
  vehicleId?: string;
  location?: string;
  riderName?: string;
}

/**
 * Extract all payment entries from the nested Collections object.
 * Structure: { "March": { "Week1": [{ date, amount, ... }], ... }, ... }
 */
function extractPayments(doc: Document): PaymentEntry[] {
  const collections = doc["Collections"];
  if (!collections || typeof collections !== "object") return [];

  const payments: PaymentEntry[] = [];
  for (const month of Object.values(collections as Record<string, any>)) {
    if (!month || typeof month !== "object") continue;
    for (const week of Object.values(month as Record<string, any>)) {
      if (!Array.isArray(week)) continue;
      for (const entry of week) {
        if (!entry || typeof entry !== "object") continue;
        const dt = parseDate(entry.date);
        const amt = Number(entry.amount);
        if (dt && !isNaN(amt)) {
          payments.push({
            date: dt,
            amount: amt,
            vehicleId: String(doc["Vehicle ID"] || ""),
            location: String(doc["Location"] || ""),
            riderName: String(doc["Rider Name"] || ""),
          });
        }
      }
    }
  }
  return payments;
}

/**
 * Sum all payments across docs within an optional date range and location filter.
 */
function sumPayments(
  docs: Document[],
  range?: TimeRange | null,
  locationFilter?: string | null,
): { total: number; count: number; byLocation: Map<string, { total: number; count: number }> } {
  let total = 0;
  let count = 0;
  const byLocation = new Map<string, { total: number; count: number }>();

  for (const doc of docs) {
    if (locationFilter && !String(doc["Location"] || "").toLowerCase().includes(locationFilter.toLowerCase())) continue;
    const payments = extractPayments(doc);
    for (const p of payments) {
      if (range && (p.date < range.start || p.date > range.end)) continue;
      total += p.amount;
      count++;
      const loc = p.location || "(unknown)";
      const entry = byLocation.get(loc) || { total: 0, count: 0 };
      entry.total += p.amount;
      entry.count++;
      byLocation.set(loc, entry);
    }
  }

  return { total, count, byLocation };
}

function groupByCount(docs: Document[], field: string): Record<string, number> {
  const groups: Record<string, number> = {};
  for (const d of docs) {
    const val = String(d[field] || "(empty)").trim();
    groups[val] = (groups[val] || 0) + 1;
  }
  return Object.fromEntries(
    Object.entries(groups).sort((a, b) => b[1] - a[1])
  );
}

// ---- Table formatting ----

function toTable(rows: Record<string, any>[]): string {
  if (rows.length === 0) return "No data found.";
  const first = rows[0];
  if (!first) return "No data found.";
  const keys = Object.keys(first);

  const header = "| " + keys.join(" | ") + " |";
  const sep = "| " + keys.map(() => "---").join(" | ") + " |";
  const body = rows.map(r =>
    "| " + keys.map(k => String(r[k] ?? "")).join(" | ") + " |"
  ).join("\n");

  return header + "\n" + sep + "\n" + body;
}

const MAX_DISPLAY_ROWS = 50;

function countResult(label: string, count: number, rows?: Record<string, any>[]): string {
  let result = `**${label}: ${count}**`;
  if (rows && rows.length > 0) {
    const display = rows.slice(0, MAX_DISPLAY_ROWS);
    result += "\n\n" + toTable(display);
    if (rows.length > MAX_DISPLAY_ROWS) {
      result += `\n\n_Showing ${MAX_DISPLAY_ROWS} of ${rows.length} rows._`;
    }
  }
  return result;
}

function groupTable(groups: Record<string, number>, label: string): string {
  const total = Object.values(groups).reduce((a, b) => a + b, 0);
  const rows = Object.entries(groups).map(([k, v]) => ({ [label]: k, Count: v }));
  return `**Total: ${total}**\n\n` + toTable(rows);
}

// ---- Main pattern matcher ----

const VEHICLE_FIELDS = ["Vehicle ID", "Status", "Location", "Vendor", "Rider Name", "Rider Contact No"];
const COMPLAINT_FIELDS = ["Vehicle ID", "Ticket", "Location", "Complaint Status", "Purpose of Form Fillup?", "Your Name", "Created Time"];
const RETURN_FIELDS = ["Vehicle ID", "Ticket", "Location", "Reason of return", "Your Name", "Created Time"];
const DEPLOY_FIELDS = ["Vehicle ID", "Location", "Your Name", "Created Time", "Rider Deployment Zone"];
const RENTAL_FIELDS = ["Vehicle ID", "Location", "Rent Amount", "Rent Due Date", "AmountStatus"];
const BATTERY_FIELDS = ["Ticket ID", "Battery ID", "Vehicle ID", "Location", "Complain Status", "Issue", "Technician Name", "Created Time"];

// ---- Text normalizer: expand abbreviations, fix typos, standardize phrasing ----

function normalize(q: string): string {
  let s = q.toLowerCase().trim();

  // Common abbreviations
  s = s.replace(/\bveh\b/g, "vehicle");
  s = s.replace(/\bvehicels?\b/g, "vehicle");
  s = s.replace(/\bvehciles?\b/g, "vehicle");
  s = s.replace(/\bbatt\b/g, "battery");
  s = s.replace(/\bbattery's\b/g, "battery");
  s = s.replace(/\bcomp\b/g, "complaint");
  s = s.replace(/\bcomplaint's\b/g, "complaint");
  s = s.replace(/\bcomplain\b/g, "complaint");
  s = s.replace(/\bcomplians?\b/g, "complaint");
  s = s.replace(/\bcomplants?\b/g, "complaint");
  s = s.replace(/\bcomplaits?\b/g, "complaint");
  s = s.replace(/\bdeploy\b/g, "deployed");
  s = s.replace(/\bdeployement\b/g, "deployment");
  s = s.replace(/\bdeploymnet\b/g, "deployment");
  s = s.replace(/\breturn\b/g, "returned");
  s = s.replace(/\breturnd\b/g, "returned");
  s = s.replace(/\bpmts?\b/g, "payment");
  s = s.replace(/\bpaymnet\b/g, "payment");
  s = s.replace(/\bpayemnts?\b/g, "payment");
  s = s.replace(/\bcollctn\b/g, "collection");
  s = s.replace(/\bcollection\b/g, "collection");
  s = s.replace(/\bcolletions?\b/g, "collection");
  s = s.replace(/\btkt\b/g, "ticket");
  s = s.replace(/\btikects?\b/g, "ticket");
  s = s.replace(/\bticekts?\b/g, "ticket");
  s = s.replace(/\btech\b/g, "technician");
  s = s.replace(/\bloc\b/g, "location");
  s = s.replace(/\bmaint\b/g, "maintenance");
  s = s.replace(/\bmaintenace\b/g, "maintenance");
  s = s.replace(/\bmaintainence\b/g, "maintenance");

  // Natural phrasing → standard
  s = s.replace(/\bhow much was collected\b/g, "total rent collected");
  s = s.replace(/\bhow much rent was collected\b/g, "total rent collected");
  s = s.replace(/\bhow much have we collected\b/g, "total rent collected");
  s = s.replace(/\btotal amount collected\b/g, "total rent collected");
  s = s.replace(/\btotal collection amount\b/g, "total collection");
  s = s.replace(/\btotal rent amount\b/g, "total rent");
  s = s.replace(/\bhow many are active\b/g, "how many vehicle active");
  s = s.replace(/\bhow many locked\b/g, "how many vehicle locked");

  return s;
}

export function localQuery(query: string, data: AppData): string | null {
  const q = query.trim();
  const lower = normalize(q);

  const vehicleId = extractVehicleId(q);
  const location = extractLocation(lower);
  const status = extractStatus(lower);
  const timeRange = parseTimeRange(lower);
  const batteryId = extractBatteryId(q);

  // ==============================
  // VEHICLE STATUS QUERIES (df1)
  // ==============================

  // "How many vehicles are [status]?" / "How many vehicles are [status] in [location]?"
  if (lower.startsWith("how many") && (lower.includes("vehicle") || lower.includes("ready to deploy"))) {
    // Locked vehicles come from rentals
    if (status === "Locked" || (lower.includes("locked") && !lower.includes("complaint"))) {
      let docs = filterByField(data.Rentingdatabase, "Status", "Lock");
      if (location) docs = filterByField(docs, "Location", location);
      if (timeRange) docs = filterByDateRange(docs, "Locked DateTime", timeRange);
      return countResult("Locked vehicles", docs.length, pickFields(docs, RENTAL_FIELDS));
    }

    if (lower.includes("returned")) {
      let docs = data.Vehiclereturnresponses;
      if (location) docs = filterByField(docs, "Location", location);
      if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
      return countResult("Vehicles returned", docs.length, pickFields(docs, RETURN_FIELDS));
    }

    if (lower.includes("deployed")) {
      let docs = data.Deployementresponses;
      if (location) docs = filterByField(docs, "Location", location);
      if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
      return countResult("Vehicles deployed", docs.length, pickFields(docs, DEPLOY_FIELDS));
    }

    if (status) {
      let docs = filterByField(data.Vehicletracker, "Status", status, true);
      if (location) docs = filterByField(docs, "Location", location);
      return countResult(`${status} vehicles`, docs.length, pickFields(docs, VEHICLE_FIELDS));
    }
  }

  // "Show all [status] vehicles" / "Show [status] vehicles in [location]"
  if (lower.startsWith("show") && (lower.includes("vehicle") || lower.includes("active") || lower.includes("maintenance"))) {
    if (lower.includes("returned")) {
      let docs = data.Vehiclereturnresponses;
      if (location) docs = filterByField(docs, "Location", location);
      if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
      return countResult("Vehicles returned", docs.length, pickFields(docs, RETURN_FIELDS));
    }

    if (status) {
      let docs = filterByField(data.Vehicletracker, "Status", status, true);
      if (location) docs = filterByField(docs, "Location", location);
      return countResult(`${status} vehicles`, docs.length, pickFields(docs, VEHICLE_FIELDS));
    }
  }

  // "Which vehicles are [status]?"
  if (lower.startsWith("which vehicles are") && status) {
    const docs = filterByField(data.Vehicletracker, "Status", status, true);
    return countResult(`${status} vehicles`, docs.length, pickFields(docs, VEHICLE_FIELDS));
  }

  // "Active vehicles for vendor X" / "Active vehicles for vendor X in Y"
  if (status && lower.includes("vendor")) {
    let docs = filterByField(data.Vehicletracker, "Status", status, true);
    // Extract vendor name after "vendor"
    const vendorMatch = q.match(/vendor\s+(.+?)(\s+in\s+|$|\?)/i);
    if (vendorMatch && vendorMatch[1]) {
      docs = filterByField(docs, "Vendor", vendorMatch[1].trim());
    }
    if (location) docs = filterByField(docs, "Location", location);
    return countResult(`${status} vehicles`, docs.length, pickFields(docs, VEHICLE_FIELDS));
  }

  // ==============================
  // VENDOR QUERIES
  // ==============================

  if (lower.includes("vendor wise") || lower.includes("vendor-wise")) {
    let docs = data.Vehicletracker as Document[];
    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Vendor");
    return groupTable(groups, "Vendor");
  }

  // ==============================
  // VEHICLE INFO QUERIES
  // ==============================

  // "Location of [vehicle_id]"
  if (lower.startsWith("location of") && vehicleId) {
    const docs = filterByField(data.Vehicletracker, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No records found for vehicle ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Location", "Status"]));
  }

  // "Deployment date of [vehicle_id]"
  if (lower.includes("deployment date") && vehicleId) {
    let docs = filterByField(data.Deployementresponses, "Vehicle ID", vehicleId);
    if (docs.length === 0) docs = filterByField(data.Vehicletracker, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No deployment records for ${vehicleId}.`;
    return toTable(pickFields(docs, ["Vehicle ID", "Location", "Created Time", "Your Name"]));
  }

  // "Rider details for [vehicle_id]"
  if (lower.includes("rider detail") && vehicleId) {
    const docs = filterByField(data.Vehicletracker, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No records found for vehicle ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Rider Name", "Rider Contact No", "Location", "Status", "Vendor"]));
  }

  // "What is the chassis number of [vehicle_id]?"
  if (lower.includes("chassis") && vehicleId) {
    const docs = filterByField(data.Vehicletracker, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No records found for vehicle ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "VIN No", "Model", "Status"]));
  }

  // "Vehicle for rider contact [number]"
  if (lower.includes("rider contact") || lower.includes("contact number")) {
    const contactMatch = q.match(CONTACT_RE);
    if (contactMatch && contactMatch[1]) {
      const docs = filterByField(data.Vehicletracker, "Rider Contact No", contactMatch[1]);
      if (docs.length === 0) return `No vehicle found for contact ${contactMatch[1]}.`;
      return toTable(pickFields(docs, ["Vehicle ID", "Rider Name", "Rider Contact No", "Location", "Status"]));
    }
  }

  // "Give me info on [vehicle_id]"
  if (lower.includes("info on") && vehicleId) {
    const tracker = filterByField(data.Vehicletracker, "Vehicle ID", vehicleId);
    const complaints = filterByField(data.Newcomplaintresponses, "Vehicle ID", vehicleId);
    const returns = filterByField(data.Vehiclereturnresponses, "Vehicle ID", vehicleId);
    const deploys = filterByField(data.Deployementresponses, "Vehicle ID", vehicleId);
    const rentals = filterByField(data.Rentingdatabase, "Vehicle ID", vehicleId);

    let result = `## Vehicle: ${vehicleId}\n\n`;
    if (tracker.length > 0) {
      result += "**Current Status:**\n" + toTable(pickFields(tracker.slice(0, 1), VEHICLE_FIELDS)) + "\n\n";
    }
    result += `**Complaints:** ${complaints.length} | **Returns:** ${returns.length} | **Deployments:** ${deploys.length} | **Rentals:** ${rentals.length}`;
    return result;
  }

  // ==============================
  // COMPLAINT QUERIES (df2)
  // ==============================

  if ((lower.startsWith("how many complaint") || lower.startsWith("how many complaints"))
      && !lower.includes("battery")) {
    let docs = data.Newcomplaintresponses as Document[];

    // Only filter by purpose when explicitly asking for "resolved" or "new complaints"
    if (lower.includes("resolved")) {
      docs = filterByField(docs, "Purpose of Form Fillup?", "Resolve Complaint");
    } else if (lower.includes("new complaint")) {
      docs = filterByField(docs, "Purpose of Form Fillup?", "New Complaint");
    }
    // "raised" without "new" → show all complaints (both new + resolved)

    // Operator: "how many complaints did [name] raise/resolve"
    const opMatch = q.match(/did\s+(\w+)\s+(raise|resolve)/i);
    if (opMatch && opMatch[1]) {
      docs = filterByField(docs, "Your Name", opMatch[1]);
    }

    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);

    return countResult("Complaints", docs.length, pickFields(docs, COMPLAINT_FIELDS));
  }

  // "Show complaints raised/resolved [timerange]"
  if (lower.startsWith("show complaint") && !lower.includes("battery")) {
    let docs = data.Newcomplaintresponses as Document[];

    if (lower.includes("resolved")) {
      docs = filterByField(docs, "Purpose of Form Fillup?", "Resolve Complaint");
    } else if (lower.includes("new complaint")) {
      docs = filterByField(docs, "Purpose of Form Fillup?", "New Complaint");
    }

    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);

    return countResult("Complaints", docs.length, pickFields(docs, COMPLAINT_FIELDS));
  }

  // "What was the issue for [vehicle_id]?"
  if (lower.includes("issue for") && vehicleId && !batteryId) {
    const docs = filterByField(data.Newcomplaintresponses, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No complaints found for ${vehicleId}.`;
    return toTable(pickFields(docs, [...COMPLAINT_FIELDS, "Comments (if any)"]));
  }

  // "Is replacement given for [vehicle_id]?"
  if (lower.includes("replacement") && vehicleId) {
    const docs = filterByField(data.Newcomplaintresponses, "Vehicle ID", vehicleId)
      .filter(d => String(d["Are you giving replacement?"] || "").toLowerCase() === "yes");
    if (docs.length === 0) return `No replacement records for ${vehicleId}.`;
    return toTable(pickFields(docs, ["Vehicle ID", "Ticket", "Are you giving replacement?", "New Vehicle ID", "Created Time"]));
  }

  // "Show replacement vehicles for [timerange]"
  if (lower.includes("replacement vehicle")) {
    let docs = data.Newcomplaintresponses.filter(
      d => String(d["Are you giving replacement?"] || "").toLowerCase() === "yes"
    );
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    return countResult("Replacements", docs.length,
      pickFields(docs, ["Vehicle ID", "Ticket", "New Vehicle ID", "Created Time"]));
  }

  // ==============================
  // RETURN QUERIES (df3)
  // ==============================

  // "When was [vehicle_id] returned and why?"
  if (lower.includes("returned") && lower.includes("why") && vehicleId) {
    const docs = filterByField(data.Vehiclereturnresponses, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No return records for ${vehicleId}.`;
    return toTable(pickFields(docs, ["Vehicle ID", "Created Time", "Reason of return", "Location", "Your Name"]));
  }

  // "Which operator returned how many vehicles?"
  if (lower.includes("operator returned") && lower.includes("how many")) {
    let docs = data.Vehiclereturnresponses as Document[];
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Your Name");
    return groupTable(groups, "Operator");
  }

  // ==============================
  // DEPLOYMENT QUERIES (df4)
  // ==============================

  // "Which vehicles were deployed in [location] [timerange]?"
  if (lower.includes("deployed") && (lower.startsWith("which") || lower.startsWith("show"))) {
    let docs = data.Deployementresponses as Document[];
    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    return countResult("Deployed vehicles", docs.length, pickFields(docs, DEPLOY_FIELDS));
  }

  // "Which operator deployed how many vehicles?"
  if (lower.includes("operator deployed") && lower.includes("how many")) {
    let docs = data.Deployementresponses as Document[];
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Your Name");
    return groupTable(groups, "Operator");
  }

  // "What's the deployment zone for [vehicle_id]?"
  if (lower.includes("deployment zone") && vehicleId) {
    const docs = filterByField(data.Deployementresponses, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No deployment records for ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Rider Deployment Zone", "Location", "Created Time"]));
  }

  // "What's the battery serial number for [vehicle_id]?"
  if (lower.includes("battery serial") && vehicleId) {
    const docs = filterByField(data.Deployementresponses, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No records for ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Battery Serial No", "Location", "Created Time"]));
  }

  // "What's the rent start date for [vehicle_id]?"
  if (lower.includes("rent start date") && vehicleId) {
    const docs = filterByField(data.Deployementresponses, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No records for ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Rent Start Date", "Location", "Created Time"]));
  }

  // ==============================
  // RENTAL & PAYMENT QUERIES (df5)
  // ==============================

  // "Which riders are due this week?"
  if (lower.includes("riders") && lower.includes("due")) {
    const range = timeRange || { start: startOfWeek(), end: endOfToday() };
    const docs = data.Rentingdatabase.filter(d => {
      const due = parseDate(d["Rent Due Date"]);
      return due && due >= range.start && due <= range.end;
    });
    return countResult("Riders due", docs.length,
      pickFields(docs, ["Vehicle ID", "Rider Name", "Rent Due Date", "Location"]));
  }

  // "What's the due date for [vehicle_id]?"
  if (lower.includes("due date") && vehicleId) {
    const docs = filterByField(data.Rentingdatabase, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No rental records for ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Rent Due Date", "AmountStatus", "Location"]));
  }

  // "What's the payment status for [vehicle_id]?"
  if (lower.includes("payment status") && vehicleId) {
    const docs = filterByField(data.Rentingdatabase, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No rental records for ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "AmountStatus", "Rent Amount", "Rent Due Date", "Location"]));
  }

  // "How many payments done [timerange]?"
  if (lower.includes("how many payment")) {
    let docs = data.Rentingdatabase as Document[];
    if (timeRange) docs = filterByDateRange(docs, "Last_Modified_Time", timeRange);
    return countResult("Payments", docs.length, pickFields(docs, RENTAL_FIELDS));
  }

  // "What's the total payment collected for [vehicle_id]?"
  if (lower.includes("total payment") && vehicleId) {
    const docs = filterByField(data.Rentingdatabase, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No rental records for ${vehicleId}.`;
    const total = docs.reduce((sum, d) => sum + (Number(d["Rent Amount"]) || 0), 0);
    return `**Total rent for ${vehicleId}: ₹${total.toLocaleString("en-IN")}**\n\n` +
      toTable(pickFields(docs, ["Vehicle ID", "Rent Amount", "AmountStatus", "Rent Due Date"]));
  }

  // "Total rent collected [timerange]" / "Total collections [timerange]" / "How much rent collected [timerange]"
  if ((lower.includes("total rent") || lower.includes("total collection") || lower.includes("rent collected")
      || lower.includes("collection amount") || lower.includes("payment collected")
      || (lower.includes("total payment") && !vehicleId)
      || (lower.includes("how much") && (lower.includes("collect") || lower.includes("rent") || lower.includes("payment"))))
      && !vehicleId) {
    const docs = data.Rentingdatabase as Document[];
    const { total, count, byLocation } = sumPayments(docs, timeRange, location);

    const periodLabel = timeRange
      ? (lower.includes("last month") ? "last month"
        : lower.includes("this month") ? "this month"
        : lower.includes("this week") ? "this week"
        : lower.includes("last week") ? "last week"
        : lower.includes("today") ? "today"
        : lower.includes("yesterday") ? "yesterday"
        : "selected period")
      : "all time";

    let result = `**Total Rent Collected (${periodLabel}${location ? ` - ${location}` : ""}): ₹${total.toLocaleString("en-IN")}**\n\n`;
    result += `_${count} payments across ${byLocation.size} locations_\n\n`;

    if (byLocation.size > 1) {
      const rows = Array.from(byLocation.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([loc, v]) => ({
          Location: loc,
          "Amount Collected": `₹${v.total.toLocaleString("en-IN")}`,
          Payments: v.count,
        }));
      result += toTable(rows);
    }
    return result;
  }

  // "Rent summary [location]" / "Collection summary [timerange]"
  if ((lower.includes("rent summary") || lower.includes("collection summary")
      || lower.includes("payment summary")) && !vehicleId) {
    const docs = data.Rentingdatabase as Document[];
    const { total, count, byLocation } = sumPayments(docs, timeRange, location);

    const rows = Array.from(byLocation.entries())
      .sort((a, b) => b[1].total - a[1].total)
      .map(([loc, v]) => ({
        Location: loc,
        "Amount Collected": `₹${v.total.toLocaleString("en-IN")}`,
        Payments: v.count,
      }));

    return `**Rent Collection Summary — ₹${total.toLocaleString("en-IN")} total (${count} payments):**\n\n` + toTable(rows);
  }

  // "Overdue payments [location]" / "Unpaid rent [timerange]"
  if (lower.includes("overdue") || (lower.includes("unpaid") && lower.includes("rent"))) {
    const now = new Date();
    let docs = data.Rentingdatabase.filter(d => {
      const due = parseDate(d["Rent Due Date"]);
      return due && due < now;
    });
    if (location) docs = filterByField(docs, "Location", location);
    return countResult("Overdue payments", docs.length,
      pickFields(docs, ["Vehicle ID", "Rider Name", "Rent Amount", "Rent Due Date", "AmountStatus", "Location"]));
  }

  // ==============================
  // BATTERY COMPLAINT QUERIES (df6)
  // ==============================

  // "How many battery complaints [resolved/pending] [timerange]?"
  // "How many resolved battery complaints this month?"
  // "Show resolved battery complaints" etc.
  if (lower.includes("battery complaint") || lower.includes("battery tickets")
      || (lower.includes("battery") && lower.includes("complaint"))) {
    let docs = data.Complaindatabase as Document[];
    let label = "Battery complaints";

    if (lower.includes("resolved")) {
      docs = filterByField(docs, "Complain Status", "Resolved", true);
      label = "Resolved battery complaints";
    } else if (lower.includes("pending")) {
      docs = filterByField(docs, "Complain Status", "Pending", true);
      label = "Pending battery complaints";
    }

    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);

    return countResult(label, docs.length,
      pickFields(docs, [...BATTERY_FIELDS, "Resolved Type", "Resolved timestamp"]));
  }

  // "How many tickets have been raised for battery [id]?"
  if (batteryId && lower.includes("ticket")) {
    const docs = filterByField(data.Complaindatabase, "Battery ID", batteryId);
    return countResult(`Tickets for ${batteryId}`, docs.length,
      pickFields(docs, BATTERY_FIELDS));
  }

  // "What is the complaint status of battery [id]?"
  if (batteryId && lower.includes("status")) {
    const docs = filterByField(data.Complaindatabase, "Battery ID", batteryId);
    if (docs.length === 0) return `No records for battery ${batteryId}.`;
    return toTable(pickFields(docs, ["Battery ID", "Vehicle ID", "Complain Status", "Issue", "Created Time"]));
  }

  // "What is the issue for battery [id]?"
  if (batteryId && lower.includes("issue")) {
    const docs = filterByField(data.Complaindatabase, "Battery ID", batteryId);
    if (docs.length === 0) return `No records for battery ${batteryId}.`;
    return toTable(pickFields(docs, ["Battery ID", "Vehicle ID", "Issue", "Complain Status", "Solution", "Created Time"]));
  }

  // "What is the location of battery [id]?"
  if (batteryId && lower.includes("location")) {
    const docs = filterByField(data.Complaindatabase, "Battery ID", batteryId);
    if (docs.length === 0) return `No records for battery ${batteryId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Battery ID", "Vehicle ID", "Location", "Complain Status"]));
  }

  // "Which vehicle is associated with battery [id]?"
  if (batteryId && lower.includes("vehicle")) {
    const docs = filterByField(data.Complaindatabase, "Battery ID", batteryId);
    if (docs.length === 0) return `No records for battery ${batteryId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Battery ID", "Vehicle ID", "Location", "Complain Status"]));
  }

  // "How many tickets are pending?"
  if (lower.includes("pending") && (lower.includes("ticket") || lower.includes("battery"))) {
    let docs = filterByField(data.Complaindatabase, "Complain Status", "Pending");

    // "for [vendor] vendor"
    const vendorMatch = q.match(/for\s+(.+?)\s+vendor/i);
    if (vendorMatch && vendorMatch[1]) docs = filterByField(docs, "Vendor", vendorMatch[1].trim());

    // "for E Luna vehicle"
    if (lower.includes("e luna")) docs = filterByField(docs, "Vehicle Type", "E Luna");

    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);

    return countResult("Pending tickets", docs.length,
      pickFields(docs, BATTERY_FIELDS));
  }

  // "How many batteries were replaced [timerange]?"
  if (lower.includes("batteries") && lower.includes("replaced")) {
    let docs = filterByField(data.Complaindatabase, "Resolved Type", "Replace");
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    return countResult("Batteries replaced", docs.length,
      pickFields(docs, [...BATTERY_FIELDS, "Resolved Type"]));
  }

  // "Which technician resolved the most battery complaints?"
  if (lower.includes("technician") && lower.includes("resolved")) {
    let docs = filterByField(data.Complaindatabase, "Complain Status", "Resolved");
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Technician Name");
    return groupTable(groups, "Technician");
  }

  // "Which issue type occurs most frequently?"
  if (lower.includes("issue type") && lower.includes("most")) {
    const groups = groupByCount(data.Complaindatabase, "Issue");
    return groupTable(groups, "Issue Type");
  }

  // "Which vendor has most complaints?"
  if (lower.includes("which vendor") && lower.includes("most")) {
    const groups = groupByCount(data.Complaindatabase, "Vendor");
    return groupTable(groups, "Vendor");
  }

  // "Which location has most complaints?"
  if (lower.includes("which location") && lower.includes("most")) {
    const groups = groupByCount(data.Complaindatabase, "Location");
    return groupTable(groups, "Location");
  }

  // "Which vehicle type has most issues?"
  if (lower.includes("vehicle type") && lower.includes("most")) {
    const groups = groupByCount(data.Complaindatabase, "Vehicle Type");
    return groupTable(groups, "Vehicle Type");
  }

  // "Average ticket closure time"
  if (lower.includes("average") && (lower.includes("closure") || lower.includes("resolution"))) {
    const docs = data.Complaindatabase.filter(d =>
      d["Ticket closure time (in days)"] !== undefined && d["Ticket closure time (in days)"] !== null
    );
    if (docs.length === 0) return "No closure time data available.";
    const total = docs.reduce((sum, d) => sum + (Number(d["Ticket closure time (in days)"]) || 0), 0);
    const avg = total / docs.length;
    return `**Average ticket closure time: ${avg.toFixed(1)} days** (based on ${docs.length} resolved tickets)`;
  }

  // ==============================
  // BROAD CATCH-ALL PATTERNS
  // ==============================

  // "Total vehicles" / "How many total vehicles"
  if ((lower.includes("total vehicle") || lower === "how many vehicles" || lower === "how many vehicles?")
      && !status) {
    let docs = data.Vehicletracker as Document[];
    if (location) docs = filterByField(docs, "Location", location);
    return countResult("Total vehicles", docs.length, pickFields(docs, VEHICLE_FIELDS));
  }

  // "Location wise count/breakdown" / "Vehicles by location"
  if ((lower.includes("location wise") || lower.includes("location-wise")
      || lower.includes("by location") || lower.includes("locationwise"))
      && (lower.includes("vehicle") || lower.includes("count") || lower.includes("breakdown"))) {
    const groups = groupByCount(data.Vehicletracker, "Location");
    return groupTable(groups, "Location");
  }

  // "Status wise breakdown" / "Vehicle status breakdown"
  if ((lower.includes("status wise") || lower.includes("status-wise") || lower.includes("status breakdown"))
      && !lower.includes("battery") && !lower.includes("complaint")) {
    const groups = groupByCount(data.Vehicletracker, "Status");
    return groupTable(groups, "Status");
  }

  // "Complaints by location" / "Location wise complaints"
  if ((lower.includes("location wise") || lower.includes("by location"))
      && lower.includes("complaint") && !lower.includes("battery")) {
    let docs = data.Newcomplaintresponses as Document[];
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Location");
    return groupTable(groups, "Location");
  }

  // "Battery complaints by location" / "Location wise battery complaints"
  if ((lower.includes("location wise") || lower.includes("by location"))
      && (lower.includes("battery") || lower.includes("ticket"))) {
    let docs = data.Complaindatabase as Document[];
    if (lower.includes("resolved")) docs = filterByField(docs, "Complain Status", "Resolved", true);
    if (lower.includes("pending")) docs = filterByField(docs, "Complain Status", "Pending", true);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Location");
    return groupTable(groups, "Location");
  }

  // "Returns by location"
  if ((lower.includes("location wise") || lower.includes("by location")) && lower.includes("return")) {
    let docs = data.Vehiclereturnresponses as Document[];
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Location");
    return groupTable(groups, "Location");
  }

  // "Deployments by location"
  if ((lower.includes("location wise") || lower.includes("by location")) && lower.includes("deploy")) {
    let docs = data.Deployementresponses as Document[];
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    const groups = groupByCount(docs, "Location");
    return groupTable(groups, "Location");
  }

  // "Total complaints" / "How many total complaints"
  if ((lower.includes("total complaint") || lower === "how many complaints" || lower === "how many complaints?")
      && !lower.includes("battery")) {
    let docs = data.Newcomplaintresponses as Document[];
    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    return countResult("Total complaints", docs.length, pickFields(docs, COMPLAINT_FIELDS));
  }

  // "Total battery complaints" / "How many total battery complaints"
  if (lower.includes("total battery") || (lower.includes("total") && lower.includes("battery") && lower.includes("complaint"))) {
    let docs = data.Complaindatabase as Document[];
    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    return countResult("Total battery complaints", docs.length, pickFields(docs, BATTERY_FIELDS));
  }

  // "Total returns" / "How many returns"
  if (lower.includes("total return") || (lower.includes("how many") && lower.includes("return") && !lower.includes("vehicle"))) {
    let docs = data.Vehiclereturnresponses as Document[];
    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    return countResult("Total returns", docs.length, pickFields(docs, RETURN_FIELDS));
  }

  // "Total deployments" / "How many deployments"
  if (lower.includes("total deployment") || (lower.includes("how many") && lower.includes("deployment"))) {
    let docs = data.Deployementresponses as Document[];
    if (location) docs = filterByField(docs, "Location", location);
    if (timeRange) docs = filterByDateRange(docs, "Created Time", timeRange);
    return countResult("Total deployments", docs.length, pickFields(docs, DEPLOY_FIELDS));
  }

  // "Dashboard" / "Fleet summary" / "Overview"
  if (lower === "dashboard" || lower === "fleet summary" || lower === "overview" || lower === "summary") {
    const active = filterByField(data.Vehicletracker, "Status", "Active", true).length;
    const maintenance = filterByField(data.Vehicletracker, "Status", "Under Maintenance", true).length;
    const locked = filterByField(data.Rentingdatabase, "Status", "Lock").length;
    const ready = filterByField(data.Vehicletracker, "Status", "Ready to Deploy", true).length;

    const todayRange = { start: today(), end: endOfToday() };
    const complaintsToday = filterByDateRange(data.Newcomplaintresponses, "Created Time", todayRange).length;
    const returnsToday = filterByDateRange(data.Vehiclereturnresponses, "Created Time", todayRange).length;
    const deploysToday = filterByDateRange(data.Deployementresponses, "Created Time", todayRange).length;
    const pendingTickets = filterByField(data.Complaindatabase, "Complain Status", "Pending").length;

    let result = `**Fleet Dashboard**\n\n`;
    result += `| Metric | Count |\n| --- | --- |\n`;
    result += `| Total Vehicles | ${data.Vehicletracker.length} |\n`;
    result += `| Active | ${active} |\n`;
    result += `| Under Maintenance | ${maintenance} |\n`;
    result += `| Locked | ${locked} |\n`;
    result += `| Ready to Deploy | ${ready} |\n`;
    result += `| Complaints Today | ${complaintsToday} |\n`;
    result += `| Returns Today | ${returnsToday} |\n`;
    result += `| Deployments Today | ${deploysToday} |\n`;
    result += `| Pending Battery Tickets | ${pendingTickets} |\n`;
    result += `| Total Riders | ${data.Rentingdatabase.length} |\n`;
    return result;
  }

  // "Rent of [vehicle_id]" / "Rent amount for [vehicle_id]"
  if ((lower.includes("rent of") || lower.includes("rent for") || lower.includes("rent amount")) && vehicleId) {
    const docs = filterByField(data.Rentingdatabase, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No rental records for ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Rider Name", "Rent Amount", "Rent Due Date", "AmountStatus", "Status", "Location"]));
  }

  // "Rider for [vehicle_id]" / "Who rides [vehicle_id]"
  if ((lower.includes("rider for") || lower.includes("who rides") || lower.includes("rider of")) && vehicleId) {
    const docs = filterByField(data.Vehicletracker, "Vehicle ID", vehicleId);
    if (docs.length === 0) return `No records found for vehicle ${vehicleId}.`;
    return toTable(pickFields(docs.slice(0, 1), ["Vehicle ID", "Rider Name", "Rider Contact No", "Location", "Status"]));
  }

  // "Status of [vehicle_id]"
  if (lower.includes("status of") && vehicleId) {
    const tracker = filterByField(data.Vehicletracker, "Vehicle ID", vehicleId);
    if (tracker.length === 0) return `No records found for vehicle ${vehicleId}.`;
    const rental = filterByField(data.Rentingdatabase, "Vehicle ID", vehicleId);
    let result = toTable(pickFields(tracker.slice(0, 1), ["Vehicle ID", "Status", "Location", "Vendor", "Rider Name"]));
    if (rental.length > 0) {
      result += "\n\n**Rental:**\n" + toTable(pickFields(rental.slice(0, 1), ["Rent Amount", "AmountStatus", "Rent Due Date", "Status"]));
    }
    return result;
  }

  // No match — fall through to LLM
  return null;
}
