import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export interface TokenPayload {
  userId: string;
  email: string;
  role: string;
  orgNodeId: string;
  permissions: Record<string, boolean>;
}

export function generateToken(payload: TokenPayload): string {
  const secret: jwt.Secret = env.JWT_SECRET;
  const options: jwt.SignOptions = { expiresIn: env.JWT_EXPIRY as any };
  return jwt.sign(payload as object, secret, options);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, env.JWT_SECRET) as TokenPayload;
}
