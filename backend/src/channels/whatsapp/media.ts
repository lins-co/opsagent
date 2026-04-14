import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../../db/prisma.js";

const MEDIA_DIR = path.resolve("storage", "wa-media");

// Ensure directory exists
if (!fs.existsSync(MEDIA_DIR)) {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

// Extension mapping
const EXT_MAP: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "video/mp4": ".mp4",
  "audio/ogg": ".ogg",
  "audio/mpeg": ".mp3",
  "application/pdf": ".pdf",
};

function getExtension(mimeType: string, fallback = ".bin"): string {
  return EXT_MAP[mimeType] || fallback;
}

export interface MediaSaveResult {
  filePath: string;
  fileSize: number;
  id: string;
}

// Save media from a WhatsApp message to disk and DB
export async function saveMessageMedia(
  msg: any,
  opts: { chatId: string; groupName?: string; senderName?: string }
): Promise<MediaSaveResult | null> {
  if (!msg?.hasMedia) return null;

  try {
    const media = await msg.downloadMedia();
    if (!media?.data) return null;

    // Decode base64
    const buffer = Buffer.from(media.data, "base64");
    if (buffer.length === 0) return null;

    // Generate unique filename (hash-based to dedupe)
    const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 16);
    const ext = getExtension(media.mimetype || "");
    const filename = `${hash}${ext}`;
    const filePath = path.join(MEDIA_DIR, filename);

    // Write to disk if not already present (dedup by hash)
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, buffer);
    }

    // Determine media type from mimetype
    const mediaType = msg.type || (media.mimetype?.split("/")?.[0] || "document");

    // Check for existing record (dedup)
    const existing = await prisma.waMediaFile.findFirst({
      where: { filePath, chatId: opts.chatId },
    });
    if (existing) {
      return { filePath, fileSize: buffer.length, id: existing.id };
    }

    const record = await prisma.waMediaFile.create({
      data: {
        chatId: opts.chatId,
        groupName: opts.groupName,
        senderName: opts.senderName,
        mediaType,
        mimeType: media.mimetype,
        fileName: media.filename || filename,
        filePath,
        fileSize: buffer.length,
        caption: msg.body || msg._data?.caption || null,
        timestamp: new Date((msg.timestamp || 0) * 1000),
      },
    });

    return { filePath, fileSize: buffer.length, id: record.id };
  } catch (err: any) {
    console.warn(`  [Media] Failed to save: ${err?.message?.slice(0, 80)}`);
    return null;
  }
}

// Link a media record to a message after the message is persisted
export async function linkMediaToMessage(mediaId: string, messageId: string): Promise<void> {
  try {
    await prisma.waMediaFile.update({
      where: { id: mediaId },
      data: { messageId },
    });
  } catch {}
}

// Get media file for Vision processing
export function getMediaPath(filePath: string): string {
  return path.resolve(filePath);
}

export function mediaExists(filePath: string): boolean {
  try { return fs.existsSync(filePath); } catch { return false; }
}
