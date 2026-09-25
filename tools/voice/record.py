"""Record every Pip sentence in tools/voice/lines.json with Orpheus, into public/voice/.

    node tools/voice/lines.mjs                      # refresh the list of sentences
    tools/voice/.venv/bin/python tools/voice/record.py --voice tara

Needs llama-server running Orpheus (see orpheus.py). Safe to stop and re-run: finished clips
are skipped. Takes whose length doesn't fit the words (Orpheus sometimes mumbles or rambles)
are re-rolled with a new seed. Clips are saved as small AAC files plus a manifest the game
reads to find them.
"""

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time

import numpy as np

from orpheus import SAMPLE_RATE, synth, VOICES

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
OUT = os.path.join(ROOT, "public", "voice")
TMP = os.path.join(HERE, "out", "tmp")

# A few gasps and chuckles for flavour, kept to the moments that suit them.
PERFORMANCE = {
    "kaboom": "<gasp> Kaboom!",
    "yikes too hot": "<gasp> Yikes, too hot!",
    "whoa too low": "<gasp> Whoa, too low!",
    "wow look at those rings": "<gasp> Wow, look at those rings!",
    "oops we missed": "<chuckle> Oops, we missed!",
    "oops we tipped over": "<chuckle> Oops, we tipped over!",
    "bump": "<chuckle> Bump!",
    "saturn is so light it could float in a giant bathtub": "Saturn is so light it could float in a giant bathtub! <chuckle>",
}


def slug(key):
    s = re.sub(r"[^a-z0-9]+", "-", key).strip("-")[:48]
    return f"{s}-{hashlib.sha1(key.encode()).hexdigest()[:6]}"


def expected_seconds(text):
    words = len(re.sub(r"<[^>]+>", "", text).split())
    return 0.35 * words + 0.4


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", required=True, choices=VOICES)
    ap.add_argument("--only", help="regex: only record matching sentences")
    ap.add_argument("--redo", action="store_true", help="re-record even if a clip exists")
    ap.add_argument("--bitrate", type=int, default=40000)
    ap.add_argument("--take", type=int, default=0, help="try different takes (changes the seeds), e.g. with --redo")
    a = ap.parse_args()

    lines = json.load(open(os.path.join(HERE, "lines.json")))
    os.makedirs(os.path.join(OUT, a.voice), exist_ok=True)
    os.makedirs(TMP, exist_ok=True)
    manifest_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {}
    if manifest.get("voice") != a.voice:
        manifest = {"voice": a.voice, "lines": {}}

    todo = [l for l in lines if not a.only or re.search(a.only, l["text"], re.I)]
    t0 = time.time()
    for i, line in enumerate(todo):
        key, text = line["key"], line["text"]
        name = f"{a.voice}/{slug(key)}.m4a"
        dest = os.path.join(OUT, name)
        if os.path.exists(dest) and not a.redo:
            manifest["lines"][key] = name
            continue
        performed = PERFORMANCE.get(key, text)
        want = expected_seconds(performed)
        best = None
        for attempt in range(4):
            wav = os.path.join(TMP, "take.wav")
            try:
                secs = synth(performed, a.voice, wav, seed=1000 + attempt * 7919 + a.take * 104729)
            except Exception as e:  # garbled token stream: just try again
                print(f"  retry ({e})", file=sys.stderr)
                continue
            ok = 0.45 * want <= secs <= 2.2 * want + 1
            score = abs(np.log(secs / want))
            if best is None or score < best[0]:
                os.replace(wav, wav + ".best")
                best = (score, secs)
            if ok:
                break
        if best is None:
            print(f"FAILED: {text}", file=sys.stderr)
            continue
        subprocess.run(["afconvert", "-f", "m4af", "-d", "aac", "-b", str(a.bitrate), wav + ".best", dest], check=True)
        manifest["lines"][key] = name
        with open(manifest_path, "w") as f:
            json.dump(manifest, f, indent=1, sort_keys=True)
        done = i + 1
        eta = (time.time() - t0) / done * (len(todo) - done)
        print(f"[{done}/{len(todo)}] {best[1]:.1f}s  {text}   (eta {eta / 60:.0f} min)", flush=True)

    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    size = sum(os.path.getsize(os.path.join(OUT, n)) for n in manifest["lines"].values())
    print(f"done: {len(manifest['lines'])} clips, {size / 1e6:.1f} MB")


if __name__ == "__main__":
    main()
