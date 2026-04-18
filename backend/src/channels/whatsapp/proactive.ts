import { ChatAnthropic } from "@langchain/anthropic";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import { getSetting, isEnabled, isBotMuted } from "../../config/settings.js";
import { extractEntities } from "./extract.js";
import { getRecurringInsights } from "./insights.js";
import { prisma } from "../../db/prisma.js";
import { env } from "../../config/env.js";
import { getMongoData } from "../../db/connectors/mongodb.js";

const llm = new ChatAnthropic({
  model: "claude-haiku-4-5-20251001",
  apiKey: env.ANTHROPIC_API_KEY,
  temperature: 0.2,
  maxTokens: 800,
});

// ══════════════════════════════════════════════════════
// Proactive Response with Solution Suggestions.
// When a recurring issue is detected, look up past
// resolutions and generate a helpful in-group reply.
// ══════════════════════════════════════════════════════

const lastProactiveReply = new Map<string, number>();
const PROACTIVE_COOLDOWN_MS = 60 * 60 * 1000;

const COMPLAINT_KEYWORDS = /\b(issue|problem|not working|broken|failed|error|fault|malfunction|damage|damaged|down|outage|complaint|urgent|critical|please check|kindly check|help needed|escalat)\b/i;

interface ProactiveResult {
  shouldRespond: boolean;
  response?: string;
  matchedInsights?: any[];
}

// Find past resolutions for similar issues
async function getPastResolutions(opts: {
  vehicleIds: string[];
  location?: string;
  category?: string;
  currentTitle: string;
}): Promise<{ source: string; summary: string; solution?: string; rootCause?: string; resolvedAt?: string }[]> {
  const resolutions: any[] = [];

  // 1. Resolved WhatsApp insights matching this pattern
  const waResolved = await prisma.waInsight.findMany({
    where: {
      status: "resolved",
      OR: [
        ...(opts.vehicleIds.length > 0 ? [{ vehicleIds: { hasSome: opts.vehicleIds } }] : []),
        ...(opts.location ? [{ location: opts.location }] : []),
        ...(opts.category ? [{ category: opts.category }] : []),
      ],
    },
    orderBy: { resolvedAt: "desc" },
    take: 3,
  });

  for (const r of waResolved) {
    resolutions.push({
      source: "whatsapp_history",
      summary: r.title,
      solution: r.notes || r.summary,
      resolvedAt: r.resolvedAt?.toISOString().slice(0, 10),
    });
  }

  // 2. Past battery complaints with solutions (Complaindatabase)
  const data = getMongoData();
  if (data?.Complaindatabase && opts.vehicleIds.length > 0) {
    const bcRecords = data.Complaindatabase
      .filter((c: any) => {
        const vid = c["Vehicle ID/Chasis No"] || c["Vehicle ID"];
        return opts.vehicleIds.some((v) => String(vid || "").toUpperCase().includes(v));
      })
      .filter((c: any) => c["Solution"] || c["Root Cause"] || c["Resolved Type"])
      .slice(0, 3);

    for (const bc of bcRecords) {
      resolutions.push({
        source: "service_history",
        summary: `${bc["Issue"] || "Previous complaint"} for ${bc["Vehicle ID/Chasis No"] || ""}`,
        solution: bc["Solution"] || bc["Resolved Type"],
        rootCause: bc["Root Cause"],
        resolvedAt: bc["Resolved timestamp"] || bc["Created Time"],
      });
    }
  }

  // 3. General battery complaints at same location with solutions
  if (data?.Complaindatabase && opts.location && resolutions.length < 3) {
    const locRecords = data.Complaindatabase
      .filter((c: any) => (c["Location"] || "").includes(opts.location!))
      .filter((c: any) => c["Solution"] && c["Issue"])
      .slice(0, 3 - resolutions.length);

    for (const lc of locRecords) {
      resolutions.push({
        source: "service_history_location",
        summary: `${lc["Issue"]} at ${lc["Location"]}`,
        solution: lc["Solution"],
        rootCause: lc["Root Cause"],
        resolvedAt: lc["Resolved timestamp"] || lc["Created Time"],
      });
    }
  }

  return resolutions;
}

// Generate a smart proactive response using past context
async function generateSmartResponse(opts: {
  currentIssue: string;
  senderName: string;
  matchedInsight: any;
  pastResolutions: any[];
}): Promise<string> {
  const { currentIssue, senderName, matchedInsight, pastResolutions } = opts;

  const insightContext = `
RECURRING PATTERN (seen ${matchedInsight.occurrenceCount} times before):
- Title: ${matchedInsight.title}
- Summary: ${matchedInsight.summary}
- First seen: ${new Date(matchedInsight.firstSeen).toISOString().slice(0, 10)}
- Last seen: ${new Date(matchedInsight.lastSeen).toISOString().slice(0, 10)}
- Reporters: ${matchedInsight.reporterNames.slice(0, 5).join(", ")}
- Vehicles: ${matchedInsight.vehicleIds.slice(0, 5).join(", ") || "N/A"}
- Location: ${matchedInsight.location || "N/A"}
`.trim();

  const resolutionContext = pastResolutions.length > 0
    ? pastResolutions.map((r, i) => `
${i + 1}. [${r.source}] ${r.summary}
   ${r.rootCause ? `Root Cause: ${r.rootCause}` : ""}
   ${r.solution ? `Solution: ${r.solution}` : ""}
   ${r.resolvedAt ? `Resolved: ${r.resolvedAt}` : ""}
`.trim()).join("\n\n")
    : "No past resolutions found for this exact issue.";

  const prompt = `You are EMO's Ops Intelligence Bot responding to a recurring issue reported in a WhatsApp group.

${senderName} just reported: "${currentIssue}"

${insightContext}

PAST RESOLUTIONS (use these to suggest a solution):
${resolutionContext}

Write a concise WhatsApp reply (max 600 chars) that:
1. Acknowledges this is a recurring issue (Nth occurrence)
2. Suggests a specific solution based on past resolutions if available
3. States who to escalate to / what action to take
4. Uses WhatsApp formatting: *bold* with single asterisks, no markdown, no emojis except ⚠️ at start

Format:
⚠️ *Recurring Issue (Nth report)*

[Pattern context in 1-2 lines]

*Likely Cause:* [from past root causes if available]
*Suggested Fix:* [from past solutions, be specific]
*Action:* [who to escalate to, what to do next]

If no past resolution exists, skip "Likely Cause" and "Suggested Fix" sections but still provide Action.
Be direct. No filler. No "would you like me to". End after Action.`;

  try {
    const response = await llm.invoke([
      new SystemMessage(prompt),
      new HumanMessage("Generate the response."),
    ]);
    return (response.content as string).trim();
  } catch (err: any) {
    // Fallback to template if LLM fails
    return buildFallbackResponse(matchedInsight, pastResolutions);
  }
}

function buildFallbackResponse(insight: any, pastResolutions: any[]): string {
  const reporters = insight.reporterNames.slice(0, 3).join(", ");
  let response = `⚠️ *Recurring Issue (${insight.occurrenceCount + 1}${ordinalSuffix(insight.occurrenceCount + 1)} report)*\n\n`;
  response += `_${insight.title}_\n`;
  if (reporters) response += `Previously reported by: ${reporters}\n`;

  const withSolution = pastResolutions.find((r) => r.solution);
  if (withSolution) {
    response += `\n*Past Fix:* ${withSolution.solution.slice(0, 200)}\n`;
  }
  response += `\n*Action:* Escalate to ops team for resolution.`;
  return response;
}

function ordinalSuffix(n: number): string {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return s[(v - 20) % 10] || s[v] || s[0];
}

// ── Main entry point ──
export async function checkProactiveResponse(msg: {
  body: string;
  chatId: string;
  senderName: string;
}): Promise<ProactiveResult> {
  // Master mute — kills ALL outbound notifications
  if (await isBotMuted()) {
    return { shouldRespond: false };
  }
  // Global switch
  if (!(await isEnabled("wa.proactive_responses"))) {
    return { shouldRespond: false };
  }

  // Per-group switch — must be explicitly enabled for this group
  const group = await prisma.waMonitoredGroup.findUnique({
    where: { chatId: msg.chatId },
    select: { proactiveEnabled: true },
  });
  if (!group?.proactiveEnabled) {
    return { shouldRespond: false };
  }

  const text = msg.body || "";
  if (!COMPLAINT_KEYWORDS.test(text)) return { shouldRespond: false };

  // Rate limit per group
  const now = Date.now();
  const last = lastProactiveReply.get(msg.chatId) || 0;
  if (now - last < PROACTIVE_COOLDOWN_MS) return { shouldRespond: false };

  const { vehicleIds, location, category } = extractEntities(text);
  const threshold = (await getSetting("wa.proactive_threshold")) as number;

  // Find recurring insights
  let insights: any[] = [];
  if (vehicleIds.length > 0) {
    for (const vid of vehicleIds) {
      insights.push(...await getRecurringInsights({ vehicleId: vid, threshold }));
    }
  }
  if (insights.length === 0 && location) {
    insights = await getRecurringInsights({ location, threshold });
  }
  if (insights.length === 0 && category) {
    insights = await getRecurringInsights({ category, threshold });
  }

  if (insights.length === 0) return { shouldRespond: false };

  const top = insights[0];

  // Get past resolutions for this pattern
  const pastResolutions = await getPastResolutions({
    vehicleIds,
    location: location || top.location,
    category: category || top.category,
    currentTitle: top.title,
  });

  // Generate smart response with solution
  const response = await generateSmartResponse({
    currentIssue: text,
    senderName: msg.senderName,
    matchedInsight: top,
    pastResolutions,
  });

  lastProactiveReply.set(msg.chatId, now);

  console.log(`  [Proactive] Generated response (insight: ${top.title}, ${pastResolutions.length} past resolutions)`);

  return { shouldRespond: true, response, matchedInsights: insights };
}
