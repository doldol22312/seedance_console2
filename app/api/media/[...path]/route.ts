import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { OUTPUTS_DIR, UPLOADS_DIR } from "@/lib/paths";

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

export async function GET(_request: Request, context: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await context.params;
  if (!segments?.length) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [bucket, ...rest] = segments;
  const root = bucket === "outputs" ? OUTPUTS_DIR : bucket === "uploads" ? UPLOADS_DIR : null;
  if (!root || rest.length !== 1) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const filePath = path.join(root, path.basename(rest[0]));
  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const buffer = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
