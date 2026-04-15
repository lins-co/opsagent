import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getSetting } from "../../config/settings.js";
import { assignInsight } from "../../agents/program-manager/assigner.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.1,
  maxTokens: 4096,
});

// ══════════════════════════════════════════════════════
// Pattern Extraction — reads recent messages, extracts
// insights (complaints, issues, escalations), dedupes
// against existing WaInsight records.
// ══════════════════════════════════════════════════════

interface ExtractedInsight {
  type: "complaint" | "issue" | "escalation" | "resolution" | "alert";
  title: string;
  summary: string;
  severity: "critical" | "high" | "medium" | "low";
  category?: string; // "battery" | "charger" | "vehicle" | "payment" | "app"
  vehicleIds?: string[];
  location?: string;
  reporterNames?: string[];
  status: "open" | "resolved";
}

const EXTRACTION_PROMPT = `You extract operational insights from WhatsApp messages at EMO Energy (EV fleet company).

For the messages below, identify distinct issues, complaints, escalations, and resolutions. Group related messages into single insights.

Output STRICT JSON array — no prose, no markdown, just the array:
[
  {
    "type": "complaint" | "issue" | "escalation" | "resolution" | "alert",
    "title": "short title, 50 chars max",
    "summary": "1-2 sentences describing the issue",
    "severity": "critical" | "high" | "medium" | "low",
    "category": "battery" | "charger" | "vehicle" | "payment" | "app" | "infrastructure",
    "vehicleIds": ["KA51JN6518", ...],  // if mentioned
    "location": "Delhi" | "Bengaluru" | "Sector 62B" | ...,  // if mentioned
    "reporterNames": ["Neeraj Bisht", ...],
    "status": "open" | "resolved"
  }
]

Rules:
- Only extract SUBSTANTIVE issues, not greetings or small talk
- Multiple messages about the SAME issue = ONE insight
- If someone says "done" or "resolved" → type="resolution", status="resolved"
- Severity: critical=fleet-wide, high=multiple vehicles, medium=single issue, low=minor
- Return [] if nothing worth tracking

Return ONLY the JSON array. No explanation.`;

export async function extractInsightsFromMessages(hours = 4): Promise<number> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const messages = await prisma.waMessage.findMany({
    where: { timestamp: { gte: since } },
    orderBy: { timestamp: "asc" },
    include: { group: true },
    take: 500,
  });

  if (messages.length < 3) {
    console.log(`  [Insights] Only ${messages.length} messages in window — skipping`);
    return 0;
  }

  console.log(`  [Insights] Analyzing ${messages.length} messages from last ${hours}h...`);

  // Group messages by group for context. Keep chatId for downstream assignment.
  const byGroup = new Map<string, { name: string; chatId: string; msgs: typeof messages }>();
  for (const m of messages) {
    const name = m.group?.chatName || m.chatId;
    const chatId = m.chatId;
    const cur = byGroup.get(chatId);
    if (!cur) byGroup.set(chatId, { name, chatId, msgs: [m] });
    else cur.msgs.push(m);
  }

  let totalExtracted = 0;

  for (const [, group] of byGroup) {
    const { name: groupName, chatId: groupChatId, msgs: groupMsgs } = group;
    if (groupMsgs.length < 3) continue;

    // Build conversation context
    const context = groupMsgs.map((m) => {
      const time = m.timestamp.toISOString().replace("T", " ").slice(0, 16);
      return `[${time}] ${m.senderName}: ${m.body.slice(0, 300)}`;
    }).join("\n");

    try {
      const response = await llm.invoke([
        new SystemMessage(EXTRACTION_PROMPT),
        new HumanMessage(`Group: ${groupName}\n\n${context}`),
      ]);

      const content = (response.content as string).trim();
      // Strip markdown code fences if present
      const jsonStr = content.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();

      let insights: ExtractedInsight[];
      try {
        insights = JSON.parse(jsonStr);
      } catch {
        console.warn(`  [Insights] Failed to parse JSON for ${groupName}`);
        continue;
      }

      if (!Array.isArray(insights) || insights.length === 0) continue;

      // Save each insight with dedup, then hand off to PM for auto-assignment.
      for (const ins of insights) {
        const createdId = await saveOrUpdateInsight(ins, groupName, groupChatId, groupMsgs.map((m) => m.id));
        totalExtracted++;
        if (createdId && ins.status === "open") {
          // Fire-and-forget assignment — don't block extraction on LLM round-trip.
          assignInsight(createdId).catch((err) =>
            console.warn(`  [PM] auto-assign failed for ${createdId}: ${err?.message}`),
          );
        }
      }

      console.log(`    ${groupName}: ${insights.length} insights`);
    } catch (err: any) {
      console.warn(`  [Insights] ${groupName} extraction failed: ${err?.message?.slice(0, 80)}`);
    }
  }

  return totalExtracted;
}

// Dedup logic: match by (type + category + vehicleIds OR title similarity).
// Returns the insight id if a NEW record was created (so callers can trigger
// downstream work like PM assignment). Returns null on dedup-update.
async function saveOrUpdateInsight(
  ins: ExtractedInsight,
  groupName: string,
  groupChatId: string,
  relatedMessageIds: string[]
): Promise<string | null> {
  if (!ins.title || !ins.summary) return null;

  // Look for existing insight matching same vehicle/category/type
  const candidates = await prisma.waInsight.findMany({
    where: {
      type: ins.type,
      category: ins.category,
      status: "open",
      // Match on vehicle IDs if any are given
      ...(ins.vehicleIds?.length
        ? { vehicleIds: { hasSome: ins.vehicleIds } }
        : ins.location
          ? { location: ins.location }
          : {}),
    },
    orderBy: { lastSeen: "desc" },
    take: 5,
  });

  // Simple similarity check — title keyword overlap
  const newWords = new Set(ins.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
  let match: typeof candidates[number] | null = null;
  for (const c of candidates) {
    const oldWords = new Set(c.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3));
    const overlap = [...newWords].filter((w) => oldWords.has(w)).length;
    if (overlap >= 2 || (newWords.size <= 2 && overlap >= 1)) {
      match = c;
      break;
    }
  }

  if (match) {
    // Increment occurrence, update last seen
    await prisma.waInsight.update({
      where: { id: match.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastSeen: new Date(),
        reporterNames: [...new Set([...match.reporterNames, ...(ins.reporterNames || [])])],
        vehicleIds: [...new Set([...match.vehicleIds, ...(ins.vehicleIds || [])])],
        relatedMessageIds: [...new Set([...match.relatedMessageIds, ...relatedMessageIds])].slice(-50),
        // Mark resolved if this update says so
        ...(ins.status === "resolved" ? { status: "resolved", resolvedAt: new Date() } : {}),
      },
    });
    return null;
  }
  // Create new insight
  const created = await prisma.waInsight.create({
    data: {
      type: ins.type,
      title: ins.title.slice(0, 100),
      summary: ins.summary.slice(0, 500),
      severity: ins.severity,
      category: ins.category,
      status: ins.status,
      groupName,
      groupChatId,
      vehicleIds: ins.vehicleIds || [],
      location: ins.location,
      reporterNames: ins.reporterNames || [],
      firstSeen: new Date(),
      lastSeen: new Date(),
      relatedMessageIds: relatedMessageIds.slice(0, 50),
    },
  });
  return created.id;
}

// Get recurring issues (for proactive response check)
export async function getRecurringInsights(opts: {
  vehicleId?: string;
  location?: string;
  category?: string;
  threshold: number;
}): Promise<any[]> {
  return prisma.waInsight.findMany({
    where: {
      status: "open",
      occurrenceCount: { gte: opts.threshold },
      ...(opts.vehicleId ? { vehicleIds: { has: opts.vehicleId } } : {}),
      ...(opts.location ? { location: opts.location } : {}),
      ...(opts.category ? { category: opts.category } : {}),
    },
    orderBy: { occurrenceCount: "desc" },
    take: 5,
  });
}
