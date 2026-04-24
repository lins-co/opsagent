// Daily briefing cron — sends each subscribed user a personalized summary
// of their open work at their configured IST hour. One per day per user.
import cron from "node-cron";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { isBotMuted } from "../../config/settings.js";
import { isConnected, sendMessage } from "../../channels/whatsapp/client.js";
import { phoneToChatId } from "../program-manager/messenger.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.3,
  maxTokens: 700,
});

let job: ReturnType<typeof cron.schedule> | null = null;
let running = false;

const BRIEFING_PROMPT = `You are EMO's program-manager assistant writing a personalized morning briefing for a teammate.

HARD RULES:
- ≤ 12 short lines. Plain WhatsApp text (no markdown, no asterisks).
- Start with a warm one-line greeting using the recipient's first name + today's date.
- Sections in this order (skip if empty):
  1) "On your plate:" — their assigned open insights (numbered, with severity + age in days)
  2) "You reported:" — insights they raised, current status
  3) "Team focus (your scope):" — critical issues in their org/category (managers+ only)
  4) "Suggested action:" — ONE concrete thing to do today
- Use plain language. No jargon, no emojis except a leading 🌅.
- NEVER invent IDs, names, or dates. Use only what's given.`;

interface BriefingContext {
  user: { firstName: string; role: string; focus?: string };
  date: string;
  assigned: Array<{ title: string; severity: string; daysOpen: number; reminderCount: number; category: string | null }>;
  reported: Array<{ title: string; status: string }>;
  teamCritical: Array<{ title: string; severity: string; category: string | null; occurrenceCount: number }>;
}

function daysSince(d: Date): number {
  return Math.max(0, Math.floor((Date.now() - d.getTime()) / 86400_000));
}

async function composeBriefing(ctx: BriefingContext): Promise<string> {
  try {
    const res = await llm.invoke([
      new SystemMessage(BRIEFING_PROMPT),
      new HumanMessage(`Context JSON:\n${JSON.stringify(ctx, null, 2)}\n\nWrite the briefing only, no preface.`),
    ]);
    return (res.content as string).trim().slice(0, 1500);
  } catch {
    return fallbackBriefing(ctx);
  }
}

function fallbackBriefing(ctx: BriefingContext): string {
  const lines = [`🌅 Good morning ${ctx.user.firstName}, ${ctx.date}`];
  if (ctx.assigned.length > 0) {
    lines.push("", "On your plate:");
    ctx.assigned.slice(0, 5).forEach((i, idx) =>
      lines.push(`${idx + 1}. ${i.title} (${i.severity}, ${i.daysOpen}d open)`),
    );
  }
  if (ctx.reported.length > 0) {
    lines.push("", "You reported:");
    ctx.reported.slice(0, 3).forEach((i) => lines.push(`· ${i.title} — ${i.status}`));
  }
  if (ctx.teamCritical.length > 0) {
    lines.push("", "Team focus:");
    ctx.teamCritical.slice(0, 3).forEach((i) => lines.push(`· ${i.title} (${i.severity}, ${i.occurrenceCount}×)`));
  }
  if (ctx.assigned.length === 0 && ctx.reported.length === 0) {
    lines.push("", "Nothing open on your plate. Enjoy the day.");
  }
  return lines.join("\n");
}

async function isManagerPlus(role: string): Promise<boolean> {
  return ["admin", "ceo", "coo", "cto", "vp", "manager"].includes(role);
}

async function sendBriefingToUser(user: any): Promise<boolean> {
  const assigned = await prisma.waInsight.findMany({
    where: { assignedUserId: user.id, status: "open" },
    orderBy: [{ severity: "asc" }, { lastSeen: "desc" }],
    take: 10,
  });

  const reported = await prisma.waInsight.findMany({
    where: { reporterNames: { has: user.name }, status: { in: ["open", "in_progress"] } },
    orderBy: { lastSeen: "desc" },
    take: 5,
  });

  const isMgr = await isManagerPlus(user.role.name);
  const teamCritical = isMgr
    ? await prisma.waInsight.findMany({
        where: { status: "open", severity: { in: ["critical", "high"] } },
        orderBy: { occurrenceCount: "desc" },
        take: 5,
      })
    : [];

  // Skip if literally nothing to report (except for admins/managers who always get a brief)
  if (!isMgr && assigned.length === 0 && reported.length === 0) return false;

  const ctx: BriefingContext = {
    user: {
      firstName: user.name.split(/\s+/)[0],
      role: user.role.name,
      focus: user.briefingFocus || undefined,
    },
    date: new Date().toLocaleDateString("en-IN", { weekday: "long", month: "short", day: "numeric" }),
    assigned: assigned.map((i) => ({
      title: i.title,
      severity: i.severity,
      daysOpen: daysSince(i.firstSeen),
      reminderCount: i.reminderCount || 0,
      category: i.category,
    })),
    reported: reported.map((i) => ({ title: i.title, status: i.status })),
    teamCritical: teamCritical.map((i) => ({
      title: i.title,
      severity: i.severity,
      category: i.category,
      occurrenceCount: i.occurrenceCount,
    })),
  };

  const text = await composeBriefing(ctx);

  // Deliver via configured channel
  if (user.briefingChannel === "whatsapp" || user.briefingChannel === "both") {
    if (user.phone && isConnected()) {
      await sendMessage(phoneToChatId(user.phone), text);
    }
  }
  // Email channel — left as a no-op here (Resend integration lives in scheduler.ts if needed)

  await prisma.user.update({ where: { id: user.id }, data: { lastBriefingAt: new Date() } });
  console.log(`  [Briefing] Sent to ${user.name} (+${user.phone})`);
  return true;
}

export async function runBriefingCycle(): Promise<void> {
  if (running) return;
  if (await isBotMuted()) return;
  if (!isConnected()) return;

  running = true;
  try {
    // Current IST hour
    const nowIst = new Date(Date.now() + 5.5 * 3600_000);
    const currentHour = nowIst.getUTCHours();

    // Find users whose briefing hour matches, who are active, have a phone, and haven't
    // received a briefing in the last 22 hours
    const cutoff = new Date(Date.now() - 22 * 3600_000);

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        briefingEnabled: true,
        briefingHourIst: currentHour,
        phone: { not: null },
        OR: [{ lastBriefingAt: null }, { lastBriefingAt: { lt: cutoff } }],
      },
      include: { role: { select: { name: true } } },
    });

    if (users.length === 0) return;
    console.log(`  [Briefing] ${users.length} users due at hour ${currentHour} IST`);

    for (const u of users) {
      try {
        await sendBriefingToUser(u);
      } catch (err: any) {
        console.warn(`  [Briefing] ${u.name} failed: ${err?.message}`);
      }
    }
  } finally {
    running = false;
  }
}

// Manual trigger — used by the send_daily_brief tool
export async function triggerBriefingForUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { role: { select: { name: true } } },
  });
  if (!user || !user.isActive) return false;
  return sendBriefingToUser(user);
}

export async function startBriefingCron(): Promise<void> {
  if (job) job.stop();
  // Fires every hour at :05 IST; each run checks if anyone's hour matches
  job = cron.schedule("5 * * * *", () => { runBriefingCycle(); }, { timezone: "Asia/Kolkata" });
  console.log("  [Briefing Cron] scheduled hourly (IST)");
}

export async function stopBriefingCron(): Promise<void> {
  if (job) { job.stop(); job = null; }
}
