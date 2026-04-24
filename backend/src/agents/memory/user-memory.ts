// User Memory Service — the bot's per-user knowledge store.
// Builds a profile of each user over time from conversation history + explicit hints.
//
// Flow:
//   1. On every invokeAgent call, buildMemoryBlock(userId) is injected into system prompt
//   2. After the agent responds, extractMemoriesFromTurn() runs ASYNC on the exchange
//   3. New facts are dedup-matched against existing memory, reinforced or inserted
//   4. Periodic pruning removes low-confidence/stale facts (see pruneStaleMemories)
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";

const extractorLlm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.1,
  maxTokens: 800,
});

// Valid memory types
export const MEMORY_TYPES = ["preference", "role_context", "working_pattern", "expertise", "interest", "relationship", "style"] as const;
export type MemoryType = typeof MEMORY_TYPES[number];

// Cap per user — prevents unbounded growth. When exceeded, lowest reinforced+oldest is pruned.
const MAX_MEMORIES_PER_USER = 40;

// ══════════════════════════════════════════════════════
// READ — build a concise memory block for the system prompt
// ══════════════════════════════════════════════════════
export async function buildMemoryBlock(userId: string): Promise<string> {
  const memories = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: [{ reinforced: "desc" }, { lastSeen: "desc" }],
    take: 30,
  });

  if (memories.length === 0) return "";

  // Group by type
  const grouped: Record<string, string[]> = {};
  for (const m of memories) {
    if (!grouped[m.type]) grouped[m.type] = [];
    grouped[m.type].push(m.content);
  }

  const lines = ["WHAT YOU KNOW ABOUT THIS USER (use it to personalize responses):"];
  for (const type of MEMORY_TYPES) {
    if (!grouped[type]?.length) continue;
    const facts = grouped[type].slice(0, 5);
    lines.push(`- ${type.replace("_", " ")}: ${facts.join("; ")}`);
  }
  return lines.join("\n") + "\n\nUse these facts silently — DON'T announce them. E.g. if user prefers concise answers, just BE concise. Don't say 'I remember you like...'";
}

// ══════════════════════════════════════════════════════
// EXPLICIT SET — user tells the bot "remember I prefer X"
// ══════════════════════════════════════════════════════
export async function setMemory(params: {
  userId: string;
  type: MemoryType;
  content: string;
  source?: "learned" | "explicit" | "observed";
}): Promise<void> {
  const content = params.content.trim().slice(0, 300);
  if (!content) return;

  // Dedup against existing
  const existing = await prisma.userMemory.findMany({
    where: { userId: params.userId, type: params.type },
    take: 20,
  });

  const newLower = content.toLowerCase();
  for (const m of existing) {
    const overlap = wordOverlap(newLower, m.content.toLowerCase());
    if (overlap >= 0.5) {
      // Reinforce existing instead of duplicating
      await prisma.userMemory.update({
        where: { id: m.id },
        data: {
          reinforced: { increment: 1 },
          lastSeen: new Date(),
          confidence: Math.min(1, m.confidence + 0.1),
          // Keep whichever wording is longer/more specific
          content: content.length > m.content.length ? content : m.content,
        },
      });
      return;
    }
  }

  // New memory
  await prisma.userMemory.create({
    data: {
      userId: params.userId,
      type: params.type,
      content,
      source: params.source || "explicit",
      confidence: params.source === "explicit" ? 1.0 : 0.7,
    },
  });

  await pruneIfOverCap(params.userId);
}

// ══════════════════════════════════════════════════════
// LEARN — extract new facts from a conversation turn (LLM)
// ══════════════════════════════════════════════════════
const EXTRACTOR_PROMPT = `You observe a conversation between a user and an assistant (EMO Ops Agent). Your job: extract DURABLE facts about the user that will help personalize FUTURE conversations.

Output STRICT JSON array, max 5 items, no prose:
[
  {
    "type": "preference" | "role_context" | "working_pattern" | "expertise" | "interest" | "relationship" | "style",
    "content": "short fact, max 150 chars",
    "confidence": 0.0-1.0
  }
]

TYPES:
- preference: tone, format, language ("prefers terse answers", "likes Hindi", "wants tables not prose")
- role_context: what they do, their scope ("oversees Bengaluru ops", "handles finance for all India")
- working_pattern: schedule, habits ("briefings at 8 AM", "doesn't work Saturdays")
- expertise: what they're deep in ("expert on BNC batteries", "new to app/tech")
- interest: what they focus on ("cares most about revenue collection", "watches app testing")
- relationship: people they work with ("reports to COO Mrinal", "manages Neeraj's team")
- style: how they communicate ("asks questions in Hinglish", "uses vehicle IDs without spaces")

STRICT RULES:
- Only extract facts that are EXPLICIT or STRONGLY IMPLIED. No guessing.
- Focus on facts useful for PERSONALIZATION, not one-off data.
- If user asked a data question, that's NOT a memory (it's a query).
- Never store sensitive info (passwords, personal health, private relationships).
- If nothing worth learning, return [].

EXAMPLES of good memory:
- User says "give me the numbers no fluff" → {"type": "preference", "content": "prefers terse data-first answers", "confidence": 0.9}
- User says "I handle battery escalations for Bengaluru" → {"type": "role_context", "content": "handles battery escalations for Bengaluru region", "confidence": 1.0}

EXAMPLES of what NOT to store:
- Specific data they asked about (e.g. "asked about KA51JN6518")
- Time-limited context (e.g. "is in a meeting")
- Duplicates of existing memory

Return ONLY the JSON array.`;

export async function extractMemoriesFromTurn(params: {
  userId: string;
  userName: string;
  userMessage: string;
  agentResponse: string;
}): Promise<number> {
  // Very short turns rarely carry useful context
  if (params.userMessage.length < 15) return 0;

  try {
    const res = await extractorLlm.invoke([
      new SystemMessage(EXTRACTOR_PROMPT),
      new HumanMessage(
        `User (${params.userName}) said: "${params.userMessage.slice(0, 800)}"\n\nAssistant replied: "${params.agentResponse.slice(0, 800)}"\n\nExtract durable facts about the user.`,
      ),
    ]);

    const content = (res.content as string).trim();
    const json = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();

    let facts: Array<{ type: string; content: string; confidence: number }>;
    try { facts = JSON.parse(json); } catch { return 0; }
    if (!Array.isArray(facts)) return 0;

    let added = 0;
    for (const f of facts) {
      if (!MEMORY_TYPES.includes(f.type as MemoryType)) continue;
      if (!f.content || f.content.length < 5 || f.content.length > 300) continue;
      if ((f.confidence || 0) < 0.5) continue;

      await setMemory({
        userId: params.userId,
        type: f.type as MemoryType,
        content: f.content,
        source: "learned",
      });
      added++;
    }
    return added;
  } catch {
    return 0;
  }
}

// ══════════════════════════════════════════════════════
// HOUSEKEEPING
// ══════════════════════════════════════════════════════
async function pruneIfOverCap(userId: string): Promise<void> {
  const count = await prisma.userMemory.count({ where: { userId } });
  if (count <= MAX_MEMORIES_PER_USER) return;

  // Delete lowest confidence + oldest + least reinforced
  const victims = await prisma.userMemory.findMany({
    where: { userId },
    orderBy: [{ reinforced: "asc" }, { confidence: "asc" }, { lastSeen: "asc" }],
    take: count - MAX_MEMORIES_PER_USER,
    select: { id: true },
  });
  if (victims.length > 0) {
    await prisma.userMemory.deleteMany({ where: { id: { in: victims.map((v) => v.id) } } });
  }
}

export async function clearMemoryForUser(userId: string): Promise<number> {
  const result = await prisma.userMemory.deleteMany({ where: { userId } });
  return result.count;
}

export async function listMemoryForUser(userId: string) {
  return prisma.userMemory.findMany({
    where: { userId },
    orderBy: [{ reinforced: "desc" }, { type: "asc" }],
  });
}

export async function deleteMemoryById(userId: string, memoryId: string): Promise<boolean> {
  const result = await prisma.userMemory.deleteMany({
    where: { id: memoryId, userId },
  });
  return result.count > 0;
}

// ── Simple word-overlap score (0-1) for dedup ──
function wordOverlap(a: string, b: string): number {
  const tokenize = (s: string) => new Set(s.split(/\W+/).filter((w) => w.length > 3));
  const A = tokenize(a);
  const B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  let hits = 0;
  for (const w of A) if (B.has(w)) hits++;
  return hits / Math.min(A.size, B.size);
}
