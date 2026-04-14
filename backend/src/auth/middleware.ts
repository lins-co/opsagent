import type { Request, Response, NextFunction } from "express";
import { verifyToken, type TokenPayload } from "./jwt.js";
import { prisma } from "../db/prisma.js";

export interface UserContext {
  userId: string;
  email: string;
  name: string;
  role: string;
  orgNodeId: string;
  permissions: Record<string, boolean>;
  allowedLocations: string[];
}

declare global {
  namespace Express {
    interface Request {
      user?: UserContext;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }

  try {
    const payload = verifyToken(header.slice(7));
    const allowedLocations = await resolveAllowedLocations(payload.orgNodeId);

    req.user = {
      userId: payload.userId,
      email: payload.email,
      name: "", // Resolved below
      role: payload.role,
      orgNodeId: payload.orgNodeId,
      permissions: payload.permissions,
      allowedLocations,
    };

    // Resolve user name
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { name: true, isActive: true },
    });

    if (!user || !user.isActive) {
      res.status(401).json({ error: "User not found or inactive" });
      return;
    }

    req.user.name = user.name;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function resolveAllowedLocations(orgNodeId: string): Promise<string[]> {
  // Walk down org tree: user sees their node + all children
  const result = await prisma.$queryRaw<{ location: string }[]>`
    WITH RECURSIVE subtree AS (
      SELECT id, locations FROM org_nodes WHERE id = ${orgNodeId}::uuid
      UNION ALL
      SELECT c.id, c.locations FROM org_nodes c
      JOIN subtree p ON c.parent_id = p.id
    )
    SELECT DISTINCT unnest(locations) as location FROM subtree
  `;
  return result.map((r) => r.location);
}
