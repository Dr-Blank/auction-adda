// Generated sounds (WebAudio, no files). One mute switch, remembered per browser.

export type Sound = 'turn' | 'bid' | 'pass' | 'gavel' | 'cash' | 'fanfare';

let ctx: AudioContext | undefined;
let muted = read();

function read(): boolean {
  try {
    return localStorage.getItem('aa:mute') === '1';
  } catch {
    return false;
  }
}

export const isMuted = () => muted;
export function setMuted(on: boolean): void {
  muted = on;
  try {
    localStorage.setItem('aa:mute', on ? '1' : '0');
  } catch {
    // not remembered; fine
  }
}

function tone(at: number, freq: number, dur: number, vol: number, type: OscillatorType = 'sine', slideTo?: number): void {
  const osc = ctx!.createOscillator();
  const gain = ctx!.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, at);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, at + dur);
  gain.gain.setValueAtTime(0.0001, at);
  gain.gain.exponentialRampToValueAtTime(vol, at + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  osc.connect(gain).connect(ctx!.destination);
  osc.start(at);
  osc.stop(at + dur + 0.05);
}

function noise(at: number, dur: number, vol: number): void {
  const len = Math.floor(ctx!.sampleRate * dur);
  const buf = ctx!.createBuffer(1, len, ctx!.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
  const src = ctx!.createBufferSource();
  const gain = ctx!.createGain();
  const filter = ctx!.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 1400;
  gain.gain.value = vol;
  src.buffer = buf;
  src.connect(filter).connect(gain).connect(ctx!.destination);
  src.start(at);
}

export function play(sound: Sound): void {
  if (muted) return;
  try {
    ctx ??= new AudioContext();
    const t = ctx.currentTime;
    switch (sound) {
      case 'turn':
        tone(t, 660, 0.25, 0.12);
        tone(t + 0.12, 880, 0.25, 0.12);
        break;
      case 'bid':
        tone(t, 1200, 0.06, 0.06, 'triangle');
        break;
      case 'pass':
        tone(t, 180, 0.14, 0.08, 'sine', 90);
        break;
      case 'gavel':
        noise(t, 0.08, 0.5);
        tone(t, 140, 0.12, 0.2, 'triangle', 70);
        noise(t + 0.18, 0.08, 0.35);
        tone(t + 0.18, 140, 0.12, 0.14, 'triangle', 70);
        break;
      case 'cash':
        tone(t, 1568, 0.08, 0.08, 'square');
        tone(t + 0.07, 2093, 0.3, 0.07, 'square');
        noise(t + 0.05, 0.15, 0.15);
        break;
      case 'fanfare':
        [523, 659, 784, 1047].forEach((f, i) => tone(t + i * 0.11, f, i === 3 ? 0.5 : 0.16, 0.09, 'sawtooth'));
        break;
    }
  } catch {
    // no sound available; the screen still shows everything
  }
}
