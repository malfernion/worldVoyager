// How Pip's messages are broken into sentences. Shared by the narrator (to find recordings)
// and by tools/voice/lines.mjs (to know what to record), so the two always agree.

/** Speakable text: no emoji, tidy spaces. */
export function cleanText(text) {
  return text.replace(/[\p{Extended_Pictographic}️‍]/gu, '').replace(/\s+/g, ' ').trim();
}

/** Split a message into sentences (keeps the ending punctuation). */
export function sentencesOf(text) {
  const clean = cleanText(text);
  return (clean.match(/[^.!?]+[.!?]*/g) || []).map((s) => s.trim()).filter(Boolean);
}

/** Lookup key for a sentence: lowercase words only, so tiny punctuation changes still match. */
export function keyOf(sentence) {
  return sentence.toLowerCase().replace(/[^a-z0-9']+/g, ' ').replace(/'/g, '').trim();
}
