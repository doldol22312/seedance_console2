import { getSettings } from "./settings";
import { ArkError, normalizeStatus } from "./ark";
import type { GenerateRequest } from "./types";
import { resolveMediaUrl } from "./media";

// Wan 3.0 video generation on Alibaba Cloud Model Studio (DashScope international).
// Docs: https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference

const CREATE_PATH = "/api/v1/services/aigc/video-generation/video-synthesis";
const TASKS_PATH = "/api/v1/tasks";

export const WAN_LIMITS = {
  referenceImages: 10,
  referenceVideos: 5,
  referenceAudios: 5,
  files: 1,
  links: 1,
  maxSeed: 2147483647,
  maxInputVideoSeconds: 15,
};

type WanMedia = { type: string; url: string };

function extractError(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") return fallback;
  const record = payload as Record<string, unknown>;
  if (typeof record.message === "string") {
    const code = typeof record.code === "string" ? record.code : "";
    return code ? `${code}: ${record.message}` : record.message;
  }
  const output = record.output;
  if (output && typeof output === "object") {
    const inner = output as Record<string, unknown>;
    if (typeof inner.message === "string") {
      const code = typeof inner.code === "string" ? inner.code : "";
      return code ? `${code}: ${inner.message}` : inner.message;
    }
  }
  return fallback;
}

async function dashscopeFetch(pathname: string, init?: RequestInit) {
  const settings = getSettings();
  if (!settings.apiKey) {
    throw new ArkError("Add your Alibaba Cloud Model Studio (DashScope) API key in Settings.", 401);
  }

  const url = `${settings.baseUrl}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${settings.apiKey}`,
      "Content-Type": "application/json",
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
    throw new ArkError(extractError(data, `DashScope request failed (${response.status})`), response.status, data);
  }
  return data;
}

function lockedRatio(mode: GenerateRequest["mode"]) {
  return mode === "frames" || mode === "edit" || mode === "extend";
}

export function buildWanPayload(input: GenerateRequest) {
  const settings = getSettings();
  const media: WanMedia[] = [];

  const push = (ref: GenerateRequest["firstFrame"], type: string, label: string, allowData = true) => {
    const url = resolveMediaUrl(ref);
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !(allowData && url.startsWith("data:"))) {
      throw new ArkError(`${label} must be a public HTTPS URL.`, 400);
    }
    media.push({ type, url });
  };

  if (input.mode === "frames") {
    push(input.firstFrame, "first_frame", "First frame");
    push(input.lastFrame, "last_frame", "Last frame");
  } else if (input.mode !== "script") {
    for (const image of input.images || []) push(image, "reference_image", `Reference image ${image.name}`);
    for (const video of input.videos || []) push(video, "reference_video", `Reference video ${video.name}`);
    for (const audio of input.audios || []) push(audio, "reference_audio", `Reference audio ${audio.name}`);
    for (const file of input.files || []) push(file, "file", `File ${file.name}`, false);
    for (const link of input.links || []) push(link, "link", `Web link ${link.name}`, false);
  }

  const inputBody: Record<string, unknown> = {};
  if (input.prompt.trim()) inputBody.prompt = input.prompt.trim();
  if (media.length) inputBody.media = media;

  const payload: Record<string, unknown> = {
    model: settings.model,
    input: inputBody,
    parameters: {
      resolution: String(input.resolution).toUpperCase(),
      ratio: lockedRatio(input.mode) ? "adaptive" : input.ratio === "21:9" ? "16:9" : input.ratio,
      duration: input.duration,
      audio: input.generateAudio,
      prompt_extend: input.promptExtend ?? true,
      watermark: input.watermark,
    },
  };
  if (typeof input.seed === "number" && input.seed >= 0) {
    (payload.parameters as Record<string, unknown>).seed = input.seed;
  }
  return payload;
}

export async function createWanTask(input: GenerateRequest) {
  const mediaCount =
    (input.images?.length || 0) +
    (input.videos?.length || 0) +
    (input.audios?.length || 0) +
    (input.files?.length || 0) +
    (input.links?.length || 0);

  if (!input.prompt.trim() && mediaCount === 0 && !input.firstFrame && !input.lastFrame) {
    throw new ArkError("Wan 3.0 needs a prompt or at least one media asset.", 400);
  }
  if (input.mode === "frames" && !input.firstFrame) {
    throw new ArkError("First-frame mode needs a still for the opening image.", 400);
  }
  if ((input.mode === "edit" || input.mode === "extend") && !(input.videos && input.videos.length)) {
    throw new ArkError("Edit and extend need a source clip as Video 1.", 400);
  }
  if (input.mode === "refs") {
    if (mediaCount === 0) {
      throw new ArkError("Reference mode needs at least one image, video, audio, file, or link.", 400);
    }
    if ((input.images?.length || 0) > WAN_LIMITS.referenceImages) {
      throw new ArkError(`Wan 3.0 allows ${WAN_LIMITS.referenceImages} reference images per request.`, 400);
    }
    if ((input.videos?.length || 0) > WAN_LIMITS.referenceVideos) {
      throw new ArkError(`Wan 3.0 allows ${WAN_LIMITS.referenceVideos} reference videos (15s total) per request.`, 400);
    }
    if ((input.audios?.length || 0) > WAN_LIMITS.referenceAudios) {
      throw new ArkError(`Wan 3.0 allows ${WAN_LIMITS.referenceAudios} reference audio clips per request.`, 400);
    }
    if ((input.files?.length || 0) > WAN_LIMITS.files) {
      throw new ArkError("Wan 3.0 allows one file per request.", 400);
    }
    if ((input.links?.length || 0) > WAN_LIMITS.links) {
      throw new ArkError("Wan 3.0 allows one web link per request.", 400);
    }
    if ((input.files?.length || 0) > 0 && (input.links?.length || 0) > 0) {
      throw new ArkError("Wan 3.0 cannot combine a file and a web link in the same request.", 400);
    }
  }
  if (typeof input.seed === "number" && (input.seed < 0 || input.seed > WAN_LIMITS.maxSeed)) {
    throw new ArkError(`Seed must be between 0 and ${WAN_LIMITS.maxSeed}.`, 400);
  }

  const payload = buildWanPayload(input);
  const data = (await dashscopeFetch(CREATE_PATH, {
    method: "POST",
    headers: { "X-DashScope-Async": "enable" },
    body: JSON.stringify(payload),
  })) as Record<string, unknown>;

  const output = (data.output && typeof data.output === "object" ? data.output : {}) as Record<string, unknown>;
  const taskId = String(output.task_id || "");
  if (!taskId) {
    throw new ArkError("DashScope accepted the request but did not return a task id.", 502, data);
  }
  return { arkId: taskId, raw: data, model: getSettings().model };
}

export function parseWanTask(data: Record<string, unknown>) {
  const output = (data.output && typeof data.output === "object" ? data.output : {}) as Record<string, unknown>;
  const status = normalizeStatus(output.task_status);
  const failed = output.task_status === "FAILED";
  return {
    arkId: String(output.task_id || ""),
    status,
    videoUrl: typeof output.video_url === "string" ? output.video_url : undefined,
    lastFrameUrl: undefined,
    error: failed ? extractError(output, "Generation failed") : undefined,
    usage: data.usage,
    seed: undefined,
    model: undefined,
    raw: data,
  };
}

export async function getWanTask(taskId: string) {
  const data = (await dashscopeFetch(
    `${TASKS_PATH}/${encodeURIComponent(taskId)}`,
  )) as Record<string, unknown>;
  return parseWanTask(data);
}

export async function cancelWanTask(taskId: string) {
  return dashscopeFetch(`${TASKS_PATH}/${encodeURIComponent(taskId)}/cancel`, { method: "POST" });
}
