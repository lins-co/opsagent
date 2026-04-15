import { ChatAnthropic } from "@langchain/anthropic";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { AgentStateType } from "../state.js";
import { env } from "../../../config/env.js";

const classifier = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0,
  maxTokens: 100,
});

const SYSTEM_PROMPT = `You are a query router for EMO's EV fleet operations platform.
Classify the user's intent into exactly ONE of these categories:

- fleet: Vehicles, fleet health, vehicle status/lists, "ready to deploy", active vehicles, idle time, fault codes, location data, deployments, returns, vendors, models, rentals (Vehicle ID / Rider Name / Rent Amount / Rent Status), active rides, Rider Deployment Zone
- battery: Battery health, battery complaints, SoH, degradation, charge cycles, temperature, cell imbalance, firmware, battery ID, pack issues, factory battery status (ZEAA/ZEN-E), live SOC/voltage/BMS telemetry, float packs, repair/replace counts
- complaint: Rider complaints, complaint trends, resolution status, recurring issues, complaint lists, new complaints, resolved complaints
- service: Service logs, repairs, root cause, MTTR, technician performance, parts replaced, solutions
- finance: ANYTHING about money — payments, Gencash, transactions, SUCCESS/FAILED txns, collections, revenue, total collected, outstanding balance, invoices, Zoho, tax, GST, invoice status, billing, deposits, payment links, rent links (chatbotrent2), manual links, "how much did we collect", "rider payment history", "who paid today", "unpaid invoices"
- report: Reports, summaries, weekly health, executive briefs, scheduled reports, "overview", "this week"
- csv: Questions referencing uploaded CSV data or file attachments
- general: Chargers, charger tickets (Kazam), charger issues, WhatsApp group questions, group messages, team discussions, greetings, help requests, anything that doesn't fit above

Respond with ONLY the category name, nothing else.`;

export async function routerNode(state: AgentStateType) {
  const lastMessage = state.messages[state.messages.length - 1];
  const userQuery = lastMessage.content as string;

  try {
    const response = await classifier.invoke([
      new SystemMessage(SYSTEM_PROMPT),
      new HumanMessage(userQuery),
    ]);

    const route = (response.content as string).trim().toLowerCase();
    const validRoutes = ["fleet", "battery", "complaint", "service", "report", "csv", "general", "finance"];
    const resolvedRoute = validRoutes.includes(route) ? route : "general";

    return { currentAgent: resolvedRoute };
  } catch {
    return { currentAgent: "general" };
  }
}

export function routeDecision(state: AgentStateType): string {
  return state.currentAgent;
}
