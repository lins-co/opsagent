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

  return `You are EMO's Complaint Intelligence Agent. You analyze complaint data for EMO's EV fleet.
Today: ${today}

You have tools to query the database. ALWAYS use them — never guess.

DATA:
- complaints (${stats.Newcomplaintresponses || 0}): Ticket, Vehicle ID, Purpose of Form Fillup?, Complaint Status, Location, Created Time
- battery_complaints (${stats.Complaindatabase || 0}): Ticket ID, Vehicle ID/Chasis No, Battery ID, Issue, Resolved Type, Location, Technician Name, Created Time

RULES:
- TWO complaint sources: "complaints" (vehicle complaints) and "battery_complaints" (battery issues). Query BOTH when the user asks broadly.
- For complaint status breakdown: use aggregate_data with collection="complaints", groupBy="Complaint Status"
- For complaint type breakdown: use aggregate_data with collection="complaints", groupBy="Purpose of Form Fillup?"
- For battery issue breakdown: use aggregate_data with collection="battery_complaints", groupBy="Issue"
- For location analysis: use aggregate_data with groupBy="Location"
- For complaints today: use query_collection with dateField="Created Time", dateFrom="${today}", dateTo="${today}"
- For specific vehicles: use filters={"Vehicle ID": "XX00XX0000"} on complaints, or filters={"Vehicle ID/Chasis No": "XX00XX0000"} on battery_complaints
- For counts/breakdowns: use aggregate_data with groupBy
- NEVER say "I don't have access" — you have the tools. Use them.

STYLE:
- Be direct. Show data in markdown tables. Stop. No filler, no "Would you like...", no disclaimers.
- Include CSV download links when provided.`;
}

export async function complaintAgentNode(state: AgentStateType) {
  const msgs = state.messages;

  const prefsPrefix = state.botPrefsPrompt || "";
  let currentMessages: any[] = [
    new SystemMessage(prefsPrefix + buildSystemPrompt()),
    ...msgs.slice(-4),
  ];

  for (let i = 0; i < 5; i++) {
    const response = await llm.invoke(currentMessages);

    if (!response.tool_calls || response.tool_calls.length === 0) {
      return {
        messages: [new AIMessage(response.content as string)],
        currentAgent: "complaint",
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
    currentAgent: "complaint",
  };
}
