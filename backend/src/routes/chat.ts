import { Router } from "express";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db/prisma.js";
import { invokeAgent } from "../agents/graph/index.js";

const router = Router();

// GET /api/conversations
router.get("/conversations", requireAuth, async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { userId: req.user!.userId, isArchived: false },
      orderBy: { updatedAt: "desc" },
      take: 50,
      include: {
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          select: { content: true, createdAt: true, role: true },
        },
      },
    });
    res.json(conversations);
  } catch (err) {
    console.error("List conversations error:", err);
    res.status(500).json({ error: "Failed to fetch conversations" });
  }
});

// GET /api/conversations/:id/messages
router.get("/conversations/:id/messages", requireAuth, async (req, res) => {
  try {
    const convId = req.params.id as string;
    const conversation = await prisma.conversation.findFirst({
      where: { id: convId, userId: req.user!.userId },
    });
    if (!conversation) { res.status(404).json({ error: "Conversation not found" }); return; }

    const messages = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: "asc" },
    });
    res.json(messages);
  } catch (err) {
    console.error("Get messages error:", err);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// POST /api/chat — SSE stream: sends status updates then final response
router.post("/chat", requireAuth, async (req, res) => {
  try {
    const { message, conversationId, stream: useStream } = req.body;
    if (!message) { res.status(400).json({ error: "Message is required" }); return; }

    // Create or get conversation
    let convId = conversationId;
    if (!convId) {
      const conv = await prisma.conversation.create({
        data: { userId: req.user!.userId, title: message.slice(0, 100), channel: "web" },
      });
      convId = conv.id;
    }

    // Store user message
    await prisma.message.create({
      data: { conversationId: convId, role: "user", content: message },
    });

    // Get conversation history
    const history = await prisma.message.findMany({
      where: { conversationId: convId },
      orderBy: { createdAt: "asc" },
      take: 20,
      select: { role: true, content: true },
    });

    // ── SSE mode (default) ──
    if (useStream !== false) {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();

      // Send conversation ID immediately
      res.write(`data: ${JSON.stringify({ type: "conversation", conversationId: convId })}\n\n`);

      const startTime = Date.now();

      const result = await invokeAgent(message, {
        userId: req.user!.userId,
        userRole: req.user!.role,
        orgScope: req.user!.allowedLocations,
        conversationHistory: history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
        onStatus: (status, node) => {
          res.write(`data: ${JSON.stringify({ type: "status", status, node })}\n\n`);
        },
      });

      const latencyMs = Date.now() - startTime;

      // Store assistant message
      const assistantMessage = await prisma.message.create({
        data: {
          conversationId: convId,
          role: "assistant",
          content: result.response,
          source: "langgraph",
          agentName: result.agent,
          latencyMs,
        },
      });

      await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });

      // Audit
      await prisma.auditLog.create({
        data: {
          userId: req.user!.userId,
          action: "chat.query",
          resource: `conversation:${convId}`,
          details: { agent: result.agent, latencyMs, queryLength: message.length },
          channel: "web",
        },
      });

      // Send final response
      res.write(`data: ${JSON.stringify({ type: "done", conversationId: convId, message: assistantMessage })}\n\n`);
      res.end();
      return;
    }

    // ── Non-streaming fallback ──
    const startTime = Date.now();
    const result = await invokeAgent(message, {
      userId: req.user!.userId,
      userRole: req.user!.role,
      orgScope: req.user!.allowedLocations,
      conversationHistory: history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    });
    const latencyMs = Date.now() - startTime;

    const assistantMessage = await prisma.message.create({
      data: {
        conversationId: convId,
        role: "assistant",
        content: result.response,
        source: "langgraph",
        agentName: result.agent,
        latencyMs,
      },
    });

    await prisma.conversation.update({ where: { id: convId }, data: { updatedAt: new Date() } });
    await prisma.auditLog.create({
      data: {
        userId: req.user!.userId,
        action: "chat.query",
        resource: `conversation:${convId}`,
        details: { agent: result.agent, latencyMs },
        channel: "web",
      },
    });

    res.json({ conversationId: convId, message: assistantMessage });
  } catch (err: any) {
    console.error("Chat error:", err?.message || err);
    const msg = err?.message || "Chat failed";
    const isDbError = msg.includes("database") || msg.includes("connect");
    // If SSE headers already sent, end the stream
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ type: "error", error: "Something went wrong. Please try again." })}\n\n`);
      res.end();
    } else {
      res.status(isDbError ? 503 : 500).json({ error: isDbError ? "Database temporarily unavailable." : "Chat failed." });
    }
  }
});

// DELETE /api/conversations/:id
router.delete("/conversations/:id", requireAuth, async (req, res) => {
  try {
    const deleteId = req.params.id as string;
    await prisma.conversation.update({
      where: { id: deleteId, userId: req.user!.userId },
      data: { isArchived: true },
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to archive conversation" });
  }
});

export default router;
