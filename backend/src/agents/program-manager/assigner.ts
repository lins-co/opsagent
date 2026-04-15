// LLM-based insight assignment. Given an insight + candidate roster,
// the LLM picks the best owner and records WHY (so humans can audit).
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getEligibleAssignees, nextBusinessTime, type TeamMember } from "./roster.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.1,
  maxTokens: 400,
});

const ASSIGN_PROMPT = `You are the dispatcher for EMO's program-manager agent.
Given one operational insight and a ranked list of team members, pick ONE owner best positioned to resolve it.

Output STRICT JSON, no prose:
{ "userId": "<uuid>", "reason": "<≤120 chars, why this person>" }

If NO candidate is appropriate (e.g. category has no specialist and no group member), return:
{ "userId": null, "reason": "<why no assignment, ≤120 chars>" }

Rules (in priority order):
1. Specialty match on insight.category is the strongest signal.
2. Membership in the insight's WhatsApp group is a strong secondary signal — they have context.
3. Prefer 'employee' or 'manager' roles over 'admin'/'ceo' for frontline issues (admins escalate later).
4. Break ties toward the candidate with the LOWEST current open load.
5. NEVER assign to someone whose phone is null.
6. For category="payment" prefer finance specialists; for "battery"/"charger"/"vehicle"/"app" prefer engineering.
7. Critical-severity issues with no specialist → assign to the group's most senior member so they can delegate.

Be decisive. If the insight is ambiguous, assign to the group's senior-most candidate.`;

export interface AssignmentResult {
  userId: string | null;
  reason: string;
}

export async function assignInsight(insightId: string): Promise<AssignmentResult> {
  const insight = await prisma.waInsight.findUnique({ where: { id: insightId } });
  if (!insight) return { userId: null, reason: "insight not found" };
  if (insight.assignedUserId) {
    return { userId: insight.assignedUserId, reason: insight.assignmentReason || "already assigned" };
  }
  if (insight.status !== "open") return { userId: null, reason: "insight not open" };

  const candidates = await getEligibleAssignees(insight.category, insight.groupChatId);
  if (candidates.length === 0) {
    return { userId: null, reason: "no eligible team members (populate User.specialties & User.waGroupIds)" };
  }

  const top = candidates.slice(0, 12);
  const ctx = {
    insight: {
      id: insight.id,
      type: insight.type,
      title: insight.title,
      summary: insight.summary,
      severity: insight.severity,
      category: insight.category,
      groupName: insight.groupName,
      groupChatId: insight.groupChatId,
      vehicleIds: insight.vehicleIds,
      location: insight.location,
      reporterNames: insight.reporterNames,
      occurrenceCount: insight.occurrenceCount,
      firstSeenHoursAgo: Math.round((Date.now() - insight.firstSeen.getTime()) / 3_600_000),
    },
    candidates: top.map((c) => ({
      userId: c.id,
      name: c.name,
      role: c.roleName,
      specialties: c.specialties,
      inGroup: !!(insight.groupChatId && c.waGroupIds.includes(insight.groupChatId)),
      openItems: c.openAssignedCount,
      hasPhone: !!c.phone,
    })),
  };

  let pick: AssignmentResult;
  try {
    const res = await llm.invoke([
      new SystemMessage(ASSIGN_PROMPT),
      new HumanMessage(JSON.stringify(ctx, null, 2)),
    ]);
    const raw = (res.content as string).trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    pick = JSON.parse(raw);
  } catch (err: any) {
    // Fallback: take the top-ranked candidate (roster already scored them).
    const fallback = top.find((c) => c.phone);
    pick = fallback
      ? { userId: fallback.id, reason: "LLM parse failed — took top-ranked candidate" }
      : { userId: null, reason: "LLM error + no fallback with phone" };
  }

  if (!pick.userId) {
    await prisma.waInsight.update({
      where: { id: insightId },
      data: { assignmentReason: pick.reason.slice(0, 490), pmNotes: `unassigned: ${pick.reason}` },
    });
    return pick;
  }

  // Verify the user actually exists and is reachable — hallucination guard.
  const confirmed = top.find((c) => c.id === pick.userId && c.phone);
  if (!confirmed) {
    const fallback = top.find((c) => c.phone);
    pick = fallback
      ? { userId: fallback.id, reason: `LLM picked unreachable user — fell back to ${fallback.name}` }
      : { userId: null, reason: "LLM hallucinated userId and no reachable fallback" };
    if (!pick.userId) {
      await prisma.waInsight.update({
        where: { id: insightId },
        data: { assignmentReason: pick.reason.slice(0, 490) },
      });
      return pick;
    }
  }

  // First follow-up window: 8h from now, clamped to business hours.
  const followupAt = nextBusinessTime(new Date(Date.now() + 8 * 3_600_000));

  await prisma.waInsight.update({
    where: { id: insightId },
    data: {
      assignedUserId: pick.userId,
      assignedAt: new Date(),
      assignmentReason: pick.reason.slice(0, 490),
      followupAt,
    },
  });

  return pick;
}

// Bulk-assign all unassigned open insights. Safe to call on boot or on demand.
export async function assignAllPending(): Promise<{ assigned: number; skipped: number }> {
  const pending = await prisma.waInsight.findMany({
    where: { status: "open", assignedUserId: null, isStuck: false },
    select: { id: true },
    take: 50,
  });
  let assigned = 0;
  let skipped = 0;
  for (const p of pending) {
    const r = await assignInsight(p.id);
    if (r.userId) assigned++;
    else skipped++;
  }
  return { assigned, skipped };
}

export type { TeamMember };
