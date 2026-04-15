import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db/prisma.js";

const router = Router();

const TONES = ["formal", "casual", "balanced", "concise"] as const;
const LENGTHS = ["short", "medium", "detailed"] as const;
const LANGUAGES = ["en", "hi", "hinglish"] as const;
const EMOJI = ["none", "minimal", "expressive"] as const;

const PrefsSchema = z.object({
  enabled: z.boolean().optional(),
  tone: z.enum(TONES).optional(),
  responseLength: z.enum(LENGTHS).optional(),
  language: z.enum(LANGUAGES).optional(),
  emojiUsage: z.enum(EMOJI).optional(),
  customInstructions: z.string().max(1000).nullable().optional(),
});

const DEFAULTS = {
  enabled: true,
  tone: "balanced",
  responseLength: "medium",
  language: "en",
  emojiUsage: "minimal",
  customInstructions: null as string | null,
};

// GET /api/me/bot-preferences
router.get("/", requireAuth, async (req, res) => {
  try {
    const prefs = await prisma.userBotPreferences.findUnique({
      where: { userId: req.user!.userId },
    });
    res.json(prefs || { ...DEFAULTS, userId: req.user!.userId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/me/bot-preferences
router.put("/", requireAuth, async (req, res) => {
  try {
    const parsed = PrefsSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid preferences", issues: parsed.error.issues });
      return;
    }

    const data = parsed.data;
    const userId = req.user!.userId;

    const updated = await prisma.userBotPreferences.upsert({
      where: { userId },
      create: { userId, ...DEFAULTS, ...data },
      update: data,
    });

    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
