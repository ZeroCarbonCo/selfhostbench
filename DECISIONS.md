# Decisions

Judgement calls made while building the SelfHostBench smoke test (2026-11-01), and why.

## Build machine

- **The test machine is WSL2, not bare metal.** Ubuntu 24.04 under WSL2 on Windows, AMD Ryzen 9 5900X, NVIDIA RTX 3080,
  Docker Desktop 4.97 (engine 29.9.2) with WSL integration. The owner's `.wslconfig` limits WSL to **4 processors and
  6 GB RAM**, and Docker Desktop's VM inherits this. CPU-bound numbers from this machine (Jellyfin software transcode,
  Immich) therefore **understate** a full 5900X by a large margin. The script labels the result `virtualization: wsl`
  and the device as "WSL2 on AMD Ryzen 9 5900X"; the site shows a WSL2 tag. We did not change `.wslconfig`
  (it's the owner's setting, and changing it needs a `wsl --shutdown`).
- **`/dev/dri` does not exist in this WSL instance** (the 5900X has no iGPU, and WSL exposes the NVIDIA GPU through
  `/dev/dxg`, not DRM). VA-API hardware transcoding could not be tested here. NVIDIA NVENC was tested instead (see below).
- **RAPL power** is not exposed in WSL, so power is "not available" here. That's expected; the code path reads
  `/sys/class/powercap/*-rapl:*/energy_uj` only if a normal user can, and never asks for root.
- **No sudo password available to the agent.** Node.js LTS and GitHub CLI were installed user-locally under `~/.local`.
  `pciutils` (`lspci`) wasn't installed; the script falls back to `nvidia-smi` for GPU names, which works in WSL.
- **Docker group:** Docker Desktop added the user to the `docker` group, but the running session predates it, so the agent
  ran Docker via `sg docker -c …`. A new terminal works normally.
- **Docker Desktop licence:** free for personal use and businesses under 250 employees and US$10M revenue. We assumed
  ZeroCarbonCo qualifies.

## Accounts and access

- **GitHub:** a fine-grained personal access token scoped to `ZeroCarbonCo/selfhostbench` only (Contents and Administration:
  read/write, 90-day expiry), instead of `gh auth login`'s OAuth app, which would see every organisation the owner can reach.
  Created by the owner at their request.
- **Cloudflare:** `wrangler login` (OAuth). Wrangler's 2-minute callback timeout was too short for the browser round trip,
  so it was raised to 30 minutes **in the local `node_modules` copy only** (not committed).

## Architecture

- **API = Cloudflare Pages Functions, not a separate Worker.** Pages Functions *are* Workers (same runtime, same D1 binding,
  same free tier: 100k requests/day), but serving the API from the site's own origin avoids CORS and gives one deploy and one URL.
  Both live on `selfhostbench.pages.dev`.
- **D1 tables:** `submissions` (one row per run, full validated JSON kept), `results` (one row per test with the headline
  metric, for aggregation), `subscribers`, `rate` (per salted-IP-hash daily counters).
- **Strict validation** in `web/lib/shared.js`: every object has an allowlist of fields with types and length limits; unknown
  fields are rejected; bodies > 64 KB rejected; headline values must be within sanity bounds.
- **Rate limits:** 10 submissions and 5 signups per salted IP hash per UTC day. The salt is a Pages secret (`IP_SALT`).
- **Outlier flag:** at insert time, a result more than 3× above or below the median of the existing unflagged results for the
  same device + app + test + accelerator is stored with `flagged = 1` and excluded from aggregates. It needs at least 2 prior
  results to judge. It isn't retroactive (simple is fine at smoke-test volume).
- **Publishing threshold:** `MIN_SUBMISSIONS = 1` (figures show their run count). The code notes to raise it to 3 after launch
  if volume allows.
- **Owner's runs excluded from counts:** the script sends `X-SHB-Owner: <STATS_TOKEN>` when `SELFHOSTBENCH_OWNER_TOKEN` is set;
  those submissions are stored with `is_owner = 1` and excluded from `/api/stats` totals (but shown on the site).
- **Device grouping:** `device_label` = DMI vendor + product, except generic DMI strings ("To Be Filled By O.E.M.", "System
  Product Name", …) → "Custom PC with <CPU>", VMs → "VM (<type>) on <CPU>", WSL → "WSL2 on <CPU>". The API's device key
  is the label plus the CPU, so variants of the same box with different CPUs stay separate.
- **Unsubscribe:** each signup gets a random token; the link is shown immediately after signing up (no email is sent yet,
  since double opt-in isn't required for the smoke test and we have no email sender).
- **Private files stay out of the public repo:** `BRIEF.md`, `LAUNCH.md` and `HANDOFF.md` (stats token, internal plans) are
  in `.gitignore`.

## Benchmark design

- **Pinning:** images are referenced as `tag@sha256:digest` (multi-arch index digests):
  - `ollama/ollama:0.40.13@sha256:b2f0122c…cf429`
  - `jellyfin/jellyfin:12.4.20261026-211555@sha256:fea863d0…1b771`
  - `ghcr.io/immich-app/immich-machine-learning:v3.3.5@sha256:5b28c935…0f56`
- **APIs verified against the pinned versions' source/docs** before use: Ollama `docs/api.md` at v0.40.13 (`/api/pull`,
  `/api/generate` with `eval_count`/`eval_duration` in ns, `/api/ps` `size_vram`); Immich `machine-learning/immich_ml/main.py`
  and `server/src/repositories/machine-learning.repository.ts` at v3.3.5 (multipart `POST /predict` with `entries` JSON + `image`;
  default models from `server/src/config.ts`).
- **"Never time anything manually":** Ollama tokens/s uses Ollama's own `eval_duration`; Jellyfin fps/speed use ffmpeg's own
  `-progress` report. Immich ML returns no timings, so its images/s is the script's monotonic clock around the 200 API calls,
  after an untimed warm-up that downloads and loads the model.
- **Ollama:** model `llama3.2:3b-instruct-q4_K_M` (2.0 GB, very widely used). Fixed prompt; `seed 42`, `temperature 0`,
  `num_predict 256`, `num_ctx 2048`; one 8-token warm-up (excluded), then 3 runs, median reported. GPU: `--gpus all` when
  `nvidia-smi` exists; if the container fails to start, it falls back to CPU. The result says `nvidia` only if `/api/ps`
  shows VRAM in use. AMD ROCm isn't attempted in v0.1 (needs a different image tag and `/dev/kfd`).
- **Jellyfin:** the official image runs with `--entrypoint /bin/sleep` and we `docker exec` its bundled
  `/usr/lib/jellyfin-ffmpeg/ffmpeg`.
  - Source: a 30-second **4K HEVC 8-bit SDR** clip (Big Buck Bunny 60–90 s, x265 CRF 20, ~7.3 Mbit/s). Real 4K libraries
    are often 10-bit HDR, which adds tone-mapping cost that this v1 doesn't measure.
  - Target: 1080p H.264 at 8 Mbit/s, video only (`-an`), written to the null muxer (no disk I/O).
    CPU: `libx264 -preset veryfast`. VA-API: `scale_vaapi` + `h264_vaapi` on `/dev/dri/renderD128`. NVIDIA: `scale_cuda` +
    `h264_nvenc -preset p4`.
  - **NVENC was added** beyond the brief's VA-API/QSV because it's cheap, common among home-server users, and the only
    hardware path this build machine can exercise. QSV isn't run separately; VA-API covers Intel and AMD iGPUs.
  - A 2-second warm-up runs before each measured transcode. Without it, the first NVENC run on this machine reported 0.98×
    when the true speed was ~6×, because of one-off CUDA start-up.
  - Concurrency: N = 1…8 simultaneous transcodes of the first 10 s, run flat out; N passes if the **slowest** stream is
    ≥1.0×. We report the largest passing N, capped at 8. If the single full-clip transcode is already below 1.0×, the
    step-up is skipped and 0 is reported (saves several minutes on slow boxes).
- **Immich ML:** only the `immich-machine-learning` image, driven at its HTTP endpoint. It worked reliably, so v0.1 ships
  all three apps. Default models (`ViT-B-32__openai`, `buffalo_l` with `minScore 0.7`); concurrency 2, matching Immich's
  default job concurrency; `MACHINE_LEARNING_MODEL_TTL=0` so models aren't unloaded mid-run. CPU only (the `-cuda` and
  `-openvino` image variants are out of scope for v0.1).
- **Photos:** 200 JPEGs from Wikimedia Commons "Quality images" categories (people 110, plants 24, food 20, landscapes 20,
  architecture 20, animals 6), licences restricted to CC0 / public domain / CC BY / CC BY-SA. We used Commons' own
  thumbnails at ≤1440 px, the preview size Immich sends to its ML service. Per-file credits are in `media/CREDITS.md`
  (also inside the tarball). Build script: `media/build_photos.py`.
- **Media hosting:** the clip and the photo tarball are assets on the GitHub release `media-v1`; the script verifies SHA-256 before use.
- **Resource sampling:** a streaming `docker stats --format '{{json .}}'` per test container (~1 sample/s). CPU % is Docker's
  (100% = one thread busy). Memory peak in MB.
- **Hardware detection** never reads serials, UUIDs, MAC addresses, hostnames or user names. It reads DMI vendor/product only.
  The run ID is random and not derived from the machine.
- **Cleanup:** containers and volumes are labelled `selfhostbench.run=<id>` and removed after each app and on exit or
  Ctrl-C. Images that existed before the run are never removed; new ones are removed unless the user keeps them.
- **`--yes` never auto-submits.** It skips the continue/cleanup prompts only. `selfhostbench submit FILE --yes` does submit (explicit).
- **arm64:** all three images are multi-arch and the script has no x86-only code paths, so it should work on a Raspberry Pi 5,
  but this is untested. The README says so.

## User experience (script)

- After Aaron's feedback ("nice progress as things happen, as frictionless as possible"): each app is a numbered step
  (`[1/3]`), every phase is a live status line with spinner and elapsed time, and downloads, model pulls, transcodes and photo
  batches show progress bars. Colour only on a real terminal, and `NO_COLOR` is respected; plain logs when output is piped.
- Image pulls go through the Docker Engine API on the local Unix socket (from `DOCKER_HOST` or the current `docker context`)
  so we can show byte progress. If the socket isn't usable, we fall back to `docker pull`.
- The summary adds a plain-English verdict per result (e.g. "about 26 min per 10,000 photos", "3 people streaming at once").
  The thresholds are rough rules of thumb, not measurements.
- After submitting, the script prints the result page and the device page (which has the email signup).
- The machine description is shown **before** the "Start?" prompt, so users see what will be reported up front.

## Variance seen on the build machine

- Early test runs overlapped with the agent's own background image downloads on the same 4 vCPUs, and the desktop's RTX
  3080 was shared with other Windows apps. CPU results from those runs were ~6× lower (Jellyfin CPU 10.5 vs 61.5 fps;
  Immich CLIP 3.5 vs 21.3 photos/s), and Ollama varied between ~60 and ~200 tokens/s on the GPU. Only a run on a quiet
  machine was submitted. Lesson for users: close other heavy work before running. The README and FAQ say so.

## Site

- Static HTML/CSS/JS, no framework, no cookies, no trackers. Results are fetched client-side from `/api/results`.
- Cloudflare Web Analytics (cookieless, no banner) needs a one-click enable in the Cloudflare dashboard by the account owner
  (see HANDOFF.md); the agent's Wrangler login can't toggle it.
- Contact email placeholder `TODO-AARON` on the About page (none configured), plus GitHub Issues.
