import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import type { AgentStateType } from "../state.js";
import { env } from "../../../config/env.js";
import { getMongoData } from "../../../db/connectors/mongodb.js";
import { getGroupSummaryData } from "../../../channels/whatsapp/client.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.3,
  maxTokens: 4096,
});

function buildReportContext(): string {
  const data = getMongoData();
  if (!data) return "\nNo data loaded.";

  const vehicles = data.Vehicletracker || [];
  const complaints = data.Newcomplaintresponses || [];
  const battComplaints = data.Complaindatabase || [];
  const returns = data.Vehiclereturnresponses || [];
  const deployments = data.Deployementresponses || [];
  const rentals = data.Rentingdatabase || [];

  // Vehicle status (field: "Status")
  const statusCounts: Record<string, number> = {};
  const locationCounts: Record<string, number> = {};
  const modelCounts: Record<string, number> = {};
  vehicles.forEach((v: any) => {
    statusCounts[v["Status"] || "Unknown"] = (statusCounts[v["Status"] || "Unknown"] || 0) + 1;
    locationCounts[v["Location"] || "Unknown"] = (locationCounts[v["Location"] || "Unknown"] || 0) + 1;
    modelCounts[v["Model"] || "Unknown"] = (modelCounts[v["Model"] || "Unknown"] || 0) + 1;
  });

  // Vehicle complaints (Newcomplaintresponses) — field: "Purpose of Form Fillup?", "Complaint Status"
  const purposeCounts: Record<string, number> = {};
  const complaintStatusCounts: Record<string, number> = {};
  complaints.forEach((c: any) => {
    purposeCounts[c["Purpose of Form Fillup?"] || "Unknown"] = (purposeCounts[c["Purpose of Form Fillup?"] || "Unknown"] || 0) + 1;
    complaintStatusCounts[c["Complaint Status"] || "Unknown"] = (complaintStatusCounts[c["Complaint Status"] || "Unknown"] || 0) + 1;
  });

  // Battery complaints (Complaindatabase) — field: "Issue", "Complain Status", "Resolved Type"
  const issueCounts: Record<string, number> = {};
  const resolvedTypeCounts: Record<string, number> = {};
  battComplaints.forEach((c: any) => {
    issueCounts[c["Issue"] || "Unknown"] = (issueCounts[c["Issue"] || "Unknown"] || 0) + 1;
    resolvedTypeCounts[c["Resolved Type"] || "Unknown"] = (resolvedTypeCounts[c["Resolved Type"] || "Unknown"] || 0) + 1;
  });

  // Return reasons
  const returnReasonCounts: Record<string, number> = {};
  returns.forEach((r: any) => {
    returnReasonCounts[r["Reason of return"] || "Unknown"] = (returnReasonCounts[r["Reason of return"] || "Unknown"] || 0) + 1;
  });

  // Rental status
  const rentalStatusCounts: Record<string, number> = {};
  rentals.forEach((r: any) => {
    rentalStatusCounts[r["Status"] || "Unknown"] = (rentalStatusCounts[r["Status"] || "Unknown"] || 0) + 1;
  });

  return `
EMO OPERATIONAL DATA SUMMARY:

═══ FLEET — Vehicletracker (${vehicles.length} vehicles) ═══
By Status: ${Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}
By Location: ${Object.entries(locationCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}
By Model: ${Object.entries(modelCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}

═══ VEHICLE COMPLAINTS — Newcomplaintresponses (${complaints.length} records) ═══
By Purpose: ${Object.entries(purposeCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}
By Complaint Status: ${Object.entries(complaintStatusCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}

═══ BATTERY COMPLAINTS — Complaindatabase (${battComplaints.length} records) ═══
By Issue (top 10): ${Object.entries(issueCounts).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v}`).join(", ")}
By Resolution: ${Object.entries(resolvedTypeCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}

═══ VEHICLE RETURNS — Vehiclereturnresponses (${returns.length} records) ═══
Top Reasons: ${Object.entries(returnReasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(", ")}

═══ DEPLOYMENTS — Deployementresponses (${deployments.length} historical deployment records) ═══

═══ RENTALS — Rentingdatabase (${rentals.length} rental records) ═══
By Status: ${Object.entries(rentalStatusCounts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(", ")}`;
}

export async function reportAgentNode(state: AgentStateType) {
  const msgs = state.messages;
  let context = buildReportContext();

  // Add WhatsApp group context if available
  try {
    const waSummary = await getGroupSummaryData(24);
    if (waSummary.length > 0) {
      context += `\n\n═══ WHATSAPP GROUP ACTIVITY (last 24h) ═══`;
      for (const g of waSummary) {
        context += `\n${g.chatName}: ${g.messageCount} messages`;
        if (g.recentMessages.length > 0) {
          context += ` — Latest topics: ${g.recentMessages.slice(0, 5).map((m: any) => m.text.slice(0, 80)).join(" | ")}`;
        }
      }
    }
  } catch { /* WhatsApp not connected, skip */ }

  const prefsPrefix = state.botPrefsPrompt || "";
  const response = await llm.invoke([
    new SystemMessage(prefsPrefix + `You are EMO's Report Intelligence Agent. Generate operational reports.
Today: ${new Date().toISOString().split("T")[0]}
${context}

CRITICAL RULES:
- TWO complaint sources: Newcomplaintresponses = vehicle complaints, Complaindatabase = battery complaints. Report BOTH separately.
- Deployementresponses (${context.includes("deployment records") ? "historical deployment records" : ""}). This is NOT "active deployments" — it's a log of all deployment events. Fleet size = Vehicletracker count.
- Rentingdatabase = rental records, NOT "active rentals" necessarily. Check Status field.
- Use EXACT numbers from data above. Never inflate or misinterpret.
- Format as a professional report with markdown headers, tables, key metrics, and risk highlights.`),
    ...msgs.slice(-4),
  ]);

  return { messages: [new AIMessage(response.content as string)], currentAgent: "report" };
}
