import express from "express";
import cors from "cors";
import path from "path";
import { createServer } from "http";
import { WebSocketServer } from "ws";
import { env } from "./config/env.js";
import { prisma } from "./db/prisma.js";
import { connectMongo, loadMongoData, ensureIndexes } from "./db/connectors/mongodb.js";
import authRouter from "./routes/auth.js";
import chatRouter from "./routes/chat.js";
import emailRouter from "./routes/email.js";
import reportsRouter from "./routes/reports.js";
import whatsappRouter from "./routes/whatsapp.js";
import settingsRouter from "./routes/settings.js";
import botPrefsRouter from "./routes/bot-prefs.js";
import teamRouter from "./routes/team.js";
import { startPmCron } from "./agents/program-manager/followup-cron.js";
import { startDigestCron } from "./agents/program-manager/digest-cron.js";
import { startScheduler } from "./agents/intelligence/scheduler.js";
import { startInsightsCron } from "./agents/intelligence/insights-cron.js";
import { initWhatsApp } from "./channels/whatsapp/client.js";

const app = express();
const server = createServer(app);

// ── Middleware ──
// Accept comma-separated origins from FRONTEND_URL. Also allows Vercel preview deployments.
const allowedOrigins = (env.FRONTEND_URL || "").split(",").map((s) => s.trim()).filter(Boolean);
app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // Allow same-origin / curl / mobile
      if (allowedOrigins.includes(origin)) return cb(null, true);
      // Allow all Vercel preview URLs for the project
      if (/\.vercel\.app$/.test(new URL(origin).hostname)) return cb(null, true);
      cb(new Error(`CORS: origin ${origin} not allowed`));
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: "10mb" }));

// ── Health check ──
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ok", db: "connected", timestamp: new Date().toISOString() });
  } catch {
    res.status(500).json({ status: "error", db: "disconnected" });
  }
});

// ── CSV export downloads ──
app.use("/api/exports", express.static(path.resolve("src/uploads/exports")));

// ── Routes ──
app.use("/api/auth", authRouter);
app.use("/api", chatRouter);
app.use("/api/email", emailRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/me/bot-preferences", botPrefsRouter);
app.use("/api/team", teamRouter);

// ── WebSocket server for streaming chat ──
const wss = new WebSocketServer({ server, path: "/ws/chat" });

wss.on("connection", (ws, req) => {
  console.log("WebSocket client connected");

  ws.on("message", async (data) => {
    try {
      const payload = JSON.parse(data.toString());
      // TODO: Authenticate via token in payload, route to LangGraph, stream response
      ws.send(JSON.stringify({
        type: "message",
        content: "WebSocket connected. LangGraph streaming coming next.",
      }));
    } catch (err) {
      ws.send(JSON.stringify({ type: "error", content: "Invalid message format" }));
    }
  });

  ws.on("close", () => {
    console.log("WebSocket client disconnected");
  });
});

// ── Seed default roles if empty ──
async function seedDefaults() {
  const roleCount = await prisma.role.count();
  if (roleCount === 0) {
    console.log("Seeding default roles...");
    await prisma.role.createMany({
      data: [
        { name: "admin", permissions: { view_all_data: true, manage_users: true, view_audit: true, manage_alerts: true, view_llm_usage: true } },
        { name: "ceo", permissions: { view_all_data: true, manage_users: true, view_audit: true, manage_alerts: true, view_llm_usage: true } },
        { name: "vp", permissions: { view_all_data: true, manage_users: false, view_audit: true, manage_alerts: true, view_llm_usage: false } },
        { name: "manager", permissions: { view_all_data: false, manage_users: false, view_audit: false, manage_alerts: true, view_llm_usage: false } },
        { name: "employee", permissions: { view_all_data: false, manage_users: false, view_audit: false, manage_alerts: false, view_llm_usage: false } },
      ],
    });
    console.log("Default roles created: admin, ceo, vp, manager, employee");
  }

  // Seed root org node if empty
  const orgCount = await prisma.orgNode.count();
  if (orgCount === 0) {
    console.log("Seeding root org node...");
    await prisma.orgNode.create({
      data: {
        name: "EMO Electric",
        level: 0,
        locations: ["Delhi", "Mumbai", "Bangalore", "Hyderabad", "Chennai", "Kolkata"],
      },
    });
    console.log("Root org node created: EMO Electric");
  }
}

// ── Start ──
async function main() {
  try {
    await prisma.$connect();
    console.log("Connected to Neon PostgreSQL");

    await seedDefaults();

    // Load MongoDB — hot cache + indexes on direct collections
    try {
      await connectMongo();
      await ensureIndexes();
      const data = await loadMongoData();
      const totalDocs = Object.values(data).reduce((sum, arr) => sum + arr.length, 0);
      console.log(`Loaded ${totalDocs} docs from MongoDB hot cache (${Object.keys(data).length} collections)`);
      console.log("Large collections (Gencash, zohobilling, Factorydatabase, HistoricalRenting) queried on-demand");
    } catch (err) {
      console.warn("MongoDB load failed (non-critical):", (err as Error).message);
    }

    // Start scheduled report cron jobs
    await startScheduler();

    // Start insights extraction cron (WhatsApp pattern analysis)
    await startInsightsCron();

    // Start program-manager follow-up cron (assigns + chases open insights)
    await startPmCron();

    // Start daily PM DM digest cron (once per user per day)
    await startDigestCron();

    // Connect WhatsApp (server-level, shared across all users)
    // If already authenticated from a previous session, it reconnects automatically.
    // If not, QR code prints in the terminal — scan once, stays connected.
    initWhatsApp();

    server.listen(env.PORT, () => {
      console.log(`\n  Backend running on http://localhost:${env.PORT}`);
      console.log(`  WebSocket on ws://localhost:${env.PORT}/ws/chat`);
      console.log(`  Health check: http://localhost:${env.PORT}/api/health\n`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

main();
