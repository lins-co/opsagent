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

- fleet: Questions about vehicles, fleet health, vehicle status, vehicle lists/tables, "ready to deploy", active vehicles, idle time, fault codes, ride patterns, location data, deployment, returns, vendors, models, rentals, rent collected, rent amount, balance, payment, revenue
- battery: Questions about battery health, battery complaints, SoH, degradation, charge cycles, temperature, cell imbalance, firmware, battery ID, pack issues
- complaint: Questions about rider complaints, complaint trends, resolution status, recurring issues, complaint lists, new complaints, resolved complaints
- service: Questions about service logs, repairs, root cause, MTTR, technician performance, parts replaced, solutions
- report: Requests for reports, summaries, weekly health, executive briefs, scheduled reports, "overview", "this week"
- csv: Questions referencing uploaded CSV data or file attachments
- general: WhatsApp group questions, group messages, "who texted", team discussions, group activity, greetings, help requests, and anything that doesn't fit above

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
    const validRoutes = ["fleet", "battery", "complaint", "service", "report", "csv", "general"];
    const resolvedRoute = validRoutes.includes(route) ? route : "general";

    return { currentAgent: resolvedRoute };
  } catch {
    return { currentAgent: "general" };
  }
}

export function routeDecision(state: AgentStateType): string {
  return state.currentAgent;
}
