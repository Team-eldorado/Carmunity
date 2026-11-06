// BGM 후보를 실제 데모 앞부분(표지 + 1장)에 입혀 보는 미리보기 영상
// node theme_preview.mjs <원본 데모 mp4> <효과음 wav> <출력 폴더> <임시 폴더> [초]
import { mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { makeBgmPreview } from './audio.mjs';

const [src, sfx, out, tmp, secArg, list] = process.argv.slice(2);
const sec = Number(secArg || 60);
const DEFAULT = { tech: '1_스마트모빌리티', garage: '2_지하공간', neighbor: '3_따뜻한이웃', keynote: '4_테크펄스', citynight: '5_도심의밤' };
// 고를 후보만: 'techSoft:1A_부드럽게,techSofter:1B_더부드럽게'
const THEMES = list ? Object.fromEntries(list.split(',').map((x) => x.split(':'))) : DEFAULT;
mkdirSync(out, { recursive: true });
mkdirSync(tmp, { recursive: true });
for (const [style, name] of Object.entries(THEMES)) {
  const wav = `${tmp}/${style}.wav`;
  makeBgmPreview(style, sec + 1, wav);
  // 영상 합성과 같은 비율: BGM -31 LUFS, 효과음은 또렷하게
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-t', String(sec), '-i', src, '-i', wav, '-t', String(sec), '-i', sfx,
    '-filter_complex', `[1:a]loudnorm=I=-31:TP=-9:LRA=7[b];[2:a]volume=0.9[s];[b][s]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95,afade=t=out:st=${sec - 2}:d=2[a]`,
    '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-t', String(sec), '-movflags', '+faststart', `${out}/미리보기${name}.mp4`]);
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', wav, '-af', 'loudnorm=I=-25:TP=-9:LRA=7', '-b:a', '192k', `${out}/음악만${name}.mp3`]);
  console.log('saved', name);
}
