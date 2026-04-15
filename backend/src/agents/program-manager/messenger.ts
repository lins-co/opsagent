// Composes program-manager DMs with the LLM and sends via WhatsApp.
// The LLM gets the full insight context + the recipient's relationship
// to the issue, and writes a short, warm, direct message — not template spam.
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { sendMessage, isConnected } from "../../channels/whatsapp/client.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.5, // a bit more warmth; it's human-facing text
  maxTokens: 300,
});

type Level = 0 | 1 | 2 | 3;

const LEVEL_STYLE: Record<Level, string> = {
  0: "First check-in. Be warm, curious, low-pressure. Acknowledge their workload. One concise question + any specific detail you need.",
  1: "Second nudge (24h later). Still friendly but more direct. Ask what's blocking. Mention how long it's been open.",
  2: "Third attempt + the issue is being escalated to their manager. Be factual and respectful — do not shame. Say the manager is now cc'd so they can help unblock.",
  3: "Leadership-level ping (CEO/admin). Crisp, factual. No pleasantries. State: the issue, who owns it, how long it's been stuck, what's blocking.",
};

const SYSTEM_PROMPT = `You are the program-manager assistant for EMO Energy (India, EV fleet operations).
You send short, respectful WhatsApp DMs to teammates about operational issues.

HARD RULES — breaking these makes the bot useless:
- NEVER invent vehicle IDs, battery IDs, names, or timestamps. Use ONLY what's given.
- ≤ 3 short lines. Plain WhatsApp-friendly text (no markdown, no *asterisks*, no emojis unless the recipient's preference explicitly asks).
- Always start with the recipient's first name.
- End with a clear ask OR a clear statement — never both, never a generic "let me know".
- Don't threaten, shame, or passive-aggressively reference time. State facts.
- If mentioning another teammate (cc), say "I've looped in <Name>" — no more.

LANGUAGE: English by default. If the user's preferences say Hindi or Hinglish, match that.`;

export async function composeFollowupDM(params: {
  insightId: string;
  level: Level;
  recipientName: string;
  recipientRole: string;
  recipientLanguage?: string;
  ccManagerName?: string | null;
}): Promise<string> {
  const insight = await prisma.waInsight.findUnique({
    where: { id: params.insightId },
    select: {
      title: true,
      summary: true,
      severity: true,
      category: true,
      groupName: true,
      vehicleIds: true,
      location: true,
      reporterNames: true,
      firstSeen: true,
      occurrenceCount: true,
      status: true,
    },
  });
  if (!insight) throw new Error(`insight ${params.insightId} not found`);

  const hoursOpen = Math.round((Date.now() - insight.firstSeen.getTime()) / 3_600_000);

  const ctx = {
    recipient: {
      firstName: params.recipientName.split(/\s+/)[0],
      role: params.recipientRole,
      language: params.recipientLanguage || "en",
    },
    escalation: {
      level: params.level,
      style: LEVEL_STYLE[params.level],
      ccManager: params.ccManagerName || null,
    },
    issue: {
      title: insight.title,
      summary: insight.summary,
      severity: insight.severity,
      category: insight.category,
      hoursOpen,
      raisedIn: insight.groupName,
      vehicleIds: insight.vehicleIds.slice(0, 3),
      location: insight.location,
      reportedBy: insight.reporterNames.slice(0, 3),
      seenTimes: insight.occurrenceCount,
    },
  };

  const res = await llm.invoke([
    new SystemMessage(SYSTEM_PROMPT),
    new HumanMessage(
      `Context JSON:\n${JSON.stringify(ctx, null, 2)}\n\nWrite the DM text only, no preface.`,
    ),
  ]);
  return (res.content as string).trim().slice(0, 900);
}

// Turns an E.164-ish phone string into the WA chat ID format.
export function phoneToChatId(phone: string): string {
  const digits = String(phone).replace(/\D/g, "");
  return `${digits}@c.us`;
}

export async function sendPmDM(phone: string, text: string): Promise<void> {
  if (!isConnected()) throw new Error("WhatsApp not connected");
  await sendMessage(phoneToChatId(phone), text);
}
