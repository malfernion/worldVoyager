// Reads messages aloud for little ones who can't read yet (browser speech synthesis).
// Browsers ship very different voices, so we rank them: modern "natural"/"neural" voices first,
// novelty and old compact voices last. Parents can also pick a voice in Settings.

// Voices that sound good for Pip, by name fragment, best first.
const FAVOURITES = [
  'Ava', 'Zoe', 'Evan', 'Allison', 'Susan', 'Nicky', 'Serena', 'Kate', // Apple premium/enhanced
  'Aria', 'Jenny', 'Ana', 'Sonia', 'Libby', 'Michelle', 'Emma', 'Guy', // Microsoft natural
  'Google US English', 'Google UK English Female', // Chrome
];

// macOS/iOS novelty voices (and the old robotic defaults).
const NOVELTY = /albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|junior|ralph|kathy|grandma|grandpa|rocko|shelley|sandy|flo|eddy|reed/i;

function score(v) {
  const name = v.name;
  let s = 0;
  if (/natural|neural|premium|enhanced|online|siri/i.test(name)) s += 100;
  const fav = FAVOURITES.findIndex((f) => name.includes(f));
  if (fav >= 0) s += 60 - fav;
  if (/google/i.test(name)) s += 40;
  if (/^en[-_](US|GB|AU|IE|NZ|CA)/i.test(v.lang)) s += 10;
  if (/samantha|daniel|karen|moira|tessa|alex/i.test(name) && !/premium|enhanced/i.test(name)) s -= 20;
  if (NOVELTY.test(name)) s -= 200;
  return s;
}

export class Narrator {
  constructor() {
    this.enabled = true;
    this.voice = null;
    this.preferred = null; // voice name chosen in Settings
    this.voices = [];
    this.synth = window.speechSynthesis || null;
    if (this.synth) {
      this.refresh();
      this.synth.addEventListener?.('voiceschanged', () => this.refresh());
    }
  }

  refresh() {
    this.voices = this.synth
      .getVoices()
      .filter((v) => v.lang && /^en/i.test(v.lang) && !NOVELTY.test(v.name))
      .sort((a, b) => score(b) - score(a));
    this.pick();
    this.onVoices?.(this.voices);
  }

  pick() {
    this.voice = this.voices.find((v) => v.name === this.preferred) || this.voices[0] || null;
  }

  setPreferred(name) {
    this.preferred = name || null;
    this.pick();
  }

  say(text, { interrupt = true } = {}) {
    if (!this.enabled || !this.synth || !text) return;
    if (interrupt) this.synth.cancel();
    const clean = text.replace(/[\p{Extended_Pictographic}️]/gu, '').replace(/\s+/g, ' ').trim();
    // One sentence at a time: sounds more natural and avoids some voices cutting off.
    const parts = clean.match(/[^.!?]+[.!?]*/g) || [clean];
    for (const part of parts) {
      const u = new SpeechSynthesisUtterance(part.trim());
      u.rate = 0.97;
      u.pitch = 1.05;
      if (this.voice) {
        u.voice = this.voice;
        u.lang = this.voice.lang;
      }
      this.synth.speak(u);
    }
  }

  stop() {
    this.synth?.cancel();
  }
}
