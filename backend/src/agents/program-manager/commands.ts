// Lightweight command parser for PM actions in the WhatsApp DM bot.
// Returns a reply string if the text matched a command, else null so
// the main agent can handle it normally.
import { prisma } from "../../db/prisma.js";
import { nextBusinessTime } from "./roster.js";

const MY_ITEMS = /^(my\s+(open\s+)?items|my\s+(tasks|assignments|plate|work)|what'?s\s+on\s+my\s+plate)\b/i;
const DEFER = /^defer\s+(?<id>[a-f0-9-]{6,})\s+(?<n>\d+)\s*(?<unit>hour|hr|h|day|d)s?\b/i;
const RESOLVE = /^resolve(?:d)?\s+(?<id>[a-f0-9-]{6,})(?:\s+(?<note>.+))?/i;
const ESCALATE = /^escalate\s+(?<id>[a-f0-9-]{6,})\b/i;
const STATUS = /^status\s+(?<id>[a-f0-9-]{6,})\b/i;

export async function tryPmCommand(userId: string, text: string): Promise<string | null> {
  const t = text.trim();

  if (MY_ITEMS.test(t)) return listMyItems(userId);

  const d = t.match(DEFER);
  if (d?.groups) return deferItem(userId, d.groups.id, parseInt(d.groups.n), d.groups.unit);

  const r = t.match(RESOLVE);
  if (r?.groups) return resolveItem(userId, r.groups.id, r.groups.note);

  const e = t.match(ESCALATE);
  if (e?.groups) return escalateItem(userId, e.groups.id);

  const s = t.match(STATUS);
  if (s?.groups) return statusItem(s.groups.id);

  return null;
}

async function listMyItems(userId: string): Promise<string> {
  const items = await prisma.waInsight.findMany({
    where: { assignedUserId: userId, status: "open" },
    orderBy: [{ severity: "asc" }, { firstSeen: "asc" }],
    take: 10,
  });
  if (items.length === 0) return "You have no open items. Nice.";

  const lines = items.map((i) => {
    const short = i.id.slice(0, 6);
    const age = Math.round((Date.now() - i.firstSeen.getTime()) / 3_600_000);
    const vids = i.vehicleIds.slice(0, 2).join(",");
    const reminder = i.reminderCount > 0 ? ` · pinged ${i.reminderCount}x` : "";
    return `• [${short}] ${i.title}${vids ? ` (${vids})` : ""} — ${i.severity}, ${age}h old${reminder}`;
  });
  return `Your open items (${items.length}):\n\n${lines.join("\n")}\n\nReply: "defer <id> 2d", "resolved <id>", "status <id>", or "escalate <id>".`;
}

async function deferItem(userId: string, idPrefix: string, n: number, unit: string): Promise<string> {
  const ins = await findMine(userId, idPrefix);
  if (!ins) return `No open item starting with ${idPrefix} assigned to you.`;

  const hours = /h|hour|hr/i.test(unit) ? n : n * 24;
  const until = nextBusinessTime(new Date(Date.now() + hours * 3_600_000));
  await prisma.waInsight.update({
    where: { id: ins.id },
    data: { deferredUntil: until, followupAt: until },
  });
  return `Deferred "${ins.title.slice(0, 60)}" until ${until.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} IST.`;
}

async function resolveItem(userId: string, idPrefix: string, note?: string): Promise<string> {
  const ins = await findMine(userId, idPrefix);
  if (!ins) return `No open item starting with ${idPrefix} assigned to you.`;

  await prisma.waInsight.update({
    where: { id: ins.id },
    data: {
      status: "resolved",
      resolvedAt: new Date(),
      resolvedBy: userId,
      pmNotes: note ? `${ins.pmNotes || ""}\nresolved by user: ${note}` : ins.pmNotes,
    },
  });
  return `Closed "${ins.title.slice(0, 60)}". Thanks.`;
}

async function escalateItem(userId: string, idPrefix: string): Promise<string> {
  const ins = await findMine(userId, idPrefix);
  if (!ins) return `No open item starting with ${idPrefix} assigned to you.`;
  // Bump followup to now — cron will pick it up and run the next escalation level.
  await prisma.waInsight.update({
    where: { id: ins.id },
    data: {
      followupAt: new Date(Date.now() - 60_000),
      pmNotes: `${ins.pmNotes || ""}\nmanually escalated by assignee`,
    },
  });
  return `Flagged for immediate escalation. The manager will be notified on the next PM cycle.`;
}

async function statusItem(idPrefix: string): Promise<string> {
  // UUID prefix match isn't supported by Prisma's UuidFilter — fetch candidates
  // by anyone's recent open items and match in JS. IDs are short-display-only
  // 6-char prefixes, so scan is cheap (<100 rows in practice).
  const candidates = await prisma.waInsight.findMany({
    orderBy: { updatedAt: "desc" },
    take: 200,
    include: { assignedUser: { select: { name: true } } },
  });
  const ins = candidates.find((c) => c.id.startsWith(idPrefix));
  if (!ins) return `No item starting with ${idPrefix}.`;
  const age = Math.round((Date.now() - ins.firstSeen.getTime()) / 3_600_000);
  const owner = (ins as any).assignedUser?.name || "unassigned";
  const next = ins.followupAt ? ins.followupAt.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }) : "—";
  return `${ins.title}\nStatus: ${ins.status}\nOwner: ${owner}\nSeverity: ${ins.severity}\nAge: ${age}h · reminders: ${ins.reminderCount}\nNext follow-up: ${next}`;
}

async function findMine(userId: string, idPrefix: string) {
  const mine = await prisma.waInsight.findMany({
    where: { assignedUserId: userId, status: "open" },
    orderBy: { firstSeen: "desc" },
    take: 50,
  });
  return mine.find((i) => i.id.startsWith(idPrefix)) || null;
}
