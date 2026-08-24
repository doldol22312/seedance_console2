# Seedance / Wan Console

A local studio for **Doubao Seedance 2.5** on [Volcano Engine Ark](https://www.volcengine.com/docs/82379/2607688) and **Wan 3.0** on [Alibaba Cloud Model Studio](https://www.alibabacloud.com/help/en/model-studio/wan3-video-generation-api-reference). It submits async video tasks, polls until they finish, and copies the result off the temporary provider URL.

## Run

```bash
npm install
copy .env.example .env.local
npm run dev
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). Paste an API key in **Settings**, or set `ARK_API_KEY` / `DASHSCOPE_API_KEY` in `.env.local`.

- Ark keys: [Volcano Engine Ark](https://console.volcengine.com/ark/region:ark+cn-beijing/apikey). Activate Seedance 2.5 on the account first.
- Wan keys: [Model Studio](https://modelstudio.console.alibabacloud.com) — the key, endpoint, and model must belong to the same region (the default `https://dashscope-intl.aliyuncs.com` is the international / Singapore gateway).

Both providers keep their own key, base URL, and model in `data/settings.json`; switching the provider in Settings swaps the whole reel.

## Providers

| Provider | Model | Default host |
| --- | --- | --- |
| Volcano Ark | `doubao-seedance-2-5-260628` | `https://ark.cn-beijing.volces.com/api/v3` |
| Alibaba DashScope | `wan3.0-video` | `https://dashscope-intl.aliyuncs.com` |

## Modes

| Magazine | What it sends |
| --- | --- |
| SCRIPT | Text-to-video. Seedance 4–30s, Wan 2–30s |
| FRAMES | First frame, optional last frame (`ratio` locked to `adaptive`) |
| REFS | Seedance: up to 30 images, 10 videos, 10 audio files (`@Image1`). Wan: up to 10 images, 5 videos, 5 audio clips, plus one **file** (pdf/docx/pptx…) or **web link** (`Image 1`) |
| CUT | Edit the source clip. Seedance has a native edit; Wan carries the clip as a reference video |
| EXTEND | Continue the source clip forward or back |

## Notes

- Stills can be uploaded and inlined as data URLs. Large video/audio files should be public HTTPS links so the provider can fetch them. Wan 3.0 files and web links must be public URLs.
- Finished clips are saved under `data/outputs` because both providers' download URLs expire after 24 hours.
- `MOV` is for grading / keying (Seedance only). Use `MP4` if you want the gate player to always open the file.
- **WebM export**: on a finished take, `WebM` transcodes the archived MP4 with `ffmpeg` (must be on PATH — `winget install Gyan.FFmpeg`). If an NVIDIA GPU with AV1 NVENC is available (RTX 40-series+) it hardware-encodes AV1 at ~10× realtime; otherwise it falls back to CPU VP9 (CRF 23, near-transparent). Audio is Opus 128k. The result is cached in `data/outputs` as `<task>.webm`; the first click encodes, later clicks are instant.
- Wan 3.0 extras: `Prompt extend` rewrites short prompts before generation; `Auto length` sends duration `-1` so the model picks a duration.
