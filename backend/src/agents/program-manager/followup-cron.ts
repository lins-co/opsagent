// Program-manager scheduler.
// Every 2h (business hours), scan open insights and act:
//   unassigned       → assign
//   followupAt <= now → ping the assignee (or escalate if they've been pinged before)
// Escalation ladder:
//   reminderCount 0 → level 0 DM, recount=1, follow up in +24h
//   reminderCount 1 → level 1 DM, recount=2, follow up in +24h
//   reminderCount 2 → level 2 DM to assignee + level 2 DM to manager, recount=3, +48h, escalationLevel=1
//   reminderCount 3 → level 3 DM to senior escalation, recount=4, +72h, escalationLevel=2
//   reminderCount >=4 → mark isStuck=true, stop pinging
import cron from "node-cron";
import { prisma } from "../../db/prisma.js";
import { isConnected } from "../../channels/whatsapp/client.js";
import { assignAllPending, assignInsight } from "./assigner.js";
import { composeFollowupDM, sendPmDM, composeGroupFollowup, sendGroupFollowup } from "./messenger.js";
import {
  getUserById,
  getManagerOf,
  escalateTo,
  isWithinWorkingHours,
  nextBusinessTime,
} from "./roster.js";

let job: ReturnType<typeof cron.schedule> | null = null;
let running = false;

export async function runFollowupCycle(): Promise<void> {
  if (running) return;
  if (!isConnected()) {
    console.log("  [PM] WhatsApp not connected — skipping");
    return;
  }
  running = true;
  try {
    // 1) Assign any freshly created, unassigned insights.
    const { assigned, skipped } = await assignAllPending();
    if (assigned || skipped) console.log(`  [PM] auto-assigned ${assigned}, skipped ${skipped}`);

    // 2) Process follow-ups that are due and within business hours.
    const now = new Date();
    if (!isWithinWorkingHours(now)) {
      console.log("  [PM] outside business hours — follow-ups paused");
      return;
    }

    const due = await prisma.waInsight.findMany({
      where: {
        status: "open",
        isStuck: false,
        assignedUserId: { not: null },
        followupAt: { lte: now },
        OR: [{ deferredUntil: null }, { deferredUntil: { lt: now } }],
      },
      orderBy: { followupAt: "asc" },
      take: 30,
    });

    if (due.length === 0) return;
    console.log(`  [PM] ${due.length} follow-ups due`);

    for (const insight of due) {
      try {
        await processOne(insight);
      } catch (err: any) {
        console.error(`  [PM] ${insight.id} error: ${err?.message}`);
      }
    }
  } finally {
    running = false;
  }
}

async function processOne(insight: any) {
  const count = insight.reminderCount ?? 0;
  const assignee = insight.assignedUserId ? await getUserById(insight.assignedUserId) : null;

  if (!assignee || !assignee.phone) {
    // Assignee became unreachable — try to reassign.
    await prisma.waInsight.update({
      where: { id: insight.id },
      data: { assignedUserId: null, pmNotes: (insight.pmNotes || "") + "\nassignee unreachable; reassigning" },
    });
    await assignInsight(insight.id);
    return;
  }

  // Phase 0: initial private DM — gentle, gives them a chance to respond quietly.
  if (count === 0) {
    const text = await composeFollowupDM({
      insightId: insight.id,
      level: 0,
      recipientName: assignee.name,
      recipientRole: assignee.roleName,
    });
    await sendPmDM(assignee.phone, text);
    await recordReminder(insight.id, 1, text, 24);
    return;
  }

  // Phase 1: follow-up in the GROUP — visible to everyone. Also DM.
  if (count === 1) {
    const dmText = await composeFollowupDM({
      insightId: insight.id,
      level: 1,
      recipientName: assignee.name,
      recipientRole: assignee.roleName,
    });
    await sendPmDM(assignee.phone, dmText);

    // Post in the group for visibility
    if (insight.groupChatId) {
      const groupText = await composeGroupFollowup({
        insightId: insight.id,
        level: 1,
        assigneeName: assignee.name,
        assigneeRole: assignee.roleName,
      });
      await sendGroupFollowup(insight.groupChatId, groupText).catch((err: any) =>
        console.warn(`  [PM] group msg failed: ${err?.message}`),
      );
    }
    await recordReminder(insight.id, 2, dmText, 24);
    return;
  }

  // Phase 2: escalate — group message tagging assignee + manager. DM both.
  if (count === 2) {
    const mgr = await getManagerOf(assignee.id);

    const dmText = await composeFollowupDM({
      insightId: insight.id,
      level: 2,
      recipientName: assignee.name,
      recipientRole: assignee.roleName,
      ccManagerName: mgr?.name || null,
    });
    await sendPmDM(assignee.phone, dmText);

    if (mgr?.phone) {
      const mgrDm = await composeFollowupDM({
        insightId: insight.id,
        level: 2,
        recipientName: mgr.name,
        recipientRole: mgr.roleName,
        ccManagerName: assignee.name,
      });
      await sendPmDM(mgr.phone, mgrDm);
      await prisma.waInsight.update({
        where: { id: insight.id },
        data: { escalatedToUserId: mgr.id, escalationLevel: 1 },
      });
    }

    // Group message with manager cc
    if (insight.groupChatId) {
      const groupText = await composeGroupFollowup({
        insightId: insight.id,
        level: 2,
        assigneeName: assignee.name,
        assigneeRole: assignee.roleName,
        ccManagerName: mgr?.name || null,
      });
      await sendGroupFollowup(insight.groupChatId, groupText).catch((err: any) =>
        console.warn(`  [PM] group msg failed: ${err?.message}`),
      );
    }
    await recordReminder(insight.id, 3, dmText, 48);
    return;
  }

  // Phase 3: senior escalation — group + DM to VP/CEO/admin.
  if (count === 3) {
    const senior = await escalateTo(assignee.id);
    if (senior?.phone) {
      const dmText = await composeFollowupDM({
        insightId: insight.id,
        level: 3,
        recipientName: senior.name,
        recipientRole: senior.roleName,
      });
      await sendPmDM(senior.phone, dmText);
      await prisma.waInsight.update({
        where: { id: insight.id },
        data: { escalatedToUserId: senior.id, escalationLevel: 2 },
      });
    }

    // Final group escalation message
    if (insight.groupChatId) {
      const groupText = await composeGroupFollowup({
        insightId: insight.id,
        level: 3,
        assigneeName: assignee.name,
        assigneeRole: assignee.roleName,
        ccManagerName: senior?.name || null,
      });
      await sendGroupFollowup(insight.groupChatId, groupText).catch((err: any) =>
        console.warn(`  [PM] group msg failed: ${err?.message}`),
      );
    }
    await recordReminder(insight.id, 4, "escalated to senior + group", 72);
    return;
  }

  // Phase 4+: stuck. Stop pinging, flag for human review.
  await prisma.waInsight.update({
    where: { id: insight.id },
    data: {
      isStuck: true,
      pmNotes: (insight.pmNotes || "") + `\nmarked stuck after ${count} reminders`,
    },
  });
}

async function recordReminder(id: string, newCount: number, text: string, nextDeltaHours: number) {
  await prisma.waInsight.update({
    where: { id },
    data: {
      reminderCount: newCount,
      lastReminderAt: new Date(),
      lastReminderText: text.slice(0, 990),
      followupAt: nextBusinessTime(new Date(Date.now() + nextDeltaHours * 3_600_000)),
    },
  });
}

export async function startPmCron(): Promise<void> {
  if (job) job.stop();
  // Every 2 hours at :25 past, IST — stays inside our 9am–8pm window comfortably.
  job = cron.schedule("25 */2 * * *", () => { runFollowupCycle(); }, { timezone: "Asia/Kolkata" });
  console.log("  [PM Cron] scheduled every 2h (25 */2 * * *)");
}

export async function stopPmCron(): Promise<void> {
  if (job) {
    job.stop();
    job = null;
  }
}
