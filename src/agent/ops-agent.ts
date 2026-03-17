import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, type FunctionDeclaration, SchemaType } from "@google/generative-ai";
import type { Document } from "mongodb";
import type { AppData } from "../db/mongo.js";
import { buildDataContext } from "./schema.js";

// ---- Provider detection ----

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const GEMINI_KEY = process.env.GEMINI_API_KEY;

type Provider = "anthropic" | "gemini";

function detectProvider(): Provider {
  if (GEMINI_KEY && GEMINI_KEY !== "your-gemini-api-key-here") return "gemini";
  if (ANTHROPIC_KEY && ANTHROPIC_KEY !== "your-anthropic-api-key-here") return "anthropic";
  throw new Error("No API key configured. Set ANTHROPIC_API_KEY or GEMINI_API_KEY in .env");
}

const PROVIDER = detectProvider();
console.log(`  [llm] Using provider: ${PROVIDER}`);

const SYSTEM_PROMPT = `You are an EV fleet operations agent. Answer questions using the provided tools. Be concise. Use markdown tables for data. Today: ${new Date().toISOString().split("T")[0]}`;

// ---- Tool execution (shared by both providers) ----

function executeTool(
  name: string,
  input: Record<string, any>,
  data: AppData
): string {
  const limit = input.limit || 20;

  const filterDocs = (
    docs: Document[],
    filters: Record<string, string | undefined>,
    maxResults: number
  ): Document[] => {
    let results = docs;
    for (const [field, value] of Object.entries(filters)) {
      if (!value) continue;
      results = results.filter((doc) => {
        const docVal = String(doc[field] || "");
        return docVal.toLowerCase().includes(value.toLowerCase());
      });
    }
    return results.slice(0, maxResults);
  };

  const cleanDoc = (doc: Document): Record<string, any> => {
    const clean: Record<string, any> = {};
    for (const [k, v] of Object.entries(doc)) {
      if (k === "_id") continue;
      if (v === null || v === undefined || v === "") continue;
      if (typeof v === "string" && v.length > 200) {
        clean[k] = v.slice(0, 200) + "...";
      } else {
        clean[k] = v;
      }
    }
    return clean;
  };

  switch (name) {
    case "query_vehicles": {
      const filtered = filterDocs(data.Vehicletracker, {
        "Vehicle ID": input.vehicle_id, Status: input.status,
        Location: input.location, Vendor: input.vendor,
      }, limit);
      return JSON.stringify({ total_matches: filtered.length, records: filtered.map(cleanDoc) });
    }
    case "query_complaints": {
      const filtered = filterDocs(data.Newcomplaintresponses, {
        "Vehicle ID": input.vehicle_id, "Complaint Status": input.status,
        "Purpose of Form Fillup?": input.purpose, Location: input.location,
        "Your Name": input.operator_name,
      }, limit);
      return JSON.stringify({ total_matches: filtered.length, records: filtered.map(cleanDoc) });
    }
    case "query_returns": {
      const filtered = filterDocs(data.Vehiclereturnresponses, {
        "Vehicle ID": input.vehicle_id, Location: input.location,
        "Reason of return": input.reason,
      }, limit);
      return JSON.stringify({ total_matches: filtered.length, records: filtered.map(cleanDoc) });
    }
    case "query_deployments": {
      const filtered = filterDocs(data.Deployementresponses, {
        "Vehicle ID": input.vehicle_id, Location: input.location,
        "Your Name": input.operator_name,
      }, limit);
      return JSON.stringify({ total_matches: filtered.length, records: filtered.map(cleanDoc) });
    }
    case "query_rentals": {
      let docs = data.Rentingdatabase;
      if (input.vehicle_id) {
        docs = docs.filter((d) =>
          String(d["Vehicle ID"] || "").toLowerCase().includes(input.vehicle_id.toLowerCase())
        );
      }
      if (input.overdue_only) {
        const now = new Date();
        docs = docs.filter((d) => {
          const due = d["Rent Due Date"];
          return due ? new Date(String(due)) < now : false;
        });
      }
      return JSON.stringify({ total_matches: docs.length, records: docs.slice(0, limit).map(cleanDoc) });
    }
    case "query_battery_complaints": {
      const filtered = filterDocs(data.Complaindatabase, {
        "Vehicle ID": input.vehicle_id, "Battery ID": input.battery_id,
        Status: input.status, Technician: input.technician,
      }, limit);
      return JSON.stringify({ total_matches: filtered.length, records: filtered.map(cleanDoc) });
    }
    case "aggregate_data": {
      const collection = (data as any)[input.collection] as Document[];
      if (!collection) return JSON.stringify({ error: "Unknown collection" });
      let docs = collection;
      if (input.filter_field && input.filter_value) {
        docs = docs.filter((d) =>
          String(d[input.filter_field] || "").toLowerCase().includes(input.filter_value.toLowerCase())
        );
      }
      if (input.operation === "count") return JSON.stringify({ count: docs.length });
      if (input.operation === "group_by") {
        if (!input.field) return JSON.stringify({ error: "field required" });
        const groups: Record<string, number> = {};
        for (const doc of docs) groups[String(doc[input.field] || "(empty)")] = (groups[String(doc[input.field] || "(empty)")] || 0) + 1;
        return JSON.stringify(Object.fromEntries(Object.entries(groups).sort((a, b) => b[1] - a[1]).slice(0, 30)));
      }
      if (input.operation === "unique_values") {
        if (!input.field) return JSON.stringify({ error: "field required" });
        const unique = [...new Set(docs.map((d) => String(d[input.field] || "")).filter(Boolean))];
        return JSON.stringify({ count: unique.length, values: unique.slice(0, 50) });
      }
      return JSON.stringify({ error: "Unknown operation" });
    }
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

// ==============================
// ANTHROPIC PROVIDER
// ==============================

const anthropicTools: Anthropic.Messages.Tool[] = [
  {
    name: "query_vehicles",
    description: "Search Vehicletracker. Filter by status, location, vendor, vehicle_id.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string", description: "Vehicle ID" },
        status: { type: "string", description: "Status filter" },
        location: { type: "string", description: "Location filter" },
        vendor: { type: "string", description: "Vendor filter" },
        limit: { type: "number", description: "Max records (default 20)" },
      },
      required: [],
    },
  },
  {
    name: "query_complaints",
    description: "Search Newcomplaintresponses. Filter by vehicle_id, status, purpose, location, operator.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, status: { type: "string" },
        purpose: { type: "string", description: "New Complaint or Resolve Complaint" },
        location: { type: "string" }, operator_name: { type: "string" },
        limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "query_returns",
    description: "Search Vehiclereturnresponses. Filter by vehicle_id, location, reason.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, location: { type: "string" },
        reason: { type: "string" }, limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "query_deployments",
    description: "Search Deployementresponses. Filter by vehicle_id, location, operator.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, location: { type: "string" },
        operator_name: { type: "string" }, limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "query_rentals",
    description: "Search Rentingdatabase. Filter by vehicle_id, overdue_only.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, overdue_only: { type: "boolean" },
        limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "query_battery_complaints",
    description: "Search Complaindatabase (battery). Filter by vehicle_id, battery_id, status, technician.",
    input_schema: {
      type: "object" as const,
      properties: {
        vehicle_id: { type: "string" }, battery_id: { type: "string" },
        status: { type: "string" }, technician: { type: "string" },
        limit: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "aggregate_data",
    description: "Aggregate: count, group_by, unique_values on any collection.",
    input_schema: {
      type: "object" as const,
      properties: {
        collection: { type: "string", enum: ["Vehicletracker", "Newcomplaintresponses", "Vehiclereturnresponses", "Deployementresponses", "Rentingdatabase", "Complaindatabase"] },
        operation: { type: "string", enum: ["count", "group_by", "unique_values"] },
        field: { type: "string" }, filter_field: { type: "string" }, filter_value: { type: "string" },
      },
      required: ["collection", "operation"],
    },
  },
];

async function callAnthropicWithRetry(
  fn: () => Promise<Anthropic.Messages.Message>,
  maxRetries = 3
): Promise<Anthropic.Messages.Message> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const isRateLimit = err?.status === 429 || err?.error?.type === "rate_limit_error";
      if (!isRateLimit || attempt === maxRetries) throw err;
      const waitMs = 15000 * Math.pow(2, attempt);
      console.log(`  [rate-limit] Waiting ${waitMs / 1000}s before retry...`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
  throw new Error("Unreachable");
}

const anthropicSessions = new Map<string, Anthropic.Messages.MessageParam[]>();

async function chatAnthropic(sessionId: string, userMessage: string, data: AppData): Promise<string> {
  const anthropic = new Anthropic();
  if (!anthropicSessions.has(sessionId)) anthropicSessions.set(sessionId, []);
  const messages = anthropicSessions.get(sessionId)!;

  const dataContext = buildDataContext(data as any);
  const systemPrompt = `${SYSTEM_PROMPT}\nCollections:\n${dataContext}`;

  messages.push({ role: "user", content: userMessage });

  const createMsg = (msgs: Anthropic.Messages.MessageParam[]) =>
    callAnthropicWithRetry(() =>
      anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        system: systemPrompt,
        tools: anthropicTools,
        messages: msgs,
      })
    );

  let response = await createMsg(messages);

  while (response.stop_reason === "tool_use") {
    messages.push({ role: "assistant", content: response.content });
    const toolResults: Anthropic.Messages.ToolResultBlockParam[] = [];
    for (const block of response.content) {
      if (block.type === "tool_use") {
        console.log(`  [tool] ${block.name}(${JSON.stringify(block.input)})`);
        toolResults.push({
          type: "tool_result",
          tool_use_id: block.id,
          content: executeTool(block.name, block.input as Record<string, any>, data),
        });
      }
    }
    messages.push({ role: "user", content: toolResults });
    response = await createMsg(messages);
  }

  const answer = response.content
    .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  messages.push({ role: "assistant", content: response.content });
  if (messages.length > 10) anthropicSessions.set(sessionId, messages.slice(-10));
  return answer;
}

// ==============================
// GEMINI PROVIDER
// ==============================

const geminiToolDeclarations: FunctionDeclaration[] = [
  {
    name: "query_vehicles",
    description: "Search Vehicletracker. Filter by status, location, vendor, vehicle_id.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING, description: "Vehicle ID" },
        status: { type: SchemaType.STRING, description: "Status filter" },
        location: { type: SchemaType.STRING, description: "Location filter" },
        vendor: { type: SchemaType.STRING, description: "Vendor filter" },
        limit: { type: SchemaType.NUMBER, description: "Max records" },
      },
    },
  },
  {
    name: "query_complaints",
    description: "Search Newcomplaintresponses. Filter by vehicle_id, status, purpose, location, operator.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, status: { type: SchemaType.STRING },
        purpose: { type: SchemaType.STRING, description: "New Complaint or Resolve Complaint" },
        location: { type: SchemaType.STRING }, operator_name: { type: SchemaType.STRING },
        limit: { type: SchemaType.NUMBER },
      },
    },
  },
  {
    name: "query_returns",
    description: "Search Vehiclereturnresponses. Filter by vehicle_id, location, reason.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, location: { type: SchemaType.STRING },
        reason: { type: SchemaType.STRING }, limit: { type: SchemaType.NUMBER },
      },
    },
  },
  {
    name: "query_deployments",
    description: "Search Deployementresponses. Filter by vehicle_id, location, operator.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, location: { type: SchemaType.STRING },
        operator_name: { type: SchemaType.STRING }, limit: { type: SchemaType.NUMBER },
      },
    },
  },
  {
    name: "query_rentals",
    description: "Search Rentingdatabase. Filter by vehicle_id, overdue_only.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, overdue_only: { type: SchemaType.BOOLEAN },
        limit: { type: SchemaType.NUMBER },
      },
    },
  },
  {
    name: "query_battery_complaints",
    description: "Search Complaindatabase (battery). Filter by vehicle_id, battery_id, status, technician.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        vehicle_id: { type: SchemaType.STRING }, battery_id: { type: SchemaType.STRING },
        status: { type: SchemaType.STRING }, technician: { type: SchemaType.STRING },
        limit: { type: SchemaType.NUMBER },
      },
    },
  },
  {
    name: "aggregate_data",
    description: "Aggregate: count, group_by, unique_values on any collection.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        collection: { type: SchemaType.STRING, description: "Collection name" },
        operation: { type: SchemaType.STRING, description: "count, group_by, or unique_values" },
        field: { type: SchemaType.STRING }, filter_field: { type: SchemaType.STRING },
        filter_value: { type: SchemaType.STRING },
      },
      required: ["collection", "operation"],
    },
  },
];

// Simple in-memory session for Gemini (stores text history)
const geminiSessions = new Map<string, Array<{ role: string; parts: any[] }>>();

async function chatGemini(sessionId: string, userMessage: string, data: AppData): Promise<string> {
  const genAI = new GoogleGenerativeAI(GEMINI_KEY!);
  const dataContext = buildDataContext(data as any);

  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: `${SYSTEM_PROMPT}\nCollections:\n${dataContext}`,
    tools: [{ functionDeclarations: geminiToolDeclarations }],
  });

  if (!geminiSessions.has(sessionId)) geminiSessions.set(sessionId, []);
  const history = geminiSessions.get(sessionId)!;

  const chat = model.startChat({ history });

  let response = await chat.sendMessage(userMessage);
  let result = response.response;

  // Tool use loop
  let maxLoops = 5;
  while (maxLoops-- > 0) {
    const calls = result.functionCalls();
    if (!calls || calls.length === 0) break;

    const functionResponses = calls.map((call) => {
      console.log(`  [tool] ${call.name}(${JSON.stringify(call.args)})`);
      const toolResult = executeTool(call.name, call.args as Record<string, any>, data);
      return {
        functionResponse: {
          name: call.name,
          response: JSON.parse(toolResult),
        },
      };
    });

    response = await chat.sendMessage(functionResponses);
    result = response.response;
  }

  const answer = result.text();

  // Save history (keep last 10 turns)
  const updatedHistory = await chat.getHistory();
  if (updatedHistory.length > 20) {
    geminiSessions.set(sessionId, updatedHistory.slice(-20));
  } else {
    geminiSessions.set(sessionId, updatedHistory);
  }

  return answer;
}

// ==============================
// PUBLIC API
// ==============================

export async function chat(sessionId: string, userMessage: string, data: AppData): Promise<string> {
  const providers: Array<{ name: string; fn: () => Promise<string> }> = [];

  if (GEMINI_KEY && GEMINI_KEY !== "your-gemini-api-key-here") {
    providers.push({ name: "gemini", fn: () => chatGemini(sessionId, userMessage, data) });
  }
  if (ANTHROPIC_KEY && ANTHROPIC_KEY !== "your-anthropic-api-key-here") {
    providers.push({ name: "anthropic", fn: () => chatAnthropic(sessionId, userMessage, data) });
  }

  // Try each provider, fall back to next on failure
  for (const provider of providers) {
    try {
      console.log(`  [llm] Trying ${provider.name}...`);
      return await provider.fn();
    } catch (err: any) {
      console.log(`  [llm] ${provider.name} failed: ${err.message?.slice(0, 100)}`);
    }
  }

  return "Both LLM providers are currently rate-limited. This query isn't handled by the local engine. Please try again in a minute, or rephrase to match a known query pattern.";
}

export function clearSession(sessionId: string) {
  anthropicSessions.delete(sessionId);
  geminiSessions.delete(sessionId);
}
