import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { loadData, getData, reloadData, shutdown } from "./db/mongo.js";
import { chat, clearSession, cleanupSessions } from "./agent/ops-agent.js";
import { localQuery } from "./agent/local-engine.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_MESSAGE_LENGTH = 5000;
const LLM_TIMEOUT_MS = 180_000; // 3 minutes (covers both providers at 90s each)

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

// Request logging
app.use((req, _res, next) => {
  if (req.path.startsWith("/api/")) {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  }
  next();
});

function sanitizeSessionId(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "default";
  return raw.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 50) || "default";
}

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId: rawSessionId } = req.body;
    const sessionId = sanitizeSessionId(rawSessionId);

    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "message is required" });
      return;
    }

    if (message.length > MAX_MESSAGE_LENGTH) {
      res.status(400).json({ error: `Message too long (max ${MAX_MESSAGE_LENGTH} chars)` });
      return;
    }

    const data = getData();
    if (!data) {
      res.status(503).json({ error: "Data not loaded yet. Please wait..." });
      return;
    }

    // Try local engine first (instant, no API call)
    const localAnswer = localQuery(message, data);
    if (localAnswer !== null) {
      console.log(`  [local] Answered locally: "${message.slice(0, 60)}..."`);
      res.json({ answer: localAnswer, sessionId, source: "local" });
      return;
    }

    // Fall back to LLM with timeout
    console.log(`  [llm] Routing to LLM: "${message.slice(0, 60)}..."`);
    const answer = await Promise.race([
      chat(sessionId, message, data),
      new Promise<never>((_resolve, reject) =>
        setTimeout(() => reject(new Error("LLM request timed out")), LLM_TIMEOUT_MS)
      ),
    ]);
    res.json({ answer, sessionId, source: "llm" });
  } catch (err: any) {
    console.error("Chat error:", err.message || err);
    const status = err.message?.includes("timed out") ? 504 : 500;
    res.status(status).json({ error: err.message || "Internal error" });
  }
});

// Clear conversation
app.post("/api/clear", (req, res) => {
  const sessionId = sanitizeSessionId(req.body.sessionId);
  clearSession(sessionId);
  res.json({ ok: true });
});

// Reload data from MongoDB
app.post("/api/reload", async (_req, res) => {
  try {
    console.log("Reloading data from MongoDB...");
    const data = await reloadData();
    res.json({ ok: true, counts: data.counts, loadedAt: data.loadedAt });
  } catch (err: any) {
    console.error("Reload error:", err.message);
    res.status(500).json({ error: "Failed to reload data" });
  }
});

// Health / data stats
app.get("/api/health", (_req, res) => {
  const data = getData();
  res.json({
    status: data ? "ready" : "loading",
    counts: data?.counts || null,
    loadedAt: data?.loadedAt || null,
  });
});

// Graceful shutdown
function handleShutdown(signal: string) {
  console.log(`\n${signal} received. Shutting down gracefully...`);
  shutdown()
    .then(() => {
      console.log("Cleanup complete. Exiting.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("Shutdown error:", err);
      process.exit(1);
    });
}

process.on("SIGINT", () => handleShutdown("SIGINT"));
process.on("SIGTERM", () => handleShutdown("SIGTERM"));

// Crash protection — log and keep running
process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught exception:", err.message);
  console.error(err.stack);
});
process.on("unhandledRejection", (reason) => {
  console.error("[WARN] Unhandled rejection:", reason);
});

// Session cleanup every 15 minutes
setInterval(() => {
  const cleaned = cleanupSessions();
  if (cleaned > 0) console.log(`  [cleanup] Removed ${cleaned} expired sessions`);
}, 15 * 60 * 1000);

// Start
async function start() {
  console.log("Loading fleet data from MongoDB...\n");
  await loadData();
  app.listen(PORT, () => {
    console.log(`Ops Agent running at http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start server:", err.message || err);
  process.exit(1);
});
