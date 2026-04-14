import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import {
  getWhatsAppStatus,
  getChats,
  fetchMessages,
  getGroupParticipants,
  getContactInfo,
  sendMessage,
  logoutWhatsApp,
  addMonitoredGroup,
  removeMonitoredGroup,
  searchWhatsAppMessages,
  getGroupSummaryData,
} from "../channels/whatsapp/client.js";
import { prisma } from "../db/prisma.js";

const router = Router();

// GET /api/whatsapp/status
router.get("/status", requireAuth, (_req, res) => {
  res.json(getWhatsAppStatus());
});

// GET /api/whatsapp/chats
router.get("/chats", requireAuth, async (_req, res) => {
  try { res.json(await getChats()); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/whatsapp/chats/:id/messages — fetch LIVE from WhatsApp
router.get("/chats/:id/messages", requireAuth, async (req, res) => {
  try {
    const chatId = decodeURIComponent(req.params.id as string);
    const limit = parseInt((req.query.limit as string) || "50");
    res.json(await fetchMessages(chatId, limit));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/whatsapp/chats/:id/participants — group members with names
router.get("/chats/:id/participants", requireAuth, async (req, res) => {
  try {
    const chatId = decodeURIComponent(req.params.id as string);
    res.json(await getGroupParticipants(chatId));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/whatsapp/contact/:phone — lookup a contact
router.get("/contact/:phone", requireAuth, async (req, res) => {
  try {
    const info = await getContactInfo(req.params.phone as string);
    if (!info) { res.status(404).json({ error: "Contact not found" }); return; }
    res.json(info);
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/whatsapp/send
router.post("/send", requireAuth, async (req, res) => {
  try {
    const { chatId, message } = req.body;
    if (!chatId || !message) { res.status(400).json({ error: "chatId and message required" }); return; }
    await sendMessage(chatId, message);
    await prisma.auditLog.create({
      data: { userId: req.user!.userId, action: "whatsapp.send", resource: `chat:${chatId}`, details: { messageLength: message.length }, channel: "whatsapp" },
    });
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// POST /api/whatsapp/logout
router.post("/logout", requireAuth, async (_req, res) => {
  try { await logoutWhatsApp(); res.json({ ok: true }); }
  catch (err: any) { res.status(500).json({ error: err.message }); }
});

// ── Monitoring ──

// GET /api/whatsapp/monitored
router.get("/monitored", requireAuth, async (_req, res) => {
  try {
    const groups = await prisma.waMonitoredGroup.findMany({
      where: { isActive: true },
      orderBy: { createdAt: "desc" },
    });
    res.json(groups);
  } catch (err: any) { res.status(500).json({ error: "Failed to fetch" }); }
});

// POST /api/whatsapp/monitor
router.post("/monitor", requireAuth, async (req, res) => {
  try {
    const { chatId, chatName, isGroup } = req.body;
    if (!chatId || !chatName) { res.status(400).json({ error: "chatId and chatName required" }); return; }
    await addMonitoredGroup(chatId, chatName, isGroup ?? true, req.user!.userId);
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/whatsapp/monitor/:chatId
router.delete("/monitor/:chatId", requireAuth, async (req, res) => {
  try {
    await removeMonitoredGroup(decodeURIComponent(req.params.chatId as string));
    res.json({ ok: true });
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

// GET /api/whatsapp/search?q=keyword — search LIVE across monitored groups
router.get("/search", requireAuth, async (req, res) => {
  try {
    const q = (req.query.q as string) || "";
    if (!q) { res.json([]); return; }
    res.json(await searchWhatsAppMessages(q, 30));
  } catch (err: any) { res.status(500).json({ error: "Search failed" }); }
});

// GET /api/whatsapp/summary — live summary for agents
router.get("/summary", requireAuth, async (req, res) => {
  try {
    const hours = parseInt((req.query.hours as string) || "24");
    res.json(await getGroupSummaryData(hours));
  } catch (err: any) { res.status(500).json({ error: err.message }); }
});

export default router;
