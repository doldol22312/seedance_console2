export type Provider = "ark" | "dashscope";

export type StudioMode = "script" | "frames" | "refs" | "edit" | "extend";

export type Ratio =
  | "adaptive"
  | "21:9"
  | "16:9"
  | "4:3"
  | "1:1"
  | "3:4"
  | "9:16";

export type Resolution = "480p" | "720p" | "1080p";
export type OutputFormat = "mp4" | "mov";

export type MediaKind = "image" | "video" | "audio" | "file" | "link";

export type MediaRef = {
  id?: string;
  kind: MediaKind;
  name: string;
  url?: string;
  mime?: string;
  duration?: number;
};

export type GenerateRequest = {
  mode: StudioMode;
  prompt: string;
  duration: number;
  ratio: Ratio;
  resolution: Resolution;
  generateAudio: boolean;
  watermark: boolean;
  outputFormat: OutputFormat;
  returnLastFrame: boolean;
  webSearch: boolean;
  promptExtend?: boolean;
  seed?: number;
  firstFrame?: MediaRef;
  lastFrame?: MediaRef;
  images?: MediaRef[];
  videos?: MediaRef[];
  audios?: MediaRef[];
  files?: MediaRef[];
  links?: MediaRef[];
};

export type JobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "expired"
  | "cancelled"
  | "unknown";

export type Job = {
  id: string;
  arkId: string;
  status: JobStatus;
  mode: StudioMode;
  prompt: string;
  provider?: Provider;
  params: {
    duration: number;
    ratio: Ratio;
    resolution: Resolution;
    generateAudio: boolean;
    watermark: boolean;
    outputFormat: OutputFormat;
    returnLastFrame: boolean;
    webSearch: boolean;
    promptExtend?: boolean;
    seed?: number;
  };
  createdAt: number;
  updatedAt: number;
  videoUrl?: string;
  lastFrameUrl?: string;
  localVideo?: string;
  localLastFrame?: string;
  error?: string;
  usage?: unknown;
  seed?: string | number;
  model?: string;
};

export type ProviderConfig = {
  apiKey: string;
  baseUrl: string;
  model: string;
};

export type Settings = ProviderConfig & {
  provider: Provider;
};

export type PublicProviderConfig = {
  hasKey: boolean;
  keyTail: string;
  baseUrl: string;
  model: string;
};

export type PublicSettings = PublicProviderConfig & {
  provider: Provider;
  providers: Record<Provider, PublicProviderConfig>;
  outputsDir: string;
  outputsDirDefault: string;
};
