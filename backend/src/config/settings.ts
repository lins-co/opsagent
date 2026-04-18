import { prisma } from "../db/prisma.js";

// ══════════════════════════════════════════════════════
// App settings — reads/writes AppSetting table with caching
// ══════════════════════════════════════════════════════

export const DEFAULT_SETTINGS = {
  // ── MASTER KILL-SWITCH ──
  // When true, ALL unsolicited outbound WhatsApp messages are suppressed:
  // PM DMs, PM group follow-ups, proactive group replies.
  // Does NOT affect responses to user-initiated messages (DMs to bot, @mentions).
  "bot.muted": false,
  "bot.muted_until": "",              // ISO timestamp — auto-unmute at this time. "" = indefinite
  "bot.muted_reason": "",             // Optional note for audit
  "bot.muted_by": "",                 // User ID of who muted (audit)
  "bot.muted_at": "",                 // ISO timestamp when muted

  // WhatsApp memory system
  "wa.store_messages": true,
  "wa.extract_patterns": true,
  "wa.proactive_responses": false,
  "wa.proactive_threshold": 3,
  "wa.extraction_interval_hours": 4,
  "wa.message_retention_days": 90,

  // Program Manager notifications
  "pm.dms_enabled": true,
  "pm.group_followups_enabled": true,

  // Daily digest mode — ONE DM per user per day, at a specific time
  "pm.dm_digest_mode": true,           // true = batch into daily digest, false = send individually
  "pm.dm_digest_hour_ist": 9,          // Hour of day (IST) to send digests (0-23)
  "pm.dm_digest_min_items": 1,         // Min pending items to trigger a digest (skip if below)
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
export type SettingValue = typeof DEFAULT_SETTINGS[SettingKey];

// In-memory cache with 60s TTL
const cache = new Map<string, { value: any; expiry: number }>();
const CACHE_TTL = 60_000;

export async function getSetting<K extends SettingKey>(key: K): Promise<typeof DEFAULT_SETTINGS[K]> {
  const cached = cache.get(key);
  if (cached && cached.expiry > Date.now()) return cached.value;

  try {
    const row = await prisma.appSetting.findUnique({ where: { key } });
    const value = row ? (row.value as any) : DEFAULT_SETTINGS[key];
    cache.set(key, { value, expiry: Date.now() + CACHE_TTL });
    return value;
  } catch {
    return DEFAULT_SETTINGS[key];
  }
}

// Widen the value type so callers can pass e.g. `true` for a setting that defaults to `false`
type WidenedValue<V> = V extends boolean ? boolean : V extends number ? number : V extends string ? string : V;

export async function setSetting<K extends SettingKey>(
  key: K,
  value: WidenedValue<typeof DEFAULT_SETTINGS[K]>,
  updatedBy?: string,
): Promise<void> {
  await prisma.appSetting.upsert({
    where: { key },
    update: { value: value as any, updatedBy },
    create: { key, value: value as any, updatedBy },
  });
  cache.delete(key); // Invalidate cache
}

export async function getAllSettings(): Promise<Record<string, any>> {
  const rows = await prisma.appSetting.findMany();
  const overrides: Record<string, any> = {};
  for (const r of rows) overrides[r.key] = r.value;
  return { ...DEFAULT_SETTINGS, ...overrides };
}

// Helper for boolean settings — returns false if setting is disabled
export async function isEnabled(key: SettingKey): Promise<boolean> {
  const v = await getSetting(key);
  return v === true;
}

// Master mute check — honors both boolean and time-based mute
export async function isBotMuted(): Promise<boolean> {
  const muted = await getSetting("bot.muted");
  if (!muted) return false;

  // If mute has an expiry, check if it's passed
  const mutedUntil = await getSetting("bot.muted_until");
  if (mutedUntil && typeof mutedUntil === "string" && mutedUntil !== "") {
    const expiry = new Date(mutedUntil);
    if (!isNaN(expiry.getTime()) && expiry <= new Date()) {
      // Auto-unmute: clear all mute-related fields
      await setSetting("bot.muted", false);
      await setSetting("bot.muted_until", "");
      await setSetting("bot.muted_reason", "");
      console.log("  [Bot] Auto-unmuted — mute expiry passed");
      return false;
    }
  }

  return true;
}
