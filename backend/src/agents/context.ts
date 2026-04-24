// Request-scoped context that rides with every agent + tool call.
// Uses Node's AsyncLocalStorage so tools can access userId/role/etc. without
// needing to thread them through every function signature.

import { AsyncLocalStorage } from "async_hooks";

export interface RequestContext {
  userId: string;
  userName: string;
  userRole: string;
  userPhone: string | null;
  allowedLocations: string[];
  // Source channel of the query — useful for tools that need to know
  // whether they're answering web chat vs WA DM vs WA group mention.
  channel: "web" | "whatsapp_dm" | "whatsapp_group" | "system";
}

export const requestContext = new AsyncLocalStorage<RequestContext>();

// Get the current request context — throws if called outside a runWithContext block.
export function getContext(): RequestContext {
  const ctx = requestContext.getStore();
  if (!ctx) throw new Error("No request context — caller must wrap with runWithContext()");
  return ctx;
}

// Safe variant — returns undefined if no context (e.g. called from a cron)
export function tryGetContext(): RequestContext | undefined {
  return requestContext.getStore();
}

export function runWithContext<T>(ctx: RequestContext, fn: () => Promise<T>): Promise<T> {
  return requestContext.run(ctx, fn);
}
