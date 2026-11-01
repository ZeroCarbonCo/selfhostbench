#!/usr/bin/env python3
"""Build the SelfHostBench photo set from Wikimedia Commons.

Fetches openly licensed (CC0 / public domain / CC BY / CC BY-SA) images from
Commons "Quality images" categories, downloads Commons' own 1440 px thumbnails
(the size Immich sends to its ML service), and writes CREDITS.md with author,
licence and source for every file. Run once by the maintainer; users download
the resulting tarball and verify its SHA-256.

Usage: python3 build_photos.py OUT_DIR
"""
import html
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

API = "https://commons.wikimedia.org/w/api.php"
UA = "SelfHostBench-media-builder/0.1 (https://github.com/ZeroCarbonCo/selfhostbench)"
# (category, how many). People first so face detection has real work to do.
PLAN = [
    ("Category:Quality images of people", 110),
    ("Category:Quality images of animals", 30),
    ("Category:Quality images of food", 20),
    ("Category:Quality images of landscapes", 20),
    ("Category:Quality images of architecture", 20),
    ("Category:Quality images of plants", 24),
]
OK_LICENCE = re.compile(r"^(CC0|Public domain|PD|CC BY(-SA)? \d\.\d)", re.I)


def get(params):
    params = dict(params, format="json", formatversion="2")
    req = urllib.request.Request(API + "?" + urllib.parse.urlencode(params), headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def strip(s):
    return html.unescape(re.sub(r"<[^>]+>", "", s or "")).strip()


def collect(category, want):
    picked, cont = [], {}
    while len(picked) < want:
        data = get({
            "action": "query", "generator": "categorymembers", "gcmtitle": category,
            "gcmtype": "file", "gcmlimit": "50", "prop": "imageinfo",
            "iiprop": "url|extmetadata|mime", "iiurlwidth": "1440", "iiurlheight": "1440", **cont,
        })
        for page in data.get("query", {}).get("pages", []):
            info = (page.get("imageinfo") or [{}])[0]
            meta = info.get("extmetadata", {})
            lic = strip(meta.get("LicenseShortName", {}).get("value"))
            if info.get("mime") != "image/jpeg" or not OK_LICENCE.match(lic) or "thumburl" not in info:
                continue
            picked.append({
                "title": page["title"], "thumb": info["thumburl"], "source": info["descriptionurl"],
                "author": strip(meta.get("Artist", {}).get("value")) or "unknown",
                "licence": lic, "licence_url": strip(meta.get("LicenseUrl", {}).get("value")),
            })
            if len(picked) >= want:
                break
        if "continue" not in data:
            break
        cont = data["continue"]
    return picked


def main():
    out = Path(sys.argv[1])
    (out / "photos").mkdir(parents=True, exist_ok=True)
    items = []
    for cat, n in PLAN:
        got = collect(cat, n)
        print(f"{cat}: {len(got)}", file=sys.stderr)
        items += got
    lines = ["# SelfHostBench photo set — credits", "",
             "All images from Wikimedia Commons, resized by Commons to fit 1440x1440.",
             "Each file keeps its original licence, listed below. The set as a whole is",
             "redistributed under those individual licences (CC BY-SA items stay CC BY-SA).", ""]
    for i, it in enumerate(items, 1):
        name = f"{i:03d}.jpg"
        for attempt in range(4):
            try:
                req = urllib.request.Request(it["thumb"], headers={"User-Agent": UA})
                with urllib.request.urlopen(req, timeout=60) as r:
                    (out / "photos" / name).write_bytes(r.read())
                break
            except Exception as e:  # Commons rate-limits thumbnail bursts
                print(f"retry {name}: {e}", file=sys.stderr)
                time.sleep(5 * (attempt + 1))
        else:
            sys.exit(f"failed to download {it['thumb']}")
        time.sleep(0.3)
        lines.append(f"- `{name}` — {it['title'][5:]} — by {it['author']} — {it['licence']}"
                     f" ({it['licence_url'] or 'see source'}) — {it['source']}")
    (out / "CREDITS.md").write_text("\n".join(lines) + "\n")
    print(f"wrote {len(items)} photos", file=sys.stderr)


if __name__ == "__main__":
    main()
