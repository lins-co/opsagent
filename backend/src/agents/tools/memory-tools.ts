import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { prisma } from "../../db/prisma.js";

// ══════════════════════════════════════════════════════
// Memory Tools — query persistent group message history
// and extracted insights/patterns.
// ══════════════════════════════════════════════════════

// ── Tool: Search stored group messages ──
export const searchGroupHistoryTool = tool(
  async ({ query, sender, groupName, category, vehicleId, location, dateFrom, dateTo, limit }) => {
    const where: any = {};

    if (query) {
      where.body = { contains: query, mode: "insensitive" };
    }
    if (sender) {
      where.senderName = { contains: sender, mode: "insensitive" };
    }
    if (groupName) {
      where.group = { chatName: { contains: groupName, mode: "insensitive" } };
    }
    if (category) where.category = category;
    if (vehicleId) where.vehicleIds = { has: vehicleId.toUpperCase() };
    if (location) where.location = { contains: location, mode: "insensitive" };

    if (dateFrom || dateTo) {
      where.timestamp = {};
      if (dateFrom) where.timestamp.gte = new Date(dateFrom + "T00:00:00");
      if (dateTo) where.timestamp.lte = new Date(dateTo + "T23:59:59");
    }

    const messages = await prisma.waMessage.findMany({
      where,
      orderBy: { timestamp: "desc" },
      include: { group: { select: { chatName: true } } },
      take: Math.min(limit || 50, 100),
    });

    if (messages.length === 0) {
      return JSON.stringify({ total: 0, messages: [] });
    }

    return JSON.stringify({
      total: messages.length,
      messages: messages.map((m) => ({
        time: m.timestamp.toISOString().replace("T", " ").slice(0, 16),
        group: m.group?.chatName || m.chatId,
        sender: m.senderName,
        body: m.body.slice(0, 300),
        category: m.category,
        vehicleIds: m.vehicleIds,
        location: m.location,
      })),
    });
  },
  {
    name: "search_group_history",
    description: `Search ALL historical WhatsApp group messages stored in the database. Use for questions like:
- "Has anyone reported KA51JN6518 before?" (use vehicleId)
- "What did Neeraj say about battery issues?" (use sender + query)
- "Complaints from Delhi last week" (use location + category + dateFrom/dateTo)
- "Any messages about Sector 62B?" (use query)

This searches the PERMANENT history (days/weeks/months back), not just in-memory recent messages.`,
    schema: z.object({
      query: z.string().optional().describe("Keyword to search in message text"),
      sender: z.string().optional().describe("Sender name (partial match)"),
      groupName: z.string().optional().describe("Group name (partial match)"),
      category: z.enum(["complaint", "deployment", "payment", "query", "status", "other"]).optional(),
      vehicleId: z.string().optional().describe("Specific vehicle ID (e.g. 'KA51JN6518')"),
      location: z.string().optional().describe("Location filter"),
      dateFrom: z.string().optional().describe("Start date YYYY-MM-DD"),
      dateTo: z.string().optional().describe("End date YYYY-MM-DD"),
      limit: z.number().optional().default(50),
    }),
  }
);

// ── Tool: Search extracted patterns/insights ──
export const searchPatternsTool = tool(
  async ({ type, severity, category, status, vehicleId, location, minOccurrences, sortBy }) => {
    const where: any = {};
    if (type) where.type = type;
    if (severity) where.severity = severity;
    if (category) where.category = category;
    if (status) where.status = status;
    if (vehicleId) where.vehicleIds = { has: vehicleId.toUpperCase() };
    if (location) where.location = { contains: location, mode: "insensitive" };
    if (minOccurrences) where.occurrenceCount = { gte: minOccurrences };

    const orderBy: any = {};
    if (sortBy === "recent") orderBy.lastSeen = "desc";
    else if (sortBy === "frequency") orderBy.occurrenceCount = "desc";
    else if (sortBy === "severity") orderBy.severity = "asc";
    else orderBy.lastSeen = "desc";

    const insights = await prisma.waInsight.findMany({
      where,
      orderBy,
      take: 30,
    });

    if (insights.length === 0) {
      return JSON.stringify({ total: 0, insights: [] });
    }

    return JSON.stringify({
      total: insights.length,
      insights: insights.map((i) => ({
        title: i.title,
        summary: i.summary,
        type: i.type,
        severity: i.severity,
        category: i.category,
        status: i.status,
        occurrences: i.occurrenceCount,
        group: i.groupName,
        location: i.location,
        vehicleIds: i.vehicleIds,
        reporters: i.reporterNames,
        firstSeen: i.firstSeen.toISOString().slice(0, 10),
        lastSeen: i.lastSeen.toISOString().slice(0, 10),
      })),
    });
  },
  {
    name: "search_patterns",
    description: `Query extracted patterns and recurring issues from WhatsApp groups. Insights are auto-extracted every few hours from group conversations.

Use for questions like:
- "What are the top unresolved issues?" (status="open", sortBy="frequency")
- "Any critical problems this week?" (severity="critical", sortBy="recent")
- "Recurring complaints about BNC vehicles?" (category="vehicle", minOccurrences=2)
- "Issues at Sector 62B" (location="Sector 62B")

Returns insights with occurrence counts, reporter names, and date ranges.`,
    schema: z.object({
      type: z.enum(["complaint", "issue", "escalation", "resolution", "alert"]).optional(),
      severity: z.enum(["critical", "high", "medium", "low"]).optional(),
      category: z.string().optional().describe("e.g. 'battery', 'charger', 'vehicle', 'payment', 'app'"),
      status: z.enum(["open", "in_progress", "resolved"]).optional(),
      vehicleId: z.string().optional(),
      location: z.string().optional(),
      minOccurrences: z.number().optional().describe("Only insights that appeared at least N times"),
      sortBy: z.enum(["recent", "frequency", "severity"]).optional(),
    }),
  }
);

// ── Tool: Read image content via Claude Vision ──
export const readImageTool = tool(
  async ({ mediaId }) => {
    const media = await prisma.waMediaFile.findUnique({ where: { id: mediaId } });
    if (!media) return JSON.stringify({ error: "Media not found" });

    // If already processed, return cached
    if (media.visionText) {
      return JSON.stringify({
        id: media.id,
        senderName: media.senderName,
        caption: media.caption,
        visionText: media.visionText,
        processedAt: media.processedAt,
        cached: true,
      });
    }

    // TODO: Claude Vision processing — wired in next iteration
    return JSON.stringify({
      id: media.id,
      senderName: media.senderName,
      caption: media.caption,
      filePath: media.filePath,
      note: "Image available but Vision processing not yet invoked. Ask explicitly to 'analyze this image'.",
    });
  },
  {
    name: "read_image",
    description: "Get content of a stored WhatsApp image — either cached Vision output or metadata if not yet processed. Used with search_media_files to find images first.",
    schema: z.object({
      mediaId: z.string().describe("Media file UUID"),
    }),
  }
);

// ── Tool: Search stored media files ──
export const searchMediaTool = tool(
  async ({ groupName, sender, dateFrom, dateTo, mediaType, limit }) => {
    const where: any = {};
    if (groupName) where.groupName = { contains: groupName, mode: "insensitive" };
    if (sender) where.senderName = { contains: sender, mode: "insensitive" };
    if (mediaType) where.mediaType = mediaType;
    if (dateFrom || dateTo) {
      where.timestamp = {};
      if (dateFrom) where.timestamp.gte = new Date(dateFrom + "T00:00:00");
      if (dateTo) where.timestamp.lte = new Date(dateTo + "T23:59:59");
    }

    const media = await prisma.waMediaFile.findMany({
      where,
      orderBy: { timestamp: "desc" },
      take: Math.min(limit || 20, 50),
    });

    return JSON.stringify({
      total: media.length,
      media: media.map((m) => ({
        id: m.id,
        group: m.groupName,
        sender: m.senderName,
        type: m.mediaType,
        caption: m.caption,
        hasVisionText: !!m.visionText,
        visionText: m.visionText?.slice(0, 300),
        time: m.timestamp.toISOString().replace("T", " ").slice(0, 16),
      })),
    });
  },
  {
    name: "search_media_files",
    description: "Search stored WhatsApp images, videos, documents by group, sender, date, or type. Returns metadata and any previously extracted Vision text.",
    schema: z.object({
      groupName: z.string().optional(),
      sender: z.string().optional(),
      dateFrom: z.string().optional(),
      dateTo: z.string().optional(),
      mediaType: z.enum(["image", "video", "document", "audio", "sticker"]).optional(),
      limit: z.number().optional().default(20),
    }),
  }
);

export const memoryTools = [searchGroupHistoryTool, searchPatternsTool, readImageTool, searchMediaTool];
