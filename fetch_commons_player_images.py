#!/usr/bin/env python3
"""
NineCat Wikimedia Commons player-image builder.

Reads a top-player CSV, resolves each player through Wikidata, obtains the P18
Commons image, checks the image's license metadata, downloads a 512px thumbnail,
and generates:
  images/players/*
  player-images.json
  player-images.js
  photo-credits.html
  commons-image-report.csv

This intentionally skips uncertain/non-whitelisted files rather than guessing.
"""

from __future__ import annotations

import argparse
import csv
import html
import json
import mimetypes
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

import requests

WIKIDATA_API = "https://www.wikidata.org/w/api.php"
COMMONS_API = "https://commons.wikimedia.org/w/api.php"

HEADERS = {
    "User-Agent": "NineCatImageBuilder/1.0 (fantasy basketball project; Wikimedia Commons attribution tool)"
}

# Conservative whitelist: licenses that clearly permit reuse, including commercial reuse.
# The script still preserves the actual license + attribution in the generated credits.
ALLOWED_PREFIXES = (
    "CC BY ",
    "CC BY-SA ",
)
ALLOWED_EXACT = {
    "CC0",
    "CC0 1.0",
    "Public domain",
    "Public Domain",
}

BASKETBALL_WORDS = (
    "basketball player",
    "basketballspieler",
    "basketballer",
    "basketball",
    "nba player",
)

def strip_html(value: str) -> str:
    value = html.unescape(value or "")
    value = re.sub(r"<br\s*/?>", " ", value, flags=re.I)
    value = re.sub(r"<[^>]+>", "", value)
    return re.sub(r"\s+", " ", value).strip()

def norm(s: str) -> str:
    s = unicodedata.normalize("NFKD", s)
    s = "".join(ch for ch in s if not unicodedata.combining(ch))
    s = s.lower().replace("’", "'")
    s = re.sub(r"[^a-z0-9]+", " ", s)
    return " ".join(s.split())

def slugify(s: str) -> str:
    s = norm(s).replace(" ", "-")
    return s.strip("-") or "player"

def get_json(session: requests.Session, url: str, params: dict, retries: int = 4) -> dict:
    last = None
    for attempt in range(retries):
        try:
            r = session.get(url, params=params, timeout=30)
            if r.status_code == 429:
                time.sleep(2 ** (attempt + 1))
                continue
            r.raise_for_status()
            return r.json()
        except Exception as e:
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f"Request failed after {retries} tries: {url} {params}") from last

def search_wikidata(session: requests.Session, player: str):
    data = get_json(session, WIKIDATA_API, {
        "action": "wbsearchentities",
        "search": player,
        "language": "en",
        "uselang": "en",
        "type": "item",
        "limit": 10,
        "format": "json",
    })
    results = data.get("search", [])
    if not results:
        return None, "no_wikidata_match"

    target = norm(player)
    scored = []
    for r in results:
        label = r.get("label", "")
        desc = (r.get("description") or "").lower()
        score = 0
        if norm(label) == target:
            score += 8
        elif target in norm(label) or norm(label) in target:
            score += 3
        if any(word in desc for word in BASKETBALL_WORDS):
            score += 10
        # Avoid blindly selecting a namesake from an unrelated field.
        scored.append((score, r))

    scored.sort(key=lambda x: x[0], reverse=True)
    score, best = scored[0]
    desc = (best.get("description") or "").lower()
    if score < 10 or not any(word in desc for word in BASKETBALL_WORDS):
        return None, f"uncertain_wikidata_match:{best.get('label','')} — {best.get('description','')}"
    return best, ""

def get_p18(session: requests.Session, qid: str):
    data = get_json(session, WIKIDATA_API, {
        "action": "wbgetentities",
        "ids": qid,
        "props": "claims",
        "format": "json",
    })
    ent = data.get("entities", {}).get(qid, {})
    claims = ent.get("claims", {}).get("P18", [])
    if not claims:
        return None
    try:
        return claims[0]["mainsnak"]["datavalue"]["value"]
    except Exception:
        return None

def commons_info(session: requests.Session, filename: str):
    title = filename if filename.startswith("File:") else "File:" + filename
    data = get_json(session, COMMONS_API, {
        "action": "query",
        "titles": title,
        "prop": "imageinfo",
        "iiprop": "url|mime|extmetadata",
        "iiurlwidth": 512,
        "iiextmetadatafilter": (
            "Artist|Credit|LicenseShortName|LicenseUrl|UsageTerms|"
            "AttributionRequired|ImageDescription|DateTimeOriginal"
        ),
        "format": "json",
        "formatversion": "2",
    })
    pages = data.get("query", {}).get("pages", [])
    if not pages or not pages[0].get("imageinfo"):
        return None
    ii = pages[0]["imageinfo"][0]
    meta = {
        k: (v.get("value", "") if isinstance(v, dict) else v)
        for k, v in ii.get("extmetadata", {}).items()
    }
    return {
        "title": pages[0].get("title", title),
        "url": ii.get("url"),
        "thumburl": ii.get("thumburl") or ii.get("url"),
        "mime": ii.get("mime", ""),
        "artist": strip_html(meta.get("Artist", "")),
        "credit": strip_html(meta.get("Credit", "")),
        "license": strip_html(meta.get("LicenseShortName", "") or meta.get("UsageTerms", "")),
        "license_url": strip_html(meta.get("LicenseUrl", "")),
        "description": strip_html(meta.get("ImageDescription", "")),
        "date": strip_html(meta.get("DateTimeOriginal", "")),
    }

def license_allowed(name: str) -> bool:
    name = (name or "").strip()
    if name in ALLOWED_EXACT:
        return True
    if any(name.startswith(p) for p in ALLOWED_PREFIXES):
        return True
    # Commons sometimes reports variants such as "Public domain mark".
    if "public domain" in name.lower():
        return True
    return False

def extension_for(mime: str, url: str) -> str:
    mapping = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
    }
    if mime in mapping:
        return mapping[mime]
    suffix = Path(url.split("?")[0]).suffix.lower()
    if suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
        return ".jpg" if suffix == ".jpeg" else suffix
    return ".jpg"

def download(session: requests.Session, url: str, dest: Path):
    r = session.get(url, headers=HEADERS, timeout=45)
    r.raise_for_status()
    dest.write_bytes(r.content)

def read_players(path: Path, limit: int):
    if path.suffix.lower() == ".csv":
        with path.open(newline="", encoding="utf-8-sig") as f:
            rows = list(csv.DictReader(f))
        out = []
        for row in rows:
            player = row.get("player") or row.get("PLAYER") or row.get("name") or row.get("Name")
            if not player:
                continue
            rank_raw = row.get("rank") or row.get("R#") or ""
            try:
                rank = int(rank_raw)
            except Exception:
                rank = len(out) + 1
            out.append({
                "rank": rank,
                "player": player.strip(),
                "pos": (row.get("pos") or row.get("POS") or "").strip(),
                "team": (row.get("team") or row.get("TEAM") or "").strip(),
            })
            if len(out) >= limit:
                break
        return out

    # Also accepts the tab-separated Hashtag-style export.
    out = []
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        cols = line.split("\t")
        if not cols or cols[0] == "R#" or not cols[0].isdigit():
            continue
        rank = int(cols[0])
        if rank > limit:
            continue
        out.append({
            "rank": rank,
            "player": cols[1].strip(),
            "pos": cols[3].strip() if len(cols) > 3 else "",
            "team": cols[4].strip() if len(cols) > 4 else "",
        })
    return out

def make_credits(entries, dest: Path):
    lines = [
        "<!doctype html>",
        '<html lang="en"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        "<title>NineCat — Photo Credits</title>",
        "<style>",
        "body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 20px;line-height:1.5}",
        "table{width:100%;border-collapse:collapse}td,th{padding:10px;border-bottom:1px solid #ddd;text-align:left;vertical-align:top}",
        "small{color:#666} a{word-break:break-word}",
        "</style></head><body>",
        "<h1>Player photo credits</h1>",
        "<p>Player images are sourced from Wikimedia Commons and used under the license shown for each file.</p>",
        "<table><thead><tr><th>Player</th><th>Creator / credit</th><th>License</th><th>Source</th></tr></thead><tbody>",
    ]
    for e in entries:
        artist = html.escape(e.get("artist") or e.get("credit") or "See source page")
        lic = html.escape(e.get("license") or "See source page")
        lic_url = e.get("license_url") or e.get("source_page")
        source = e.get("source_page")
        lines.append(
            "<tr>"
            f"<td>{html.escape(e['player'])}</td>"
            f"<td>{artist}</td>"
            f'<td><a href="{html.escape(lic_url, quote=True)}">{lic}</a></td>'
            f'<td><a href="{html.escape(source, quote=True)}">Wikimedia Commons</a></td>'
            "</tr>"
        )
    lines += ["</tbody></table>", "<p><small>Generated by NineCat's Commons image builder.</small></p>", "</body></html>"]
    dest.write_text("\n".join(lines), encoding="utf-8")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", default="players_top200.csv")
    ap.add_argument("--limit", type=int, default=200)
    ap.add_argument("--output", default="images/players")
    ap.add_argument("--delay", type=float, default=0.20, help="Pause between players")
    args = ap.parse_args()

    input_path = Path(args.input)
    players = read_players(input_path, args.limit)
    if not players:
        raise SystemExit(f"No players found in {input_path}")

    image_dir = Path(args.output)
    image_dir.mkdir(parents=True, exist_ok=True)

    session = requests.Session()
    session.headers.update(HEADERS)

    manifest = {}
    credits = []
    report = []

    for idx, row in enumerate(players, start=1):
        player = row["player"]
        print(f"[{idx}/{len(players)}] {player}", flush=True)
        item = {
            "rank": row["rank"],
            "player": player,
            "team": row.get("team", ""),
            "pos": row.get("pos", ""),
        }

        try:
            hit, reason = search_wikidata(session, player)
            if not hit:
                item.update(status="manual_review", reason=reason)
                report.append(item)
                print(f"  -> REVIEW: {reason}")
                time.sleep(args.delay)
                continue

            qid = hit["id"]
            filename = get_p18(session, qid)
            if not filename:
                item.update(
                    status="manual_review",
                    qid=qid,
                    wikidata_label=hit.get("label", ""),
                    reason="no_P18_image",
                )
                report.append(item)
                print("  -> REVIEW: no P18 image")
                time.sleep(args.delay)
                continue

            info = commons_info(session, filename)
            if not info:
                item.update(status="manual_review", qid=qid, reason="commons_metadata_failed")
                report.append(item)
                print("  -> REVIEW: Commons metadata failed")
                time.sleep(args.delay)
                continue

            source_page = "https://commons.wikimedia.org/wiki/" + quote(info["title"].replace(" ", "_"), safe=":_()/,-.'")
            if not license_allowed(info["license"]):
                item.update(
                    status="manual_review",
                    qid=qid,
                    commons_file=info["title"],
                    license=info["license"],
                    source_page=source_page,
                    reason="license_not_whitelisted",
                )
                report.append(item)
                print(f"  -> REVIEW: license {info['license']!r}")
                time.sleep(args.delay)
                continue

            ext = extension_for(info["mime"], info["thumburl"])
            local_name = slugify(player) + ext
            dest = image_dir / local_name
            download(session, info["thumburl"], dest)

            public_path = "/" + str(dest).replace("\\", "/")
            entry = {
                **item,
                "status": "downloaded",
                "qid": qid,
                "wikidata_label": hit.get("label", ""),
                "commons_file": info["title"],
                "local_file": public_path,
                "source_page": source_page,
                "artist": info["artist"],
                "credit": info["credit"],
                "license": info["license"],
                "license_url": info["license_url"],
                "description": info["description"],
            }
            report.append(entry)
            credits.append(entry)
            manifest[player] = public_path
            print(f"  -> OK {info['license']} -> {dest}")

        except Exception as e:
            item.update(status="error", reason=str(e))
            report.append(item)
            print(f"  -> ERROR: {e}")

        time.sleep(args.delay)

    Path("player-images.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    Path("player-images.js").write_text(
        "window.PLAYER_IMAGES = " + json.dumps(manifest, ensure_ascii=False, indent=2) + ";\n",
        encoding="utf-8",
    )
    make_credits(credits, Path("photo-credits.html"))

    fields = [
        "rank", "player", "team", "pos", "status", "reason", "qid",
        "wikidata_label", "commons_file", "local_file", "source_page",
        "artist", "credit", "license", "license_url", "description",
    ]
    with Path("commons-image-report.csv").open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        w.writeheader()
        w.writerows(report)

    ok = sum(1 for r in report if r.get("status") == "downloaded")
    review = sum(1 for r in report if r.get("status") == "manual_review")
    errors = sum(1 for r in report if r.get("status") == "error")
    print(f"\nDone: {ok} downloaded, {review} need manual review, {errors} errors.")
    print("Generated player-images.js, player-images.json, photo-credits.html, commons-image-report.csv")

if __name__ == "__main__":
    main()
