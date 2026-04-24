// Central permission matrix — who can do what via chat commands.
// Used by every command tool before executing any state-changing action.

export const PERMISSIONS = {
  // ── Notification controls ──
  "notifications.mute_bot":            ["admin", "ceo", "coo"],
  "notifications.unmute_bot":          ["admin", "ceo", "coo"],
  "notifications.mute_group":          ["admin", "ceo", "coo", "cto", "vp", "manager", "lead_operations"],

  // ── Insight management ──
  "insights.read":                     ["admin", "ceo", "coo", "cto", "vp", "manager", "lead_operations", "employee"],
  "insights.assign":                   ["admin", "ceo", "coo", "cto", "vp", "manager", "lead_operations"],
  "insights.reassign_category":        ["admin", "ceo", "coo", "cto"],
  "insights.resolve_own":              ["admin", "ceo", "coo", "cto", "vp", "manager", "lead_operations", "employee"],
  "insights.resolve_any":              ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "insights.reopen":                   ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "insights.set_severity":             ["admin", "ceo", "coo", "cto", "vp", "manager"],

  // ── Reports & automations ──
  "reports.create":                    ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "reports.trigger_now":               ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "reports.delete_own":                ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "reports.list_own":                  ["admin", "ceo", "coo", "cto", "vp", "manager", "lead_operations", "employee"],

  // ── Briefings (anyone can subscribe; destructive requires manager+) ──
  "briefings.subscribe":               ["admin", "ceo", "coo", "cto", "vp", "manager", "lead_operations", "employee"],
  "briefings.on_demand":               ["admin", "ceo", "coo", "cto", "vp", "manager", "lead_operations", "employee"],

  // ── Messaging / broadcasts ──
  "messaging.broadcast_group":         ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "messaging.broadcast_role":          ["admin", "ceo", "coo"],
  "messaging.dm_user":                 ["admin", "ceo", "coo", "cto", "vp", "manager"],

  // ── User / team management (never delete) ──
  "team.read":                         ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "team.set_ooo":                      ["admin", "ceo", "coo", "cto", "vp", "manager"],
  "team.update_specialty":             ["admin", "ceo", "coo"],
  "team.set_availability":             ["admin", "ceo", "coo", "cto", "vp", "manager"],

  // ── Settings (global controls) ──
  "settings.read":                     ["admin", "ceo", "coo"],
  "settings.update_notifications":     ["admin", "ceo", "coo"],
  "settings.update_pm_behavior":       ["admin", "ceo", "coo"],

  // ── Audit / observability ──
  "audit.read":                        ["admin", "ceo", "coo"],
} as const;

export type Permission = keyof typeof PERMISSIONS;

// Permission check — returns true if the given role can perform the action.
export function canDo(role: string | undefined | null, action: Permission): boolean {
  if (!role) return false;
  const allowed = PERMISSIONS[action] as readonly string[] | undefined;
  return allowed?.includes(role) ?? false;
}

// For destructive actions — require explicit confirmation in chat before executing.
// Tool returns { needs_confirmation: true, token } first; user confirms, agent re-calls with the token.
export const DESTRUCTIVE_ACTIONS = new Set<Permission>([
  "notifications.mute_bot",
  "insights.reassign_category",
  "messaging.broadcast_role",
  "messaging.broadcast_group",
  "settings.update_pm_behavior",
  "settings.update_notifications",
  "team.update_specialty",
]);

export function isDestructive(action: Permission): boolean {
  return DESTRUCTIVE_ACTIONS.has(action);
}

// Helpful error message for the LLM to relay to the user
export function forbiddenMessage(role: string | undefined | null, action: Permission): string {
  const allowed = PERMISSIONS[action] as readonly string[] | undefined;
  return JSON.stringify({
    error: "forbidden",
    reason: `Your role '${role || "unknown"}' is not allowed to '${action}'. Allowed roles: ${allowed?.join(", ") || "(none)"}.`,
  });
}
