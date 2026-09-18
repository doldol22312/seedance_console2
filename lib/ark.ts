import { getSettings } from "./settings";
import type { GenerateRequest, JobStatus } from "./types";
import { resolveMediaUrl } from "./media";

type ArkContent =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string }; role?: string }
  | { type: "video_url"; video_url: { url: string }; role?: string }
  | { type: "audio_url"; audio_url: { url: string }; role?: string };

export class ArkError extends Error {
  status: number;
  body: unknown;

  constructor(message: string, status: number, body?: unknown) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function extractError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  const error = record.error;
  if (error && typeof error === "object") {
    const inner = error as Record<string, unknown>;
    return String(inner.message || inner.code || fallback);
  }
  if (typeof record.message === "string") return record.message;
  return fallback;
}

export async function arkFetch(pathname: string, init?: RequestInit) {
  const settings = getSettings();
  if (!settings.apiKey) {
    throw new ArkError("Add your Volcano Engine Ark API key in Settings.", 401);
  }

  const url = `${settings.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      ...headers(settings.apiKey),
      ...(init?.headers || {}),
    },
  });

  const text = await response.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { raw: text };
    }
  }

  if (!response.ok) {
    throw new ArkError(extractError(data, `Ark request failed (${response.status})`), response.status, data);
  }
  return data;
}

function lockedRatio(mode: GenerateRequest["mode"]) {
  return mode === "frames" || mode === "edit" || mode === "extend";
}

function lockedDuration(mode: GenerateRequest["mode"]) {
  return mode === "edit";
}

export function buildArkPayload(input: GenerateRequest) {
  const settings = getSettings();
  const content: ArkContent[] = [{ type: "text", text: input.prompt.trim() }];

  const pushImage = (ref: GenerateRequest["firstFrame"], role: string) => {
    const url = resolveMediaUrl(ref);
    if (!url) return;
    content.push({ type: "image_url", image_url: { url }, role });
  };
  const pushVideo = (ref: NonNullable<GenerateRequest["videos"]>[number]) => {
    const url = resolveMediaUrl(ref);
    if (!url) return;
    content.push({ type: "video_url", video_url: { url }, role: "reference_video" });
  };
  const pushAudio = (ref: NonNullable<GenerateRequest["audios"]>[number]) => {
    const url = resolveMediaUrl(ref);
    if (!url) return;
    content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" });
  };

  if (input.mode === "frames") {
    pushImage(input.firstFrame, "first_frame");
    pushImage(input.lastFrame, "last_frame");
  } else if (input.mode !== "script") {
    for (const image of input.images || []) pushImage(image, "reference_image");
    for (const video of input.videos || []) pushVideo(video);
    for (const audio of input.audios || []) pushAudio(audio);
  }

  const payload: Record<string, unknown> = {
    model: settings.model,
    content,
    generate_audio: input.generateAudio,
    watermark: input.watermark,
    output_format: input.outputFormat,
    return_last_frame: input.returnLastFrame,
    resolution: input.resolution,
  };

  payload.ratio = lockedRatio(input.mode) ? "adaptive" : input.ratio;
  payload.duration = lockedDuration(input.mode) ? -1 : input.duration;

  if (typeof input.seed === "number" && input.seed >= 0) {
    payload.seed = input.seed;
  }
  if (input.webSearch) {
    payload.tools = [{ type: "web_search" }];
  }

  return payload;
}

export async function createTask(input: GenerateRequest) {
  if (!input.prompt.trim()) {
    throw new ArkError("Write a prompt before launching.", 400);
  }
  if (input.mode === "frames" && !input.firstFrame) {
    throw new ArkError("First-frame mode needs a still for the opening image.", 400);
  }
  if ((input.mode === "edit" || input.mode === "extend") && !(input.videos && input.videos.length)) {
    throw new ArkError("Edit and extend need a source clip as @Video1.", 400);
  }
  if (input.mode === "refs") {
    const total =
      (input.images?.length || 0) + (input.videos?.length || 0) + (input.audios?.length || 0);
    if (total === 0) {
      throw new ArkError("Reference mode needs at least one image, video, or audio asset.", 400);
    }
    if ((input.images?.length || 0) > 30 || (input.videos?.length || 0) > 10 || (input.audios?.length || 0) > 10) {
      throw new ArkError("Seedance 2.5 allows 30 images, 10 videos, and 10 audio files per request.", 400);
    }
  }

  const payload = buildArkPayload(input);
  const data = (await arkFetch("/contents/generations/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  })) as Record<string, unknown>;

  const arkId = String(data.id || data.task_id || "");
  if (!arkId) {
    throw new ArkError("Ark accepted the request but did not return a task id.", 502, data);
  }
  return { arkId, raw: data, model: String(data.model || getSettings().model) };
}

export function normalizeStatus(value: unknown): JobStatus {
  const status = String(value || "").toLowerCase();
  if (status === "pending" || status === "queued") return "queued";
  if (status === "processing" || status === "running") return "running";
  if (status === "succeeded" || status === "success" || status === "completed") return "succeeded";
  if (status === "failed" || status === "error") return "failed";
  if (status === "expired") return "expired";
  if (status === "cancelled" || status === "canceled" || status === "deleted") return "cancelled";
  return "unknown";
}

export function parseTask(data: Record<string, unknown>) {
  const content = (data.content && typeof data.content === "object" ? data.content : {}) as Record<string, unknown>;
  const error = data.error && typeof data.error === "object" ? (data.error as Record<string, unknown>) : null;
  return {
    arkId: String(data.id || data.task_id || ""),
    status: normalizeStatus(data.status),
    videoUrl: typeof content.video_url === "string" ? content.video_url : undefined,
    lastFrameUrl: typeof content.last_frame_url === "string" ? content.last_frame_url : undefined,
    error: error ? String(error.message || error.code || "Generation failed") : undefined,
    usage: data.usage,
    seed: (data.seed as string | number | undefined) ?? undefined,
    model: typeof data.model === "string" ? data.model : undefined,
    raw: data,
  };
}

export async function getTask(arkId: string) {
  const data = (await arkFetch(`/contents/generations/tasks/${encodeURIComponent(arkId)}`)) as Record<string, unknown>;
  return parseTask(data);
}

export async function cancelTask(arkId: string) {
  return arkFetch(`/contents/generations/tasks/${encodeURIComponent(arkId)}`, { method: "DELETE" });
}
