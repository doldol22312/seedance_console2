import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
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

function runFfmpeg(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-2000);
    });
    child.on("error", (err) => {
      reject(
        err instanceof Error && err.message.includes("ENOENT")
          ? new Error("ffmpeg was not found on PATH. Install it to export WebM (winget install Gyan.FFmpeg).")
          : err,
      );
    });
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code}. ${stderr.trim()}`));
    });
  });
}

// One-time probe: does this machine's ffmpeg have a working NVIDIA AV1 encoder?
const nvencAv1 = new Promise<boolean>((resolve) => {
  const child = spawn(
    "ffmpeg",
    ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.2", "-c:v", "av1_nvenc", "-f", "null", "-"],
    { windowsHide: true },
  );
  child.on("error", () => resolve(false));
  child.on("close", (code) => resolve(code === 0));
});

const CPU_VIDEO = [
  "-c:v",
  "libvpx-vp9",
  "-crf",
  "23",
  "-b:v",
  "0",
  "-deadline",
  "good",
  "-cpu-used",
  "4",
  "-row-mt",
  "1",
];

async function encodeWebm(source: string, temp: string) {
  const gpu = await nvencAv1;
  const audio = ["-c:a", "libopus", "-b:a", "128k", "-f", "webm"];
  if (gpu) {
    try {
      await runFfmpeg([
        "-y",
        "-i",
        source,
        "-c:v",
        "av1_nvenc",
        "-preset",
        "p6",
        "-cq",
        "26",
        "-b:v",
        "0",
        "-spatial-aq",
        "1",
        ...audio,
        temp,
      ]);
      return;
    } catch {
      // GPU hiccup (driver, session limits) — fall through to the CPU encoder.
    }
  }
  await runFfmpeg(["-y", "-i", source, ...CPU_VIDEO, ...audio, temp]);
}

// Transcode an archived take to WebM (VP9 + Opus). Encoded to a temp file and
// renamed atomically, so a crashed encode never poisons the cache. Result is
// cached in data/outputs.
const webmInFlight = new Map<string, Promise<{ target: string; url: string; filename: string }>>();

export function ensureWebm(basename: string) {
  const existing = webmInFlight.get(basename);
  if (existing) return existing;

  const run = (async () => {
    ensureDataDirs();
    const stem = path.basename(basename, path.extname(basename));
    const source = outputPath(`${stem}.mp4`);
    if (!fs.existsSync(source)) {
      throw new Error("The MP4 archive for this take is missing — re-open the take to fetch it again.");
    }
    const target = outputPath(`${stem}.webm`);
    if (!fs.existsSync(target)) {
      const temp = `${target}.part`;
      try {
        await encodeWebm(source, temp);
        fs.renameSync(temp, target);
      } catch (err) {
        try {
          fs.unlinkSync(temp);
        } catch {
          // Temp file may not exist.
        }
        throw err;
      }
    }
    return { target, url: `/api/media/outputs/${stem}.webm`, filename: `${stem}.webm` };
  })();

  webmInFlight.set(basename, run);
  run.finally(() => webmInFlight.delete(basename)).catch(() => undefined);
  return run;
}
