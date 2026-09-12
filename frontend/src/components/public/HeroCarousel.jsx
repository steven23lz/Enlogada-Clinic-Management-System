import React, { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { cn } from '../../lib/utils';

/**
 * The hero's background: slides that cross-fade, as on the reference site. [1.72.0]
 *
 * Until the clinic supplies photographs, the slides are the Aurora itself — the same three lights in
 * different positions — so the hero still drifts between compositions without a stock photo
 * standing in for a real clinic (the decision Home.jsx's Phase 4 note records). Every slide is an
 * `.aurora`, so every one is measured by checkContrast.js: moving a light changes where it lands,
 * never how bright it is.
 *
 * Adding photos later is one change: give a slide `src`. It renders dimmed and desaturated the way
 * the reference does, under a dark gradient so the headline keeps its contrast.
 *
 * Timing is the reference site's — an 1800 ms cross-fade every 10 s. It never advances for anyone
 * who asked for reduced motion or while the tab is hidden, and the button in the corner stops it for
 * anyone else: moving content has to be pausable, however slowly it moves.
 */
// Module-private: a file that exports a constant beside a component loses Fast Refresh. Callers
// pass their own `slides` — the day the clinic supplies photographs, that is the only change.
const AURORA_SLIDES = [
  { id: 'dawn', lights: ['12% 10%', '88% 0%', '50% 110%'] },
  { id: 'noon', lights: ['30% 0%', '100% 45%', '8% 100%'] },
  { id: 'dusk', lights: ['0% 55%', '72% 0%', '92% 100%'] },
];

const INTERVAL_MS = 10000;

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export default function HeroCarousel({ slides = AURORA_SLIDES, className }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [reduced] = useState(prefersReducedMotion);
  const animates = slides.length > 1 && !reduced;

  useEffect(() => {
    if (!animates || paused) return undefined;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex((i) => (i + 1) % slides.length);
    }, INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [animates, paused, slides.length]);

  return (
    <>
      <div aria-hidden="true" className={cn('pointer-events-none absolute inset-0 overflow-hidden', className)}>
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            className="absolute inset-0 transition-opacity duration-[1800ms] ease-[cubic-bezier(0.4,0,0.2,1)]"
            style={{ opacity: i === index ? 1 : 0 }}
          >
            {slide.src ? (
              <>
                <img
                  src={slide.src}
                  alt=""
                  loading={i === 0 ? 'eager' : 'lazy'}
                  fetchPriority={i === 0 ? 'high' : 'auto'}
                  className="h-full w-full object-cover brightness-[0.82] saturate-[0.85]"
                />
                <div className="absolute inset-0 bg-linear-to-b from-black/40 via-black/20 to-black/80" />
              </>
            ) : (
              <div
                className="aurora h-full w-full"
                style={{ '--a1': slide.lights[0], '--a2': slide.lights[1], '--a3': slide.lights[2] }}
              />
            )}
          </div>
        ))}
      </div>

      {animates && (
        <button
          type="button"
          onClick={() => setPaused((p) => !p)}
          aria-pressed={paused}
          aria-label={paused ? 'Play background animation' : 'Pause background animation'}
          title={paused ? 'Play background animation' : 'Pause background animation'}
          // bottom-20, not bottom-4: the quick dock overlaps the hero's lower edge and would cover it.
          className="absolute bottom-20 right-4 z-10 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-white/25 bg-white/10 text-aurora-ink backdrop-blur-sm transition-colors hover:bg-white/20"
        >
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
      )}
    </>
  );
}
