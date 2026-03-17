import type { Document } from "mongodb";

/**
 * Build a minimal schema summary — fields + row count only, no samples.
 * Keeps token usage low for rate-limited API tiers.
 */
export function describeCollection(name: string, docs: Document[]): string {
  if (docs.length === 0) return `- ${name}: (empty)`;

  const keySet = new Set<string>();
  for (const doc of docs.slice(0, 20)) {
    for (const key of Object.keys(doc)) {
      if (key !== "_id") keySet.add(key);
    }
  }

  return `- ${name} (${docs.length} rows): ${Array.from(keySet).join(", ")}`;
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
