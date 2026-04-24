// User memory tools — let the user (and admins) inspect/manage what the bot remembers.
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";
import { getContext } from "../context.js";
import { canDo } from "../../auth/permissions.js";
import { setMemory, clearMemoryForUser, listMemoryForUser, deleteMemoryById, MEMORY_TYPES, type MemoryType } from "../memory/user-memory.js";

// ══════════════════════════════════════════════════════
// 1. REMEMBER — user explicitly stores a fact
// ══════════════════════════════════════════════════════
export const rememberThisTool = tool(
  async ({ fact, type }) => {
    const ctx = getContext();
    await setMemory({
      userId: ctx.userId,
      type: (type || "preference") as MemoryType,
      content: fact,
      source: "explicit",
    });
    return JSON.stringify({
      ok: true,
      message: `Saved: "${fact}" (${type || "preference"}). I'll remember this for future conversations.`,
    });
  },
  {
    name: "remember_about_me",
    description: `Explicitly save a fact about the current user that the bot should remember across ALL future conversations. Use when the user says:
- "remember I prefer short answers" → type: preference
- "I handle finance for Bengaluru" → type: role_context
- "always brief me in Hindi" → type: style
- "I work weekends" → type: working_pattern
Only call this when the user EXPLICITLY wants to store something — don't call it spontaneously.`,
    schema: z.object({
      fact: z.string().describe("The fact to remember, phrased as a durable statement (max 200 chars)"),
      type: z.enum(["preference", "role_context", "working_pattern", "expertise", "interest", "relationship", "style"]).optional(),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 2. WHAT DO YOU KNOW ABOUT ME
// ══════════════════════════════════════════════════════
export const whatYouKnowTool = tool(
  async () => {
    const ctx = getContext();
    const memories = await listMemoryForUser(ctx.userId);
    if (memories.length === 0) {
      return JSON.stringify({
        total: 0,
        message: `I don't have any stored facts about you yet, ${ctx.userName}. I'll learn as we chat.`,
      });
    }
    return JSON.stringify({
      total: memories.length,
      memory: memories.map((m) => ({
        id: m.id,
        type: m.type,
        content: m.content,
        source: m.source,
        reinforced: m.reinforced,
        lastSeen: m.lastSeen.toISOString().slice(0, 10),
      })),
    });
  },
  {
    name: "what_do_you_know_about_me",
    description: "Show all facts the bot has stored about the current user. Use when user asks 'what do you know about me', 'what do you remember', 'show my profile'.",
    schema: z.object({}),
  },
);

// ══════════════════════════════════════════════════════
// 3. FORGET SPECIFIC FACT
// ══════════════════════════════════════════════════════
export const forgetOneTool = tool(
  async ({ memoryId }) => {
    const ctx = getContext();
    const removed = await deleteMemoryById(ctx.userId, memoryId);
    return JSON.stringify({
      ok: removed,
      message: removed ? "Forgotten." : "No matching memory found for this user.",
    });
  },
  {
    name: "forget_one_fact",
    description: "Delete a specific remembered fact by its memory ID. Use when the user says 'forget that I...' after seeing their profile via what_do_you_know_about_me.",
    schema: z.object({
      memoryId: z.string().describe("UUID of the memory entry"),
    }),
  },
);

// ══════════════════════════════════════════════════════
// 4. FORGET EVERYTHING ABOUT ME (privacy)
// ══════════════════════════════════════════════════════
export const forgetAllTool = tool(
  async () => {
    const ctx = getContext();
    const count = await clearMemoryForUser(ctx.userId);
    return JSON.stringify({
      ok: true,
      cleared: count,
      message: `Cleared all ${count} stored facts about you. I'll start fresh.`,
    });
  },
  {
    name: "forget_everything_about_me",
    description: "Permanently delete ALL stored facts about the current user. Use ONLY when the user explicitly says 'forget everything', 'clear my profile', 'reset your memory of me'.",
    schema: z.object({}),
  },
);

// ══════════════════════════════════════════════════════
// 5. ADMIN: VIEW ANOTHER USER'S MEMORY (audit-only)
// ══════════════════════════════════════════════════════
export const viewUserMemoryTool = tool(
  async ({ userName }) => {
    const ctx = getContext();
    if (!canDo(ctx.userRole, "audit.read")) {
      return JSON.stringify({ error: "Admin/CEO/COO only" });
    }

    const users = await prisma.user.findMany({
      where: { name: { contains: userName, mode: "insensitive" } },
      select: { id: true, name: true },
    });
    if (users.length === 0) return JSON.stringify({ error: "No matching user" });
    if (users.length > 1) return JSON.stringify({ error: `Ambiguous: ${users.map((u) => u.name).join(", ")}` });

    const memories = await listMemoryForUser(users[0].id);
    return JSON.stringify({
      user: users[0].name,
      total: memories.length,
      memory: memories.map((m) => ({
        type: m.type,
        content: m.content,
        source: m.source,
        reinforced: m.reinforced,
      })),
    });
  },
  {
    name: "view_user_memory",
    description: "Admin-only. See what the bot has stored about a specific user. Useful for audits or debugging personalization.",
    schema: z.object({ userName: z.string() }),
  },
);

export const userMemoryTools = [
  rememberThisTool,
  whatYouKnowTool,
  forgetOneTool,
  forgetAllTool,
  viewUserMemoryTool,
];
