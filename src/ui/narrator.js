// Reads messages aloud for little ones who can't read yet (browser speech synthesis).
export class Narrator {
  constructor() {
    this.enabled = true;
    this.voice = null;
    this.synth = window.speechSynthesis || null;
    if (this.synth) {
      const pick = () => {
        const voices = this.synth.getVoices().filter((v) => v.lang && v.lang.startsWith('en'));
        const nice = ['Samantha', 'Google US English', 'Karen', 'Moira', 'Tessa', 'Daniel', 'Google UK English Female'];
        this.voice = nice.map((n) => voices.find((v) => v.name.includes(n))).find(Boolean) || voices[0] || null;
      };
      pick();
      this.synth.addEventListener?.('voiceschanged', pick);
    }
  }

  say(text, { interrupt = true } = {}) {
    if (!this.enabled || !this.synth || !text) return;
    if (interrupt) this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/[\p{Extended_Pictographic}️]/gu, ''));
    u.rate = 0.95;
    u.pitch = 1.2;
    if (this.voice) u.voice = this.voice;
    this.synth.speak(u);
  }

  stop() {
    this.synth?.cancel();
  }
}
