// Command tools — chat-as-admin-console.
// Each tool checks role authorization via permissions.ts, logs to AuditLog,
// and returns a structured JSON result. Destructive actions require a typed
// confirmation token to avoid accidental fires.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import crypto from "crypto";
import { prisma } from "../../db/prisma.js";
import { getContext } from "../context.js";
import { canDo, forbiddenMessage, isDestructive, type Permission } from "../../auth/permissions.js";
import { setSetting } from "../../config/settings.js";
import { sendMessage, isConnected } from "../../channels/whatsapp/client.js";
import { phoneToChatId } from "../program-manager/messenger.js";
import { triggerBriefingForUser } from "../intelligence/briefing-cron.js";

// ── Audit helper ──
async function audit(action: string, resource: string | null, details: any): Promise<void> {
  try {
    const ctx = getContext();
    await prisma.auditLog.create({
      data: {
        userId: ctx.userId,
        action: `cmd.${action}`,
        resource: resource || null,
        details: details || {},
        channel: ctx.channel,
      },
    });
  } catch {}
}

// ── Rate limit tracker (in-memory, per-user per-action) ──
const rateBucket = new Map<string, number[]>();
function isRateLimited(userId: string, action: string, maxPerDay: number): boolean {
  const key = `${userId}:${action}`;
  const now = Date.now();
  const dayAgo = now - 24 * 3600_000;
  const hits = (rateBucket.get(key) || []).filter((t) => t > dayAgo);
  if (hits.length >= maxPerDay) return true;
  hits.push(now);
  rateBucket.set(key, hits);
  return false;
}

// ── Confirmation tokens for destructive ops ──
// Token is a short string (time + random) that the agent relays to the user.
// User echoes it back to confirm. We check against a short-lived set.
const pendingConfirmations = new Map<string, { userId: string; action: string; expires: number }>();
function mintToken(userId: string, action: string): string {
  const token = crypto.randomBytes(4).toString("hex");
  pendingConfirmations.set(token, { userId, action, expires: Date.now() + 5 * 60_000 });
  return token;
}
function checkToken(userId: string, action: string, token?: string): boolean {
  if (!token) return false;
  const entry = pendingConfirmations.get(token);
  if (!entry) return false;
  if (entry.userId !== userId || entry.action !== action) return false;
  if (entry.expires < Date.now()) { pendingConfirmations.delete(token); return false; }
  pendingConfirmations.delete(token); // single-use
  return true;
}

// Helper: require permission. Returns forbidden JSON if not allowed, else null.
function requirePerm(action: Permission): string | null {
  const ctx = getContext();
  if (!canDo(ctx.userRole, action)) return forbiddenMessage(ctx.userRole, action);
  return null;
}

// Helper: require confirmation for destructive. Returns confirmation prompt or null.
function requireConfirmation(action: Permission, actionKey: string, summary: string, token?: string): string | null {
  if (!isDestructive(action)) return null;
  const ctx = getContext();
  if (token && checkToken(ctx.userId, actionKey, token)) return null; // confirmed
  const newToken = mintToken(ctx.userId, actionKey);
  return JSON.stringify({
    needs_confirmation: true,
    message: summary,
    confirmation_token: newToken,
    instructions: "This is a destructive action. To proceed, ask the user to confirm. On confirmation, call this tool again with confirm_token set to the token above.",
  });
}

// ══════════════════════════════════════════════════════
// 1. MUTE BOT — global kill switch
// ══════════════════════════════════════════════════════
export const muteBotTool = tool(
  async ({ duration, reason, confirm_token }) => {
    const forbidden = requirePerm("notifications.mute_bot");
    if (forbidden) return forbidden;

    const ctx = getContext();
    const summary = `Mute the ENTIRE bot for ${duration}. This stops: PM DMs, group follow-ups, proactive replies. User-initiated responses still work.`;
    const confirmCheck = requireConfirmation("notifications.mute_bot", `mute:${duration}`, summary, confirm_token);
    if (confirmCheck) return confirmCheck;

    const now = new Date();
    let untilIso = "";
    if (duration !== "indef") {
      const hours = duration === "1h" ? 1 : duration === "4h" ? 4 : duration === "24h" ? 24 : 0;
      if (hours > 0) untilIso = new Date(now.getTime() + hours * 3600_000).toISOString();
    }

    await Promise.all([
      setSetting("bot.muted", true),
      setSetting("bot.muted_until", untilIso),
      setSetting("bot.muted_reason", reason || ""),
      setSetting("bot.muted_by", ctx.userId),
      setSetting("bot.muted_at", now.toISOString()),
    ]);
    await audit("mute_bot", null, { duration, reason });

    return JSON.stringify({ ok: true, mutedFor: duration, until: untilIso || "indefinite", reason: reason || null });
  },
  {
    name: "mute_bot",
    description: "Mute ALL bot notifications (PM DMs, group follow-ups, proactive replies). Admin/CEO/COO only. DESTRUCTIVE — first call returns a confirmation token, then call again with confirm_token to proceed.",
    schema: z.object({
      duration: z.enum(["1h", "4h", "24h", "indef"]),
      reason: z.string().optional(),
      confirm_token: z.string().optional().describe("Token returned from first call — pass back on confirmation"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 2. UNMUTE BOT
// ══════════════════════════════════════════════════════
export const unmuteBotTool = tool(
  async () => {
    const forbidden = requirePerm("notifications.unmute_bot");
    if (forbidden) return forbidden;

    await Promise.all([
      setSetting("bot.muted", false),
      setSetting("bot.muted_until", ""),
      setSetting("bot.muted_reason", ""),
    ]);
    await audit("unmute_bot", null, {});
    return JSON.stringify({ ok: true, message: "Bot unmuted. Notifications resumed." });
  },
  {
    name: "unmute_bot",
    description: "Resume all bot notifications. Admin/CEO/COO only.",
    schema: z.object({}),
  },
);

// ══════════════════════════════════════════════════════
// 3. ASSIGN INSIGHT — manually route an issue to a user
// ══════════════════════════════════════════════════════
export const assignInsightTool = tool(
  async ({ insightId, assigneeName, reason }) => {
    const forbidden = requirePerm("insights.assign");
    if (forbidden) return forbidden;

    const ctx = getContext();
    // Resolve assignee by name (fuzzy)
    const users = await prisma.user.findMany({
      where: { isActive: true, name: { contains: assigneeName, mode: "insensitive" } },
      select: { id: true, name: true, phone: true, role: { select: { name: true } } },
    });
    if (users.length === 0) return JSON.stringify({ error: `No active user matching '${assigneeName}'` });
    if (users.length > 1) return JSON.stringify({ error: `Ambiguous — ${users.length} matches: ${users.map((u) => u.name).join(", ")}. Be more specific.` });

    const assignee = users[0];
    const insight = await prisma.waInsight.findUnique({ where: { id: insightId } });
    if (!insight) return JSON.stringify({ error: "Insight not found" });

    await prisma.waInsight.update({
      where: { id: insightId },
      data: {
        assignedUserId: assignee.id,
        assignedAt: new Date(),
        assignmentReason: (reason || `Manually assigned by ${ctx.userName}`).slice(0, 500),
        // Reset reminder count so PM follow-up starts fresh
        reminderCount: 0,
        followupAt: new Date(Date.now() + 2 * 3600_000),
      },
    });
    await audit("assign_insight", insightId, { assigneeId: assignee.id, assigneeName: assignee.name, reason });

    return JSON.stringify({
      ok: true,
      insight: { id: insightId, title: insight.title },
      assignedTo: { name: assignee.name, role: assignee.role.name },
      nextFollowup: "in 2 hours",
    });
  },
  {
    name: "assign_insight",
    description: "Manually assign (or reassign) an insight to a specific user. Resets follow-up clock. Use when the auto-assignment is wrong or the user wants to override.",
    schema: z.object({
      insightId: z.string().describe("UUID of the insight"),
      assigneeName: z.string().describe("Full or partial name of the person to assign to"),
      reason: z.string().optional().describe("Why you're assigning (for audit)"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 4. RESOLVE INSIGHT
// ══════════════════════════════════════════════════════
export const resolveInsightTool = tool(
  async ({ insightId, notes }) => {
    const ctx = getContext();
    const insight = await prisma.waInsight.findUnique({ where: { id: insightId } });
    if (!insight) return JSON.stringify({ error: "Insight not found" });

    // Own-vs-any check
    const isOwn = insight.assignedUserId === ctx.userId || (insight.reporterNames as string[]).includes(ctx.userName);
    const perm: Permission = isOwn ? "insights.resolve_own" : "insights.resolve_any";
    const forbidden = requirePerm(perm);
    if (forbidden) return forbidden;

    await prisma.waInsight.update({
      where: { id: insightId },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
        resolvedBy: ctx.userId,
        notes: ((insight.notes || "") + `\n[${new Date().toISOString().slice(0, 10)} ${ctx.userName}] ${notes || "marked resolved"}`).slice(-2000),
      },
    });
    await audit("resolve_insight", insightId, { notes });
    return JSON.stringify({ ok: true, insight: { id: insightId, title: insight.title, status: "resolved" } });
  },
  {
    name: "resolve_insight",
    description: "Mark an insight as resolved with optional notes. Anyone can resolve their own; managers+ can resolve anyone's.",
    schema: z.object({
      insightId: z.string(),
      notes: z.string().optional().describe("What was done to resolve it"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 5. CREATE SCHEDULED REPORT (automation)
// ══════════════════════════════════════════════════════
export const createAutomationTool = tool(
  async ({ name, prompt, scheduleCron, channel }) => {
    const forbidden = requirePerm("reports.create");
    if (forbidden) return forbidden;

    const ctx = getContext();
    // Validate cron (node-cron accepts 5 or 6 field patterns)
    if (!/^(\S+\s+){4,5}\S+$/.test(scheduleCron)) {
      return JSON.stringify({ error: "Invalid cron expression. Use standard 5-field format, e.g. '0 8 * * *' for 8 AM daily." });
    }

    const report = await prisma.scheduledReport.create({
      data: {
        userId: ctx.userId,
        name: name.slice(0, 100),
        reportType: "custom",
        prompt: prompt.slice(0, 2000),
        dataScope: {},
        scheduleCron,
        deliveryChannel: channel,
        deliveryTarget: channel === "whatsapp" ? ctx.userPhone : null,
        isActive: true,
      },
    });
    await audit("create_automation", report.id, { name, scheduleCron, channel });

    return JSON.stringify({
      ok: true,
      automation: { id: report.id, name: report.name, schedule: scheduleCron, channel },
      note: "Automation created. It will run at its scheduled time. Use list_my_automations to see all your subscriptions, or pause_automation to stop it.",
    });
  },
  {
    name: "create_automation",
    description: `Create a scheduled automation — a recurring report the user receives automatically. Use for requests like "every day at 8 AM send me yesterday's rental revenue" or "weekly Monday summary of open complaints".
Cron examples: "0 8 * * *" = 8 AM daily, "0 9 * * 1" = 9 AM every Monday, "0 18 * * 1-5" = 6 PM weekdays.`,
    schema: z.object({
      name: z.string().describe("Short name for the automation"),
      prompt: z.string().describe("What the bot should generate each time — a question or instruction"),
      scheduleCron: z.string().describe("Cron expression (5 fields, IST timezone)"),
      channel: z.enum(["email", "whatsapp", "web"]).describe("Where to deliver the result"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 6. LIST MY AUTOMATIONS
// ══════════════════════════════════════════════════════
export const listAutomationsTool = tool(
  async () => {
    const forbidden = requirePerm("reports.list_own");
    if (forbidden) return forbidden;
    const ctx = getContext();

    const automations = await prisma.scheduledReport.findMany({
      where: { userId: ctx.userId },
      orderBy: { createdAt: "desc" },
    });
    return JSON.stringify({
      total: automations.length,
      automations: automations.map((a) => ({
        id: a.id,
        name: a.name,
        schedule: a.scheduleCron,
        channel: a.deliveryChannel,
        active: a.isActive,
        lastRunAt: a.lastRunAt,
        nextRunAt: a.nextRunAt,
      })),
    });
  },
  {
    name: "list_my_automations",
    description: "List all scheduled automations (reports, briefings) for the current user.",
    schema: z.object({}),
  },
);

// ══════════════════════════════════════════════════════
// 7. PAUSE / RESUME AUTOMATION
// ══════════════════════════════════════════════════════
export const toggleAutomationTool = tool(
  async ({ automationId, action }) => {
    const ctx = getContext();
    const auto = await prisma.scheduledReport.findUnique({ where: { id: automationId } });
    if (!auto) return JSON.stringify({ error: "Automation not found" });

    // Owner-only check — admins can toggle anyone's via a different tool (not this one)
    if (auto.userId !== ctx.userId && !canDo(ctx.userRole, "settings.update_notifications")) {
      return JSON.stringify({ error: "You can only pause/resume your own automations" });
    }

    await prisma.scheduledReport.update({
      where: { id: automationId },
      data: { isActive: action === "resume" },
    });
    await audit(action === "resume" ? "resume_automation" : "pause_automation", automationId, {});

    return JSON.stringify({ ok: true, automation: auto.name, active: action === "resume" });
  },
  {
    name: "toggle_automation",
    description: "Pause or resume one of the current user's scheduled automations.",
    schema: z.object({
      automationId: z.string(),
      action: z.enum(["pause", "resume"]),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 8. BROADCAST TO GROUP — post a message to a WA group
// ══════════════════════════════════════════════════════
export const broadcastGroupTool = tool(
  async ({ groupName, message, confirm_token }) => {
    const forbidden = requirePerm("messaging.broadcast_group");
    if (forbidden) return forbidden;

    const ctx = getContext();
    if (isRateLimited(ctx.userId, "broadcast_group", 10)) {
      return JSON.stringify({ error: "Rate limited — max 10 broadcasts per day" });
    }

    const confirmCheck = requireConfirmation(
      "messaging.broadcast_group",
      `broadcast:${groupName}`,
      `Post the following to WA group "${groupName}":\n\n"${message.slice(0, 200)}${message.length > 200 ? "..." : ""}"\n\nThis is visible to everyone in the group.`,
      confirm_token,
    );
    if (confirmCheck) return confirmCheck;

    const group = await prisma.waMonitoredGroup.findFirst({
      where: { chatName: { contains: groupName, mode: "insensitive" }, isActive: true },
    });
    if (!group) return JSON.stringify({ error: `No monitored group matching '${groupName}'` });

    if (!isConnected()) return JSON.stringify({ error: "WhatsApp not connected" });

    const finalText = `[From ${ctx.userName}]\n\n${message}`;
    await sendMessage(group.chatId, finalText);
    await audit("broadcast_group", group.chatId, { groupName: group.chatName, messageLength: message.length });

    return JSON.stringify({ ok: true, posted_to: group.chatName, chars: finalText.length });
  },
  {
    name: "broadcast_to_group",
    description: "Post a message (visible to everyone) in a monitored WhatsApp group. Use for announcements, team updates, escalations. Rate-limited to 10/day. DESTRUCTIVE — requires confirmation.",
    schema: z.object({
      groupName: z.string().describe("Name of the monitored group (partial match)"),
      message: z.string().describe("The message to post — will be prefixed with '[From <your name>]'"),
      confirm_token: z.string().optional(),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 9. SEND DAILY BRIEF — on-demand summary for the caller
// ══════════════════════════════════════════════════════
export const sendDailyBriefTool = tool(
  async () => {
    const ctx = getContext();
    // Pull the user's assigned open insights, subordinates' insights, and recent category activity
    const myOpen = await prisma.waInsight.findMany({
      where: { assignedUserId: ctx.userId, status: "open" },
      orderBy: [{ severity: "asc" }, { lastSeen: "desc" }],
      take: 10,
    });

    const reportedByMe = await prisma.waInsight.findMany({
      where: { reporterNames: { has: ctx.userName }, status: "open" },
      take: 10,
    });

    const criticalOpen = canDo(ctx.userRole, "insights.read")
      ? await prisma.waInsight.findMany({
          where: { status: "open", severity: { in: ["critical", "high"] } },
          orderBy: { occurrenceCount: "desc" },
          take: 5,
        })
      : [];

    return JSON.stringify({
      asOf: new Date().toISOString(),
      user: { name: ctx.userName, role: ctx.userRole },
      assigned_to_me: myOpen.map((i) => ({
        id: i.id, title: i.title, severity: i.severity, occurrenceCount: i.occurrenceCount,
        firstSeen: i.firstSeen.toISOString().slice(0, 10),
        reminderCount: i.reminderCount,
      })),
      reported_by_me: reportedByMe.map((i) => ({
        id: i.id, title: i.title, status: i.status, assignedUserId: i.assignedUserId,
      })),
      org_critical: criticalOpen.map((i) => ({
        id: i.id, title: i.title, severity: i.severity, category: i.category,
        assignedUserId: i.assignedUserId, occurrenceCount: i.occurrenceCount,
      })),
    });
  },
  {
    name: "send_daily_brief",
    description: "Generate an on-demand briefing for the current user: their assigned insights, items they reported, and (for managers+) org-wide critical issues. Use when user says 'give me a briefing', 'what's on my plate', 'what's happening today'.",
    schema: z.object({}),
  },
);

// ══════════════════════════════════════════════════════
// 10. SET USER OOO (out of office)
// ══════════════════════════════════════════════════════
export const setUserOooTool = tool(
  async ({ userName, untilDate }) => {
    const forbidden = requirePerm("team.set_ooo");
    if (forbidden) return forbidden;

    const users = await prisma.user.findMany({
      where: { isActive: true, name: { contains: userName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (users.length !== 1) return JSON.stringify({ error: users.length === 0 ? "No matching user" : `${users.length} matches — be more specific` });

    const until = new Date(untilDate);
    if (isNaN(until.getTime())) return JSON.stringify({ error: "Invalid date. Use YYYY-MM-DD." });

    await prisma.user.update({
      where: { id: users[0].id },
      data: { outOfOfficeUntil: until },
    });
    await audit("set_ooo", users[0].id, { userName: users[0].name, untilDate });

    return JSON.stringify({
      ok: true,
      user: users[0].name,
      oooUntil: untilDate,
      note: "PM will not assign new issues to this user until that date.",
    });
  },
  {
    name: "set_user_ooo",
    description: "Mark a user as out-of-office until a given date. PM assigner skips OOO users automatically.",
    schema: z.object({
      userName: z.string(),
      untilDate: z.string().describe("YYYY-MM-DD"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 11. GET AUDIT TRAIL
// ══════════════════════════════════════════════════════
export const getAuditTrailTool = tool(
  async ({ userName, days }) => {
    const forbidden = requirePerm("audit.read");
    if (forbidden) return forbidden;

    const where: any = {
      createdAt: { gte: new Date(Date.now() - (days || 7) * 86400_000) },
    };
    if (userName) {
      const u = await prisma.user.findFirst({
        where: { name: { contains: userName, mode: "insensitive" } },
      });
      if (u) where.userId = u.id;
    }

    const logs = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { user: { select: { name: true } } },
    });

    return JSON.stringify({
      total: logs.length,
      logs: logs.map((l) => ({
        time: l.createdAt.toISOString().replace("T", " ").slice(0, 16),
        user: l.user?.name,
        action: l.action,
        resource: l.resource,
        channel: l.channel,
        details: l.details,
      })),
    });
  },
  {
    name: "get_audit_trail",
    description: "Retrieve audit log entries (user actions, commands, bot changes) from the last N days. Admin/CEO/COO only.",
    schema: z.object({
      userName: z.string().optional().describe("Filter by user name (partial match). Omit for all users."),
      days: z.number().optional().describe("Look back this many days (default 7)"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 12. MUTE GROUP PROACTIVE — per-group toggle
// ══════════════════════════════════════════════════════
export const muteGroupProactiveTool = tool(
  async ({ groupName, enabled }) => {
    const forbidden = requirePerm("notifications.mute_group");
    if (forbidden) return forbidden;

    const group = await prisma.waMonitoredGroup.findFirst({
      where: { chatName: { contains: groupName, mode: "insensitive" } },
    });
    if (!group) return JSON.stringify({ error: `No matching group '${groupName}'` });

    await prisma.waMonitoredGroup.update({
      where: { id: group.id },
      data: { proactiveEnabled: enabled },
    });
    await audit(enabled ? "enable_group_proactive" : "disable_group_proactive", group.chatId, { groupName: group.chatName });

    return JSON.stringify({ ok: true, group: group.chatName, proactive: enabled });
  },
  {
    name: "toggle_group_proactive",
    description: "Enable or disable auto-responses in a specific WA group. Manager-level+.",
    schema: z.object({
      groupName: z.string(),
      enabled: z.boolean(),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 13. SUBSCRIBE TO DAILY BRIEFING
// ══════════════════════════════════════════════════════
export const subscribeBriefingTool = tool(
  async ({ hourIst, channel, focus }) => {
    const forbidden = requirePerm("briefings.subscribe");
    if (forbidden) return forbidden;
    const ctx = getContext();

    if (hourIst < 0 || hourIst > 23) return JSON.stringify({ error: "hourIst must be 0-23" });

    await prisma.user.update({
      where: { id: ctx.userId },
      data: {
        briefingEnabled: true,
        briefingHourIst: hourIst,
        briefingChannel: channel,
        briefingFocus: focus || null,
      },
    });
    await audit("subscribe_briefing", null, { hourIst, channel, focus });
    return JSON.stringify({
      ok: true,
      message: `Daily briefing scheduled for ${String(hourIst).padStart(2, "0")}:00 IST via ${channel}. ${focus ? `Focus: ${focus}.` : ""}`,
    });
  },
  {
    name: "subscribe_daily_briefing",
    description: "Subscribe the current user to a personalized daily briefing at a specific IST hour. The briefing summarizes their open assigned items, things they reported, and (for managers+) team-critical issues.",
    schema: z.object({
      hourIst: z.number().describe("Hour of day IST (0-23). 8 = 8 AM, 18 = 6 PM"),
      channel: z.enum(["whatsapp", "email", "both"]).default("whatsapp"),
      focus: z.string().optional().describe("Optional free-text: what the user wants the bot to emphasize (e.g. 'focus on payment collections')"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 14. UNSUBSCRIBE FROM DAILY BRIEFING
// ══════════════════════════════════════════════════════
export const unsubscribeBriefingTool = tool(
  async () => {
    const ctx = getContext();
    await prisma.user.update({
      where: { id: ctx.userId },
      data: { briefingEnabled: false },
    });
    await audit("unsubscribe_briefing", null, {});
    return JSON.stringify({ ok: true, message: "Daily briefing turned off." });
  },
  {
    name: "unsubscribe_daily_briefing",
    description: "Turn off the current user's scheduled daily briefing.",
    schema: z.object({}),
  },
);

// ══════════════════════════════════════════════════════
// 15. TRIGGER BRIEFING NOW — on-demand push via WA
// ══════════════════════════════════════════════════════
export const triggerBriefingNowTool = tool(
  async () => {
    const forbidden = requirePerm("briefings.on_demand");
    if (forbidden) return forbidden;
    const ctx = getContext();

    const sent = await triggerBriefingForUser(ctx.userId);
    await audit("trigger_briefing_now", null, { sent });
    return JSON.stringify({
      ok: true,
      sent,
      message: sent
        ? "Briefing sent to your WhatsApp."
        : "No open items right now — nothing to brief. You're clear.",
    });
  },
  {
    name: "trigger_briefing_now",
    description: "Generate a full personalized briefing and send it to the user's WhatsApp immediately. Different from send_daily_brief which returns JSON; this actually delivers via WA.",
    schema: z.object({}),
  },
);

export const commandTools = [
  muteBotTool,
  unmuteBotTool,
  assignInsightTool,
  resolveInsightTool,
  createAutomationTool,
  listAutomationsTool,
  toggleAutomationTool,
  broadcastGroupTool,
  sendDailyBriefTool,
  setUserOooTool,
  getAuditTrailTool,
  muteGroupProactiveTool,
  subscribeBriefingTool,
  unsubscribeBriefingTool,
  triggerBriefingNowTool,
];
