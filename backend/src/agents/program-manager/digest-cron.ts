// Daily PM DM Digest.
// Collects queued DMs per user and sends ONE consolidated message per user
// at the configured IST hour. Enforces "once per user per day" across all levels.
import cron from "node-cron";
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { isConnected, sendMessage } from "../../channels/whatsapp/client.js";
import { getSetting, isBotMuted, isEnabled } from "../../config/settings.js";
import { phoneToChatId } from "./messenger.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.4,
  maxTokens: 500,
});

let job: ReturnType<typeof cron.schedule> | null = null;
let running = false;

const DIGEST_PROMPT = `You are the program-manager assistant for EMO Energy. You send ONE consolidated WhatsApp DM per day to a teammate summarizing ALL open issues assigned to them.

HARD RULES:
- ≤ 8 short lines total. Plain WhatsApp text (no markdown, no asterisks).
- Start with the recipient's first name and a warm one-liner.
- List issues as numbered items. Each item: one line with issue + vehicle/location + how long open.
- End with a single clear ask: "can you update status by EOD?" — never both a question and a statement.
- If escalation level is 2 or 3 on any item, call it out: "2 items have been flagged for 2+ days."
- NEVER invent IDs, names, or dates. Use only what's given.
- LANGUAGE: English by default. Match user preference if given.`;

interface QueuedItem {
  id: string;
  insightId: string | null;
  level: number;
  text: string;
  insight?: any;
}

async function composeDigest(params: {
  recipientName: string;
  recipientRole: string;
  items: QueuedItem[];
}): Promise<string> {
  const itemsCtx = params.items.map((q, i) => {
    const ins = q.insight;
    if (!ins) return { idx: i + 1, level: q.level, raw: q.text };
    const hoursOpen = Math.round((Date.now() - new Date(ins.firstSeen).getTime()) / 3_600_000);
    return {
      idx: i + 1,
      level: q.level,
      title: ins.title,
      summary: ins.summary,
      severity: ins.severity,
      category: ins.category,
      vehicleIds: ins.vehicleIds?.slice(0, 3) || [],
      location: ins.location,
      hoursOpen,
      reminderCount: ins.reminderCount || 0,
    };
  });

  const ctx = {
    recipient: {
      firstName: params.recipientName.split(/\s+/)[0],
      role: params.recipientRole,
    },
    itemCount: params.items.length,
    maxLevel: Math.max(...params.items.map((i) => i.level)),
    items: itemsCtx,
  };

  try {
    const res = await llm.invoke([
      new SystemMessage(DIGEST_PROMPT),
      new HumanMessage(`Context JSON:\n${JSON.stringify(ctx, null, 2)}\n\nWrite the digest message only, no preface.`),
    ]);
    return (res.content as string).trim().slice(0, 1200);
  } catch {
    // Fallback if LLM fails
    return buildFallbackDigest(params.recipientName, itemsCtx);
  }
}

function buildFallbackDigest(name: string, items: any[]): string {
  const first = name.split(/\s+/)[0];
  const lines = [
    `Hi ${first},`,
    `Quick update — you have ${items.length} open item${items.length > 1 ? "s" : ""} from ops:`,
    ...items.slice(0, 6).map((i) => `${i.idx}. ${i.title || i.raw?.slice(0, 80)} (${i.hoursOpen || 0}h open)`),
    `Can you update status by EOD?`,
  ];
  return lines.join("\n");
}

// The actual cron run — checks if it's time, then flushes.
export async function runDigestCycle(): Promise<void> {
  if (running) return;

  // Check settings
  if (await isBotMuted()) return;
  if (!(await isEnabled("pm.dms_enabled"))) return;
  if (!(await isEnabled("pm.dm_digest_mode"))) return;

  // Check time window — only send during the configured IST hour
  const targetHour = (await getSetting("pm.dm_digest_hour_ist")) as number;
  const nowIst = new Date(Date.now() + 5.5 * 3600_000); // rough IST offset (UTC+5:30)
  const currentHour = nowIst.getUTCHours();
  if (currentHour !== targetHour) return;

  if (!isConnected()) {
    console.log("  [PM Digest] WhatsApp not connected — skipping");
    return;
  }

  running = true;
  try {
    // Find users with queued, unsent DMs, who haven't received a digest in last 22h
    const twentyTwoHoursAgo = new Date(Date.now() - 22 * 3600_000);
    const usersWithQueue = await prisma.pmDmQueue.groupBy({
      by: ["userId"],
      where: { sentAt: null },
      _count: true,
    });

    if (usersWithQueue.length === 0) return;
    console.log(`  [PM Digest] ${usersWithQueue.length} users have queued DMs`);

    const minItems = (await getSetting("pm.dm_digest_min_items")) as number;

    for (const row of usersWithQueue) {
      try {
        await sendDigestToUser(row.userId, twentyTwoHoursAgo, minItems);
      } catch (err: any) {
        console.error(`  [PM Digest] user ${row.userId} failed: ${err?.message}`);
      }
    }
  } finally {
    running = false;
  }
}

async function sendDigestToUser(
  userId: string,
  tooRecentCutoff: Date,
  minItems: number,
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, name: true, phone: true, lastPmDigestAt: true, isActive: true, role: { select: { name: true } } },
  });
  if (!user || !user.isActive || !user.phone) return;

  // Enforce "once per 22h" — skip if already sent recently
  if (user.lastPmDigestAt && user.lastPmDigestAt > tooRecentCutoff) {
    console.log(`  [PM Digest] ${user.name}: already got a digest in the last 22h, skipping`);
    return;
  }

  // Gather queued items + attach insight context
  const queued = await prisma.pmDmQueue.findMany({
    where: { userId, sentAt: null },
    orderBy: [{ level: "desc" }, { createdAt: "asc" }],
    take: 20,
  });
  if (queued.length < minItems) return;

  const insightIds = queued.map((q) => q.insightId).filter(Boolean) as string[];
  const insights = await prisma.waInsight.findMany({
    where: { id: { in: insightIds } },
    select: {
      id: true,
      title: true,
      summary: true,
      severity: true,
      category: true,
      vehicleIds: true,
      location: true,
      firstSeen: true,
      reminderCount: true,
    },
  });
  const insightMap = new Map(insights.map((i) => [i.id, i]));

  const items: QueuedItem[] = queued.map((q) => ({
    id: q.id,
    insightId: q.insightId,
    level: q.level,
    text: q.text,
    insight: q.insightId ? insightMap.get(q.insightId) : undefined,
  }));

  // Compose and send
  const digestText = await composeDigest({
    recipientName: user.name,
    recipientRole: user.role.name,
    items,
  });

  try {
    await sendMessage(phoneToChatId(user.phone), digestText);
    const now = new Date();

    // Mark all items as sent
    await prisma.pmDmQueue.updateMany({
      where: { id: { in: queued.map((q) => q.id) } },
      data: { sentAt: now },
    });

    // Update user's last digest time
    await prisma.user.update({
      where: { id: user.id },
      data: { lastPmDigestAt: now },
    });

    console.log(`  [PM Digest] ✓ Sent to ${user.name} (+${user.phone}) with ${items.length} items`);
  } catch (err: any) {
    console.error(`  [PM Digest] Send to ${user.name} failed: ${err?.message}`);
  }
}

// Manual trigger — admin can force the digest to run now (for testing or ad-hoc flush)
export async function flushDigestNow(): Promise<{ usersSent: number }> {
  if (await isBotMuted()) return { usersSent: 0 };

  const usersWithQueue = await prisma.pmDmQueue.groupBy({
    by: ["userId"],
    where: { sentAt: null },
    _count: true,
  });

  const minItems = (await getSetting("pm.dm_digest_min_items")) as number;
  let sent = 0;
  for (const row of usersWithQueue) {
    const before = await prisma.pmDmQueue.count({ where: { userId: row.userId, sentAt: null } });
    await sendDigestToUser(row.userId, new Date(0), minItems).catch(() => {});
    const after = await prisma.pmDmQueue.count({ where: { userId: row.userId, sentAt: null } });
    if (after < before) sent++;
  }
  return { usersSent: sent };
}

export async function startDigestCron(): Promise<void> {
  if (job) job.stop();
  // Runs every hour at :05 IST — inside runDigestCycle we check if it's the target hour
  job = cron.schedule("5 * * * *", () => { runDigestCycle(); }, { timezone: "Asia/Kolkata" });
  console.log("  [PM Digest Cron] scheduled hourly (IST), fires during the configured digest hour");
}

export async function stopDigestCron(): Promise<void> {
  if (job) { job.stop(); job = null; }
}
