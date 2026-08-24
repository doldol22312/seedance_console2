import { NextResponse } from "next/server";
import { jsonError } from "@/lib/http";
import { createTask } from "@/lib/ark";
import { createWanTask } from "@/lib/dashscope";
import { getSettings } from "@/lib/settings";
import { upsertJob } from "@/lib/jobs";
import type { GenerateRequest, Job } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request) {
  try {
    const input = (await request.json()) as GenerateRequest;
    const provider = getSettings().provider;
    const created =
      provider === "dashscope" ? await createWanTask(input) : await createTask(input);
    const now = Date.now();
    const job: Job = {
      id: created.arkId,
      arkId: created.arkId,
      status: "queued",
      mode: input.mode,
      prompt: input.prompt.trim(),
      provider,
      params: {
        duration: input.duration,
        ratio: input.ratio,
        resolution: input.resolution,
        generateAudio: input.generateAudio,
        watermark: input.watermark,
        outputFormat: provider === "dashscope" ? "mp4" : input.outputFormat,
        returnLastFrame: provider === "dashscope" ? false : input.returnLastFrame,
        webSearch: provider === "dashscope" ? false : input.webSearch,
        promptExtend: input.promptExtend,
        seed: input.seed,
      },
      createdAt: now,
      updatedAt: now,
      model: created.model,
    };
    upsertJob(job);
    return NextResponse.json(job);
  } catch (error) {
    return jsonError(error);
  }
}
