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

  return `You are EMO's Fleet Intelligence Agent. You analyze EV fleet data.
Today: ${today}

You have tools to query the database. ALWAYS use them — never guess.

DATA:
- vehicles (${stats.Vehicletracker || 0}): Status (Active/Under Maintenance/Ready to Deploy/Accidental/Missing/Pending), Location, Model, Vendor, Rider Name, Battery ID, Vehicle ID, Deployed Date, Last Active Date
- deployments (${stats.Deployementresponses || 0}): Vehicle ID, Location, Created Time, Rider Deployment Zone, Rider Name, Battery Serial No, Rent Start Date, Vendor
- returns (${stats.Vehiclereturnresponses || 0}): Vehicle ID, Location, Reason of return, Status, Created Time
- rentals (${stats.Rentingdatabase || 0}): Vehicle ID, Rider Name, Status, Location, "Rent Amount" (number, weekly), "Balance Amount" (number, outstanding), "Deposit Amount" (number), "Perday_Collection_Amount", "Payment Weeks Paid" (number), "Rent Status" (Paid/Unpaid), "AmountStatus" (Collected/etc), "Rent Start Date", "Rent Due Date"

QUERIES:
- "deployed today": deployments, dateField="Created Time", dateFrom="${today}", dateTo="${today}"
- "vehicles in Delhi": vehicles, filters={"Location": "Delhi"}
- vehicle lookup: vehicles, filters={"Vehicle ID": "XX00XX0000"}
- counts: aggregate_data with groupBy
- rent totals: aggregate_data, operation="sum", sumField="Rent Amount", collection="rentals"
- balance totals: aggregate_data, operation="sum", sumField="Balance Amount", collection="rentals"

SANDBOX: Use run_analysis for complex multi-step calculations (revenue per vehicle, correlations, trends). It has full data access + helper functions.

STYLE:
- Be direct. Show data in markdown tables. Stop. No filler, no "Would you like...", no disclaimers.
- NEVER ask clarifying questions if you can compute the answer. Just compute it.
- Include CSV download links when provided.`;
}

export async function fleetAgentNode(state: AgentStateType) {
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
        currentAgent: "fleet",
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
    currentAgent: "fleet",
  };
}
