"""Render speech with Orpheus TTS running in llama.cpp (llama-server), decoded with SNAC.

Start the server first:
    llama-server -m ~/models/orpheus/orpheus-3b-0.1-ft-Q8_0.gguf -ngl 99 -c 8192 --port 8089

Orpheus is a Llama-3B model that writes audio as special tokens: every 7 tokens are one frame
of SNAC codes (1 + 2 + 4 across three layers). We ask llama.cpp for those tokens and let the
SNAC decoder turn them into 24 kHz audio.
"""

import argparse
import json
import sys
import urllib.request
import wave
import warnings

import numpy as np

warnings.filterwarnings("ignore", category=FutureWarning)

SERVER = "http://127.0.0.1:8089"
VOICES = ["tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"]
SAMPLE_RATE = 24000

# Orpheus special tokens (Llama-3 vocab + custom tokens).
BOS = 128000
EOT = 128009
START_OF_HUMAN = 128259
END_OF_HUMAN = 128260
START_OF_AI = 128261
START_OF_SPEECH = 128257
END_OF_SPEECH = 128258
AUDIO_BASE = 128266  # <custom_token_10>

_snac = None


def snac_model():
    global _snac
    if _snac is None:
        import torch
        from snac import SNAC

        _snac = SNAC.from_pretrained("hubertsiuzdak/snac_24khz").eval()
        _snac.to("cpu")
    return _snac


# Sampling that matches the reference Orpheus code (Hugging Face generate): top-k 50, no min-p,
# repetition penalty over the whole output. llama.cpp's defaults are a bit different.
REFERENCE = {"top_k": 50, "min_p": 0.0, "repeat_last_n": 4096}
LLAMA_DEFAULTS = {"top_k": 40, "min_p": 0.05, "repeat_last_n": 64}


def generate_tokens(text, voice, temperature=0.6, top_p=0.95, repeat_penalty=1.1, seed=-1, max_tokens=3000, sampling=REFERENCE):
    prompt = [START_OF_HUMAN, BOS, f"{voice}: {text}", EOT, END_OF_HUMAN, START_OF_AI, START_OF_SPEECH]
    body = {
        "prompt": prompt,
        "n_predict": max_tokens,
        "temperature": temperature,
        "top_p": top_p,
        "repeat_penalty": repeat_penalty,
        "seed": seed,
        "return_tokens": True,
        "stop": ["<custom_token_2>"],  # end-of-speech
        "cache_prompt": False,
        **sampling,
    }
    req = urllib.request.Request(f"{SERVER}/completion", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=600) as r:
        out = json.load(r)
    return out["tokens"]


def tokens_to_audio(tokens):
    import torch

    codes = []
    for t in tokens:
        if t == END_OF_SPEECH:
            break
        if t >= AUDIO_BASE:
            codes.append(t - AUDIO_BASE)
    codes = codes[: len(codes) // 7 * 7]
    if not codes:
        raise RuntimeError("model produced no audio tokens")
    l1, l2, l3 = [], [], []
    for i in range(len(codes) // 7):
        c = codes[7 * i : 7 * i + 7]
        l1.append(c[0])
        l2.append(c[1] - 4096)
        l3.append(c[2] - 2 * 4096)
        l3.append(c[3] - 3 * 4096)
        l2.append(c[4] - 4 * 4096)
        l3.append(c[5] - 5 * 4096)
        l3.append(c[6] - 6 * 4096)
    if min(l1 + l2 + l3) < 0 or max(l1 + l2 + l3) > 4095:
        raise RuntimeError("audio tokens out of range (bad generation)")
    layers = [torch.tensor(x, dtype=torch.int32).unsqueeze(0) for x in (l1, l2, l3)]
    with torch.inference_mode():
        audio = snac_model().decode(layers)
    return audio.squeeze().cpu().numpy()


def write_wav(path, audio, rate=SAMPLE_RATE):
    pcm = np.clip(audio, -1, 1)
    pcm = (pcm * 32767).astype(np.int16)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm.tobytes())


def trim_silence(audio, threshold=0.01, pad=0.08):
    idx = np.where(np.abs(audio) > threshold)[0]
    if len(idx) == 0:
        return audio
    p = int(pad * SAMPLE_RATE)
    return audio[max(0, idx[0] - p) : min(len(audio), idx[-1] + p)]


def synth(text, voice="tara", out="out.wav", seed=-1, **kw):
    tokens = generate_tokens(text, voice, seed=seed, **kw)
    audio = trim_silence(tokens_to_audio(tokens))
    write_wav(out, audio)
    return len(audio) / SAMPLE_RATE


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("text")
    ap.add_argument("--voice", default="tara", choices=VOICES)
    ap.add_argument("--out", default="out.wav")
    ap.add_argument("--seed", type=int, default=-1)
    a = ap.parse_args()
    secs = synth(a.text, a.voice, a.out, a.seed)
    print(f"{a.out}: {secs:.1f}s", file=sys.stderr)
