import pkg from "whatsapp-web.js";
const { Client, LocalAuth } = pkg;
// @ts-ignore
import qrcode from "qrcode-terminal";
import { prisma } from "../../db/prisma.js";
import { EventEmitter } from "events";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { extractEntities } from "./extract.js";
import { saveMessageMedia, linkMediaToMessage } from "./media.js";
import { isEnabled } from "../../config/settings.js";
import { checkProactiveResponse } from "./proactive.js";

export const waEvents = new EventEmitter();

let client: InstanceType<typeof Client> | null = null;
let isReady = false;
let currentQR: string | null = null;
let botWid: string | null = null; // Bot's own WhatsApp ID (could be LID or phone@c.us)
const botLids = new Set<string>(); // All known LIDs for this bot
let browserPid: number | null = null; // Track Chrome PID for force-kill
let recoveryAttempts = 0; // Track consecutive recovery attempts
let connectedNumber: string | null = null;
let monitoredChatIds = new Set<string>();

// ══════════════════════════════════════════════════════
// IN-MEMORY GROUP MESSAGE STORE
// Captures messages in real-time from event listeners.
// This is the PRIMARY source for group data — never relies
// on fetchMessages() which has the waitForChatLoading bug.
// ══════════════════════════════════════════════════════

interface StoredMessage {
  sender: string;
  senderPhone: string;
  text: string;
  time: Date;
  fromMe: boolean;
  groupId: string;
  groupName: string;
}

const groupMessages = new Map<string, StoredMessage[]>();
const MAX_STORED_PER_GROUP = 1000;

function storeGroupMessage(msg: StoredMessage) {
  const arr = groupMessages.get(msg.groupId) || [];
  arr.push(msg);
  // Trim to max
  if (arr.length > MAX_STORED_PER_GROUP) {
    groupMessages.set(msg.groupId, arr.slice(-MAX_STORED_PER_GROUP));
  } else {
    groupMessages.set(msg.groupId, arr);
  }
}

// Dedupe key for persistent storage — same msgId shouldn't be stored twice
const persistedMsgIds = new Set<string>();

// ── Main capture function: stores in-memory + persists to DB + saves media ──
async function captureGroupMessage(msg: any): Promise<void> {
  const authorId = msg.author || msg.from;
  const notifyName = msg._data?.notifyName || "";

  // Resolve sender name
  let sender = notifyName;
  if (!sender || /^\d{10,}$/.test(sender)) {
    sender = nameCache.get(authorId) || notifyName || authorId.split("@")[0];
    resolveContactName(authorId, notifyName || undefined).then((name) => {
      const stored = groupMessages.get(msg.from);
      if (stored) {
        const last = stored[stored.length - 1];
        if (last && last.senderPhone === authorId.split("@")[0].replace(/\D/g, "")) {
          last.sender = name;
        }
      }
    }).catch(() => {});
  }

  const group = await prisma.waMonitoredGroup.findUnique({ where: { chatId: msg.from } });
  const groupName = group?.chatName || msg.from;
  const groupDbId = group?.id;

  const msgText = msg.body || msg._data?.caption || msg.caption || "";
  const hasMedia = !!msg.hasMedia;

  // ── 1. In-memory store (always) ──
  const displayText = msgText || (hasMedia ? `[${msg.type}]` : "");
  storeGroupMessage({
    sender,
    senderPhone: authorId.split("@")[0].replace(/\D/g, ""),
    text: displayText.slice(0, 500),
    time: new Date(msg.timestamp * 1000),
    fromMe: false,
    groupId: msg.from,
    groupName,
  });

  // ── 2. Persist to DB (if enabled) ──
  const shouldPersist = await isEnabled("wa.store_messages");
  if (!shouldPersist || !groupDbId) return;

  const msgId = msg.id?._serialized || `${msg.from}_${msg.timestamp}_${authorId}`;
  if (persistedMsgIds.has(msgId)) return;
  persistedMsgIds.add(msgId);
  if (persistedMsgIds.size > 2000) {
    const arr = Array.from(persistedMsgIds);
    arr.slice(0, 1000).forEach((id) => persistedMsgIds.delete(id));
  }

  const { vehicleIds, location, category } = extractEntities(msgText);

  try {
    const saved = await prisma.waMessage.create({
      data: {
        groupId: groupDbId,
        chatId: msg.from,
        senderId: authorId,
        senderName: sender,
        body: msgText || (hasMedia ? `[${msg.type}]` : ""),
        messageType: msg.type || "chat",
        timestamp: new Date(msg.timestamp * 1000),
        vehicleIds,
        location,
        category,
      },
    });

    // Update group stats
    await prisma.waMonitoredGroup.update({
      where: { id: groupDbId },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: new Date(msg.timestamp * 1000),
      },
    }).catch(() => {});

    // ── 3. Save media (async, don't block) ──
    if (hasMedia) {
      saveMessageMedia(msg, { chatId: msg.from, groupName, senderName: sender })
        .then((result) => {
          if (result) linkMediaToMessage(result.id, saved.id);
        })
        .catch(() => {});
    }

    // ── 4. Proactive response check (async, don't block capture) ──
    checkProactiveResponse({ body: msgText, chatId: msg.from, senderName: sender })
      .then(async (result) => {
        if (result.shouldRespond && result.response && client) {
          try {
            await msg.reply(result.response);
            console.log(`  [Proactive] Responded in ${groupName} (${result.matchedInsights?.length} pattern matches)`);
          } catch (err: any) {
            console.warn(`  [Proactive] Reply failed: ${err?.message}`);
          }
        }
      })
      .catch(() => {});
  } catch (err: any) {
    // Swallow persist errors — don't break message handling
    if (!err?.message?.includes("Unique constraint")) {
      console.warn("  [WA Persist] Failed:", err?.message?.slice(0, 80));
    }
  }
}

function getStoredMessages(groupId: string, hours?: number): StoredMessage[] {
  const arr = groupMessages.get(groupId) || [];
  if (!hours) return arr;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return arr.filter((m) => m.time >= since);
}

function getAllStoredMessages(hours?: number): StoredMessage[] {
  const all: StoredMessage[] = [];
  for (const msgs of groupMessages.values()) {
    all.push(...msgs);
  }
  if (!hours) return all;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  return all.filter((m) => m.time >= since);
}

// Cached agent invoker — avoids dynamic import issues
let cachedInvokeAgent: typeof import("../../agents/graph/index.js").invokeAgent | null = null;
async function getInvokeAgent() {
  if (!cachedInvokeAgent) {
    const mod = await import("../../agents/graph/index.js");
    cachedInvokeAgent = mod.invokeAgent;
  }
  return cachedInvokeAgent;
}

// ── Status ──

export function getWhatsAppStatus() {
  return {
    connected: isReady,
    number: connectedNumber,
    qrPending: !!currentQR && !isReady,
    monitoredGroups: monitoredChatIds.size,
  };
}

export function getCurrentQR(): string | null { return currentQR; }
export function isConnected(): boolean { return isReady && !!client; }

// ── Chats ──

export async function getChats() {
  if (!client || !isReady) return [];
  const chats = await client.getChats();
  return chats
    .filter((c: any) => c.name)
    .map((c: any) => ({
      id: c.id._serialized,
      name: c.name,
      isGroup: c.isGroup,
      participantCount: c.isGroup ? c.participants?.length : undefined,
      isMonitored: monitoredChatIds.has(c.id._serialized),
    }))
    .sort((a: any, b: any) => {
      if (a.isMonitored !== b.isMonitored) return a.isMonitored ? -1 : 1;
      if (a.isGroup !== b.isGroup) return a.isGroup ? -1 : 1;
      return 0;
    });
}

// ── Fetch messages from in-memory store ──

export async function fetchMessages(chatId: string, limit = 50) {
  // Read ONLY from in-memory store — never call chat.fetchMessages()
  const stored = getStoredMessages(chatId);
  return stored.slice(-limit).map((m) => ({
    id: "",
    from: m.groupId,
    author: m.senderPhone,
    senderName: m.sender,
    body: m.text,
    timestamp: Math.floor(m.time.getTime() / 1000),
    type: "chat",
    fromMe: m.fromMe,
    hasMedia: false,
  }));
}

// ── Group participants ──

export async function getGroupParticipants(chatId: string) {
  if (!client || !isReady) return [];
  try {
    const chat = await client.getChatById(chatId);
    if (!(chat as any).isGroup) return [];
    const participants = (chat as any).participants || [];

    const result = [];
    for (const p of participants) {
      const phone = p.id._serialized?.split("@")[0] || "";
      let name = phone;
      try {
        const contact = await client!.getContactById(p.id._serialized);
        name = contact.pushname || contact.name || (contact as any).shortName || phone;
      } catch { }
      result.push({
        phone,
        name,
        isAdmin: p.isAdmin || p.isSuperAdmin || false,
        isSuperAdmin: p.isSuperAdmin || false,
      });
    }
    return result;
  } catch { return []; }
}

// ── Contact info ──

export async function getContactInfo(phone: string) {
  if (!client || !isReady) return null;
  try {
    const chatId = phone.includes("@") ? phone : `${phone}@c.us`;
    const contact = await client.getContactById(chatId);
    return {
      phone: contact.number,
      name: contact.pushname || contact.name || (contact as any).shortName || contact.number,
      isMyContact: (contact as any).isMyContact || false,
      profilePicUrl: await contact.getProfilePicUrl().catch(() => null),
    };
  } catch { return null; }
}

// ── Send / Logout ──

export async function sendMessage(chatId: string, text: string) {
  if (!client || !isReady) throw new Error("WhatsApp not connected");
  await client.sendMessage(chatId, text);
}

export async function logoutWhatsApp() {
  if (!client) throw new Error("WhatsApp not initialized");
  await client.logout();
  isReady = false;
  connectedNumber = null;
  currentQR = null;
  client = null;
}

// ── Monitoring ──

export async function loadMonitoredGroups() {
  const groups = await prisma.waMonitoredGroup.findMany({ where: { isActive: true } });
  monitoredChatIds = new Set(groups.map((g) => g.chatId));
  console.log(`  WhatsApp monitoring ${monitoredChatIds.size} groups`);
}

export async function addMonitoredGroup(chatId: string, chatName: string, isGroup: boolean, userId: string) {
  const existing = await prisma.waMonitoredGroup.findUnique({ where: { chatId } });
  if (existing) {
    await prisma.waMonitoredGroup.update({ where: { chatId }, data: { isActive: true, chatName } });
  } else {
    await prisma.waMonitoredGroup.create({ data: { chatId, chatName, isGroup, addedBy: userId, isActive: true } });
  }
  monitoredChatIds.add(chatId);
}

export async function removeMonitoredGroup(chatId: string) {
  await prisma.waMonitoredGroup.updateMany({ where: { chatId }, data: { isActive: false } });
  monitoredChatIds.delete(chatId);
}

// ── Contact name resolver with cache ──
const nameCache = new Map<string, string>();

async function resolveContactName(contactId: string, fallbackName?: string): Promise<string> {
  if (!contactId || !client) return fallbackName || "Unknown";

  // Check cache first
  const cached = nameCache.get(contactId);
  if (cached) return cached;

  try {
    const contact = await client.getContactById(contactId);
    const name = contact.pushname || contact.name || (contact as any).shortName || (contact as any).verifiedName;
    if (name) {
      nameCache.set(contactId, name);
      return name;
    }
  } catch { }

  // If contact lookup fails, try phone number
  const phone = contactId.split("@")[0];
  // If it's a numeric ID (LID format), don't use it as the name
  if (/^\d{10,}$/.test(phone) && phone.length > 13) {
    // LID — can't resolve, use fallback
    const result = fallbackName || "Unknown";
    nameCache.set(contactId, result);
    return result;
  }

  // Actual phone number — usable as name
  const result = fallbackName || `+${phone}`;
  nameCache.set(contactId, result);
  return result;
}

// Batch resolve names for a list of messages
async function resolveMessageNames(messages: any[]): Promise<Map<string, string>> {
  const uniqueAuthors = new Set<string>();
  for (const m of messages) {
    const authorId = m.author || m.from;
    if (authorId && !nameCache.has(authorId)) {
      uniqueAuthors.add(authorId);
    }
  }

  // Resolve in parallel (max 20 at a time to avoid rate limiting)
  const authors = Array.from(uniqueAuthors).slice(0, 20);
  await Promise.allSettled(
    authors.map(async (id) => {
      const notifyName = messages.find((m: any) => (m.author || m.from) === id)?._data?.notifyName;
      await resolveContactName(id, notifyName || undefined);
    })
  );

  return nameCache;
}

// ── Live data for agents ──

export async function getGroupSummaryData(hours?: number) {
  // Read from in-memory store — no fetchMessages, no waitForChatLoading bug
  // If hours not specified, return ALL stored messages
  const groups = await prisma.waMonitoredGroup.findMany({ where: { isActive: true } });
  const results = [];

  for (const group of groups) {
    const msgs = getStoredMessages(group.chatId, hours).filter((m) => !m.fromMe);
    results.push({
      chatName: group.chatName,
      chatId: group.chatId,
      messageCount: msgs.length,
      recentMessages: msgs.map((m) => ({
        sender: m.sender,
        text: m.text,
        time: m.time,
      })),
    });
  }

  return results;
}

export async function searchWhatsAppMessages(query: string, limit = 30) {
  // Search from in-memory store
  const q = query.toLowerCase();
  const all = getAllStoredMessages().filter((m) => !m.fromMe && m.text.toLowerCase().includes(q));
  return all
    .sort((a, b) => b.time.getTime() - a.time.getTime())
    .slice(0, limit)
    .map((m) => ({
      group: m.groupName,
      sender: m.sender,
      message: m.text,
      timestamp: m.time,
    }));
}

// ══════════════════════════════════════════════════════
// DM BOT — employees chat with AI via personal WhatsApp
// ══════════════════════════════════════════════════════

// Rate limiter
const rateLimits = new Map<string, number[]>();
function isRateLimited(phone: string): boolean {
  const now = Date.now();
  const timestamps = (rateLimits.get(phone) || []).filter((t) => now - t < 60_000);
  if (timestamps.length >= 10) return true;
  timestamps.push(now);
  rateLimits.set(phone, timestamps);
  return false;
}

// Resolve user from phone — tries exact match, then last 10 digits
async function resolveUserFromPhone(phone: string) {
  // Strip any non-digit characters just in case
  const digits = phone.replace(/\D/g, "");

  let user = await prisma.user.findFirst({
    where: { phone: digits, isActive: true },
    include: { role: true },
  });

  if (!user) {
    // Try last 10 digits (handles country code differences)
    const last10 = digits.slice(-10);
    user = await prisma.user.findFirst({
      where: { phone: { endsWith: last10 }, isActive: true },
      include: { role: true },
    });
  }

  return user;
}

// Format markdown → WhatsApp text
function formatForWhatsApp(text: string): string {
  return text
    .replace(/^#{1,3}\s+(.+)$/gm, "*$1*")
    .replace(/\*\*(.+?)\*\*/g, "*$1*")
    .replace(/\|(.+)\|/g, (match) => {
      const cells = match.split("|").filter((c) => c.trim() && !c.match(/^[\s-:]+$/));
      return cells.map((c) => c.trim()).join("  ·  ");
    })
    .replace(/^\|[\s-:|]+\|$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\[Download.*?\]\(.*?\)/g, "(CSV available on web dashboard)")
    .trim();
}

// Trial expiry — WhatsApp bot only available this week
const WA_BOT_EXPIRY = new Date("2026-12-07T00:00:00+05:30"); // Monday April 7 IST

// Resolve org-scoped locations (same as web auth middleware)
async function resolveAllowedLocations(orgNodeId: string): Promise<string[]> {
  try {
    const result = await prisma.$queryRaw<{ location: string }[]>`
      WITH RECURSIVE subtree AS (
        SELECT id, locations FROM org_nodes WHERE id = ${orgNodeId}::uuid
        UNION ALL
        SELECT c.id, c.locations FROM org_nodes c
        JOIN subtree p ON c.parent_id = p.id
      )
      SELECT DISTINCT unnest(locations) as location FROM subtree
    `;
    return result.map((r) => r.location);
  } catch {
    return [];
  }
}

// Main DM handler — works exactly like the web chat
async function handleDMBot(msg: any) {
  const body = (msg.body || "").trim();
  if (!body) return;

  const chatId = msg.from;

  // Check trial expiry
  if (new Date() > WA_BOT_EXPIRY) {
    await client!.sendMessage(chatId, "The WhatsApp bot trial has ended. Please use the web dashboard at emo-energy.com");
    return;
  }

  // Resolve phone number — @lid format doesn't contain it, so get it from contact
  let phone = "";
  try {
    const contactId = msg.author || msg.from;
    const contact = await client!.getContactById(contactId);
    phone = contact.number || contact.id?.user || contactId.split("@")[0];
  } catch {
    phone = chatId.replace("@c.us", "").replace("@lid", "").split("@")[0];
  }
  phone = phone.replace(/\D/g, "");

  console.log(`  [WA Bot] DM from +${phone} (${chatId}): "${body.slice(0, 80)}${body.length > 80 ? '...' : ''}"`);

  // Test command
  if (body.toLowerCase() === "ping") {
    console.log(`  [WA Bot] Ping → Pong`);
    await client!.sendMessage(chatId, "🏓 Pong! EMO Intelligence Bot is running.");
    return;
  }

  // Rate limit
  if (isRateLimited(phone)) {
    console.log(`  [WA Bot] Rate limited: +${phone}`);
    await client!.sendMessage(chatId, "⏳ Too many messages. Please wait a moment.");
    return;
  }

  // Resolve user
  console.log(`  [WA Bot] Looking up user for phone: ${phone}`);
  const user = await resolveUserFromPhone(phone);

  if (!user) {
    console.log(`  [WA Bot] No user found for +${phone}`);
    await client!.sendMessage(
      chatId,
      `Hi! I'm the EMO Intelligence Bot. 🤖\n\nYour phone number (+${phone}) isn't linked to an EMO account yet.\n\n*To get started:*\n1. Log in to the EMO web dashboard\n2. Go to Settings\n3. Link your phone number\n\nThen message me again!`
    );
    return;
  }

  console.log(`  [WA Bot] User: ${user.name} (${user.role.name})`);

  // Resolve org scope — same as web chat
  const orgScope = await resolveAllowedLocations(user.orgNodeId);

  // Find or create conversation
  let conv = await prisma.conversation.findFirst({
    where: { userId: user.id, channel: "whatsapp", isArchived: false },
    orderBy: { updatedAt: "desc" },
  });
  if (!conv) {
    conv = await prisma.conversation.create({
      data: { userId: user.id, channel: "whatsapp", title: `WhatsApp · ${user.name}` },
    });
    console.log(`  [WA Bot] New conversation for ${user.name}`);
  }

  // Store user message
  await prisma.message.create({
    data: { conversationId: conv.id, role: "user", content: body, source: "whatsapp" },
  });

  // Get conversation history — same depth as web (last 20, pass last 6 to agent)
  const history = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: { createdAt: "asc" },
    take: 20,
    select: { role: true, content: true },
  });

  // Show typing
  try {
    const chat = await client!.getChatById(chatId);
    await (chat as any).sendStateTyping?.();
  } catch { }

  try {
    console.log(`  [WA Bot] Invoking agent...`);
    const startTime = Date.now();
    const invokeAgent = await getInvokeAgent();

    const result = await invokeAgent(body, {
      userId: user.id,
      userRole: user.role.name,
      orgScope,
      conversationHistory: history.slice(0, -1).map((m) => ({ role: m.role, content: m.content })),
    });

    const latencyMs = Date.now() - startTime;
    console.log(`  [WA Bot] ${result.agent} agent responded (${latencyMs}ms, ${result.response.length} chars)`);

    // Format for WhatsApp
    let response = formatForWhatsApp(result.response);
    if (response.length > 3000) {
      response = response.slice(0, 2950) + "\n\n_(Truncated. View full answer on the web dashboard.)_";
    }

    // Store assistant message
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: "assistant",
        content: result.response,
        source: "whatsapp",
        agentName: result.agent,
        latencyMs,
      },
    });

    await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });

    // Audit log — same as web chat
    await prisma.auditLog.create({
      data: {
        userId: user.id,
        action: "chat.query",
        resource: `conversation:${conv.id}`,
        details: { agent: result.agent, latencyMs, queryLength: body.length, responseLength: result.response.length },
        channel: "whatsapp",
      },
    });

    // Send reply
    await client!.sendMessage(chatId, response);
    console.log(`  [WA Bot] ✓ Reply sent to ${user.name} via ${result.agent} agent`);

  } catch (err: any) {
    console.error(`  [WA Bot] ERROR for ${user.name} (+${phone}):`, err?.message || err);
    try {
      await client!.sendMessage(chatId, "Sorry, something went wrong. Please try again or use the web dashboard.");
    } catch { }
  }

  // Clear typing
  try {
    const chat = await client!.getChatById(chatId);
    await (chat as any).clearState?.();
  } catch { }
}

// ══════════════════════════════════════════════════════
// GROUP MENTION BOT — responds when @mentioned in groups
// ══════════════════════════════════════════════════════

async function isBotMentioned(msg: any): Promise<boolean> {
  if (!connectedNumber) return false;

  const mentionedIds: any[] = msg.mentionedIds || msg._data?.mentionedJidList || [];
  if (mentionedIds.length === 0) return false;

  for (const mid of mentionedIds) {
    const id = typeof mid === "string" ? mid : (mid?._serialized || mid?.user || "");
    if (!id) continue;

    // Check phone number match
    if (id.includes(connectedNumber)) return true;

    // Check against known LIDs
    const idUser = id.split("@")[0];
    if (botLids.has(idUser) || botLids.has(id)) return true;
  }

  // Fallback: check message body
  if ((msg.body || "").includes(`@${connectedNumber}`)) return true;

  // Unknown mention — try to resolve the LID to see if it's actually us
  for (const mid of mentionedIds) {
    const id = typeof mid === "string" ? mid : (mid?._serialized || mid?.user || "");
    if (!id || !id.includes("@lid")) continue;

    try {
      const contact = await client!.getContactById(id);
      const phone = contact.number || "";
      if (phone === connectedNumber || phone.endsWith(connectedNumber)) {
        // This LID IS us! Save it and return true
        const lidUser = id.split("@")[0];
        botLids.add(lidUser);
        botLids.add(id);
        console.log(`  [WA Bot] Discovered bot LID via contact resolve: ${lidUser}`);
        return true;
      }
    } catch { }
  }

  console.log(`  [WA Bot] Mention miss — mentioned: ${JSON.stringify(mentionedIds.map((m: any) => typeof m === 'string' ? m : m?._serialized))}, known LIDs: ${JSON.stringify([...botLids])}`);
  return false;
}

// Learn bot's LID from outgoing messages (most reliable way)
function learnBotLid(msg: any) {
  // Check every field that might contain the bot's LID
  const candidates = [
    msg.author,
    msg.from,
    msg.to,
    msg.id?.participant,
    msg.id?.remote,
    msg._data?.author,
    msg._data?.from,
    msg._data?.participant,
  ];

  for (const c of candidates) {
    if (!c) continue;
    const val = typeof c === "string" ? c : (c._serialized || "");
    if (!val) continue;
    const user = val.split("@")[0];
    // It's a LID if it's a long numeric ID that isn't our phone number
    if (user && /^\d{10,}$/.test(user) && user !== connectedNumber && !botLids.has(user)) {
      botLids.add(user);
      botLids.add(`${user}@lid`);
      console.log(`  [WA Bot] Learned bot LID from outgoing: ${user}`);
    }
  }
}

function stripMention(body: string): string {
  // Remove @mentions (phone numbers and LID format)
  return body
    .replace(/@\d{10,15}/g, "")     // @919606861074
    .replace(/@\d{15,}/g, "")        // @149679744499923 (LID)
    .trim();
}

async function handleGroupMention(msg: any) {
  const rawBody = (msg.body || "").trim();
  const body = stripMention(rawBody);
  if (!body) return;

  const groupId = msg.from;
  const authorId = msg.author || msg.from;

  // Resolve who sent the message
  let phone = "";
  let senderName = "";
  try {
    const contact = await client!.getContactById(authorId);
    phone = contact.number || authorId.split("@")[0];
    senderName = contact.pushname || contact.name || (contact as any).shortName || phone;
  } catch {
    phone = authorId.split("@")[0];
    senderName = msg._data?.notifyName || phone;
  }
  phone = phone.replace(/\D/g, "");

  console.log(`  [WA Bot] Group mention from ${senderName} (+${phone}) in ${groupId}: "${body.slice(0, 80)}"`);

  // Rate limit per phone
  if (isRateLimited(phone)) {
    await client!.sendMessage(groupId, "⏳ Too many messages. Please wait a moment.");
    return;
  }

  // Resolve user — if not linked, use a guest context (anyone in group can ask)
  const user = await resolveUserFromPhone(phone);
  const userId = user?.id || "guest";
  const userRole = user?.role?.name || "employee";
  const orgNodeId = user?.orgNodeId || null;
  const userName = user?.name || senderName;

  const orgScope = orgNodeId ? await resolveAllowedLocations(orgNodeId) : [];

  if (!user) {
    console.log(`  [WA Bot] Group mention from unlinked user ${senderName} — responding as guest`);
  }

  // Group mentions are STATELESS — no conversation history.
  // Each @mention is an independent question. Prevents hallucination from old context.

  // Typing indicator
  try {
    const chat = await client!.getChatById(groupId);
    await (chat as any).sendStateTyping?.();
  } catch { }

  try {
    console.log(`  [WA Bot] Invoking agent for ${userName} (group)...`);
    const startTime = Date.now();
    const invokeAgent = await getInvokeAgent();

    const result = await invokeAgent(body, {
      userId: userId,
      userRole: userRole,
      orgScope,
      conversationHistory: [], // Stateless — each group mention is independent
    });

    const latencyMs = Date.now() - startTime;

    let response = formatForWhatsApp(result.response);
    if (response.length > 3000) {
      response = response.slice(0, 2950) + "\n\n_(Truncated. Full answer on web dashboard.)_";
    }

    // No conversation storage for group mentions — stateless by design

    // Reply in group — quote the original message
    await msg.reply(response);
    console.log(`  [WA Bot] ✓ Group reply to ${userName} via ${result.agent} agent (${latencyMs}ms)`);

  } catch (err: any) {
    console.error(`  [WA Bot] Group mention ERROR:`, err?.message || err);
    try {
      await msg.reply("Sorry, something went wrong. Try asking me in a DM.");
    } catch { }
  }

  // Clear typing
  try {
    const chat = await client!.getChatById(groupId);
    await (chat as any).clearState?.();
  } catch { }
}

// ══════════════════════════════════════════════════════
// PROCESS KILLER — cross-platform Chrome force-kill
// ══════════════════════════════════════════════════════

const isWindows = process.platform === "win32";

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // Signal 0 = just check, don't kill
    return true;
  } catch {
    return false; // Process doesn't exist
  }
}

async function forceKillChrome(pid: number): Promise<boolean> {
  console.log(`  [WA Kill] Killing Chrome PID ${pid} (${isWindows ? "Windows" : "Linux"})...`);

  // Step 1: Graceful SIGTERM (works on both platforms)
  try {
    process.kill(pid, "SIGTERM");
    await new Promise((r) => setTimeout(r, 2000));
    if (!isProcessAlive(pid)) {
      console.log(`  [WA Kill] Chrome PID ${pid} dead after SIGTERM`);
      return true;
    }
  } catch {}

  // Step 2: Platform-specific force kill
  try {
    if (isWindows) {
      // /F = force, /T = kill entire process tree (Chrome spawns children)
      execSync(`taskkill /F /T /PID ${pid}`, { timeout: 10_000, stdio: "ignore" });
    } else {
      process.kill(pid, "SIGKILL");
    }
    await new Promise((r) => setTimeout(r, 3000));
    if (!isProcessAlive(pid)) {
      console.log(`  [WA Kill] Chrome PID ${pid} dead after force kill`);
      return true;
    }
  } catch {}

  // Step 3: Windows fallback — kill all chrome.exe matching our session
  if (isWindows) {
    try {
      execSync(`taskkill /F /IM chrome.exe /FI "WINDOWTITLE eq about:blank"`, { timeout: 10_000, stdio: "ignore" });
      await new Promise((r) => setTimeout(r, 2000));
    } catch {}
  }

  const alive = isProcessAlive(pid);
  console.log(`  [WA Kill] Chrome PID ${pid} ${alive ? "STILL ALIVE" : "dead"}`);
  return !alive;
}

// ══════════════════════════════════════════════════════
// WATCHDOG — detects silent deaths, auto-recovers
// ══════════════════════════════════════════════════════

const MAX_RECOVERY_ATTEMPTS = 3;
const RECOVERY_BACKOFF = [5_000, 10_000, 20_000]; // Exponential backoff

let watchdogInterval: ReturnType<typeof setInterval> | null = null;
let lastHealthy = Date.now();
let consecutiveFailures = 0;
let isRecovering = false;

async function healthCheck(): Promise<boolean> {
  if (!client || !isReady) return false;
  try {
    const state = await Promise.race([
      client.getState(),
      new Promise<null>((_, reject) => setTimeout(() => reject(new Error("Health check timeout")), 10_000)),
    ]);
    if (state === "CONNECTED") {
      lastHealthy = Date.now();
      consecutiveFailures = 0;
      recoveryAttempts = 0; // Reset on healthy
      return true;
    }
    console.warn(`  [WA Watchdog] State: ${state} (not CONNECTED)`);
    return false;
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg.includes("detached") || msg.includes("Target closed") || msg.includes("Session closed") || msg.includes("timeout")) {
      console.error(`  [WA Watchdog] Fatal: ${msg} — recovering immediately`);
      recover();
      return false;
    }
    console.warn(`  [WA Watchdog] Health check failed: ${msg}`);
    return false;
  }
}

async function recover() {
  if (isRecovering) return;
  isRecovering = true;
  recoveryAttempts++;

  if (recoveryAttempts > MAX_RECOVERY_ATTEMPTS) {
    console.error(`  [WA Watchdog] ═══ GIVING UP after ${MAX_RECOVERY_ATTEMPTS} failed recoveries. Manual restart required. ═══`);
    isRecovering = false;
    return;
  }

  const backoff = RECOVERY_BACKOFF[recoveryAttempts - 1] || 20_000;
  console.log(`  [WA Watchdog] Recovery attempt ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS}...`);

  // Stop watchdog/keepalive
  if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null; }
  if (keepaliveInterval) { clearInterval(keepaliveInterval); keepaliveInterval = null; }

  const oldClient = client;
  client = null;
  isReady = false;
  connectedNumber = null;
  consecutiveFailures = 0;

  // ── Step 1: Kill Chrome via stored PID (most reliable) ──
  let killed = false;
  if (browserPid && isProcessAlive(browserPid)) {
    killed = await forceKillChrome(browserPid);
  }

  // ── Step 2: Kill via Puppeteer browser handle (backup) ──
  if (!killed && oldClient) {
    try {
      const browser = (oldClient as any).pupBrowser;
      if (browser) {
        const proc = browser.process();
        if (proc?.pid && isProcessAlive(proc.pid)) {
          killed = await forceKillChrome(proc.pid);
        }
        // Also try graceful close
        if (!killed) {
          try { await Promise.race([browser.close(), new Promise(r => setTimeout(r, 3000))]) } catch {}
        }
      }
    } catch {}
  }

  // ── Step 3: Try client.destroy() as last resort ──
  if (oldClient) {
    try { await Promise.race([oldClient.destroy(), new Promise(r => setTimeout(r, 3000))]) } catch {}
  }

  // ── Step 4: Clean lock files ──
  const sessionDir = path.resolve(".wwebjs_auth", "session");
  for (const lockFile of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    try { fs.unlinkSync(path.join(sessionDir, lockFile)); } catch {}
  }

  browserPid = null;

  // ── Step 5: Wait with backoff ──
  console.log(`  [WA Watchdog] Waiting ${backoff / 1000}s before reinit...`);
  await new Promise((r) => setTimeout(r, backoff));

  // ── Step 6: Verify Chrome is actually dead ──
  if (browserPid && isProcessAlive(browserPid)) {
    console.error(`  [WA Watchdog] Chrome STILL alive after kill — retrying recovery`);
    isRecovering = false;
    recover(); // Retry with next attempt
    return;
  }

  console.log("  [WA Watchdog] Reinitializing client...");
  isRecovering = false;
  initWhatsApp();
}

function startWatchdog() {
  if (watchdogInterval) clearInterval(watchdogInterval);

  watchdogInterval = setInterval(async () => {
    if (isRecovering || !isReady) return;

    const healthy = await healthCheck();
    if (!healthy) {
      consecutiveFailures++;
      console.warn(`  [WA Watchdog] Failure ${consecutiveFailures}/3`);

      if (consecutiveFailures >= 3) {
        console.error("  [WA Watchdog] 3 consecutive failures — recovering");
        await recover();
      }
    }
  }, 60_000);

  console.log("  [WA Watchdog] Started (checks every 60s)");
}

// ══════════════════════════════════════════════════════
// KEEPALIVE — prevents idle disconnects
// ══════════════════════════════════════════════════════

let keepaliveInterval: ReturnType<typeof setInterval> | null = null;

function startKeepalive() {
  if (keepaliveInterval) clearInterval(keepaliveInterval);

  keepaliveInterval = setInterval(async () => {
    if (!client || !isReady || isRecovering) return;
    try {
      // Light operation to keep the session alive
      await client.getState();
    } catch { }
  }, 5 * 60_000); // Every 5 minutes
}

// ══════════════════════════════════════════════════════
// BACKFILL — reads history from WhatsApp Web's internal
// store via Puppeteer. Bypasses fetchMessages() entirely.
// ══════════════════════════════════════════════════════

async function backfillFromStore() {
  if (!client) return;
  const page = (client as any).pupPage;
  if (!page) return;

  const groups = await prisma.waMonitoredGroup.findMany({ where: { isActive: true } });
  if (!groups.length) return;

  console.log(`  WhatsApp: backfilling from ${groups.length} groups...`);
  let total = 0;

  for (const group of groups) {
    try {
      const msgs: any[] = await page.evaluate(async (chatId: string) => {
        try {
          const store = (window as any).Store;
          if (!store?.Chat) return [];

          const chat = store.Chat.get(chatId);
          if (!chat || typeof chat.getAllMsgs !== "function") return [];

          // Load chat if needed
          try { if (chat.waitForChatLoading) await chat.waitForChatLoading(); } catch {}

          // Loop getAllMsgs — each call may trigger server fetch for more history
          let allMsgs: any[] = [];
          for (let i = 0; i < 10; i++) {
            try {
              const result = await chat.getAllMsgs();
              if (!Array.isArray(result) || result.length <= allMsgs.length) break;
              allMsgs = result;
              // Small delay to let WhatsApp Web fetch more from server
              await new Promise(r => setTimeout(r, 800));
            } catch { break; }
          }

          return allMsgs.map((m: any) => ({
            body: m.body || m.caption || m.text || m.content || m.description || "",
            author: m.author?._serialized || m.author || "",
            from: m.from?._serialized || m.from || "",
            timestamp: m.t || 0,
            fromMe: !!(m.id?.fromMe),
            notifyName: m.notifyName || "",
            type: m.type || "chat",
            // Dump all string fields for media messages so we don't miss captions
            _extra: m.type !== "chat" ? Object.fromEntries(
              Object.entries(m).filter(([k, v]) => typeof v === "string" && (v as string).length > 0 && (v as string).length < 500 && !k.startsWith("_"))
            ) : undefined,
          })).filter((m: any) => !m.fromMe);
        } catch {
          return [];
        }
      }, group.chatId);

      for (const m of msgs) {
        // For media messages, log extra fields once to find caption field name
        if (m._extra && total < 3) {
          console.log(`      [Media fields] type=${m.type}: ${JSON.stringify(m._extra)}`);
        }

        const text = m.body || (m._extra ? Object.values(m._extra).find((v: any) => typeof v === "string" && v.length > 5) as string : "") || (m.type === "image" ? "[image]" : m.type !== "chat" ? `[${m.type}]` : "");
        if (!text) continue;

        const authorId = m.author || m.from || "";
        let sender = m.notifyName || "";
        if (!sender || /^\d{10,}$/.test(sender)) {
          sender = await resolveContactName(authorId, m.notifyName || undefined);
        }

        storeGroupMessage({
          sender,
          senderPhone: authorId.split("@")[0].replace(/\D/g, ""),
          text: text.slice(0, 500),
          time: new Date(m.timestamp * 1000),
          fromMe: false,
          groupId: group.chatId,
          groupName: group.chatName,
        });
        total++;
      }

      if (msgs.length > 0) {
        console.log(`    ${group.chatName}: ${msgs.length} messages`);
      }
    } catch {}
  }

  console.log(`  WhatsApp: backfilled ${total} messages total`);
}

// ══════════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════════

export function initWhatsApp() {
  if (client) return;

  console.log("  WhatsApp: initializing...");

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: ".wwebjs_auth" }),
    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--disable-extensions",
        "--no-first-run",
        "--disable-background-timer-throttling",
        "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding",
        "--disable-features=TranslateUI",
        "--disable-ipc-flooding-protection",      // Prevents frame detach under load
        "--disable-hang-monitor",                  // Don't kill "unresponsive" pages
        "--js-flags=--max-old-space-size=512",     // Limit Chrome JS memory
      ],
      timeout: 60_000, // 60s timeout for browser launch
    },
  });

  client.on("qr", (qr: string) => {
    currentQR = qr;
    isReady = false;
    console.log("\n  WhatsApp QR Code — scan with your phone:");
    qrcode.generate(qr, { small: true });
    waEvents.emit("qr", qr);
  });

  client.on("ready", async () => {
    isReady = true;
    currentQR = null;
    lastHealthy = Date.now();
    consecutiveFailures = 0;
    recoveryAttempts = 0; // Successful connection — reset

    // Capture Chrome PID for force-kill during recovery
    try {
      const browser = (client as any).pupBrowser;
      const proc = browser?.process();
      if (proc?.pid) {
        browserPid = proc.pid;
        console.log(`  WhatsApp Chrome PID: ${browserPid}`);
      }
    } catch {}

    const info = client!.info;
    connectedNumber = info?.wid?.user || "unknown";
    botWid = info?.wid?._serialized || null;

    // Resolve bot's own LID — needed for @mention matching in groups
    // Method 1: Check contact data
    try {
      const me = await client!.getContactById(botWid || `${connectedNumber}@c.us`);
      // Try every possible place the LID might be
      const possibleLids = [
        (me as any).id?.lid,
        (me as any)._data?.lid,
        (me as any).id?._serialized,
      ];
      for (const lid of possibleLids) {
        if (lid && !lid.includes(connectedNumber)) {
          const user = lid.split("@")[0];
          botLids.add(user);
          botLids.add(`${user}@lid`);
          console.log(`  WhatsApp bot LID (from contact): ${user}`);
        }
      }
    } catch { }

    // Method 2: Send a probe message to self to learn LID
    // The message_create event from our own message will contain the LID
    if (botLids.size === 0) {
      console.log("  WhatsApp: LID not found from contact, will learn from first outgoing message");
    }

    console.log(`  WhatsApp connected: +${connectedNumber} (WID: ${botWid})`);
    console.log(`  WhatsApp DM Bot: ACTIVE | Group @mention: ACTIVE`);
    waEvents.emit("ready", connectedNumber);

    await loadMonitoredGroups();

    // Backfill: read history directly from WhatsApp Web's internal store via Puppeteer.
    // This bypasses chat.fetchMessages() (broken waitForChatLoading bug) entirely.
    await backfillFromStore();

    // Start watchdog + keepalive
    startWatchdog();
    startKeepalive();

    // Pre-cache the agent invoker
    getInvokeAgent().catch(() => { });
  });

  client.on("disconnected", (reason: string) => {
    isReady = false;
    connectedNumber = null;
    console.log("  WhatsApp disconnected:", reason);
    waEvents.emit("disconnected", reason);

    // Auto-recover
    setTimeout(() => {
      if (!isRecovering) {
        console.log("  WhatsApp: reconnecting after disconnect...");
        client = null;
        initWhatsApp();
      }
    }, 10_000);
  });

  client.on("change_state", (state: string) => {
    console.log(`  [WA] State changed: ${state}`);
    if (state === "CONFLICT" || state === "UNLAUNCHED" || state === "UNPAIRED") {
      console.warn(`  [WA] Bad state "${state}" — will recover on next watchdog check`);
      isReady = false;
    }
  });

  // ── Message listeners ──
  const processedIds = new Set<string>();

  const handleMessage = async (msg: any) => {
    try {
      // Deduplicate
      const msgId = msg.id?._serialized || msg.id?.id || String(msg.timestamp);
      if (processedIds.has(msgId)) return;
      processedIds.add(msgId);
      if (processedIds.size > 1000) {
        const arr = Array.from(processedIds);
        arr.splice(0, 500).forEach((id) => processedIds.delete(id));
      }

      if (!msg.body?.trim()) return;
      if (msg.from === "status@broadcast") return;

      // Learn bot's LID from its own outgoing messages
      if (msg.fromMe || msg.id?.fromMe) {
        learnBotLid(msg);
        return;
      }

      // Mark as healthy — we're receiving messages
      lastHealthy = Date.now();
      consecutiveFailures = 0;

      const isGroup = msg.from?.endsWith("@g.us");
      const isDM = !isGroup && !msg.from?.includes("@broadcast");

      // ── Capture monitored group messages (in-memory + persist to DB) ──
      if (isGroup && monitoredChatIds.has(msg.from)) {
        await captureGroupMessage(msg).catch((err: any) => {
          console.error("  [WA Capture] Error:", err?.message);
        });
      }

      // ── Handle DMs and group @mentions ──
      if (isDM) {
        await handleDMBot(msg);
      } else if (isGroup && await isBotMentioned(msg)) {
        await handleGroupMention(msg);
      }
    } catch (err: any) {
      const msg = err?.message || "";
      console.error("  [WA] Message handler error:", msg);
      // If the error is a detached frame, trigger recovery
      if (msg.includes("detached") || msg.includes("Target closed") || msg.includes("Session closed")) {
        console.error("  [WA] Fatal error in message handler — recovering");
        recover();
      }
    }
  };

  client.on("message", handleMessage);
  client.on("message_create", handleMessage);

  client.on("auth_failure", (msg: string) => {
    console.error("  WhatsApp auth failed:", msg);
    isReady = false;
    // Auth failure needs full re-auth — recover after delay
    setTimeout(() => recover(), 15_000);
  });

  client.initialize().catch(async (err: any) => {
    const msg = err?.message || "";
    console.error("  WhatsApp init failed:", msg);
    client = null;

    if (msg.includes("already running") || msg.includes("SingletonLock")) {
      console.log("  [WA] Stale Chrome detected — force killing...");

      // Kill the orphaned Chrome using stored PID
      if (browserPid && isProcessAlive(browserPid)) {
        await forceKillChrome(browserPid);
      }

      // Also try killing any Chrome holding our session dir
      if (isWindows) {
        try { execSync(`taskkill /F /IM chrome.exe`, { timeout: 10_000, stdio: "ignore" }); } catch {}
      }

      // Clean lock files
      const sessionDir = path.resolve(".wwebjs_auth", "session");
      for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
        try { fs.unlinkSync(path.join(sessionDir, f)); } catch {}
      }

      browserPid = null;
      recoveryAttempts++;

      if (recoveryAttempts > MAX_RECOVERY_ATTEMPTS) {
        console.error(`  [WA] ═══ GIVING UP after ${MAX_RECOVERY_ATTEMPTS} attempts. Restart the server. ═══`);
        return;
      }

      const backoff = RECOVERY_BACKOFF[recoveryAttempts - 1] || 20_000;
      console.log(`  [WA] Retry ${recoveryAttempts}/${MAX_RECOVERY_ATTEMPTS} in ${backoff / 1000}s...`);
      setTimeout(() => initWhatsApp(), backoff);
    } else {
      setTimeout(() => initWhatsApp(), 30_000);
    }
  });
}
