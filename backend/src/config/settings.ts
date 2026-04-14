import { prisma } from "../db/prisma.js";

// ══════════════════════════════════════════════════════
// App settings — reads/writes AppSetting table with caching
// ══════════════════════════════════════════════════════

export const DEFAULT_SETTINGS = {
  // WhatsApp memory system
  "wa.store_messages": true,
  "wa.extract_patterns": true,
  "wa.proactive_responses": false,
  "wa.proactive_threshold": 3,         // Occurrences before auto-response
  "wa.extraction_interval_hours": 4,   // How often to run pattern extraction
  "wa.message_retention_days": 90,     // Delete messages older than this
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

export async function setSetting<K extends SettingKey>(
  key: K,
  value: typeof DEFAULT_SETTINGS[K],
  updatedBy?: string
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
