import fs from "node:fs";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { getJob } from "@/lib/jobs";
import { ensureWebm } from "@/lib/media";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 600;

// GET /api/tasks/:id/webm — transcode the archived take to WebM (VP9 + Opus) and send it as a download.
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = getJob(id);
    if (!job || !job.localVideo) {
      return NextResponse.json(
        { error: "This take has no local archive to convert yet." },
        { status: 404 },
      );
    }

    const { target, filename } = await ensureWebm(job.arkId);
    const stat = fs.statSync(target);
    const stream = Readable.toWeb(fs.createReadStream(target)) as ReadableStream<Uint8Array>;

    return new Response(stream, {
      headers: {
        "Content-Type": "video/webm",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
