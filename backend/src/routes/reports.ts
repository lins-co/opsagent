import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db/prisma.js";

const router = Router();

// GET /api/reports/scheduled — list user's scheduled reports
router.get("/scheduled", requireAuth, async (req, res) => {
  try {
    const schedules = await prisma.scheduledReport.findMany({
      where: { userId: req.user!.userId },
      orderBy: { createdAt: "desc" },
    });
    res.json(schedules);
  } catch (err) {
    console.error("List schedules error:", err);
    res.status(500).json({ error: "Failed to fetch schedules" });
  }
});

// POST /api/reports/schedule — create a new scheduled report
router.post("/schedule", requireAuth, async (req, res) => {
  try {
    const { name, prompt, scheduleCron, deliveryChannel, deliveryTarget, attachCsv } = req.body;

    if (!name || !prompt || !scheduleCron) {
      res.status(400).json({ error: "name, prompt, and scheduleCron are required" });
      return;
    }

    // Validate cron expression (basic check)
    const cronParts = scheduleCron.trim().split(/\s+/);
    if (cronParts.length < 5 || cronParts.length > 6) {
      res.status(400).json({ error: "Invalid cron expression. Use standard 5-part cron format (e.g., '0 9 * * 1' for Monday 9am)" });
      return;
    }

    const schedule = await prisma.scheduledReport.create({
      data: {
        userId: req.user!.userId,
        name,
        reportType: "custom_prompt",
        prompt,
        scheduleCron,
        deliveryChannel: deliveryChannel || "email",
        deliveryTarget: deliveryTarget || req.user!.email,
        dataScope: { attachCsv: attachCsv ?? false },
        isActive: true,
      },
    });

    res.status(201).json(schedule);
  } catch (err) {
    console.error("Create schedule error:", err);
    res.status(500).json({ error: "Failed to create schedule" });
  }
});

// PATCH /api/reports/scheduled/:id — update a schedule
router.patch("/scheduled/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const existing = await prisma.scheduledReport.findFirst({
      where: { id, userId: req.user!.userId },
    });
    if (!existing) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    const { name, prompt, scheduleCron, deliveryChannel, deliveryTarget, isActive, attachCsv } = req.body;

    const schedule = await prisma.scheduledReport.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(prompt !== undefined && { prompt }),
        ...(scheduleCron !== undefined && { scheduleCron }),
        ...(deliveryChannel !== undefined && { deliveryChannel }),
        ...(deliveryTarget !== undefined && { deliveryTarget }),
        ...(isActive !== undefined && { isActive }),
        ...(attachCsv !== undefined && { dataScope: { ...((existing.dataScope as any) || {}), attachCsv } }),
      },
    });

    res.json(schedule);
  } catch (err) {
    console.error("Update schedule error:", err);
    res.status(500).json({ error: "Failed to update schedule" });
  }
});

// DELETE /api/reports/scheduled/:id
router.delete("/scheduled/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    await prisma.scheduledReport.deleteMany({
      where: { id, userId: req.user!.userId },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete schedule" });
  }
});

// POST /api/reports/scheduled/:id/run — manually trigger a scheduled report
router.post("/scheduled/:id/run", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const schedule = await prisma.scheduledReport.findFirst({
      where: { id, userId: req.user!.userId },
    });
    if (!schedule) {
      res.status(404).json({ error: "Schedule not found" });
      return;
    }

    // Import and run
    const { executeScheduledReport } = await import("../agents/intelligence/scheduler.js");
    const result = await executeScheduledReport(schedule);

    res.json({ ok: true, result });
  } catch (err: any) {
    console.error("Run schedule error:", err);
    res.status(500).json({ error: err.message || "Failed to run schedule" });
  }
});

export default router;
