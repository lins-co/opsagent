// Roster lookups — who's on the team, what do they specialize in,
// who do they report to, when are they reachable.
import { prisma } from "../../db/prisma.js";

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  roleName: string;
  specialties: string[];
  waGroupIds: string[];
  reportsToId: string | null;
  isAvailable: boolean;
  outOfOfficeUntil: Date | null;
  workingHoursStart: number;
  workingHoursEnd: number;
  orgNodeId: string;
  openAssignedCount: number;
}

// ──────────────────────────────────────────────────────────────
// Fetch candidates eligible to own an insight. Priority order:
//   (1) specialty match on the insight's category
//   (2) membership in the same WhatsApp group as the insight
//   (3) availability + phone linked
// Returns the full candidate pool so the LLM (assigner.ts) can pick.
// ──────────────────────────────────────────────────────────────
export async function getEligibleAssignees(
  category: string | null,
  groupChatId: string | null,
): Promise<TeamMember[]> {
  const now = new Date();

  const users = await prisma.user.findMany({
    where: {
      isActive: true,
      phone: { not: null },
      OR: [
        { outOfOfficeUntil: null },
        { outOfOfficeUntil: { lt: now } },
      ],
    },
    include: {
      role: { select: { name: true } },
      _count: {
        select: {
          assignedInsights: { where: { status: "open" } },
        },
      },
    },
  });

  const members: TeamMember[] = users.map((u: any) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    roleName: u.role.name,
    specialties: u.specialties || [],
    waGroupIds: u.waGroupIds || [],
    reportsToId: u.reportsToId,
    isAvailable: u.isAvailable,
    outOfOfficeUntil: u.outOfOfficeUntil,
    workingHoursStart: u.workingHoursStart,
    workingHoursEnd: u.workingHoursEnd,
    orgNodeId: u.orgNodeId,
    openAssignedCount: u._count?.assignedInsights || 0,
  }));

  // Rank: specialty match > group membership > role seniority > load
  const ranked = members
    .map((m) => {
      let score = 0;
      if (category && m.specialties.includes(category)) score += 100;
      if (groupChatId && m.waGroupIds.includes(groupChatId)) score += 40;
      // Prefer non-admins for frontline work (they're usually ops)
      if (m.roleName === "employee" || m.roleName === "manager") score += 10;
      // Load balancing — fewer open items = slight preference
      score -= Math.min(m.openAssignedCount, 10);
      return { m, score };
    })
    .sort((a, b) => b.score - a.score);

  return ranked.map((x) => x.m);
}

export async function getUserById(id: string): Promise<TeamMember | null> {
  const u = await prisma.user.findUnique({
    where: { id },
    include: {
      role: { select: { name: true } },
      _count: { select: { assignedInsights: { where: { status: "open" } } } },
    },
  });
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    roleName: (u as any).role.name,
    specialties: (u as any).specialties || [],
    waGroupIds: (u as any).waGroupIds || [],
    reportsToId: (u as any).reportsToId,
    isAvailable: (u as any).isAvailable,
    outOfOfficeUntil: (u as any).outOfOfficeUntil,
    workingHoursStart: (u as any).workingHoursStart,
    workingHoursEnd: (u as any).workingHoursEnd,
    orgNodeId: u.orgNodeId,
    openAssignedCount: (u as any)._count?.assignedInsights || 0,
  };
}

export async function getManagerOf(userId: string): Promise<TeamMember | null> {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { reportsToId: true },
  });
  const mgrId = (u as any)?.reportsToId;
  if (!mgrId) return null;
  return getUserById(mgrId);
}

// Climb the hierarchy until we hit someone of seniority >= minRole.
export async function escalateTo(
  startUserId: string,
  targetRoles: string[] = ["manager", "vp", "ceo", "admin"],
): Promise<TeamMember | null> {
  let cursor: string | null = startUserId;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    seen.add(cursor);
    const current: TeamMember | null = await getUserById(cursor);
    if (!current) return null;
    if (targetRoles.includes(current.roleName) && current.id !== startUserId) return current;
    cursor = current.reportsToId;
  }
  return getSeniorFallback();
}

// When no hierarchy info exists, return any admin/CEO as the last-resort escalation.
export async function getSeniorFallback(): Promise<TeamMember | null> {
  const u = await prisma.user.findFirst({
    where: {
      isActive: true,
      phone: { not: null },
      role: { name: { in: ["admin", "ceo"] } },
    },
    include: { role: true, _count: { select: { assignedInsights: { where: { status: "open" } } } } },
  });
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    phone: u.phone,
    roleName: (u as any).role.name,
    specialties: (u as any).specialties || [],
    waGroupIds: (u as any).waGroupIds || [],
    reportsToId: (u as any).reportsToId,
    isAvailable: (u as any).isAvailable,
    outOfOfficeUntil: (u as any).outOfOfficeUntil,
    workingHoursStart: (u as any).workingHoursStart,
    workingHoursEnd: (u as any).workingHoursEnd,
    orgNodeId: u.orgNodeId,
    openAssignedCount: (u as any)._count?.assignedInsights || 0,
  };
}

// ──────────────────────────────────────────────────────────────
// Business-hours helper — true if `at` falls inside the user's
// working window in Asia/Kolkata. Used to avoid 2am pings.
// ──────────────────────────────────────────────────────────────
export function isWithinWorkingHours(
  at: Date,
  startHour = 9,
  endHour = 20,
): boolean {
  const istHour = Number(
    at.toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "numeric", hour12: false }),
  );
  return istHour >= startHour && istHour < endHour;
}

// Returns the next valid ping time at-or-after `from`, clamped to
// `[startHour, endHour)` IST. If `from` is 2am, we push to 9am same day.
export function nextBusinessTime(
  from: Date,
  startHour = 9,
  endHour = 20,
): Date {
  const istDate = new Date(from.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const offsetMs = from.getTime() - istDate.getTime();
  const h = istDate.getHours();
  if (h >= startHour && h < endHour) return from;
  const next = new Date(istDate);
  if (h < startHour) {
    next.setHours(startHour, 5, 0, 0);
  } else {
    next.setDate(next.getDate() + 1);
    next.setHours(startHour, 5, 0, 0);
  }
  return new Date(next.getTime() + offsetMs);
}
