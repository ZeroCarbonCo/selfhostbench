# SelfHostBench

**Will app X run well on box Y?** SelfHostBench is a small, open-source script that measures how popular
self-hosted apps actually perform on your hardware, and (only if you agree) adds the numbers to a public
results table at **https://selfhostbench.pages.dev**.

> Early project, built with AI assistance (Anthropic's Claude), directed and reviewed by a human maintainer.
> Please read the script before running it, and [open an issue](https://github.com/ZeroCarbonCo/selfhostbench/issues)
> if anything goes wrong.

## What it tests (v0.1.0)

| App | What we run | What we report |
|---|---|---|
| **Ollama** `ollama/ollama:0.40.13` | `llama3.2:3b-instruct-q4_K_M` writes 256 tokens for a fixed prompt, 3 times. Uses an NVIDIA GPU if Docker can. | Median tokens/s, from Ollama's own `eval_count / eval_duration` |
| **Jellyfin** `jellyfin/jellyfin:12.4.20261026-211555` | Its bundled `jellyfin-ffmpeg` converts a 30 s 4K HEVC clip to 1080p H.264 (8 Mbit/s): CPU (libx264 veryfast), then VA-API (`/dev/dri`) or NVIDIA NVENC if available. Then 1…8 conversions at once. | fps and speed from ffmpeg's progress report; the largest number of simultaneous streams that all stay ≥1× real time |
| **Immich ML** `ghcr.io/immich-app/immich-machine-learning:v3.3.5` | 200 photos (1440 px) through its `/predict` API, 2 at a time (Immich's defaults): CLIP `ViT-B-32__openai` and faces `buffalo_l`. CPU only. | Images per second for each |

All images are pinned by tag **and** digest. While each test runs, container CPU % and memory are sampled once
per second (`docker stats`), plus CPU package power from RAPL **only** if a normal user can read it.

**Not measured:** idle or wall power, temperatures, the full Immich/Jellyfin apps, Intel QSV specifically,
AMD GPUs for Ollama, GPU for Immich.

## Requirements

- Linux, x86_64 (arm64 such as Raspberry Pi 5 should work but is untested)
- Docker, usable by your user (or run with `sudo`)
- Python 3.8+ (standard library only, nothing to install)
- ~20 GB free disk while running (Ollama's image is large) and 10–40 minutes
- For fair numbers, pause other heavy work on the machine (transcodes, backups, games) while it runs

## Install and run

Download, read, then run. No `curl | bash`.

```bash
curl -fsSLO https://github.com/ZeroCarbonCo/selfhostbench/releases/download/v0.1.0/selfhostbench
curl -fsSLO https://github.com/ZeroCarbonCo/selfhostbench/releases/download/v0.1.0/selfhostbench.sha256
sha256sum -c selfhostbench.sha256
less selfhostbench
python3 selfhostbench
```

Options:

```text
python3 selfhostbench --apps ollama,jellyfin   # test a subset (ollama, jellyfin, immich)
python3 selfhostbench --no-submit              # keep results local only
python3 selfhostbench --no-gpu                 # CPU only
python3 selfhostbench --yes                    # skip the "continue?" prompts (never auto-submits)
python3 selfhostbench --keep-images            # keep downloaded images and media for next time
python3 selfhostbench submit ~/.selfhostbench/results/<file>.json   # submit a saved result later
```

## What happens

1. **Preflight:** checks Docker and disk space, lists the apps with download sizes and rough times, asks to continue.
2. **Hardware detection** (no typing): CPU model and cores, RAM, system vendor/model from `/sys/class/dmi/id`,
   GPU names (`lspci`, `nvidia-smi`), `/dev/dri` render nodes, OS, kernel, Docker version, and whether it is a VM/WSL.
3. **Tests** run one app at a time in temporary containers named `shb-<app>-<run id>`.
4. **Results** are printed and saved to `~/.selfhostbench/results/`.
5. **Submission:** the exact JSON is printed, then you're asked `Submit these results? [y/N]`.
6. **Cleanup:** containers and volumes are always removed. You're asked whether to keep the images and media the
   run downloaded (default: remove). Images you already had are never removed.

## Privacy

Sent only with your consent: hardware model names and counts, OS/kernel/Docker versions, benchmark numbers,
a random run ID and the start time (to the minute). **Never** sent: hostnames, user names, IP addresses, serial
numbers, MAC addresses or file paths. The server keeps a salted hash of your IP for rate limiting only.
Full details: https://selfhostbench.pages.dev/about#privacy

## Repository layout

- `bench/selfhostbench`: the script (single file, Python standard library)
- `web/`: the site (`public/`) and API (`functions/api/`, Cloudflare Pages Functions + D1; `schema.sql`)
- `media/`: how the test media was built, and per-file credits
- `DECISIONS.md`: judgement calls and their reasons

## Test media credits

- Video: 30-second excerpt of *Big Buck Bunny* © 2008 Blender Foundation | peach.blender.org,
  [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/), re-encoded to 4K HEVC.
- Photos: 200 images from Wikimedia Commons (CC0 / public domain / CC BY / CC BY-SA), each credited in
  [media/CREDITS.md](media/CREDITS.md). Redistributed under their individual licences.

Both are published as assets on the [`media-v1` release](https://github.com/ZeroCarbonCo/selfhostbench/releases/tag/media-v1)
and checked by SHA-256 before use.

## Licence

MIT for the code and site (see [LICENSE](LICENSE)). Test media keeps its own licences, listed above.
Ollama, Jellyfin, Immich and Llama 3.2 belong to their owners and are used unmodified via their official images.
