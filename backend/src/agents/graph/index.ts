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
    userRole: string;
    orgScope: string[];
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

  const input = {
    messages,
    userId: options.userId,
    userRole: options.userRole,
    orgScope: options.orgScope,
    botPrefsPrompt: options.botPrefsPrompt || "",
  };

  let finalResponse = "";
  let finalAgent = "general";

  // Stream node-by-node — emits each time a node finishes
  const stream = await agentGraph.stream(input, { streamMode: "updates" });

  for await (const chunk of stream) {
    // chunk is { nodeName: nodeOutput }
    for (const [nodeName, nodeOutput] of Object.entries(chunk)) {
      // Emit status for each node
      const label = AGENT_LABELS[nodeName] || `${nodeName} is working...`;
      options.onStatus?.(label, nodeName);

      // Extract the agent response from the last node
      const output = nodeOutput as any;
      if (output?.currentAgent) {
        finalAgent = output.currentAgent;
      }
      if (output?.messages?.length) {
        const lastMsg = output.messages[output.messages.length - 1];
        if (lastMsg?.content && nodeName !== "router") {
          finalResponse = lastMsg.content as string;
        }
      }
    }
  }

  // Fix LLM-mangled export URLs: https://api/exports/... or http://api/exports/... → /api/exports/...
  finalResponse = finalResponse
    .replace(/https?:\/\/api\/exports\//g, "/api/exports/")
    .replace(/\(https?:\/\/[^)]*\/api\/exports\/([^)]+)\)/g, "(/api/exports/$1)");

  return { response: finalResponse, agent: finalAgent };
}
