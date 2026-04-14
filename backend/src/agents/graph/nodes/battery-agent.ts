import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, AIMessage } from "@langchain/core/messages";
import type { AgentStateType } from "../state.js";
import { env } from "../../../config/env.js";
import { getCollectionStats } from "../../../db/connectors/mongodb.js";
import { allTools, executeTool } from "../../../agents/tools/db-tools.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.2,
  maxTokens: 4096,
}).bindTools(allTools);

function buildSystemPrompt(): string {
  const stats = getCollectionStats();
  const today = new Date().toISOString().split("T")[0];

  return `You are EMO's Battery Intelligence Agent. You analyze battery complaint and health data for EMO's EV fleet.
Today: ${today}

You have tools to query the database. ALWAYS use them — never guess.

DATA:
- battery_complaints (${stats.Complaindatabase || 0}): Ticket ID, Vehicle ID/Chasis No, Battery ID, Issue, Resolved Type, Location, Vendor, Vehicle Type, Technician Name, Root Cause, Solution, Created Time
- vehicles (${stats.Vehicletracker || 0}): Vehicle ID, Battery ID, BMS ID, Status, Location, Model, Vendor

RULES:
- Primary data source is "battery_complaints" collection (maps to Complaindatabase).
- For issue breakdown: use aggregate_data with collection="battery_complaints", groupBy="Issue"
- For resolution analysis: use aggregate_data with collection="battery_complaints", groupBy="Resolved Type"
- For vendor analysis: use aggregate_data with collection="battery_complaints", groupBy="Vendor"
- For vehicle type analysis: use aggregate_data with collection="battery_complaints", groupBy="Vehicle Type"
- For location hotspots: use aggregate_data with collection="battery_complaints", groupBy="Location"
- For root cause analysis: use aggregate_data with collection="battery_complaints", groupBy="Root Cause"
- For specific vehicle battery lookup: query vehicles with filters={"Vehicle ID": "XX00XX0000"} to find Battery ID, then query battery_complaints
- For specific battery: use filters={"Battery ID": "ZEN..."} on battery_complaints
- IMPORTANT: The vehicle ID field in battery_complaints is "Vehicle ID/Chasis No" (not "Vehicle ID")
- "Resolved Type" values include: Replace, Repair, Replaced
- For date filtering: use dateField="Created Time" with dateFrom/dateTo
- Note: Full telemetry (SoH, degradation curves) requires IoT/SENS integration. Current data is complaint-based.
- NEVER say "I don't have access" — you have the tools. Use them.

STYLE:
- Be direct. Show data in markdown tables. Stop. No filler, no "Would you like...", no disclaimers.
- Include CSV download links when provided.`;
}

export async function batteryAgentNode(state: AgentStateType) {
  const msgs = state.messages;

  let currentMessages: any[] = [
    new SystemMessage(buildSystemPrompt()),
    ...msgs.slice(-4),
  ];

  for (let i = 0; i < 5; i++) {
    const response = await llm.invoke(currentMessages);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return {
        messages: [new AIMessage(response.content as string)],
        currentAgent: "battery",
      };
    }

    currentMessages.push(response);

    for (const toolCall of response.tool_calls) {
      try {
        const result = await executeTool(toolCall.name, toolCall.args);
        currentMessages.push({
          role: "tool",
          content: result,
          tool_call_id: toolCall.id,
        } as any);
      } catch (err: any) {
        currentMessages.push({
          role: "tool",
          content: JSON.stringify({ error: err.message }),
          tool_call_id: toolCall.id,
        } as any);
      }
    }
  }

  const finalResponse = await llm.invoke(currentMessages);
  return {
    messages: [new AIMessage(finalResponse.content as string)],
    currentAgent: "battery",
  };
}
