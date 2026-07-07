'use client';

import { useEffect, useRef } from 'react';

const SVGNS = 'http://www.w3.org/2000/svg';

// Concentric fingerprint rings for the landing art field.
// A blob outline is sampled, smoothed into a closed bezier path, then shrunk
// toward a moving focal point ring-by-ring; the whole field slowly drifts.
function blobShape(samples: number, seed: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < samples; i++) {
    const a = (i / samples) * Math.PI * 2;
    const taper = 1 + Math.sin(a) * 0.06;
    const n =
      1.0 +
      Math.sin(a * 1 + seed * 0.7) * 0.045 +
      Math.sin(a * 2 + seed * 1.3) * 0.03 +
      Math.sin(a * 3 + seed * 2.1) * 0.02 +
      Math.sin(a * 5 + seed * 0.4) * 0.012;
    const rx = 320 * n * taper;
    const ry = 380 * n;
    pts.push([Math.cos(a) * rx, Math.sin(a) * ry]);
  }
  return pts;
}

function smoothClosedPath(pts: [number, number][]): string {
  const n = pts.length;
  let d = '';
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n];
    const p1 = pts[i];
    const p2 = pts[(i + 1) % n];
    const p3 = pts[(i + 2) % n];
    if (i === 0) d += `M ${p1[0].toFixed(2)} ${p1[1].toFixed(2)} `;
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += `C ${c1x.toFixed(2)} ${c1y.toFixed(2)} ${c2x.toFixed(2)} ${c2y.toFixed(2)} ${p2[0].toFixed(2)} ${p2[1].toFixed(2)} `;
  }
  return `${d}Z`;
}

function shrink(pts: [number, number][], t: number, pullX: number, pullY: number): [number, number][] {
  return pts.map((p) => [p[0] + (pullX - p[0]) * t, p[1] + (pullY - p[1]) * t]);
}

export function FingerprintArt() {
  const baseRef = useRef<SVGGElement>(null);
  const warmRef = useRef<SVGGElement>(null);
  const coolRef = useRef<SVGGElement>(null);
  const gradRef = useRef<SVGLinearGradientElement>(null);

  useEffect(() => {
    const base = baseRef.current;
    const warm = warmRef.current;
    const cool = coolRef.current;
    const grad = gradRef.current;
    if (!base || !warm || !cool) return;

    const params = {
      rings: 49,
      seed: 22,
      samples: 96,
      pullX: 0,
      pullY: -98,
      warmAmt: 1.2,
      coolAmt: 0.25,
      angle: 95,
      weight: 1.6,
    };

    function build() {
      if (!base || !warm || !cool) return;
      base.replaceChildren();
      warm.replaceChildren();
      cool.replaceChildren();

      const shape = blobShape(params.samples, params.seed);
      const N = params.rings;
      if (grad) grad.setAttribute('gradientTransform', `rotate(${params.angle - 45} 0.5 0.5)`);

      for (let i = 0; i < N; i++) {
        const u = i / (N - 1);
        const t = u ** 1.35 * 0.96;
        const ring = shrink(shape, t, params.pullX, params.pullY);
        const d = smoothClosedPath(ring);
        const w = params.weight * (0.7 + (1 - u) * 0.6);

        const make = (parent: SVGGElement, opacity: number) => {
          const p = document.createElementNS(SVGNS, 'path');
          p.setAttribute('d', d);
          p.setAttribute('stroke-width', w.toFixed(2));
          p.setAttribute('opacity', opacity.toFixed(3));
          parent.appendChild(p);
        };

        make(base, 0.6 + 0.3 * (1 - u));
        if (params.warmAmt > 0) make(warm, 0.5 * params.warmAmt);
        if (params.coolAmt > 0) make(cool, 0.5 * params.coolAmt);
      }
    }

    build();

    const reduce =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduce) return;

    const anim = {
      raf: 0,
      t0: performance.now(),
      lastBuild: 0,
      speed: 0.6,
      base: { seed: params.seed, angle: params.angle, pullX: params.pullX, pullY: params.pullY },
    };

    const loop = (now: number) => {
      const t = ((now - anim.t0) / 1000) * anim.speed;
      params.pullX = anim.base.pullX + Math.sin(t * 0.21) * 75 + Math.sin(t * 0.07 + 1.3) * 35;
      params.pullY = anim.base.pullY + Math.cos(t * 0.17) * 75 + Math.cos(t * 0.09 + 0.7) * 35;
      params.seed = anim.base.seed + Math.sin(t * 0.13) * 9 + t * 0.35;
      params.angle = (anim.base.angle + t * 8) % 360;
      if (now - anim.lastBuild > 45) {
        build();
        anim.lastBuild = now;
      }
      anim.raf = requestAnimationFrame(loop);
    };
    anim.raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(anim.raf);
  }, []);

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-[-80px] -z-10 h-[800px] w-[800px] max-w-none -translate-x-1/2 opacity-35"
    >
      <svg viewBox="-500 -500 1000 1000" xmlns={SVGNS} className="block h-full w-full">
        <defs>
          <linearGradient ref={gradRef} id="fpGrad" x1="0" y1="1" x2="1" y2="0">
            <stop offset="0%" stopColor="#17E187" />
            <stop offset="45%" stopColor="#8C5EF4" />
            <stop offset="100%" stopColor="#DAF45E" />
          </linearGradient>
          <radialGradient id="fpFade" cx="50%" cy="50%" r="55%">
            <stop offset="0%" stopColor="#fff" stopOpacity="1" />
            <stop offset="55%" stopColor="#fff" stopOpacity="0.95" />
            <stop offset="85%" stopColor="#fff" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="fpWarm" cx="28%" cy="78%" r="60%">
            <stop offset="0%" stopColor="#17E187" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#17E187" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="fpCool" cx="74%" cy="22%" r="60%">
            <stop offset="0%" stopColor="#DAF45E" stopOpacity="0.85" />
            <stop offset="60%" stopColor="#DAF45E" stopOpacity="0" />
          </radialGradient>
          <mask id="fpMask" maskUnits="userSpaceOnUse" x="-500" y="-500" width="1000" height="1000">
            <rect x="-500" y="-500" width="1000" height="1000" fill="url(#fpFade)" />
          </mask>
          <filter id="fpWarble" x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="2" seed="7" result="t" />
            <feDisplacementMap in="SourceGraphic" in2="t" scale="6" xChannelSelector="R" yChannelSelector="G" />
          </filter>
        </defs>
        <g ref={baseRef} mask="url(#fpMask)" filter="url(#fpWarble)" fill="none" stroke="url(#fpGrad)" strokeLinecap="round" />
        <g ref={warmRef} mask="url(#fpMask)" filter="url(#fpWarble)" fill="none" stroke="url(#fpWarm)" strokeLinecap="round" />
        <g ref={coolRef} mask="url(#fpMask)" filter="url(#fpWarble)" fill="none" stroke="url(#fpCool)" strokeLinecap="round" />
      </svg>
    </div>
  );
}
