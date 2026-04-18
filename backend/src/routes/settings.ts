import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db/prisma.js";
import { getAllSettings, setSetting, DEFAULT_SETTINGS, type SettingKey } from "../config/settings.js";
import { startInsightsCron, triggerExtractionNow } from "../agents/intelligence/insights-cron.js";
import { flushDigestNow } from "../agents/program-manager/digest-cron.js";
import { isBotMuted } from "../config/settings.js";

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

// GET /api/settings/mute-status — quick check of mute state (used by UI banner)
router.get("/mute-status", requireAuth, async (_req, res) => {
  try {
    const [muted, mutedUntil, mutedReason, mutedBy, mutedAt] = await Promise.all([
      getAllSettings().then((s) => s["bot.muted"]),
      getAllSettings().then((s) => s["bot.muted_until"]),
      getAllSettings().then((s) => s["bot.muted_reason"]),
      getAllSettings().then((s) => s["bot.muted_by"]),
      getAllSettings().then((s) => s["bot.muted_at"]),
    ]);
    // Actually run through isBotMuted to auto-unmute if expired
    const active = await isBotMuted();
    res.json({
      muted: active,
      mutedUntil: mutedUntil || null,
      mutedReason: mutedReason || null,
      mutedBy: mutedBy || null,
      mutedAt: mutedAt || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/mute — mute the bot. Body: { duration?: "1h"|"4h"|"24h"|"indef", reason?: string }
router.post("/mute", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { duration, reason } = req.body;
    const now = new Date();
    let untilIso = "";
    if (duration && duration !== "indef") {
      const hours = duration === "1h" ? 1 : duration === "4h" ? 4 : duration === "24h" ? 24 : 0;
      if (hours > 0) {
        const until = new Date(now.getTime() + hours * 3_600_000);
        untilIso = until.toISOString();
      }
    }

    await Promise.all([
      setSetting("bot.muted", true),
      setSetting("bot.muted_until", untilIso),
      setSetting("bot.muted_reason", reason || ""),
      setSetting("bot.muted_by", req.user!.userId),
      setSetting("bot.muted_at", now.toISOString()),
    ]);

    res.json({ ok: true, until: untilIso || "indefinite", reason: reason || null });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/unmute — instantly unmute
router.post("/unmute", requireAuth, requireAdmin, async (_req, res) => {
  try {
    await Promise.all([
      setSetting("bot.muted", false),
      setSetting("bot.muted_until", ""),
      setSetting("bot.muted_reason", ""),
    ]);
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/settings/dm-queue — inspect queued DMs
router.get("/dm-queue", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const queue = await prisma.pmDmQueue.findMany({
      where: { sentAt: null },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const users = await prisma.user.findMany({
      where: { id: { in: [...new Set(queue.map((q) => q.userId))] } },
      select: { id: true, name: true, phone: true, lastPmDigestAt: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    const grouped = queue.reduce((acc: any, q) => {
      const u = userMap.get(q.userId);
      if (!acc[q.userId]) {
        acc[q.userId] = { userId: q.userId, userName: u?.name || "Unknown", phone: u?.phone, lastPmDigestAt: u?.lastPmDigestAt, items: [] };
      }
      acc[q.userId].items.push({ id: q.id, insightId: q.insightId, level: q.level, text: q.text.slice(0, 200), createdAt: q.createdAt });
      return acc;
    }, {});
    res.json({ total: queue.length, users: Object.values(grouped) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/settings/dm-queue/flush — manually flush the digest NOW
router.post("/dm-queue/flush", requireAuth, requireAdmin, async (_req, res) => {
  try {
    const result = await flushDigestNow();
    res.json({ ok: true, usersSent: result.usersSent });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/settings/dm-queue/:id — remove a queued DM
router.delete("/dm-queue/:id", requireAuth, requireAdmin, async (req, res) => {
  try {
    await prisma.pmDmQueue.delete({ where: { id: req.params.id as string } });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
