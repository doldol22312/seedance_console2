import path from "node:path";
import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { cancelTask, getTask } from "@/lib/ark";
import { cancelWanTask, getWanTask } from "@/lib/dashscope";
import { getJob, patchJob } from "@/lib/jobs";
import { downloadToOutputs } from "@/lib/media";
import type { Job, Provider } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

type RemoteTask = Awaited<ReturnType<typeof getTask>>;

function providerOf(job?: Job): Provider {
  return job?.provider || "ark";
}

async function fetchTask(provider: Provider, taskId: string): Promise<RemoteTask> {
  return provider === "dashscope" ? getWanTask(taskId) : getTask(taskId);
}

async function cancelRemote(provider: Provider, taskId: string) {
  if (provider === "dashscope") return cancelWanTask(taskId);
  return cancelTask(taskId);
}

async function hydrateJob(taskId: string) {
  const existing = getJob(taskId);
  const provider = providerOf(existing);
  const remote = await fetchTask(provider, taskId);
  const next = patchJob(taskId, {
    status: remote.status,
    videoUrl: remote.videoUrl || existing?.videoUrl,
    lastFrameUrl: remote.lastFrameUrl || existing?.lastFrameUrl,
    error: remote.error,
    usage: remote.usage,
    seed: remote.seed,
    model: remote.model || existing?.model,
  });

  if (!next) return remote;

  if (remote.status === "succeeded" && remote.videoUrl && !next.localVideo) {
    const wantsMov = provider !== "dashscope" && next.params.outputFormat === "mov";
    const ext = wantsMov ? ".mov" : ".mp4";
    try {
      const localVideo = await downloadToOutputs(remote.videoUrl, `${next.arkId}${ext}`);
      patchJob(taskId, { localVideo });
    } catch {
      // Keep the temporary provider URL if the copy fails.
    }
  }

  if (remote.status === "succeeded" && remote.lastFrameUrl && !next.localLastFrame) {
    try {
      const localLastFrame = await downloadToOutputs(
        remote.lastFrameUrl,
        `${next.arkId}-last${path.extname(new URL(remote.lastFrameUrl).pathname) || ".png"}`,
      );
      patchJob(taskId, { localLastFrame });
    } catch {
      // Optional still.
    }
  }

  return getJob(taskId);
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const job = await hydrateJob(id);
    if (!job) {
      return NextResponse.json({ error: "Unknown take" }, { status: 404 });
    }
    return NextResponse.json(job);
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const existing = getJob(id);
    if (existing?.arkId) {
      try {
        await cancelRemote(providerOf(existing), existing.arkId);
      } catch {
        // Local cancel still stands if the provider already finished.
      }
    }
    const job = patchJob(id, { status: "cancelled" });
    return NextResponse.json(job || { id, status: "cancelled" });
  } catch (error) {
    return jsonError(error);
  }
}
