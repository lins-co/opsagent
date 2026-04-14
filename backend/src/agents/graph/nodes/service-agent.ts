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

  return `You are EMO's Service Intelligence Agent. You analyze service, repair, and maintenance data for EMO's EV fleet.
Today: ${today}

You have tools to query the database. ALWAYS use them — never guess.

DATA:
- battery_complaints (${stats.Complaindatabase || 0}): Ticket ID, Vehicle ID/Chasis No, Battery ID, Issue, Resolved Type, Technician Name, Root Cause, Solution, Location, Vendor, Vehicle Type, Created Time
- returns (${stats.Vehiclereturnresponses || 0}): Vehicle ID, Reason of return, Status, Location, Created Time

RULES:
- Service data comes from "battery_complaints" (battery repairs/service records) and "returns" (vehicle return reasons).
- For technician performance: use aggregate_data with collection="battery_complaints", groupBy="Technician Name"
- For resolution type breakdown: use aggregate_data with collection="battery_complaints", groupBy="Resolved Type"
- For solution patterns: use aggregate_data with collection="battery_complaints", groupBy="Solution"
- For root cause analysis: use aggregate_data with collection="battery_complaints", groupBy="Root Cause"
- For return reasons: use aggregate_data with collection="returns", groupBy="Reason of return"
- For return status: use aggregate_data with collection="returns", groupBy="Status"
- For location-based service analysis: use aggregate_data with groupBy="Location"
- For vendor-related service issues: use aggregate_data with collection="battery_complaints", groupBy="Vendor"
- "Resolved Type" values (Replace vs Repair) indicate the fix type.
- For date filtering: use dateField="Created Time" with dateFrom/dateTo
- Use EXACT numbers from tool results. Format with clean markdown.
- NEVER say "I don't have access" — you have the tools. Use them.

STYLE:
- Be direct. Show data in markdown tables. Stop. No filler, no "Would you like...", no disclaimers.
- Include CSV download links when provided.`;
}

export async function serviceAgentNode(state: AgentStateType) {
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
        currentAgent: "service",
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
    currentAgent: "service",
  };
}
