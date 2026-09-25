import { describe, it, expect } from 'vitest';
import { sentencesOf, keyOf, cleanText } from '../src/ui/speech.js';

describe('speech helpers', () => {
  it('splits messages into sentences and drops emoji', () => {
    expect(sentencesOf('🌕 Welcome to Pebble! Tap the landing button to land!')).toEqual(['Welcome to Pebble!', 'Tap the landing button to land!']);
    expect(sentencesOf('Hmm, I can\'t find a path. Let\'s try again in a moment!')).toEqual(["Hmm, I can't find a path.", "Let's try again in a moment!"]);
    expect(cleanText('Touchdown on Dusty! 🔴')).toBe('Touchdown on Dusty!');
  });

  it('matches sentences regardless of punctuation and capitals', () => {
    expect(keyOf("We're at Pebble!")).toBe(keyOf('were at pebble.'));
    expect(keyOf('Tap "Show me how" and I\'ll help you fly there.')).toBe('tap show me how and ill help you fly there');
  });
});
