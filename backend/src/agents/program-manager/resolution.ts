// Resolution detector. When a new WhatsApp GROUP message arrives, check
// if it resolves any open insight in that group. Two-stage gate:
//   (1) cheap keyword/overlap pre-filter to avoid spamming the LLM
//   (2) LLM confirms with a tight JSON yes/no for the shortlist
import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0,
  maxTokens: 200,
});

const RESOLVE_RE = /\b(resolved|done|fixed|completed|replaced|delivered|sorted|handed over|working now|ok now|restored)\b/i;

const CONFIRM_PROMPT = `You are checking if a WhatsApp message resolves a known open issue.
Return STRICT JSON:
{ "resolved": true|false, "matchIndex": 0|1|2|... , "reason": "<≤100 chars>" }
Set matchIndex to the index of the matching insight in the given list, or -1 if none match.
A message resolves an insight only if it directly confirms fix/completion for the SAME vehicle OR the SAME specific issue. Generic "done" without context → resolved=false.`;

export async function maybeResolveFromMessage(args: {
  groupChatId: string;
  senderName: string;
  body: string;
  timestamp: Date;
  messageId?: string;
}): Promise<void> {
  if (!RESOLVE_RE.test(args.body)) return;

  // Candidate open insights in this group, recent first.
  const open = await prisma.waInsight.findMany({
    where: { groupChatId: args.groupChatId, status: "open", isStuck: false },
    orderBy: { lastSeen: "desc" },
    take: 10,
  });
  if (open.length === 0) return;

  // Pre-filter: require vehicle-ID overlap OR strong keyword overlap with title.
  const body = args.body.toLowerCase();
  const bodyWords = new Set(body.split(/[^a-z0-9]+/).filter((w) => w.length > 3));

  const shortlist = open.filter((ins) => {
    if (ins.vehicleIds.some((v) => body.includes(v.toLowerCase()))) return true;
    const title = new Set(ins.title.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3));
    const overlap = [...title].filter((w) => bodyWords.has(w)).length;
    return overlap >= 2;
  });
  if (shortlist.length === 0) return;

  const ctx = {
    message: {
      sender: args.senderName,
      body: args.body.slice(0, 400),
      timestamp: args.timestamp.toISOString(),
    },
    openInsights: shortlist.map((i) => ({
      title: i.title,
      summary: i.summary,
      category: i.category,
      vehicleIds: i.vehicleIds,
      reporters: i.reporterNames,
    })),
  };

  try {
    const res = await llm.invoke([
      new SystemMessage(CONFIRM_PROMPT),
      new HumanMessage(JSON.stringify(ctx)),
    ]);
    const raw = (res.content as string).trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    const parsed = JSON.parse(raw) as { resolved: boolean; matchIndex: number; reason: string };
    if (!parsed.resolved || parsed.matchIndex < 0 || parsed.matchIndex >= shortlist.length) return;

    const target = shortlist[parsed.matchIndex];
    await prisma.waInsight.update({
      where: { id: target.id },
      data: {
        status: "resolved",
        resolvedAt: new Date(),
        pmNotes: (target.pmNotes || "") + `\nauto-resolved from group msg by ${args.senderName}: "${args.body.slice(0, 120)}" (${parsed.reason})`,
      },
    });
    console.log(`  [PM Resolution] auto-closed "${target.title}" via ${args.senderName}`);
  } catch (err: any) {
    // Silent — resolution detection is best-effort
  }
}
