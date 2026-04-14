import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  getGroupSummaryData,
  searchWhatsAppMessages,
  getChats,
  fetchMessages,
  getGroupParticipants,
  isConnected,
} from "../../channels/whatsapp/client.js";

// ── Tool: List monitored WhatsApp groups ──
export const listGroupsTool = tool(
  async () => {
    if (!isConnected()) return JSON.stringify({ error: "WhatsApp not connected" });
    const chats = await getChats();
    const monitored = chats.filter((c: any) => c.isMonitored);
    const groups = chats.filter((c: any) => c.isGroup);
    return JSON.stringify({
      monitoredGroups: monitored.map((c: any) => ({ name: c.name, id: c.id, participants: c.participantCount })),
      totalGroups: groups.length,
      totalMonitored: monitored.length,
    });
  },
  {
    name: "list_whatsapp_groups",
    description: "List all monitored WhatsApp groups. Use this to find group names and IDs before querying messages.",
    schema: z.object({}),
  }
);

// ── Tool: Get group activity / messages ──
export const groupActivityTool = tool(
  async ({ hours, groupName }) => {
    if (!isConnected()) return JSON.stringify({ error: "WhatsApp not connected" });

    const summaries = await getGroupSummaryData(hours);

    let results = summaries;
    if (groupName) {
      const q = groupName.toLowerCase();
      results = summaries.filter((g: any) => g.chatName.toLowerCase().includes(q));
    }

    if (results.length === 0) {
      return JSON.stringify({ message: `No activity found${groupName ? ` for "${groupName}"` : ""} in the last ${hours} hours`, groups: [] });
    }

    // Build rich context with sender details
    const output = results.map((g: any) => {
      // Count messages per sender
      const senderCounts: Record<string, number> = {};
      g.recentMessages.forEach((m: any) => {
        senderCounts[m.sender] = (senderCounts[m.sender] || 0) + 1;
      });

      return {
        group: g.chatName,
        totalMessages: g.messageCount,
        activeSenders: Object.entries(senderCounts)
          .sort((a, b) => b[1] - a[1])
          .map(([name, count]) => ({ name, messages: count })),
        recentMessages: g.recentMessages.slice(0, 30).map((m: any) => ({
          sender: m.sender,
          text: m.text,
          time: m.time.toISOString().replace("T", " ").slice(0, 16),
        })),
      };
    });

    return JSON.stringify({ hours, groups: output });
  },
  {
    name: "whatsapp_group_activity",
    description: `Get WhatsApp group activity — messages, who sent them, and when. Use for "what's happening in groups?", "who texted in the Delhi group?", "show me group conversations".

By default, returns ALL stored messages (no time filter). Only pass "hours" if the user explicitly asks for a specific time window like "last 24 hours" or "this week". For general questions about activity, OMIT hours to get the full history.`,
    schema: z.object({
      hours: z.number().optional().describe("Optional: hours back to look. Omit to return all stored messages (recommended)."),
      groupName: z.string().optional().describe("Filter by group name (partial match). Leave empty for all monitored groups."),
    }),
  }
);

// ── Tool: Search group messages by keyword or sender ──
export const searchGroupMessagesTool = tool(
  async ({ query, sender, groupName, limit }) => {
    if (!isConnected()) return JSON.stringify({ error: "WhatsApp not connected" });

    // Get all group chats
    const chats = await getChats();
    const monitored = chats.filter((c: any) => c.isMonitored);

    let targetGroups = monitored;
    if (groupName) {
      const q = groupName.toLowerCase();
      targetGroups = monitored.filter((c: any) => c.name.toLowerCase().includes(q));
    }

    if (targetGroups.length === 0) {
      return JSON.stringify({ message: "No matching monitored groups found", results: [] });
    }

    const results: any[] = [];

    for (const group of targetGroups) {
      try {
        const messages = await fetchMessages(group.id, 200);
        for (const m of messages) {
          if (m.fromMe) continue;
          if (!m.body?.trim()) continue;

          // Apply filters
          const matchesQuery = !query || m.body.toLowerCase().includes(query.toLowerCase());
          const matchesSender = !sender || (m.senderName || "").toLowerCase().includes(sender.toLowerCase());

          if (matchesQuery && matchesSender) {
            results.push({
              group: group.name,
              sender: m.senderName,
              message: m.body.slice(0, 500),
              time: new Date(m.timestamp * 1000).toISOString().replace("T", " ").slice(0, 16),
            });
          }

          if (results.length >= limit) break;
        }
      } catch {}
      if (results.length >= limit) break;
    }

    results.sort((a, b) => b.time.localeCompare(a.time));

    return JSON.stringify({
      query: query || null,
      sender: sender || null,
      group: groupName || "all monitored",
      total: results.length,
      messages: results.slice(0, limit),
    });
  },
  {
    name: "search_whatsapp_messages",
    description: `Search WhatsApp group messages by keyword, sender name, or group. Use for "what did Rahul say?", "any messages about battery?", "search groups for complaints", "who mentioned Delhi?". Can filter by sender name, keyword, and group.`,
    schema: z.object({
      query: z.string().optional().describe("Keyword to search in message text"),
      sender: z.string().optional().describe("Filter by sender name (partial match)"),
      groupName: z.string().optional().describe("Filter by group name (partial match)"),
      limit: z.number().optional().default(30).describe("Max results to return"),
    }),
  }
);

// ── Tool: Get group participants ──
export const groupParticipantsTool = tool(
  async ({ groupName }) => {
    if (!isConnected()) return JSON.stringify({ error: "WhatsApp not connected" });

    const chats = await getChats();
    const groups = chats.filter((c: any) => c.isGroup);

    let target = groups;
    if (groupName) {
      const q = groupName.toLowerCase();
      target = groups.filter((c: any) => c.name.toLowerCase().includes(q));
    }

    if (target.length === 0) {
      return JSON.stringify({ message: "No matching groups found" });
    }

    const results = [];
    for (const group of target.slice(0, 5)) {
      const participants = await getGroupParticipants(group.id);
      results.push({
        group: group.name,
        participantCount: participants.length,
        members: participants.map((p: any) => ({
          name: p.name,
          phone: p.phone,
          isAdmin: p.isAdmin,
        })),
      });
    }

    return JSON.stringify(results);
  },
  {
    name: "whatsapp_group_participants",
    description: "Get the list of members in a WhatsApp group. Use for 'who is in the group?', 'list group members', 'group participants'.",
    schema: z.object({
      groupName: z.string().optional().describe("Group name to look up (partial match)"),
    }),
  }
);

export const whatsappTools = [listGroupsTool, groupActivityTool, searchGroupMessagesTool, groupParticipantsTool];
