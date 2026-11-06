// 데모 영상 오디오: 직접 합성한 잔잔한 BGM + 장면 효과음 (저작권 걱정 없는 합성음)
// node audio.mjs [timing.json] [out.wav]  — compose.mjs가 자동으로 부른다
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SR = 48000;
const TAU = Math.PI * 2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);

// ---------------- 작은 합성 도구 ----------------
function onePoleLP(buf, cutoff) {
  const a = Math.exp((-TAU * cutoff) / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y = (1 - a) * buf[i] + a * y; buf[i] = y; }
}
function onePoleHP(buf, cutoff) {
  const a = Math.exp((-TAU * cutoff) / SR);
  let y = 0, px = 0;
  for (let i = 0; i < buf.length; i++) { y = a * (y + buf[i] - px); px = buf[i]; buf[i] = y; }
}
let seed = 12345;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296 * 2 - 1; };

/** 음 하나를 스테레오 버퍼에 더한다 */
function addTone(L, R, t0, dur, f, { gain = 0.2, attack = 0.005, decay = 0.3, harm = [1], pan = 0, wave = 'sine', release = 0.05 } = {}) {
  const i0 = Math.floor(t0 * SR);
  const n = Math.floor((dur + release) * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    if (i < 0 || i >= L.length) continue;
    const t = k / SR;
    let env = t < attack ? t / attack : Math.exp(-(t - attack) / decay);
    if (t > dur) env *= Math.max(0, 1 - (t - dur) / release);
    let v = 0;
    for (let h = 0; h < harm.length; h++) {
      const ph = TAU * f * (h + 1) * t;
      v += harm[h] * (wave === 'tri' ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph));
    }
    L[i] += v * env * gl;
    R[i] += v * env * gr;
  }
}
function addNoise(L, R, t0, dur, { gain = 0.1, decay = 0.03, hp = 6000, lp = 16000, pan = 0 } = {}) {
  const n = Math.floor(dur * SR);
  const b = new Float32Array(n);
  for (let k = 0; k < n; k++) b[k] = rnd() * Math.exp(-k / SR / decay);
  onePoleHP(b, hp); onePoleLP(b, lp);
  const i0 = Math.floor(t0 * SR);
  const gl = gain * Math.cos(((pan + 1) * Math.PI) / 4), gr = gain * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let k = 0; k < n; k++) { const i = i0 + k; if (i >= 0 && i < L.length) { L[i] += b[k] * gl; R[i] += b[k] * gr; } }
}

// ---------------- BGM 후보 5가지 (모두 드럼·베이스 없이 잔잔하게) ----------------
const pan2 = (pan) => [Math.cos(((pan + 1) * Math.PI) / 4), Math.sin(((pan + 1) * Math.PI) / 4)];
const fadeIO = (L, R, dur, inS = 4, outS = 4) => {
  for (let i = 0; i < L.length; i++) {
    const t = i / SR;
    const g = Math.min(1, t / inS) * Math.min(1, Math.max(0, (dur - t) / outS));
    L[i] *= g; R[i] *= g;
  }
};
/** 화음 패드: span초마다 다음 화음, 앞뒤로 부드럽게 겹침 */
function padChords(L, R, dur, chords, span, { gain = 0.016, harm = [1, 0.25, 0.06], fade = 2, det = 0.07 } = {}) {
  for (let k = 0; k * span < dur + span; k++) {
    const ch = chords[k % chords.length];
    const t0 = k * span - fade * 0.75;
    const n = Math.floor((span + fade * 1.75) * SR);
    for (const note of ch) {
      for (const [d, pan] of [[-det, -0.55], [det, 0.55]]) {
        const f = midi(note + d);
        const [gl, gr] = pan2(pan);
        const i0 = Math.floor(t0 * SR);
        for (let j = 0; j < n; j++) {
          const i = i0 + j;
          if (i < 0 || i >= L.length) continue;
          const t = j / SR;
          const env = t < fade ? Math.sin((Math.PI / 2) * (t / fade)) ** 2 : t > span + fade * 0.75 ? Math.max(0, Math.cos((Math.PI / 2) * ((t - span - fade * 0.75) / fade))) ** 2 : 1;
          let v = 0;
          for (let h = 0; h < harm.length; h++) v += harm[h] * Math.sin(TAU * f * (h + 1) * t);
          v *= env * gain;
          L[i] += v * gl; R[i] += v * gr;
        }
      }
    }
  }
}
function echoNote(L, R, t, note, gain, pan, decay = 0.9, harm = [1, 0.12]) {
  for (const [d, g] of [[0, 1], [0.36, 0.38], [0.72, 0.16]]) {
    addTone(L, R, t + d, 1.6, midi(note), { gain: gain * g, attack: 0.012, decay, harm, pan: d ? -pan : pan, release: 0.4 });
  }
}

const BGM = {
  /** 1. 맑은 아침: 밝은 장조 화음 + 띄엄띄엄 반짝이는 고음 */
  fresh(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    padChords(L, R, dur, [[72, 76, 79, 84], [71, 74, 79, 83], [69, 72, 76, 79], [69, 72, 77, 81]], 5.5);
    const sp = [84, 86, 88, 91, 93, 96];
    for (let t = 2.5; t < dur - 3; t += 1.5 + ((rnd() + 1) / 2) * 1.5) echoNote(L, R, t, sp[Math.floor(((rnd() + 1) / 2) * sp.length) % sp.length], 0.022, rnd() * 0.7);
    onePoleHP(L, 180); onePoleHP(R, 180);
    fadeIO(L, R, dur);
    return [L, R];
  },
  /** 2. 따뜻한 오후: 포근한 화음만 천천히 (가장 조용함) */
  warm(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    padChords(L, R, dur, [[65, 69, 72, 76, 79], [64, 67, 71, 74], [62, 65, 69, 72, 76], [58, 62, 65, 69]], 8, { gain: 0.016, harm: [1, 0.15], fade: 3.5, det: 0.05 });
    onePoleLP(L, 2400); onePoleLP(R, 2400); onePoleHP(L, 160); onePoleHP(R, 160);
    for (let i = 0; i < N; i++) { const b = 0.82 + 0.18 * Math.sin((TAU * i) / SR / 12); L[i] *= b; R[i] *= b; }
    fadeIO(L, R, dur, 5, 5);
    return [L, R];
  },
  /** 3. 펠트 피아노: 먹먹한 피아노 음이 천천히 한 음씩 + 아주 옅은 패드 */
  piano(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    const beat = 60 / 66; // 느린 템포
    const prog = [[60, 64, 67, 71, 74], [57, 60, 64, 67, 72], [53, 57, 60, 64, 69], [55, 59, 62, 67, 71]];
    const pattern = [0, 2, 4, 3, 1, 3, 2, -1]; // -1 쉼표
    for (let bar = 0; bar * 4 * beat < dur; bar++) {
      const ch = prog[Math.floor(bar / 2) % 4];
      const t0 = bar * 4 * beat;
      if (bar % 2 === 0) addTone(L, R, t0, 3.5, midi(ch[0] - 12), { gain: 0.03, attack: 0.008, decay: 1.6, harm: [1, 0.35, 0.12], pan: -0.1 });
      pattern.forEach((p, k) => {
        if (p < 0 || (bar % 2 === 1 && k > 5)) return;
        addTone(L, R, t0 + k * (beat / 2), 2.2, midi(ch[p] + 12), { gain: 0.03 * (k % 2 ? 0.8 : 1), attack: 0.006, decay: 1.3, harm: [1, 0.4, 0.15, 0.06], pan: -0.3 + 0.15 * p });
      });
    }
    onePoleLP(L, 2600); onePoleLP(R, 2600);
    const P = new Float32Array(N), PR = new Float32Array(N);
    padChords(P, PR, dur, prog.map((c) => c.slice(0, 3)), 8 * beat, { gain: 0.007, harm: [1, 0.1], fade: 2.5 });
    for (let i = 0; i < N; i++) { L[i] += P[i]; R[i] += PR[i]; }
    onePoleHP(L, 120); onePoleHP(R, 120);
    fadeIO(L, R, dur);
    return [L, R];
  },
  /** 4. 가벼운 걸음: 밝은 패드 + 아주 작은 톡톡 박자 + 부드러운 플럭 */
  pulse(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    const beat = 60 / 92;
    const chords = [[67, 71, 74, 79], [64, 67, 71, 76], [65, 69, 72, 77], [62, 67, 69, 74]];
    padChords(L, R, dur, chords, 8 * beat, { gain: 0.011, fade: 1.5 });
    for (let b = 0; b * beat < dur; b++) {
      const t = b * beat;
      const ch = chords[Math.floor(b / 8) % 4];
      if (b >= 8) addNoise(L, R, t + beat / 2, 0.05, { gain: 0.014, decay: 0.014, hp: 6000, pan: 0.3 }); // 톡톡 (엇박)
      if (b >= 4 && b % 2 === 0) addTone(L, R, t, 0.5, midi(ch[(b / 2) % 4] + 12), { gain: 0.02, attack: 0.004, decay: 0.32, harm: [1, 0.3, 0.1], pan: (b % 4 ? 0.35 : -0.35) });
    }
    onePoleHP(L, 200); onePoleHP(R, 200);
    fadeIO(L, R, dur);
    return [L, R];
  },
  /** 5. 물결: 넓게 퍼지는 화음이 파도처럼 천천히 밀려왔다 빠짐 */
  drift(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    padChords(L, R, dur, [[62, 69, 74, 78], [64, 69, 71, 76], [62, 66, 69, 74], [59, 66, 71, 74]], 10, { gain: 0.018, harm: [1, 0.2, 0.05], fade: 4, det: 0.1 });
    // 천천히 열렸다 닫히는 필터 + 파도 같은 음량 흐름
    let yl = 0, yr = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const wave = 0.5 + 0.5 * Math.sin((TAU * t) / 16 - Math.PI / 2);
      const cutoff = 700 + 2300 * wave;
      const a = Math.exp((-TAU * cutoff) / SR);
      yl = (1 - a) * L[i] + a * yl; yr = (1 - a) * R[i] + a * yr;
      const g = 0.6 + 0.4 * wave;
      L[i] = yl * g; R[i] = yr * g;
    }
    const sp = [86, 90, 93, 98];
    for (let t = 6; t < dur - 4; t += 7 + ((rnd() + 1) / 2) * 4) echoNote(L, R, t, sp[Math.floor(((rnd() + 1) / 2) * sp.length) % sp.length], 0.012, rnd() * 0.8, 1.4);
    onePoleHP(L, 150); onePoleHP(R, 150);
    fadeIO(L, R, dur, 5, 5);
    return [L, R];
  },
};

// ---------------- 테마 후보 (지하주차장 · 모빌리티 앱 데모용) ----------------
/** 간단한 리버브 (콤 4 + 올패스 2) */
function reverb(L, R, { mix = 0.25, fb = 0.78, damp = 0.35 } = {}) {
  const N = L.length;
  const mono = new Float32Array(N);
  for (let i = 0; i < N; i++) mono[i] = (L[i] + R[i]) * 0.5;
  const combs = [1557, 1617, 1491, 1422, 1277, 1356].map((d) => Math.round(d * SR / 44100));
  const wetL = new Float32Array(N), wetR = new Float32Array(N);
  combs.forEach((d, ci) => {
    const buf = new Float32Array(d);
    let idx = 0, lp = 0;
    for (let i = 0; i < N; i++) {
      const y = buf[idx];
      lp = y * (1 - damp) + lp * damp;
      buf[idx] = mono[i] + lp * fb;
      idx = (idx + 1) % d;
      if (ci % 2) wetL[i] += y; else wetR[i] += y;
    }
  });
  for (const [w, d0] of [[wetL, 225], [wetR, 341]]) {
    for (const d of [d0, 556]) {
      const dd = Math.round(d * SR / 44100), buf = new Float32Array(dd);
      let idx = 0;
      for (let i = 0; i < N; i++) { const b = buf[idx]; const y = -w[i] + b; buf[idx] = w[i] + b * 0.5; w[i] = y; idx = (idx + 1) % dd; }
    }
  }
  for (let i = 0; i < N; i++) { L[i] = L[i] * (1 - mix) + wetL[i] * mix * 0.25; R[i] = R[i] * (1 - mix) + wetR[i] * mix * 0.25; }
}
/** 기타처럼 뜯는 소리 (Karplus-Strong) */
function pluck(L, R, t0, note, { gain = 0.1, pan = 0, decay = 0.996, len = 1.8, bright = 0.5 } = {}) {
  const f = midi(note), p = Math.max(2, Math.round(SR / f));
  const buf = new Float32Array(p);
  for (let k = 0; k < p; k++) buf[k] = rnd() * (0.5 + bright * 0.5);
  const [gl, gr] = pan2(pan), i0 = Math.floor(t0 * SR), n = Math.floor(len * SR);
  let idx = 0, prev = 0;
  for (let k = 0; k < n; k++) {
    const i = i0 + k;
    const y = buf[idx];
    const nx = decay * 0.5 * (y + prev);
    prev = y; buf[idx] = nx; idx = (idx + 1) % p;
    if (i >= 0 && i < L.length) { const env = Math.min(1, k / 40); L[i] += y * gain * gl * env; R[i] += y * gain * gr * env; }
  }
}
function softKick(L, R, t, gain = 0.06) {
  const i0 = Math.floor(t * SR);
  for (let k = 0; k < SR * 0.25; k++) {
    const i = i0 + k; if (i >= L.length) break;
    const tt = k / SR, f = 70 + 90 * Math.exp(-tt / 0.035);
    const v = Math.sin(TAU * f * tt) * Math.exp(-tt / 0.09) * gain;
    L[i] += v; R[i] += v;
  }
}

Object.assign(BGM, {
  /** 1. 스마트 모빌리티: 밝은 전자음 아르페지오 + 가벼운 박자 (100 BPM) */
  tech(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    const beat = 0.6;
    const chords = [[64, 68, 71, 75], [61, 64, 68, 71], [57, 61, 64, 68], [59, 63, 66, 71]];
    padChords(L, R, dur, chords, 8 * beat, { gain: 0.009, fade: 1.2 });
    const arp = [0, 1, 2, 3, 2, 1, 2, 3];
    for (let s = 0; s * beat / 4 < dur; s++) {
      const t = s * beat / 4, bar = Math.floor(s / 32), ch = chords[bar % 4];
      if (s >= 16 && s % 2 === 0) addTone(L, R, t, 0.18, midi(ch[arp[(s / 2) % 8]] + 12), { gain: 0.022, attack: 0.003, decay: 0.12, harm: [1, 0.5, 0.25, 0.12], pan: (s / 2) % 2 ? 0.4 : -0.4 });
      if (s >= 64) {
        if (s % 8 === 0) softKick(L, R, t, 0.05);
        if (s % 8 === 4) addNoise(L, R, t, 0.12, { gain: 0.03, decay: 0.05, hp: 1500, lp: 7000 });
        if (s % 2 === 1) addNoise(L, R, t, 0.04, { gain: 0.012, decay: 0.012, hp: 8000, pan: 0.3 });
      }
    }
    reverb(L, R, { mix: 0.22 });
    onePoleHP(L, 90); onePoleHP(R, 90);
    fadeIO(L, R, dur, 3, 4);
    return [L, R];
  },
  /** 2. 지하 공간: 넓은 울림 + 멀리서 울리는 레이더 핑 + 물방울 */
  garage(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    padChords(L, R, dur, [[57, 64, 69, 72], [55, 62, 67, 71], [53, 60, 65, 69], [55, 62, 64, 71]], 9, { gain: 0.014, harm: [1, 0.2], fade: 3.5, det: 0.08 });
    for (let t = 3; t < dur - 3; t += 4.5 + ((rnd() + 1) / 2) * 2) {
      addTone(L, R, t, 0.9, 1318.5, { gain: 0.03, attack: 0.004, decay: 0.45, harm: [1], pan: rnd() * 0.6 });
      addTone(L, R, t + 0.5, 0.9, 1318.5, { gain: 0.012, attack: 0.004, decay: 0.45, harm: [1], pan: rnd() * 0.6 });
    }
    for (let t = 1.5; t < dur - 2; t += 1.8 + ((rnd() + 1) / 2) * 3) {
      const i0 = Math.floor(t * SR), f0 = 1800 + 900 * ((rnd() + 1) / 2), [gl, gr] = pan2(rnd() * 0.8);
      for (let k = 0; k < SR * 0.12; k++) {
        const i = i0 + k; if (i >= N) break;
        const tt = k / SR, f = f0 * (1 - 0.35 * tt / 0.12);
        const v = Math.sin(TAU * f * tt) * Math.exp(-tt / 0.03) * 0.018;
        L[i] += v * gl; R[i] += v * gr;
      }
    }
    reverb(L, R, { mix: 0.55, fb: 0.84, damp: 0.25 });
    onePoleHP(L, 140); onePoleHP(R, 140);
    fadeIO(L, R, dur, 4, 4);
    return [L, R];
  },
  /** 3. 따뜻한 이웃: 기타처럼 뜯는 소리, 친근한 진행 (G - D - Em - C) */
  neighbor(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    const beat = 60 / 96;
    const chords = [[55, 59, 62, 67, 71], [50, 57, 62, 66, 69], [52, 59, 64, 67, 71], [48, 55, 60, 64, 67]];
    const pat = [0, 2, 1, 3, 2, 4, 3, 2];
    for (let s = 0; s * beat / 2 < dur; s++) {
      const t = s * beat / 2, ch = chords[Math.floor(s / 16) % 4];
      pluck(L, R, t, ch[pat[s % 8]] + 12, { gain: 0.06 * (s % 2 ? 0.8 : 1), pan: -0.3 + 0.15 * pat[s % 8], len: 1.6, bright: 0.45 });
      if (s >= 32 && s % 2 === 1) addNoise(L, R, t, 0.06, { gain: 0.012, decay: 0.02, hp: 5000, pan: 0.35 });
    }
    padChords(L, R, dur, chords.map((c) => c.slice(1, 4).map((n) => n + 12)), 8 * beat, { gain: 0.006, fade: 1.5 });
    reverb(L, R, { mix: 0.2 });
    onePoleHP(L, 110); onePoleHP(R, 110);
    fadeIO(L, R, dur, 2, 4);
    return [L, R];
  },
  /** 4. 테크 펄스: 화음이 8분음표로 고동치는 미니멀 전자음 + 종소리 모티프 (110 BPM) */
  keynote(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    const beat = 60 / 110;
    const chords = [[62, 66, 69, 74], [59, 62, 66, 71], [55, 59, 62, 69], [57, 61, 64, 69]];
    padChords(L, R, dur, chords.map((c) => c.map((n) => n + 12)), 8 * beat, { gain: 0.016, harm: [1, 0.35, 0.15], fade: 0.6 });
    for (let i = 0; i < N; i++) {
      const ph = ((i / SR) / (beat / 2)) % 1;
      const g = 0.35 + 0.65 * Math.exp(-ph * 3.2);
      L[i] *= g; R[i] *= g;
    }
    const motif = [86, 81, 83, 78];
    for (let bar = 2; bar * 4 * beat < dur; bar += 2) motif.forEach((n, k) => addTone(L, R, bar * 4 * beat + k * beat * 0.75, 1.2, midi(n), { gain: 0.02, attack: 0.004, decay: 0.6, harm: [1, 0, 0.3, 0, 0.12], pan: -0.3 + k * 0.2 }));
    reverb(L, R, { mix: 0.25 });
    onePoleHP(L, 150); onePoleHP(R, 150);
    fadeIO(L, R, dur, 3, 4);
    return [L, R];
  },
  /** 5. 도심의 밤: 부드러운 로파이 건반 + 먹먹한 박자 (80 BPM) */
  citynight(dur) {
    const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
    const beat = 0.75;
    const chords = [[62, 65, 69, 72, 76], [60, 64, 67, 71, 74], [57, 60, 64, 67, 71], [58, 62, 65, 69, 72]];
    for (let bar = 0; bar * 4 * beat < dur; bar++) {
      const ch = chords[bar % 4], t0 = bar * 4 * beat;
      for (const [off, len] of [[0, 1.4], [2.5 * beat, 1.0]]) {
        ch.forEach((n, k) => addTone(L, R, t0 + off + k * 0.012, len, midi(n), { gain: 0.016, attack: 0.008, decay: 0.9, harm: [1, 0.2, 0.08], pan: -0.4 + k * 0.2 }));
      }
      if (bar >= 2) {
        softKick(L, R, t0, 0.05); softKick(L, R, t0 + 2.5 * beat, 0.035);
        for (const b of [1, 3]) addNoise(L, R, t0 + b * beat, 0.15, { gain: 0.025, decay: 0.06, hp: 900, lp: 3500 });
        for (let e = 0; e < 8; e++) addNoise(L, R, t0 + e * beat / 2 + (e % 2 ? 0.04 : 0), 0.04, { gain: 0.008, decay: 0.012, hp: 6000, pan: 0.25 });
      }
    }
    for (let i = 0; i < N; i++) { const tr = 0.9 + 0.1 * Math.sin((TAU * 4.5 * i) / SR); L[i] *= tr; R[i] *= tr; }
    for (let k = 0; k < dur * 6; k++) addNoise(L, R, ((rnd() + 1) / 2) * dur, 0.01, { gain: 0.01, decay: 0.002, hp: 3000 });
    onePoleLP(L, 4500); onePoleLP(R, 4500);
    reverb(L, R, { mix: 0.18 });
    onePoleHP(L, 90); onePoleHP(R, 90);
    fadeIO(L, R, dur, 2, 4);
    return [L, R];
  },
});


// ---------------- 1번(스마트 모빌리티)을 부드럽게 ----------------
/** 둥근 음색 아르페지오 공통 (박자감 정도만 다르게) */
function techSoftBase(dur, { beat, arpEvery, arpGain, arpDecay, kick, hat, pad }) {
  const N = Math.ceil(dur * SR), L = new Float32Array(N), R = new Float32Array(N);
  const chords = [[64, 68, 71, 75], [61, 64, 68, 71], [57, 61, 64, 68], [59, 63, 66, 71]];
  padChords(L, R, dur, chords, 8 * beat, { gain: pad, fade: 1.8, harm: [1, 0.2, 0.05] });
  const arp = [0, 1, 2, 3, 2, 1, 2, 3];
  const A = new Float32Array(N), AR = new Float32Array(N);
  let step = 0;
  for (let s = 0; s * beat / 4 < dur; s++) {
    const t = s * beat / 4, bar = Math.floor(s / 32), ch = chords[bar % 4];
    if (s >= 16 && s % arpEvery === 0) {
      addTone(A, AR, t, arpDecay * 1.6, midi(ch[arp[step % 8]] + 12), { gain: arpGain * (step % 2 ? 0.8 : 1), attack: 0.012, decay: arpDecay, harm: [1, 0.22, 0.05], pan: step % 2 ? 0.35 : -0.35 });
      step++;
    }
    if (s >= 64) {
      if (kick && s % 16 === 0) softKick(L, R, t, kick);
      if (hat && s % 4 === 2) addNoise(L, R, t, 0.04, { gain: hat, decay: 0.01, hp: 9000, pan: 0.3 });
    }
  }
  onePoleLP(A, 3200); onePoleLP(AR, 3200);
  for (let i = 0; i < N; i++) { L[i] += A[i]; R[i] += AR[i]; }
  reverb(L, R, { mix: 0.3, fb: 0.8 });
  onePoleLP(L, 6000); onePoleLP(R, 6000);
  onePoleHP(L, 110); onePoleHP(R, 110);
  fadeIO(L, R, dur, 3, 4);
  return [L, R];
}
Object.assign(BGM, {
  /** 1-A 부드럽게: 둥근 아르페지오(16분) + 아주 작은 킥·하이햇, 94 BPM */
  techSoft: (dur) => techSoftBase(dur, { beat: 60 / 94, arpEvery: 2, arpGain: 0.02, arpDecay: 0.22, kick: 0.03, hat: 0.007, pad: 0.011 }),
  /** 1-B 더 부드럽게: 박자 없이, 느린 아르페지오(8분)와 패드 중심, 88 BPM */
  techSofter: (dur) => techSoftBase(dur, { beat: 60 / 88, arpEvery: 4, arpGain: 0.018, arpDecay: 0.4, kick: 0, hat: 0, pad: 0.013 }),
});

export const BGM_STYLES = Object.keys(BGM);
function bgm(dur, style = 'fresh') { return (BGM[style] || BGM.fresh)(dur); }

// ---------------- 효과음 ----------------
const SFX = {
  tap: (L, R, t) => { addNoise(L, R, t, 0.02, { gain: 0.05, decay: 0.004, hp: 2500 }); addTone(L, R, t, 0.03, 1900, { gain: 0.05, decay: 0.02 }); },
  ping: (L, R, t) => { addTone(L, R, t, 0.5, midi(88), { gain: 0.07, decay: 0.35, harm: [1, 0.15] }); addTone(L, R, t + 0.12, 0.6, midi(93), { gain: 0.07, decay: 0.45, harm: [1, 0.15] }); },
  checks: (L, R, t) => { for (let i = 1; i <= 7; i++) addTone(L, R, t + i * 0.38, 0.05, 2200, { gain: 0.035, decay: 0.025, pan: 0.2 }); },
  ok: (L, R, t) => { addTone(L, R, t, 0.3, midi(84), { gain: 0.05, decay: 0.2 }); addTone(L, R, t + 0.09, 0.4, midi(91), { gain: 0.05, decay: 0.3 }); },
  success: (L, R, t) => { [84, 88, 91, 96].forEach((n, k) => addTone(L, R, t + k * 0.075, 0.7, midi(n), { gain: 0.05, decay: 0.45, harm: [1, 0.2, 0.05], pan: -0.2 + k * 0.13 })); },
  deny: (L, R, t) => { addTone(L, R, t, 0.16, midi(69), { gain: 0.06, decay: 0.12, harm: [1, 0.4, 0.2], wave: 'tri' }); addTone(L, R, t + 0.2, 0.22, midi(65), { gain: 0.06, decay: 0.16, harm: [1, 0.4, 0.2], wave: 'tri' }); },
  coin: (L, R, t) => { addTone(L, R, t, 0.1, midi(95), { gain: 0.05, decay: 0.06 }); addTone(L, R, t + 0.08, 0.6, midi(100), { gain: 0.05, decay: 0.35 }); },
  radar: (L, R, t) => { for (const [d, p] of [[0, -0.5], [0.45, 0.5], [0.9, 0]]) addTone(L, R, t + d, 0.4, midi(86), { gain: 0.035, decay: 0.25, harm: [1, 0.1], pan: p }); },
  trunk: (L, R, t) => { addTone(L, R, t, 0.2, 90, { gain: 0.12, decay: 0.09 }); addNoise(L, R, t + 0.02, 0.05, { gain: 0.05, decay: 0.012, hp: 1500 }); addNoise(L, R, t + 0.1, 0.9, { gain: 0.015, decay: 0.4, hp: 300, lp: 1500 }); },
  whoosh: (L, R, t) => {
    const n = Math.floor(0.7 * SR), i0 = Math.floor(t * SR);
    let y = 0;
    for (let k = 0; k < n; k++) {
      const x = k / n, cutoff = 300 + 2600 * Math.sin(Math.PI * x);
      const a = Math.exp((-TAU * cutoff) / SR);
      y = (1 - a) * rnd() + a * y;
      const v = y * Math.sin(Math.PI * x) ** 2 * 0.09, i = i0 + k;
      if (i >= 0 && i < L.length) { L[i] += v * (1 - x * 0.6); R[i] += v * (0.4 + x * 0.6); }
    }
  },
};

function writeWav(out, L, R, peakTo) {
  const N = L.length;
  let peak = 1e-9;
  for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = peakTo / peak;
  const buf = Buffer.alloc(44 + N * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(N * 4, 40);
  for (let i = 0; i < N; i++) {
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32000), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32000), 46 + i * 4);
  }
  writeFileSync(out, buf);
  return out;
}

/** BGM 후보 미리 듣기 */
export function makeBgmPreview(style, dur, out) {
  const [L, R] = bgm(dur, style);
  return writeWav(out, L, R, 0.5);
}

/** BGM과 효과음을 각각 WAV로 만든다 → { bgm, sfx } */
export function makeAudio(T, outPrefix) {
  const dur = (T.end - T.t0.desktop) / 1000 + 0.5;
  const [L, R] = bgm(dur, T.bgmStyle || process.env.BGM_STYLE || 'fresh');
  const sL = new Float32Array(L.length), sR = new Float32Array(L.length);
  for (const m of T.sfx || []) {
    const t = (m.t - T.t0.desktop) / 1000;
    if (SFX[m.name] && t >= 0) SFX[m.name](sL, sR, t);
  }
  return { bgm: writeWav(`${outPrefix}_bgm.wav`, L, R, 0.5), sfx: writeWav(`${outPrefix}_sfx.wav`, sL, sR, 0.5) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const T = JSON.parse(readFileSync(process.argv[2], 'utf8'));
  console.log('saved', makeAudio(T, process.argv[3] || 'audio'));
}
