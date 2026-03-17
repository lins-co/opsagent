import express from "express";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
import { loadData, getData } from "./db/mongo.js";
import { chat, clearSession } from "./agent/ops-agent.js";
import { localQuery } from "./agent/local-engine.js";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "..", "public")));

// Chat endpoint
app.post("/api/chat", async (req, res) => {
  try {
    const { message, sessionId = "default" } = req.body;
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    const data = getData();
    if (!data) {
      res.status(503).json({ error: "Data not loaded yet" });
      return;
    }

    // Try local engine first (instant, no API call)
    const localAnswer = localQuery(message, data);
    if (localAnswer !== null) {
      console.log(`  [local] Answered locally: "${message.slice(0, 60)}..."`);
      res.json({ answer: localAnswer, sessionId, source: "local" });
      return;
    }

    // Fall back to LLM for complex/unknown queries
    console.log(`  [llm] Routing to Claude: "${message.slice(0, 60)}..."`);
    const answer = await chat(sessionId, message, data);
    res.json({ answer, sessionId, source: "llm" });
  } catch (err: any) {
    console.error("Chat error:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

// Clear conversation
app.post("/api/clear", (req, res) => {
  const { sessionId = "default" } = req.body;
  clearSession(sessionId);
  res.json({ ok: true });
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

// Start
async function start() {
  console.log("Loading fleet data from MongoDB...\n");
  await loadData();
  app.listen(PORT, () => {
    console.log(`Ops Agent running at http://localhost:${PORT}`);
  });
}

start().catch(console.error);
