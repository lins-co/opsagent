import type { Document } from "mongodb";

/**
 * Build a rich but compact schema context for the LLM.
 * Includes: field names, date fields, numeric fields, and sample enum values.
 * This gives the LLM enough context to pick the right tool and parameters.
 */

function detectFieldType(docs: Document[], field: string): "date" | "number" | "string" {
  for (const doc of docs.slice(0, 20)) {
    const val = doc[field];
    if (val === null || val === undefined || val === "") continue;
    if (val instanceof Date) return "date";
    if (typeof val === "number") return "number";
    const s = String(val).trim();
    // Check for date patterns: M/D/YYYY or M/D/YYYY, h:mmam/pm
    if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) return "date";
    // Check for pure numeric strings
    if (/^\d+(\.\d+)?$/.test(s) && s.length < 10) return "number";
  }
  return "string";
}

function getEnumValues(docs: Document[], field: string, maxValues = 8): string[] | null {
  const values = new Set<string>();
  for (const doc of docs.slice(0, 200)) {
    const val = doc[field];
    if (val === null || val === undefined || val === "") continue;
    values.add(String(val).trim());
    if (values.size > maxValues) return null; // Not an enum-like field
  }
  if (values.size === 0 || values.size > maxValues) return null;
  return Array.from(values);
}

export function describeCollection(name: string, docs: Document[]): string {
  if (docs.length === 0) return `${name}: (empty)`;

  // Discover all fields from first 50 docs
  const keySet = new Set<string>();
  for (const doc of docs.slice(0, 50)) {
    for (const key of Object.keys(doc)) {
      if (key !== "_id") keySet.add(key);
    }
  }

  const fields = Array.from(keySet);
  const parts: string[] = [];

  const dateFields: string[] = [];
  const numericFields: string[] = [];
  const enumInfo: string[] = [];

  for (const field of fields) {
    const type = detectFieldType(docs, field);
    if (type === "date") dateFields.push(field);
    if (type === "number") numericFields.push(field);

    // Only check enums for string fields
    if (type === "string") {
      const enums = getEnumValues(docs, field);
      if (enums && enums.length <= 8) {
        enumInfo.push(`${field}=[${enums.join("|")}]`);
      }
    }
  }

  parts.push(`${name}(${docs.length}): ${fields.join(", ")}`);
  if (dateFields.length > 0) parts.push(`  dates: ${dateFields.join(", ")}`);
  if (numericFields.length > 0) parts.push(`  numeric: ${numericFields.join(", ")}`);
  if (enumInfo.length > 0) parts.push(`  enums: ${enumInfo.join("; ")}`);

  return parts.join("\n");
}

export function buildDataContext(data: Record<string, Document[] | undefined>): string {
  const collections: [string, Document[]][] = [
    ["Vehicletracker", data.Vehicletracker ?? []],
    ["Newcomplaintresponses", data.Newcomplaintresponses ?? []],
    ["Vehiclereturnresponses", data.Vehiclereturnresponses ?? []],
    ["Deployementresponses", data.Deployementresponses ?? []],
    ["Rentingdatabase", data.Rentingdatabase ?? []],
    ["Complaindatabase", data.Complaindatabase ?? []],
  ];

  return collections.map(([name, docs]) => describeCollection(name, docs)).join("\n");
}
