// 녹화한 스튜디오 화면(desktop.mkv) 위에 차량 화면(car.webm)을 합성하고, BGM과 효과음(audio.mjs)을 깔아 demo.mp4를 만든다.
// node compose.mjs [출력 파일]
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { REC } from './lib.mjs';
import { makeAudio } from './audio.mjs';

const T = JSON.parse(readFileSync(`${REC}/timing.json`, 'utf8'));
const out = process.argv[2] || `${REC}/demo.mp4`;
const sec = (ms) => Math.max(0, (ms - T.t0.desktop) / 1000).toFixed(2);
const dur = (T.end - T.t0.desktop) / 1000;
const off = ((T.t0.car - T.t0.desktop) / 1000).toFixed(3);
const { crop: c, slot: s } = T;
// 장 전환 카드가 화면을 덮는 동안에는 차량 화면을 숨긴다
const hide = T.cards.map(([a, b]) => `between(t,${sec(a)},${sec(b)})`).join('+') || '0';
const filter = [
  `[1:v]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${s.w}:${s.h}:flags=lanczos,fps=30,setpts=PTS+${off}/TB[car]`,
  `[0:v][car]overlay=${s.x}:${s.y}:eof_action=pass:enable='not(${hide})',fade=t=in:st=0:d=0.8,fade=t=out:st=${(dur - 1.4).toFixed(2)}:d=1.2,format=yuv420p[out]`,
].join(';\n');
writeFileSync(`${REC}/compose.txt`, filter);
console.log(filter);
const parts = makeAudio(T, `${REC}/audio`);
const wav = `${REC}/audio.wav`;
// 외부 BGM 파일(BGM_FILE, 예: Pixabay 음원)을 쓰면: 곡이 영상보다 짧을 때 곡이 끝나기 전 마지막 장 카드에서 처음부터 다시 시작
if (process.env.BGM_FILE) {
  const src = process.env.BGM_FILE;
  const len = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], { encoding: 'utf8' }).trim());
  const starts = T.cards.map(([a]) => (a - T.t0.desktop) / 1000).filter((x) => x > 30 && x < len - 4);
  const R = len >= dur ? null : (starts.at(-1) ?? len - 4) + 0.2;
  const ext = `${REC}/audio_bgm_ext.wav`;
  const graph = R == null
    ? `[0:a]atrim=0:${dur.toFixed(2)},asetpts=N/SR/TB,afade=t=in:st=0:d=2,afade=t=out:st=${(dur - 3.5).toFixed(2)}:d=3.5,aresample=48000[o]`
    : `[0:a]atrim=0:${(R + 3).toFixed(2)},asetpts=N/SR/TB,afade=t=out:st=${R.toFixed(2)}:d=3[a];` +
      `[1:a]atrim=0:${(dur - R).toFixed(2)},asetpts=N/SR/TB,afade=t=in:st=0:d=1.5,adelay=${Math.round(R * 1000)}|${Math.round(R * 1000)}[b];` +
      `[a][b]amix=inputs=2:normalize=0:duration=longest,atrim=0:${dur.toFixed(2)},afade=t=in:st=0:d=2,afade=t=out:st=${(dur - 3.5).toFixed(2)}:d=3.5,aresample=48000[o]`;
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', src, '-i', src, '-filter_complex', graph, '-map', '[o]', '-ac', '2', ext], { stdio: 'inherit' });
  parts.bgm = ext;
  console.log('bgm file', src, `${len.toFixed(1)}s`, R == null ? '(한 번으로 충분)' : `→ ${R.toFixed(1)}s 장 카드에서 다시 시작`);
}
// BGM은 화면을 방해하지 않게 낮게(-31 LUFS), 효과음은 또렷하게(최대 -5dB 안팎), 끝에 리미터
execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', parts.bgm, '-i', parts.sfx, '-filter_complex',
  '[0:a]loudnorm=I=-31:TP=-9:LRA=7[b];[1:a]volume=0.9[s];[b][s]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.95[a]',
  '-map', '[a]', '-ar', '48000', wav], { stdio: 'inherit' });
console.log('audio', wav, (T.sfx || []).length, 'sfx');
if (process.env.REUSE_VIDEO) {
  // 화면은 이미 합성된 영상에서 그대로 가져오고 소리만 바꾼다 (빠름)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', process.env.REUSE_VIDEO, '-i', wav,
    '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
} else {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${REC}/desktop.mkv`, '-i', `${REC}/car.webm`, '-i', wav, '-filter_complex_script', `${REC}/compose.txt`,
    '-map', '[out]', '-map', '2:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', out], { stdio: 'inherit' });
}
console.log('saved', out);
