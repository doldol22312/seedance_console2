import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { UPLOADS_DIR } from "@/lib/paths";
import { findOutputFile } from "@/lib/media";

export const runtime = "nodejs";

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
};

function resolveFile(segments?: string[]): string | null {
  if (!segments?.length) return null;
  const [bucket, ...rest] = segments;
  if (rest.length !== 1) return null;
  if (bucket === "outputs") return findOutputFile(rest[0]);
  if (bucket === "uploads") {
    const candidate = path.join(UPLOADS_DIR, path.basename(rest[0]));
    return fs.existsSync(candidate) ? candidate : null;
  }
  return null;
}

function contentType(filePath: string) {
  return MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
}

function streamBody(filePath: string, range?: { start: number; end: number }) {
  return Readable.toWeb(
    fs.createReadStream(filePath, range),
  ) as unknown as ReadableStream<Uint8Array>;
}

// Single-range parsing (bytes=a-b, bytes=a-, bytes=-n). Multi-range requests
// fall back to the full file, which is all the <video> element asks for.
function parseRange(header: string | null, size: number) {
  const match = header ? /^bytes=(\d*)-(\d*)$/.exec(header.trim()) : null;
  if (!match || (!match[1] && !match[2])) return null;
  let start: number;
  let end: number;
  if (!match[1]) {
    start = Math.max(0, size - Number(match[2]));
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) {
    return "invalid" as const;
  }
  return { start, end: Math.min(end, size - 1) };
}

export async function GET(request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const filePath = resolveFile(segments);
  if (!filePath) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const size = fs.statSync(filePath).size;
  const range = parseRange(request.headers.get("range"), size);

  if (range === "invalid") {
    return new NextResponse(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}`, "Accept-Ranges": "bytes" },
    });
  }

  if (range) {
    const length = range.end - range.start + 1;
    return new NextResponse(streamBody(filePath, range), {
      status: 206,
      headers: {
        "Content-Type": contentType(filePath),
        "Content-Length": String(length),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
      },
    });
  }

  return new NextResponse(streamBody(filePath), {
    status: 200,
    headers: {
      "Content-Type": contentType(filePath),
      "Content-Length": String(size),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

export async function HEAD(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  const filePath = resolveFile(segments);
  if (!filePath) {
    return new NextResponse(null, { status: 404 });
  }
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Content-Type": contentType(filePath),
      "Content-Length": String(fs.statSync(filePath).size),
      "Accept-Ranges": "bytes",
    },
  });
}
