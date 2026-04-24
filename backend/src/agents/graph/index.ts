import { StateGraph, END } from "@langchain/langgraph";
import { HumanMessage, AIMessage } from "@langchain/core/messages";
import { AgentState } from "./state.js";
import { routerNode, routeDecision } from "./nodes/router.js";
import { generalAgentNode } from "./nodes/general-agent.js";
import { fleetAgentNode } from "./nodes/fleet-agent.js";
import { batteryAgentNode } from "./nodes/battery-agent.js";
import { complaintAgentNode } from "./nodes/complaint-agent.js";
import { serviceAgentNode } from "./nodes/service-agent.js";
import { reportAgentNode } from "./nodes/report-agent.js";
import { financeAgentNode } from "./nodes/finance-agent.js";
import { runWithContext, type RequestContext } from "../context.js";
import { buildMemoryBlock, extractMemoriesFromTurn } from "../memory/user-memory.js";

const AGENT_LABELS: Record<string, string> = {
  router: "Classifying your query...",
  general: "General Agent is thinking...",
  fleet: "Fleet Agent is analyzing vehicle data...",
  battery: "Battery Agent is analyzing pack health...",
  complaint: "Complaint Agent is reviewing complaint data...",
  service: "Service Agent is checking repair records...",
  report: "Report Agent is generating your report...",
  finance: "Finance Agent is crunching payments and invoices...",
};

// Build the LangGraph
const graph = new StateGraph(AgentState)
  .addNode("router", routerNode)
  .addNode("general", generalAgentNode)
  .addNode("fleet", fleetAgentNode)
  .addNode("battery", batteryAgentNode)
  .addNode("complaint", complaintAgentNode)
  .addNode("service", serviceAgentNode)
  .addNode("report", reportAgentNode)
  .addNode("finance", financeAgentNode)
  .addEdge("__start__", "router")
  .addConditionalEdges("router", routeDecision, {
    general: "general",
    fleet: "fleet",
    battery: "battery",
    complaint: "complaint",
    service: "service",
    report: "report",
    finance: "finance",
    csv: "general",
  })
  .addEdge("general", END)
  .addEdge("fleet", END)
  .addEdge("battery", END)
  .addEdge("complaint", END)
  .addEdge("service", END)
  .addEdge("report", END)
  .addEdge("finance", END);

export const agentGraph = graph.compile();

// Callback for streaming status updates
export type StatusCallback = (status: string, node: string) => void;

export async function invokeAgent(
  message: string,
  options: {
    userId: string;
    userName?: string;
    userRole: string;
    userPhone?: string | null;
    orgScope: string[];
    channel?: RequestContext["channel"];
    conversationHistory?: { role: string; content: string }[];
    onStatus?: StatusCallback;
    botPrefsPrompt?: string;
  }
): Promise<{ response: string; agent: string }> {
  const history = (options.conversationHistory || []).slice(-6);
  const messages = [
    ...history.map((m) =>
      m.role === "assistant"
        ? new AIMessage(m.content.slice(0, 500))
        : new HumanMessage(m.content)
    ),
    new HumanMessage(message),
  ];

  // Load user memory — the bot's accumulated knowledge about this user
  const userMemoryBlock = await buildMemoryBlock(options.userId).catch(() => "");

  const input = {
    messages,
    userId: options.userId,
    userRole: options.userRole,
    orgScope: options.orgScope,
    botPrefsPrompt: options.botPrefsPrompt || "",
    userMemoryBlock,
    userName: options.userName || "",
  };

  // Build request context — carried via AsyncLocalStorage so command tools can read it.
  const ctx: RequestContext = {
    userId: options.userId,
    userName: options.userName || "User",
    userRole: options.userRole,
    userPhone: options.userPhone ?? null,
    allowedLocations: options.orgScope,
    channel: options.channel || "web",
  };

  return runWithContext(ctx, async () => {
    let finalResponse = "";
    let finalAgent = "general";

    const stream = await agentGraph.stream(input, { streamMode: "updates" });

    for await (const chunk of stream) {
      for (const [nodeName, nodeOutput] of Object.entries(chunk)) {
        const label = AGENT_LABELS[nodeName] || `${nodeName} is working...`;
        options.onStatus?.(label, nodeName);

        const output = nodeOutput as any;
        if (output?.currentAgent) finalAgent = output.currentAgent;
        if (output?.messages?.length) {
          const lastMsg = output.messages[output.messages.length - 1];
          if (lastMsg?.content && nodeName !== "router") {
            finalResponse = lastMsg.content as string;
          }
        }
      }
    }

    finalResponse = finalResponse
      .replace(/https?:\/\/api\/exports\//g, "/api/exports/")
      .replace(/\(https?:\/\/[^)]*\/api\/exports\/([^)]+)\)/g, "(/api/exports/$1)");

    // Fire-and-forget memory extraction — runs after response, doesn't delay the user
    // Only if we have a real user message (skip system/empty) and a meaningful response
    if (message.length > 15 && finalResponse.length > 20 && options.userId) {
      extractMemoriesFromTurn({
        userId: options.userId,
        userName: options.userName || "User",
        userMessage: message,
        agentResponse: finalResponse,
      }).catch(() => {});
    }

    return { response: finalResponse, agent: finalAgent };
  });
}
