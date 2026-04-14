import { randomUUID } from "crypto";
import { writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";

const EXPORTS_DIR = path.resolve("src/uploads/exports");

// Ensure exports directory exists
if (!existsSync(EXPORTS_DIR)) {
  mkdirSync(EXPORTS_DIR, { recursive: true });
}

interface ExportResult {
  fileId: string;
  fileName: string;
  filePath: string;
  downloadUrl: string;
  rowCount: number;
  columns: string[];
}

/**
 * Export an array of objects to CSV, save to disk, return download URL.
 * Used by agents when result set is too large to send to the LLM.
 */
export function exportToCSV(
  records: Record<string, any>[],
  fileLabel: string,
): ExportResult {
  if (records.length === 0) {
    throw new Error("No records to export");
  }

  // Collect all unique keys across records
  const columnSet = new Set<string>();
  records.forEach((r) => Object.keys(r).forEach((k) => columnSet.add(k)));
  // Remove internal MongoDB fields
  columnSet.delete("_id");
  columnSet.delete("__v");
  const columns = Array.from(columnSet);

  // Build CSV
  const escapeCSV = (val: any): string => {
    if (val === null || val === undefined) return "";
    const str = String(val);
    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const header = columns.map(escapeCSV).join(",");
  const rows = records.map((r) =>
    columns.map((col) => escapeCSV(r[col])).join(",")
  );
  const csv = [header, ...rows].join("\n");

  // Save
  const fileId = randomUUID().slice(0, 8);
  const safeName = fileLabel.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
  const fileName = `${safeName}_${fileId}.csv`;
  const filePath = path.join(EXPORTS_DIR, fileName);
  writeFileSync(filePath, csv, "utf-8");

  return {
    fileId,
    fileName,
    filePath,
    downloadUrl: `/api/exports/${fileName}`,
    rowCount: records.length,
    columns,
  };
}

/**
 * For agents: if records > threshold, export to CSV and return a summary + download link.
 * If records <= threshold, return the records for the LLM to format as a table.
 */
export function smartExport(
  records: Record<string, any>[],
  fileLabel: string,
  threshold = 20,
): { mode: "inline"; records: Record<string, any>[] } | { mode: "csv"; export: ExportResult; sample: Record<string, any>[] } {
  if (records.length <= threshold) {
    return { mode: "inline", records };
  }

  const result = exportToCSV(records, fileLabel);
  // Return a small sample for the LLM to show a preview
  const sample = records.slice(0, 5);
  return { mode: "csv", export: result, sample };
}
