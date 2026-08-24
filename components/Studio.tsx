"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  GenerateRequest,
  Job,
  MediaKind,
  MediaRef,
  OutputFormat,
  Provider,
  PublicSettings,
  Ratio,
  Resolution,
  StudioMode,
} from "@/lib/types";

const MODES: { id: StudioMode; title: string; line: string; hint: string; wanHint: string; heading: string }[] = [
  {
    id: "script",
    title: "SCRIPT",
    line: "Text to video",
    hint: "Write a shot like a scene: action, camera, light, sound, and the last beat. Seedance 2.5 will hold a single take up to 30 seconds.",
    wanHint: "Write a shot like a scene: action, camera, light, sound, and the last beat. Wan 3.0 holds a single take up to 30 seconds at 30fps.",
    heading: "INT. OPEN STAGE — NIGHT",
  },
  {
    id: "frames",
    title: "FRAMES",
    line: "First / last still",
    hint: "Lock the opening image, optionally the closing image. Ratio follows the first frame. Cite nothing — the stills are the picture.",
    wanHint: "Lock the opening image, optionally the closing image. Wan 3.0 animates between the two stills; ratio stays adaptive.",
    heading: "INT. GATE — CONTINUOUS",
  },
  {
    id: "refs",
    title: "REFS",
    line: "Multimodal cues",
    hint: "Up to 30 images, 10 videos, 10 audio files. Call them @Image1, @Video1, @Audio1 in the prompt so each asset has a job.",
    wanHint: "Up to 10 images, 5 videos (≤15s), 5 audio clips, plus one file or web link. Call them Image 1, Video 1, Audio 1 in the prompt.",
    heading: "INT. REFERENCE BAY — NIGHT",
  },
  {
    id: "edit",
    title: "CUT",
    line: "Edit a clip",
    hint: "Put the source in @Video1. Use replace / remove / add / modify. Duration and ratio stay locked to the original take.",
    wanHint: "Wan 3.0 has no dedicated edit call — the source rides along as Video 1 reference. Input plus output must stay under 30 seconds.",
    heading: "INT. CUTTING ROOM — NIGHT",
  },
  {
    id: "extend",
    title: "EXTEND",
    line: "Continue the take",
    hint: "Source clip as @Video1. Say whether to extend forward or back, then describe what happens next. Ratio stays adaptive.",
    wanHint: "Source clip as Video 1 reference. Describe what happens next. Input plus output must stay under 30 seconds.",
    heading: "EXT. CONTINUATION — DAY",
  },
];

const RATIOS: Ratio[] = ["16:9", "9:16", "1:1", "4:3", "3:4", "21:9", "adaptive"];
const PROMPT_CHIPS: Record<StudioMode, string[]> = {
  script: [
    "Slow dolly in, tungsten practicals, rain on glass, no jump cuts.",
    "The woman looks at camera and says: “Hold the gate.”",
    "Wide night street, neon reflection, 24fps cinematic grain.",
  ],
  frames: [
    "Animate the first frame; land exactly on the last frame.",
    "Keep identity locked; only the weather and light change.",
  ],
  refs: [
    "@Image1 is the hero. @Video1 is the camera language. @Audio1 is the score.",
    "Do not invent a new face. Wardrobe stays on @Image2.",
  ],
  edit: [
    "Replace the sky in @Video1 with a storm, keep the walk cycle.",
    "Remove the passerby on the left of @Video1. Do not retime the shot.",
  ],
  extend: [
    "Extend @Video1 forward: she opens the door and steps into the gallery.",
    "Continue @Video1 for eight more seconds, same lens and pace.",
  ],
};

const WAN_CHIPS: Record<StudioMode, string[]> = {
  script: [
    "A kitten running on a moonlit rooftop, neon city below, smooth camera movement.",
    "Product film: smart glasses emerge from darkness, macro detail, minimalist motion graphics.",
    "The street chef tosses noodles in a wok; flames, steam, night market glow.",
  ],
  frames: [
    "Animate the first frame; land exactly on the last frame.",
    "She turns from a smile to laughter, camera slowly pushing in, light shifting cool to warm.",
  ],
  refs: [
    "Image 1 holds Image 3 and plays the song from Audio 1 on the chair in Image 4.",
    "Video 1 walks past Image 1 and says: “That sounds beautiful, can you sing it again?”",
    "Read the deck in File 1, then cut a launch film for the product it describes.",
  ],
  edit: [
    "Retime Video 1 into slow motion; keep identity, wardrobe, and background locked.",
    "Keep everything in Video 1 but replace the sky with a storm. Do not retime.",
  ],
  extend: [
    "Extend Video 1 forward: she opens the door and steps into the gallery.",
    "Continue Video 1 for eight more seconds, same lens and pace.",
  ],
};

const PROVIDERS: Record<
  Provider,
  {
    label: string;
    sheetLabel: string;
    eyebrow: string;
    word: string;
    version: string;
    ratios: Ratio[];
    minDuration: number;
    maxImages: number;
    maxVideos: number;
    maxAudios: number;
    features: { outputFormat: boolean; returnLastFrame: boolean; webSearch: boolean; promptExtend: boolean };
    keyPlaceholder: string;
    sheetCopy: string;
  }
> = {
  ark: {
    label: "Volcano Ark · Seedance 2.5",
    sheetLabel: "Volcano Ark — Seedance 2.5",
    eyebrow: "Volcano Engine Ark · Doubao",
    word: "SEEDANCE",
    version: "2.5",
    ratios: RATIOS,
    minDuration: 4,
    maxImages: 30,
    maxVideos: 10,
    maxAudios: 10,
    features: { outputFormat: true, returnLastFrame: true, webSearch: true, promptExtend: false },
    keyPlaceholder: "ARK_API_KEY",
    sheetCopy:
      "Create an API key in Volcano Engine Ark, then paste it here. The key stays on this machine in data/settings.json.",
  },
  dashscope: {
    label: "Alibaba DashScope · Wan 3.0",
    sheetLabel: "Alibaba DashScope — Wan 3.0",
    eyebrow: "Alibaba Model Studio · DashScope",
    word: "WAN",
    version: "3.0",
    ratios: ["16:9", "9:16", "1:1", "4:3", "3:4", "adaptive"],
    minDuration: 2,
    maxImages: 10,
    maxVideos: 5,
    maxAudios: 5,
    features: { outputFormat: false, returnLastFrame: false, webSearch: false, promptExtend: true },
    keyPlaceholder: "DASHSCOPE_API_KEY",
    sheetCopy:
      "Create an API key in Alibaba Cloud Model Studio (Singapore), then paste it here. Calls go to dashscope-intl.aliyuncs.com. The key stays on this machine in data/settings.json.",
  },
};

const TAKES_PER_PAGE = 20;

function liveStatuses(status: Job["status"]) {
  return status === "queued" || status === "running" || status === "unknown";
}

function videoSrc(job?: Job | null) {
  return job?.localVideo || job?.videoUrl;
}

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json();
  if (!response.ok) {
    throw new Error((data as { error?: string }).error || `Request failed (${response.status})`);
  }
  return data as T;
}

function AssetCard({
  item,
  citation,
  onRemove,
}: {
  item: MediaRef;
  citation: string;
  onRemove: () => void;
}) {
  const preview = item.id ? `/api/media/uploads/${item.id}` : item.url;
  return (
    <div className="asset">
      {item.kind === "image" && preview ? (
        <img src={preview} alt="" />
      ) : item.kind === "video" && preview ? (
        <video src={preview} muted />
      ) : (
        <div />
      )}
      <div className="meta">
        <b>{item.name}</b>
        <small>
          {citation} · {item.kind}
        </small>
      </div>
      <button className="ghost" type="button" onClick={onRemove}>
        Pull
      </button>
    </div>
  );
}

export default function Studio() {
  const [now, setNow] = useState(() => new Date());
  const [mode, setMode] = useState<StudioMode>("script");
  const [prompt, setPrompt] = useState("");
  const [duration, setDuration] = useState(8);
  const [autoDuration, setAutoDuration] = useState(false);
  const [ratio, setRatio] = useState<Ratio>("16:9");
  const [resolution, setResolution] = useState<Resolution>("720p");
  const [generateAudio, setGenerateAudio] = useState(true);
  const [watermark, setWatermark] = useState(false);
  const [outputFormat, setOutputFormat] = useState<OutputFormat>("mp4");
  const [returnLastFrame, setReturnLastFrame] = useState(true);
  const [webSearch, setWebSearch] = useState(false);
  const [promptExtend, setPromptExtend] = useState(true);
  const [seed, setSeed] = useState("");
  const [firstFrame, setFirstFrame] = useState<MediaRef>();
  const [lastFrame, setLastFrame] = useState<MediaRef>();
  const [images, setImages] = useState<MediaRef[]>([]);
  const [videos, setVideos] = useState<MediaRef[]>([]);
  const [audios, setAudios] = useState<MediaRef[]>([]);
  const [files, setFiles] = useState<MediaRef[]>([]);
  const [links, setLinks] = useState<MediaRef[]>([]);
  const [urlKind, setUrlKind] = useState<MediaKind>("image");
  const [urlValue, setUrlValue] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeId, setActiveId] = useState<string>();
  const [stripPage, setStripPage] = useState(0);
  const [settings, setSettings] = useState<PublicSettings>();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [sheetProvider, setSheetProvider] = useState<Provider>("ark");
  const [baseUrl, setBaseUrl] = useState("https://ark.cn-beijing.volces.com/api/v3");
  const [model, setModel] = useState("doubao-seedance-2-5-260628");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [hot, setHot] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const provider: Provider = settings?.provider || "ark";
  const meta = PROVIDERS[provider];
  const active = jobs.find((job) => job.id === activeId) || jobs[0];
  const pendingKey = jobs
    .filter((job) => liveStatuses(job.status))
    .map((job) => job.arkId)
    .join(",");
  const recording = Boolean(pendingKey);
  const modeMeta = MODES.find((item) => item.id === mode)!;
  const ratioLocked = mode === "frames" || mode === "edit" || mode === "extend";
  const durationLocked = provider === "ark" && mode === "edit";
  const refAssetCount =
    images.length + videos.length + audios.length + files.length + links.length;
  const hasMedia =
    mode === "frames"
      ? Boolean(firstFrame)
      : mode === "script"
        ? false
        : mode === "refs"
          ? refAssetCount > 0
          : videos.length > 0;
  const needsPrompt = provider === "ark" || !hasMedia;
  const chips = provider === "dashscope" ? WAN_CHIPS[mode] : PROMPT_CHIPS[mode];
  const hint = provider === "dashscope" ? modeMeta.wanHint : modeMeta.hint;

  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => setNow(new Date()), 80);
    return () => window.clearInterval(timer);
  }, [recording]);

  const refreshJobs = useCallback(async () => {
    const list = await readJson<Job[]>(await fetch("/api/tasks"));
    setJobs(list);
    setActiveId((current) => current || list[0]?.id);
  }, []);

  useEffect(() => {
    refreshJobs().catch(() => undefined);
    fetch("/api/settings")
      .then((response) => response.json())
      .then((data: PublicSettings) => {
        setSettings(data);
        setSheetProvider(data.provider);
        setBaseUrl(data.baseUrl);
        setModel(data.model);
        if (!data.hasKey) setSettingsOpen(true);
      })
      .catch(() => undefined);
  }, [refreshJobs]);

  // Keep form values inside the active provider's limits.
  useEffect(() => {
    if (provider === "dashscope") {
      if (!meta.ratios.includes(ratio)) setRatio("16:9");
      if (duration < meta.minDuration) setDuration(meta.minDuration);
      setOutputFormat("mp4");
      if (urlKind === "file" || urlKind === "link") setUrlKind("image");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider]);

  useEffect(() => {
    const ids = pendingKey.split(",").filter(Boolean);
    if (!ids.length) return;
    const timer = window.setInterval(async () => {
      for (const arkId of ids) {
        try {
          const next = await readJson<Job>(await fetch(`/api/tasks/${arkId}`));
          setJobs((current) => current.map((item) => (item.id === next.id || item.arkId === next.arkId ? next : item)));
        } catch {
          // Keep polling; the provider can 429 under load.
        }
      }
    }, 4000);
    return () => window.clearInterval(timer);
  }, [pendingKey]);

  const cite = useCallback(
    (label: string, index: number) =>
      provider === "dashscope" ? `${label} ${index + 1}` : `@${label}${index + 1}`,
    [provider],
  );

  const citations = useMemo(() => {
    const lines: string[] = [];
    images.forEach((_, index) => lines.push(cite("Image", index)));
    videos.forEach((_, index) => lines.push(cite("Video", index)));
    audios.forEach((_, index) => lines.push(cite("Audio", index)));
    files.forEach((_, index) => lines.push(cite("File", index)));
    links.forEach((_, index) => lines.push(cite("Link", index)));
    return lines;
  }, [images, videos, audios, files, links, cite]);

  function maxFor(kind: MediaKind) {
    if (kind === "image") return meta.maxImages;
    if (kind === "video") return meta.maxVideos;
    if (kind === "audio") return meta.maxAudios;
    return 1;
  }

  function appendRef(kind: MediaKind, ref: MediaRef) {
    const max = maxFor(kind);
    if (mode === "frames") {
      if (kind !== "image") {
        setError("Frames mode only accepts stills.");
        return;
      }
      if (!firstFrame) setFirstFrame(ref);
      else setLastFrame(ref);
      return;
    }
    if (kind === "file" || kind === "link") {
      if (provider !== "dashscope") {
        setError("Files and web links are a Wan 3.0 feature.");
        return;
      }
      if (files.length && kind === "link") {
        setError("Wan 3.0 cannot combine a file and a web link.");
        return;
      }
      if (links.length && kind === "file") {
        setError("Wan 3.0 cannot combine a file and a web link.");
        return;
      }
      if (kind === "file") setFiles([ref]);
      else setLinks([ref]);
      return;
    }
    const setter =
      kind === "image" ? setImages : kind === "video" ? setVideos : setAudios;
    setter((current) => {
      if (current.length >= max) {
        setError(
          provider === "dashscope"
            ? `Wan 3.0 allows ${max} ${kind}${max > 1 ? "s" : ""} per request.`
            : `Seedance 2.5 allows ${max} ${kind}${max > 1 ? "s" : ""} per request.`,
        );
        return current;
      }
      return [...current, ref];
    });
  }

  async function addFiles(fileList: FileList | File[]) {
    setError("");
    for (const file of Array.from(fileList)) {
      const body = new FormData();
      body.append("file", file);
      const saved = await readJson<MediaRef & { kind: MediaKind }>(
        await fetch("/api/upload", { method: "POST", body }),
      );
      if (saved.kind === "file") {
        setError("Wan 3.0 files must be public URLs — paste one below instead of uploading.");
        continue;
      }
      const ref: MediaRef = {
        id: saved.id,
        kind: saved.kind,
        name: saved.name,
        mime: saved.mime,
      };
      appendRef(ref.kind, ref);
    }
  }

  function addUrl(event: FormEvent) {
    event.preventDefault();
    const url = urlValue.trim();
    if (!url) return;
    const ref: MediaRef = { kind: urlKind, name: url, url };
    appendRef(urlKind, ref);
    setUrlValue("");
  }

  async function generate() {
    setBusy(true);
    setError("");
    try {
      const payload: GenerateRequest = {
        mode,
        prompt,
        duration: durationLocked || autoDuration ? -1 : duration,
        ratio: ratioLocked ? "adaptive" : ratio,
        resolution,
        generateAudio,
        watermark,
        outputFormat: provider === "dashscope" ? "mp4" : outputFormat,
        returnLastFrame: provider === "dashscope" ? false : returnLastFrame,
        webSearch: provider === "dashscope" ? false : webSearch,
        promptExtend,
        seed: seed.trim() ? Number(seed) : undefined,
        firstFrame,
        lastFrame,
        images,
        videos,
        audios,
        files,
        links,
      };
      const job = await readJson<Job>(
        await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }),
      );
      setJobs((current) => [job, ...current.filter((item) => item.id !== job.id)]);
      setActiveId(job.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the take.");
    } finally {
      setBusy(false);
    }
  }

  function switchSheetProvider(next: Provider) {
    setSheetProvider(next);
    const config = settings?.providers[next];
    if (config) {
      setBaseUrl(config.baseUrl);
      setModel(config.model);
    } else {
      setBaseUrl(
        next === "dashscope" ? "https://dashscope-intl.aliyuncs.com" : "https://ark.cn-beijing.volces.com/api/v3",
      );
      setModel(next === "dashscope" ? "wan3.0-video" : "doubao-seedance-2-5-260628");
    }
  }

  async function saveSettings(event: FormEvent) {
    event.preventDefault();
    const next = await readJson<PublicSettings>(
      await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: sheetProvider, apiKey, baseUrl, model }),
      }),
    );
    setSettings(next);
    setApiKey("");
    setSettingsOpen(false);
  }

  async function cancelActive() {
    if (!active) return;
    const next = await readJson<Job>(await fetch(`/api/tasks/${active.arkId}`, { method: "DELETE" }));
    setJobs((current) => current.map((item) => (item.id === next.id ? next : item)));
  }

  function continueTake(kind: "extend" | "frames") {
    if (!active) return;
    if (kind === "extend" && videoSrc(active)) {
      setMode("extend");
      setVideos([
        {
          kind: "video",
          name: "Previous take",
          url: active.videoUrl || undefined,
        },
      ]);
      setPrompt(
        provider === "dashscope"
          ? "Extend Video 1 forward. Keep the same lens, pace, and character. "
          : "Extend @Video1 forward. Keep the same lens, pace, and character. ",
      );
    }
    if (kind === "frames") {
      const frame = active.localLastFrame || active.lastFrameUrl;
      if (!frame) {
        setError("Turn on “return last frame” before chaining stills.");
        return;
      }
      setMode("frames");
      setFirstFrame({ kind: "image", name: "Last frame", url: active.lastFrameUrl || frame });
    }
  }

  const leaderNumber = recording ? 8 - (Math.floor(now.getSeconds() % 8) ) : 8;
  const sheetConfig = settings?.providers[sheetProvider];
  const sheetMeta = PROVIDERS[sheetProvider];
  const pageCount = Math.max(1, Math.ceil(jobs.length / TAKES_PER_PAGE));
  const stripPageSafe = Math.min(Math.max(0, stripPage), pageCount - 1);
  const pageStart = stripPageSafe * TAKES_PER_PAGE;
  const pageJobs = jobs.slice(pageStart, pageStart + TAKES_PER_PAGE);

  // Keep the page containing the selected take in view.
  useEffect(() => {
    if (!activeId) return;
    const index = jobs.findIndex((job) => job.id === activeId);
    if (index >= 0) setStripPage(Math.floor(index / TAKES_PER_PAGE));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, jobs.length]);

  return (
    <div className="studio">
      <div className="grain" />
      <header className="mast">
        <div className="brand">
          <div className="eyebrow">{meta.eyebrow}</div>
          <h1 className="wordmark">
            {meta.word} <span>{meta.version}</span>
          </h1>
        </div>
        <div className="mast-actions">
          <button className="ghost" type="button" onClick={() => setSettingsOpen(true)}>
            {settings?.hasKey ? `${meta.word} ·${settings.keyTail}` : "API key"}
          </button>
        </div>
      </header>

      {error ? <div className="banner">{error}</div> : null}

      <div className="layout">
        <aside className="rail">
          <div className="section-label">Magazine</div>
          {MODES.map((item) => (
            <button
              key={item.id}
              className={`mode ${mode === item.id ? "active" : ""}`}
              type="button"
              onClick={() => setMode(item.id)}
            >
              <b>{item.title}</b>
              <span>{item.line}</span>
            </button>
          ))}
          <p className="hint">{hint}</p>
        </aside>

        <section className="desk">
          <div className="script">
            <div className="scene-head">{modeMeta.heading}</div>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                  event.preventDefault();
                  generate().catch(() => undefined);
                }
              }}
              placeholder={
                provider === "dashscope"
                  ? "Action, camera, light, dialogue, sound. Cite Image 1 / Video 1 / Audio 1 when assets are loaded."
                  : "Action, camera, light, dialogue, sound. Cite @Image1 / @Video1 / @Audio1 when assets are loaded."
              }
            />
            <div className="script-meta">
              <span>{prompt.length} marks</span>
              <span>Ctrl + Enter rolls camera</span>
            </div>
            <div className="chips">
              {chips.map((chip) => (
                <button key={chip} className="chip" type="button" onClick={() => setPrompt((current) => (current ? `${current}\n${chip}` : chip))}>
                  {chip}
                </button>
              ))}
              {citations.length ? (
                <button className="chip" type="button" onClick={() => setPrompt((current) => `${current} ${citations.join(" ")}`.trim())}>
                  Insert {citations.join(" ")}
                </button>
              ) : null}
            </div>
          </div>

          <div className="controls">
            <label className="field">
              <span>Duration</span>
              <div className="slider-row">
                <input
                  type="range"
                  min={meta.minDuration}
                  max={30}
                  value={duration}
                  disabled={durationLocked || autoDuration}
                  onChange={(event) => setDuration(Number(event.target.value))}
                />
                <strong>{durationLocked || autoDuration ? "auto" : `${duration}s`}</strong>
              </div>
            </label>
            <label className="field">
              <span>Ratio</span>
              <select value={ratioLocked ? "adaptive" : ratio} disabled={ratioLocked} onChange={(event) => setRatio(event.target.value as Ratio)}>
                {meta.ratios.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Resolution</span>
              <select value={resolution} onChange={(event) => setResolution(event.target.value as Resolution)}>
                <option value="1080p">1080p</option>
                <option value="720p">720p</option>
                <option value="480p">480p</option>
              </select>
            </label>
            {meta.features.outputFormat ? (
              <label className="field">
                <span>Print</span>
                <select value={outputFormat} onChange={(event) => setOutputFormat(event.target.value as OutputFormat)}>
                  <option value="mp4">MP4 · delivery</option>
                  <option value="mov">MOV · grade / key</option>
                </select>
              </label>
            ) : null}
          </div>

          <div className="toggles">
            <label className="toggle">
              <input type="checkbox" checked={generateAudio} onChange={(event) => setGenerateAudio(event.target.checked)} />
              <span>Sync audio</span>
            </label>
            <label className="toggle">
              <input type="checkbox" checked={watermark} onChange={(event) => setWatermark(event.target.checked)} />
              <span>Watermark</span>
            </label>
            {meta.features.returnLastFrame ? (
              <label className="toggle">
                <input type="checkbox" checked={returnLastFrame} onChange={(event) => setReturnLastFrame(event.target.checked)} />
                <span>Last frame</span>
              </label>
            ) : null}
            {meta.features.webSearch ? (
              <label className="toggle">
                <input type="checkbox" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} />
                <span>Web search</span>
              </label>
            ) : null}
            {meta.features.promptExtend ? (
              <label className="toggle">
                <input type="checkbox" checked={promptExtend} onChange={(event) => setPromptExtend(event.target.checked)} />
                <span>Prompt extend</span>
              </label>
            ) : null}
            <label className="toggle">
              <input
                type="checkbox"
                checked={autoDuration || durationLocked}
                disabled={durationLocked}
                onChange={(event) => setAutoDuration(event.target.checked)}
              />
              <span>Auto length</span>
            </label>
            <label className="toggle">
              <span>Seed</span>
              <input
                type="text"
                inputMode="numeric"
                value={seed}
                onChange={(event) => setSeed(event.target.value.replace(/[^\d]/g, ""))}
                placeholder="random"
                style={{ width: 84, background: "transparent", border: 0, outline: "none" }}
              />
            </label>
          </div>

          {mode !== "script" ? (
            <div className="media">
              <div
                className={`drop ${hot ? "hot" : ""}`}
                onDragOver={(event) => {
                  event.preventDefault();
                  setHot(true);
                }}
                onDragLeave={() => setHot(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setHot(false);
                  if (event.dataTransfer.files.length) addFiles(event.dataTransfer.files).catch((err) => setError(err.message));
                }}
                onClick={() => fileRef.current?.click()}
              >
                Drop stills, clips, or audio into the gate — or click to browse.
                <input
                  ref={fileRef}
                  type="file"
                  hidden
                  multiple
                  accept="image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,.mp3,.wav,.mp4,.mov"
                  onChange={(event) => {
                    if (event.target.files) addFiles(event.target.files).catch((err) => setError(err.message));
                    event.target.value = "";
                  }}
                />
              </div>
              <form className="url-row" onSubmit={addUrl}>
                <select value={urlKind} onChange={(event) => setUrlKind(event.target.value as MediaKind)}>
                  <option value="image">Image URL</option>
                  <option value="video">Video URL</option>
                  <option value="audio">Audio URL</option>
                  {provider === "dashscope" ? (
                    <>
                      <option value="file">File URL</option>
                      <option value="link">Web link</option>
                    </>
                  ) : null}
                </select>
                <input value={urlValue} onChange={(event) => setUrlValue(event.target.value)} placeholder="https://… or asset://…" />
                <button className="ghost" type="submit">
                  Load
                </button>
              </form>
              <div className="assets">
                {mode === "frames" && firstFrame ? (
                  <AssetCard item={firstFrame} citation="first frame" onRemove={() => setFirstFrame(undefined)} />
                ) : null}
                {mode === "frames" && lastFrame ? (
                  <AssetCard item={lastFrame} citation="last frame" onRemove={() => setLastFrame(undefined)} />
                ) : null}
                {mode !== "frames"
                  ? images.map((item, index) => (
                      <AssetCard
                        key={`${item.id || item.url}-${index}`}
                        item={item}
                        citation={cite("Image", index)}
                        onRemove={() => setImages((current) => current.filter((_, i) => i !== index))}
                      />
                    ))
                  : null}
                {mode !== "frames"
                  ? videos.map((item, index) => (
                      <AssetCard
                        key={`${item.id || item.url}-${index}`}
                        item={item}
                        citation={cite("Video", index)}
                        onRemove={() => setVideos((current) => current.filter((_, i) => i !== index))}
                      />
                    ))
                  : null}
                {mode !== "frames"
                  ? audios.map((item, index) => (
                      <AssetCard
                        key={`${item.id || item.url}-${index}`}
                        item={item}
                        citation={cite("Audio", index)}
                        onRemove={() => setAudios((current) => current.filter((_, i) => i !== index))}
                      />
                    ))
                  : null}
                {mode !== "frames"
                  ? files.map((item, index) => (
                      <AssetCard
                        key={`${item.id || item.url}-${index}`}
                        item={item}
                        citation={cite("File", index)}
                        onRemove={() => setFiles((current) => current.filter((_, i) => i !== index))}
                      />
                    ))
                  : null}
                {mode !== "frames"
                  ? links.map((item, index) => (
                      <AssetCard
                        key={`${item.id || item.url}-${index}`}
                        item={item}
                        citation={cite("Link", index)}
                        onRemove={() => setLinks((current) => current.filter((_, i) => i !== index))}
                      />
                    ))
                  : null}
              </div>
            </div>
          ) : null}

          <div className="roll">
            <span className="eyebrow">{settings?.model || meta.word.toLowerCase()}</span>
            <button className="primary" type="button" disabled={busy || (needsPrompt && !prompt.trim())} onClick={() => generate()}>
              {busy ? "Queuing…" : "Roll camera"}
            </button>
          </div>
        </section>

        <section className="gate">
          <div className="viewport">
            {recording && !videoSrc(active) ? (
              <div className="leader">
                <div className="leader-ring">
                  <span>{leaderNumber}</span>
                </div>
              </div>
            ) : videoSrc(active) ? (
              <video src={videoSrc(active)} controls autoPlay loop />
            ) : (
              <div className="gate-empty">
                <div>
                  <b>NO SIGNAL</b>
                  <p>Takes land here. Result URLs are copied locally so they outlive the 24-hour expiry.</p>
                </div>
              </div>
            )}
          </div>
          <div className="job-meta">
            <div className={`status ${active?.status || ""}`}>{active?.status || "idle"}</div>
            <h2>{active ? active.mode.toUpperCase() : "EMPTY GATE"}</h2>
            <p>{active?.prompt || "Queue a generation to fill the gate."}</p>
            {active?.model ? <small>{active.model}</small> : null}
            {active?.error ? <p>{active.error}</p> : null}
          </div>
          {active ? (
            <div className="toggles">
              {liveStatuses(active.status) ? (
                <button className="danger" type="button" onClick={() => cancelActive()}>
                  Cancel
                </button>
              ) : null}
              {active.status === "succeeded" ? (
                <>
                  <a className="ghost" href={videoSrc(active)} download>
                    Download
                  </a>
                  <button className="ghost" type="button" onClick={() => continueTake("extend")}>
                    Extend this
                  </button>
                  {active.provider !== "dashscope" ? (
                    <button className="ghost" type="button" onClick={() => continueTake("frames")}>
                      Next from last frame
                    </button>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
        </section>
      </div>

      <section className="strip">
        <div className="strip-head">
          <div className="section-label">Stripboard</div>
          <span className="eyebrow">{jobs.length} takes</span>
          {pageCount > 1 ? (
            <div className="pager">
              <button
                className="ghost"
                type="button"
                disabled={stripPageSafe === 0}
                onClick={() => setStripPage(stripPageSafe - 1)}
              >
                ‹ Prev
              </button>
              <span className="eyebrow">
                {stripPageSafe + 1} / {pageCount}
              </span>
              <button
                className="ghost"
                type="button"
                disabled={stripPageSafe >= pageCount - 1}
                onClick={() => setStripPage(stripPageSafe + 1)}
              >
                Next ›
              </button>
            </div>
          ) : null}
        </div>
        <div className="takes">
          {pageJobs.length ? (
            pageJobs.map((job) => (
              <button
                key={job.id}
                className={`take ${job.id === active?.id ? "active" : ""}`}
                type="button"
                onClick={() => setActiveId(job.id)}
              >
                <div className="take-thumb">
                  {videoSrc(job) ? <video src={videoSrc(job)} muted /> : job.status.toUpperCase()}
                </div>
                <div className="take-body">
                  <div className={`status ${job.status}`}>{job.status}</div>
                  <b>{job.prompt}</b>
                  {job.model ? <small>{job.model}</small> : null}
                </div>
              </button>
            ))
          ) : (
            <p className="hint">No takes yet. Write a scene and roll camera.</p>
          )}
        </div>
      </section>

      {settingsOpen ? (
        <div className="veil" onClick={() => settings?.hasKey && setSettingsOpen(false)}>
          <form className="sheet" onClick={(event) => event.stopPropagation()} onSubmit={saveSettings}>
            <h2>PROJECTION BOOTH</h2>
            <p>{sheetMeta.sheetCopy}</p>
            <label>
              Provider
              <select value={sheetProvider} onChange={(event) => switchSheetProvider(event.target.value as Provider)}>
                <option value="ark">{PROVIDERS.ark.sheetLabel}</option>
                <option value="dashscope">{PROVIDERS.dashscope.sheetLabel}</option>
              </select>
            </label>
            <label>
              API key
              <input
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={sheetConfig?.hasKey ? `unchanged ·${sheetConfig.keyTail}` : sheetMeta.keyPlaceholder}
                type="password"
              />
            </label>
            <label>
              Base URL
              <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} />
            </label>
            <label>
              Model
              <input value={model} onChange={(event) => setModel(event.target.value)} />
            </label>
            <div className="sheet-actions">
              {settings?.hasKey ? (
                <button className="ghost" type="button" onClick={() => setSettingsOpen(false)}>
                  Close
                </button>
              ) : null}
              <button className="primary" type="submit">
                Save
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}
