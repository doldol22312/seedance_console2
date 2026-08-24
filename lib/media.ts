import fs from "node:fs";
import path from "node:path";
import { OUTPUTS_DIR, UPLOADS_DIR, ensureDataDirs } from "./paths";
import type { MediaKind, MediaRef } from "./types";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".bmp": "image/bmp",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
  ".heic": "image/heic",
  ".heif": "image/heif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
};

const MAX_INLINE_BYTES = 42 * 1024 * 1024;

export function mimeFromName(name: string, fallback = "application/octet-stream") {
  return MIME[path.extname(name).toLowerCase()] || fallback;
}

export function saveUpload(buffer: Buffer, originalName: string) {
  ensureDataDirs();
  const ext = path.extname(originalName) || "";
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}${ext}`;
  const filePath = path.join(UPLOADS_DIR, id);
  fs.writeFileSync(filePath, buffer);
  return {
    id,
    name: originalName,
    mime: mimeFromName(originalName),
    size: buffer.length,
  };
}

export function uploadPath(id: string) {
  const safe = path.basename(id);
  return path.join(UPLOADS_DIR, safe);
}

export function outputPath(name: string) {
  const safe = path.basename(name);
  return path.join(OUTPUTS_DIR, safe);
}

export function resolveMediaUrl(ref?: MediaRef): string | undefined {
  if (!ref) return undefined;
  if (ref.url?.trim()) return ref.url.trim();
  if (!ref.id) return undefined;

  const filePath = uploadPath(ref.id);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Missing uploaded file: ${ref.name || ref.id}`);
  }
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_INLINE_BYTES) {
    throw new Error(
      `${ref.name} is ${(stat.size / 1024 / 1024).toFixed(1)} MB. The provider needs a public HTTPS URL for files this large — paste a CDN or object-storage link instead.`,
    );
  }
  const mime = ref.mime || mimeFromName(ref.id);
  return `data:${mime};base64,${fs.readFileSync(filePath).toString("base64")}`;
}

export function kindFromMime(mime: string, name: string): MediaKind {
  if (mime.startsWith("image/") || /\.(jpe?g|png|webp|gif|bmp|tiff?|heic|heif)$/i.test(name)) {
    return "image";
  }
  if (mime.startsWith("video/") || /\.(mp4|mov)$/i.test(name)) return "video";
  if (mime.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(name)) return "audio";
  if (mime === "application/pdf" || /\.(pdf|docx?|xlsx?|pptx?|txt|md|key|pages|numbers)$/i.test(name)) {
    return "file";
  }
  return "audio";
}

export async function downloadToOutputs(url: string, basename: string) {
  ensureDataDirs();
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not download result (${response.status})`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  const filePath = outputPath(basename);
  fs.writeFileSync(filePath, buffer);
  return `/api/media/outputs/${basename}`;
}
