// Which of Pip's sentences don't have a recording yet?
//   npm run voice:check
import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

execFileSync('node', ['tools/voice/lines.mjs'], { stdio: 'inherit' });
const lines = JSON.parse(readFileSync('tools/voice/lines.json', 'utf8'));
const manifest = existsSync('public/voice/manifest.json') ? JSON.parse(readFileSync('public/voice/manifest.json', 'utf8')) : { lines: {} };
const missing = lines.filter((l) => !manifest.lines[l.key] || !existsSync(`public/voice/${manifest.lines[l.key]}`));
if (!missing.length) {
  console.log(`All ${lines.length} sentences are recorded (voice: ${manifest.voice}).`);
} else {
  console.log(`${missing.length} of ${lines.length} sentences need recording:`);
  for (const l of missing) console.log('  ' + l.text);
  console.log(`\nRecord them with: tools/voice/.venv/bin/python tools/voice/record.py --voice ${manifest.voice || 'jess'}`);
  process.exitCode = 1;
}
