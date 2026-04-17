import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db/prisma.js";

const router = Router();

async function requireAdmin(req: any, res: any, next: any) {
  const u = await prisma.user.findUnique({
    where: { id: req.user.userId },
    include: { role: true },
  });
  if (!u || !["admin", "ceo"].includes(u.role.name)) {
    res.status(403).json({ error: "admin only" });
    return;
  }
  next();
}

// GET /api/team — roster overview
router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    include: {
      role: { select: { name: true } },
      orgNode: { select: { name: true } },
      _count: { select: { assignedInsights: { where: { status: "open" } } } },
    },
  });
  res.json(
    users.map((u: any) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      phone: u.phone,
      role: u.role.name,
      org: u.orgNode.name,
      specialties: u.specialties,
      waGroupIds: u.waGroupIds,
      reportsToId: u.reportsToId,
      isAvailable: u.isAvailable,
      outOfOfficeUntil: u.outOfOfficeUntil,
      workingHoursStart: u.workingHoursStart,
      workingHoursEnd: u.workingHoursEnd,
      openAssignedCount: u._count.assignedInsights,
    })),
  );
});

const UpdateSchema = z.object({
  specialties: z.array(z.string()).optional(),
  waGroupIds: z.array(z.string()).optional(),
  reportsToId: z.string().uuid().nullable().optional(),
  isAvailable: z.boolean().optional(),
  outOfOfficeUntil: z.string().nullable().optional(),
  workingHoursStart: z.number().min(0).max(23).optional(),
  workingHoursEnd: z.number().min(1).max(24).optional(),
});

// PATCH /api/team/:userId — update PM fields
router.patch("/:userId", requireAuth, requireAdmin, async (req, res) => {
  const parsed = UpdateSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "invalid", issues: parsed.error.issues });
    return;
  }
  const data: any = { ...parsed.data };
  if (typeof data.outOfOfficeUntil === "string") data.outOfOfficeUntil = new Date(data.outOfOfficeUntil);

  const updated = await prisma.user.update({
    where: { id: String(req.params.userId) },
    data,
  });
  res.json({ ok: true, userId: updated.id });
});

// GET /api/team/insights — PM dashboard data
router.get("/insights", requireAuth, requireAdmin, async (_req, res) => {
  const [open, stuck, recentResolved] = await Promise.all([
    prisma.waInsight.findMany({
      where: { status: "open", isStuck: false },
      orderBy: [{ severity: "asc" }, { firstSeen: "asc" }],
      take: 50,
      include: { assignedUser: { select: { name: true, phone: true } } },
    }),
    prisma.waInsight.findMany({
      where: { status: "open", isStuck: true },
      orderBy: { firstSeen: "asc" },
      take: 20,
      include: { assignedUser: { select: { name: true } } },
    }),
    prisma.waInsight.findMany({
      where: { status: "resolved" },
      orderBy: { resolvedAt: "desc" },
      take: 20,
      include: { assignedUser: { select: { name: true } } },
    }),
  ]);
  res.json({ open, stuck, recentResolved });
});

// PATCH /api/team/insights/:id/assign — reassign an insight
router.patch("/insights/:id/assign", requireAuth, requireAdmin, async (req, res) => {
  const { userId } = req.body;
  if (!userId) { res.status(400).json({ error: "userId required" }); return; }
  await prisma.waInsight.update({
    where: { id: String(req.params.id) },
    data: {
      assignedUserId: userId,
      assignedAt: new Date(),
      assignmentReason: `manually reassigned by admin (${req.user!.name})`,
      reminderCount: 0,
      escalationLevel: 0,
      isStuck: false,
      followupAt: new Date(Date.now() + 8 * 3_600_000),
    },
  });
  res.json({ ok: true });
});

export default router;
