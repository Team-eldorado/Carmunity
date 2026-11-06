// BGM 후보 미리 듣기 mp3 만들기: node bgm_preview.mjs <mp3 출력 폴더> <임시 wav 폴더> [초]
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeBgmPreview } from './audio.mjs';

const out = process.argv[2] || 'bgm_preview';
const tmp = process.argv[3] || out;
const dur = Number(process.argv[4] || 45);
const NAMES = { fresh: '1_맑은아침', warm: '2_따뜻한오후', piano: '3_펠트피아노', pulse: '4_가벼운걸음', drift: '5_물결' };
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });
for (const [style, name] of Object.entries(NAMES)) {
  const wav = `${tmp}/${style}.wav`;
  makeBgmPreview(style, dur, wav);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', 'loudnorm=I=-18:TP=-2:LRA=7', '-ar', '48000', '-b:a', '192k', `${out}/BGM후보${name}.mp3`]);
  console.log('saved', name);
}
