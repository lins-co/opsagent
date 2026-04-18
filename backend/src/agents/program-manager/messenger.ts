// Composes program-manager DMs with the LLM and sends via WhatsApp.
// The LLM gets the full insight context + the recipient's relationship
// to the issue, and writes a short, warm, direct message — not template spam.
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { sendMessage, isConnected } from "../../channels/whatsapp/client.js";
import { isEnabled, isBotMuted, getSetting } from "../../config/settings.js";

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

// Legacy entry point — sends a DM immediately, respecting kill switches.
// For normal PM flow, use queuePmDM() so daily digest batching kicks in.
export async function sendPmDM(phone: string, text: string): Promise<void> {
  if (await isBotMuted()) {
    console.log(`  [PM DM] Skipped — bot is MUTED (would send to +${phone})`);
    return;
  }
  if (!(await isEnabled("pm.dms_enabled"))) {
    console.log(`  [PM DM] Skipped — pm.dms_enabled is OFF (would send to +${phone})`);
    return;
  }
  if (!isConnected()) throw new Error("WhatsApp not connected");
  await sendMessage(phoneToChatId(phone), text);
}

// Queue a DM for later digest delivery. If digest mode is OFF, sends immediately.
// Enforces "once per user per day" when digest mode is ON.
export async function queuePmDM(params: {
  userId: string;
  phone: string;
  text: string;
  insightId?: string;
  level?: number;
  ccManagerId?: string | null;
}): Promise<{ queued: boolean; sent: boolean; reason?: string }> {
  // Master mute
  if (await isBotMuted()) {
    return { queued: false, sent: false, reason: "bot muted" };
  }
  if (!(await isEnabled("pm.dms_enabled"))) {
    return { queued: false, sent: false, reason: "pm.dms_enabled off" };
  }

  const digestMode = await isEnabled("pm.dm_digest_mode");
  if (!digestMode) {
    // Legacy: send immediately
    await sendPmDM(params.phone, params.text);
    return { queued: false, sent: true };
  }

  // Queue for digest — but first, check if user already got a digest today
  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { lastPmDigestAt: true },
  });
  if (user?.lastPmDigestAt) {
    const hoursSince = (Date.now() - user.lastPmDigestAt.getTime()) / 3_600_000;
    if (hoursSince < 22) {
      // Already messaged today — queue it for tomorrow's digest
      console.log(`  [PM DM Queue] User ${params.userId} already got today's digest, queueing for next cycle`);
    }
  }

  // Dedupe: skip if same insight already queued, unsent, for same user
  if (params.insightId) {
    const existing = await prisma.pmDmQueue.findFirst({
      where: {
        userId: params.userId,
        insightId: params.insightId,
        sentAt: null,
      },
    });
    if (existing) {
      // Update level if this is a higher-priority escalation
      if ((params.level || 0) > existing.level) {
        await prisma.pmDmQueue.update({
          where: { id: existing.id },
          data: { level: params.level || 0, text: params.text, ccManagerId: params.ccManagerId || null },
        });
      }
      return { queued: true, sent: false, reason: "deduped" };
    }
  }

  await prisma.pmDmQueue.create({
    data: {
      userId: params.userId,
      insightId: params.insightId || null,
      level: params.level || 0,
      text: params.text,
      ccManagerId: params.ccManagerId || null,
    },
  });

  return { queued: true, sent: false };
}

// ──────────────────────────────────────────────────────────────
// Group follow-up — posts a visible message in the WA group
// tagging the responsible person. More effective than DMs for
// accountability because the whole team sees progress.
// ──────────────────────────────────────────────────────────────

const GROUP_FOLLOWUP_PROMPT = `You are the program-manager bot for EMO Energy, posting a follow-up in a WhatsApp operations group.

HARD RULES:
- ≤ 3 lines. Plain WhatsApp text. No markdown, no asterisks.
- Start with the assignee's first name (they'll see it in the group).
- State the issue clearly (vehicle IDs, category, location if known).
- End with ONE specific ask — "can you confirm status?" or "what's blocking?" — not both.
- If a manager is cc'd, mention them by first name ("Looping in <Manager>").
- NEVER fabricate data. Use only what's provided.
- Be professional and direct — the whole team reads this.`;

export async function composeGroupFollowup(params: {
  insightId: string;
  level: Level;
  assigneeName: string;
  assigneeRole: string;
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
    },
  });
  if (!insight) throw new Error(`insight ${params.insightId} not found`);

  const hoursOpen = Math.round((Date.now() - insight.firstSeen.getTime()) / 3_600_000);

  const ctx = {
    assignee: {
      firstName: params.assigneeName.split(/\s+/)[0],
      role: params.assigneeRole,
    },
    escalation: {
      level: params.level,
      ccManager: params.ccManagerName || null,
    },
    issue: {
      title: insight.title,
      summary: insight.summary,
      severity: insight.severity,
      category: insight.category,
      hoursOpen,
      vehicleIds: insight.vehicleIds.slice(0, 3),
      location: insight.location,
      reportedBy: insight.reporterNames.slice(0, 3),
      seenTimes: insight.occurrenceCount,
    },
  };

  const res = await llm.invoke([
    new SystemMessage(GROUP_FOLLOWUP_PROMPT),
    new HumanMessage(
      `Context JSON:\n${JSON.stringify(ctx, null, 2)}\n\nWrite the group message only, no preface.`,
    ),
  ]);
  return (res.content as string).trim().slice(0, 900);
}

export async function sendGroupFollowup(groupChatId: string, text: string): Promise<void> {
  if (await isBotMuted()) {
    console.log(`  [PM Group] Skipped — bot is MUTED (would post to ${groupChatId})`);
    return;
  }
  if (!(await isEnabled("pm.group_followups_enabled"))) {
    console.log(`  [PM Group] Skipped — pm.group_followups_enabled is OFF (would post to ${groupChatId})`);
    return;
  }
  if (!isConnected()) throw new Error("WhatsApp not connected");
  await sendMessage(groupChatId, text);
}
