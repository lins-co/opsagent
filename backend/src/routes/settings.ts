import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db/prisma.js";
import { getAllSettings, setSetting, DEFAULT_SETTINGS, type SettingKey } from "../config/settings.js";
import { startInsightsCron, triggerExtractionNow } from "../agents/intelligence/insights-cron.js";

const router = Router();

// All settings routes are admin-only
async function requireAdmin(req: any, res: any, next: any) {
  const user = await prisma.user.findUnique({
    where: { id: req.user.userId },
    include: { role: true },
  });
  if (user?.role?.name !== "admin") {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}

// GET /api/settings — list all settings
router.get("/", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const settings = await getAllSettings();
    res.json({ settings, defaults: DEFAULT_SETTINGS });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/settings/:key — update a single setting
router.patch("/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const key = req.params.key as SettingKey;
    if (!(key in DEFAULT_SETTINGS)) {
      res.status(400).json({ error: `Unknown setting: ${key}` });
      return;
    }

    const { value } = req.body;
    await setSetting(key, value, req.user!.userId);

    // If it's a cron-related setting, restart the cron
    if (key === "wa.extract_patterns" || key === "wa.extraction_interval_hours") {
      await startInsightsCron();
    }

    res.json({ ok: true, key, value });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/insights/trigger — manually trigger extraction
router.post("/insights/trigger", requireAuth, requireAdmin, async (req, res) => {
  try {
    const hours = req.body.hours || 24;
    const count = await triggerExtractionNow(hours);
    res.json({ ok: true, extracted: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/insights — list recent insights
router.get("/insights", requireAuth, async (req, res) => {
  try {
    const status = (req.query.status as string) || undefined;
    const insights = await prisma.waInsight.findMany({
      where: status ? { status } : {},
      orderBy: [{ occurrenceCount: "desc" }, { lastSeen: "desc" }],
      take: 100,
    });
    res.json(insights);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/settings/insights/:id — update insight status
router.patch("/insights/:id", requireAuth, async (req, res) => {
  try {
    const { status, notes } = req.body;
    const updated = await prisma.waInsight.update({
      where: { id: req.params.id as string },
      data: {
        ...(status ? { status } : {}),
        ...(notes !== undefined ? { notes } : {}),
        ...(status === "resolved" ? { resolvedAt: new Date(), resolvedBy: req.user!.userId } : {}),
      },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/groups — list monitored groups with proactive settings
router.get("/groups", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const groups = await prisma.waMonitoredGroup.findMany({
      where: { isActive: true },
      orderBy: { chatName: "asc" },
      select: {
        id: true,
        chatId: true,
        chatName: true,
        messageCount: true,
        lastMessageAt: true,
        proactiveEnabled: true,
      },
    });
    res.json(groups);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/settings/groups/:id — toggle per-group proactive
router.patch("/groups/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { proactiveEnabled } = req.body;
    const updated = await prisma.waMonitoredGroup.update({
      where: { id: req.params.id as string },
      data: { proactiveEnabled: !!proactiveEnabled },
    });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/memory-stats — show memory usage
router.get("/memory-stats", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const [msgCount, insightCount, mediaCount, openIssues] = await Promise.all([
      prisma.waMessage.count(),
      prisma.waInsight.count(),
      prisma.waMediaFile.count(),
      prisma.waInsight.count({ where: { status: "open" } }),
    ]);
    res.json({ msgCount, insightCount, mediaCount, openIssues });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
