/**
 * ProfBlob — the Prof's living orb (borrowed from ClickyX's audio-reactive
 * waveform + glow overlay, re-formed as a single blob). Canvas-drawn:
 * a paper-light disc with a stamp-red aura that DISTORTS with your voice
 * (AnalyserNode RMS → radial noise), breathes slowly while thinking, and
 * holds a steady warm glow while he speaks.
 *
 * No React re-renders on the audio path — level lives in a ref, the blob
 * reads it inside requestAnimationFrame.
 */
import React, { useEffect, useRef } from 'react';

export type BlobState = 'listening' | 'thinking' | 'speaking' | 'idle';

interface ProfBlobProps {
  state: BlobState;
  /** Live mic stream while recording — drives the distortion. */
  stream?: MediaStream | null;
  size?: number;
  onClick?: () => void;
  label?: string;
}

const STAMP = '#8C3B22';
const INK = '#26221B';

const ProfBlob: React.FC<ProfBlobProps> = ({ state, stream, size = 64, onClick, label }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<BlobState>(state);
  const levelRef = useRef(0);
  stateRef.current = state;

  // Mic level → levelRef (0..1), via Web Audio analyser on the live stream.
  useEffect(() => {
    if (!stream) {
      levelRef.current = 0;
      return undefined;
    }
    const ctx = new AudioContext();
    // WebKit starts AudioContext SUSPENDED outside a direct gesture handler —
    // a suspended context feeds the analyser pure flatline (every byte 128),
    // which is exactly "no distortion when I speak" (2026-09-06).
    void ctx.resume();
    const src = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    src.connect(analyser);
    const buf = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    let peak = 0.02; // auto-gain: running peak so normal speech reads ~1
    let logged = false; // review fix #5: one trace line, not a 2s heartbeat
    const tick = () => {
      analyser.getByteTimeDomainData(buf);
      let sum = 0;
      for (let i = 0; i < buf.length; i++) sum += (buf[i]! - 128) ** 2;
      const rms = Math.sqrt(sum / buf.length) / 128;
      if (rms > peak) peak = rms;
      const normalized = Math.min(1, (rms / peak) * (peak > 0.05 ? 1 : peak / 0.05));
      // Attack fast, release slow — feels alive, not twitchy.
      levelRef.current = Math.max(normalized, levelRef.current * 0.82);
      if (!logged && rms > 0.005) {
        logged = true;
        console.info('[prof] audio flowing — ctx:', ctx.state, 'first rms:', rms.toFixed(3));
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(raf);
      void ctx.close();
    };
  }, [stream]);

  // The draw loop.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.scale(dpr, dpr);

    let raf = 0;
    const t0 = performance.now();
    const draw = () => {
      const t = (performance.now() - t0) / 1000;
      const st = stateRef.current;
      const level = st === 'listening' ? levelRef.current : 0;
      const cx = size / 2;
      const cy = size / 2;
      const base = size * 0.22;

      // breathing: thinking = slow deep breath, speaking = gentle presence
      const breathe =
        st === 'thinking'
          ? 1 + 0.16 * Math.sin(t * 2.2)
          : st === 'speaking'
            ? 1 + 0.05 * Math.sin(t * 1.4)
            : 1;

      ctx.clearRect(0, 0, size, size);

      // aura
      const glowR = base * breathe * (2.1 + level * 0.9);
      const glow = ctx.createRadialGradient(cx, cy, base * 0.5, cx, cy, glowR);
      const glowColor = st === 'idle' ? INK : STAMP;
      const glowAlpha =
        st === 'thinking' ? 0.32 + 0.12 * Math.sin(t * 2.2) : st === 'idle' ? 0.1 : 0.28 + level * 0.3;
      glow.addColorStop(0, `${glowColor}${Math.round(glowAlpha * 255).toString(16).padStart(2, '0')}`);
      glow.addColorStop(1, `${glowColor}00`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, size, size);

      // the blob: a circle distorted by 5 harmonics driven by voice level
      ctx.beginPath();
      const points = 48;
      for (let i = 0; i <= points; i++) {
        const a = (i / points) * Math.PI * 2;
        const wobble =
          level *
          base *
          1.1 * // auto-gained level × bigger coefficient — speech is VISIBLE
          (0.6 * Math.sin(3 * a + t * 7) +
            0.3 * Math.sin(5 * a - t * 11) +
            0.15 * Math.sin(8 * a + t * 5));
        const idle_wobble =
          st === 'thinking' || st === 'speaking'
            ? base * 0.04 * Math.sin(4 * a + t * (st === 'thinking' ? 2.5 : 1.2))
            : 0;
        const r = base * breathe + wobble + idle_wobble;
        const x = cx + r * Math.cos(a);
        const y = cy + r * Math.sin(a);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.fillStyle = st === 'speaking' ? STAMP : '#F8F4E9';
      ctx.fill();
      ctx.lineWidth = 1.25;
      ctx.strokeStyle = st === 'idle' ? INK : STAMP;
      ctx.stroke();

      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  return (
    <button
      type='button'
      onClick={onClick}
      aria-label={label ?? 'Professor'}
      className='block cursor-pointer border-0 bg-transparent p-0'
      style={{ width: size, height: size }}
    >
      <canvas ref={canvasRef} style={{ width: size, height: size }} />
    </button>
  );
};

export default ProfBlob;
