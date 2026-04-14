import dotenv from "dotenv";
dotenv.config();

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

export const env = {
  // Server
  PORT: parseInt(process.env.PORT || "3000", 10),
  NODE_ENV: process.env.NODE_ENV || "development",
  FRONTEND_URL: process.env.FRONTEND_URL || "http://localhost:5173",

  // Databases
  DATABASE_URL: required("DATABASE_URL"),
  MONGO_URI: required("MONGO_URI"),

  // LLM
  ANTHROPIC_API_KEY: required("ANTHROPIC_API_KEY"),
  GEMINI_API_KEY: process.env.GEMINI_API_KEY || "",

  // Google OAuth
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || "",

  // Email (Resend)
  RESEND_API_KEY: process.env.RESEND_API_KEY || "",
  RESEND_FROM: process.env.RESEND_FROM || "EMO Intelligence <noreply@emo-energy.com>",

  // Auth
  JWT_SECRET: required("JWT_SECRET"),
  JWT_EXPIRY: process.env.JWT_EXPIRY || "7d",
} as const;
