"""Render the same plain lines with two sampling setups, for listening side by side."""
import sys, warnings
warnings.filterwarnings("ignore")
from orpheus import synth, REFERENCE, LLAMA_DEFAULTS

LINES = [
    "We made it to Pebble! Tap the landing button to land!",
    "Point backwards to the arrow and hold GO to slow down, or we'll zoom right past!",
    "Frosty is an icy moon like Europa, a moon of Jupiter.",
]
for voice in sys.argv[1:]:
    for tag, sampling in [("A-current", LLAMA_DEFAULTS), ("B-reference", REFERENCE)]:
        for i, text in enumerate(LINES, 1):
            out = f"out/compare_{voice}_{tag}_{i}.wav"
            import os
            if os.path.exists(out):
                continue
            secs = synth(text, voice, out, seed=42 + i, sampling=sampling)
            print(f"{out}: {secs:.1f}s", flush=True)
