import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize, Volume2, VolumeX, WifiOff } from 'lucide-react';
import Logo from '../../components/Logo';
import api from '../../config/api';
import { useClinic } from '../../lib/clinic';
import { usePolling } from '../../hooks/usePolling';
import {
  STATIONS, POLL_MS, FLASH_MS, callSentence, clockOf, isStale, latestCallId, newCallsSince, sayCall,
} from '../../lib/nowServing';

/** Two notes, from the browser's own synthesiser: no sound file to host or lose. */
function playChime(context) {
  [[784, 0], [587, 0.32]].forEach(([frequency, at]) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, context.currentTime + at);
    gain.gain.exponentialRampToValueAtTime(0.35, context.currentTime + at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + at + 0.7);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(context.currentTime + at);
    oscillator.stop(context.currentTime + at + 0.75);
  });
}

const CONTROL = 'inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-rail-line bg-rail-raised px-3 py-2 text-note font-semibold text-rail-ink hover:bg-rail-line';

/**
 * `?display=queue`: the waiting-room TV. [1.149.0]
 *
 * Open to anyone with no sign-in, because a TV has no account: it shows each station's current
 * ticket and nothing that names a person. It takes the whole page and is dark in both themes, so
 * it carries rail ink only. Tiles never move, so a patient learns where to look; a new call lights
 * its tile, and with sound on chimes and says the number. A browser only allows sound after someone
 * presses something on the page, which is what "Turn on sound" is for, and why it is offered until
 * pressed.
 *
 * A failed read keeps the last board and says it has stopped updating: stale numbers presented as
 * live would send patients to the wrong place, and a blank wall would tell them nothing.
 */
export default function NowServing() {
  const clinic = useClinic();
  const [board, setBoard] = useState(null);
  const [failed, setFailed] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [lit, setLit] = useState({});
  const [latest, setLatest] = useState('');
  const [now, setNow] = useState(() => new Date());
  const [fullscreen, setFullscreen] = useState(false);
  const lastSeen = useRef(null);
  const audio = useRef(null);
  const sound = useRef(false);

  const read = useCallback(async () => {
    try {
      const next = (await api.get('/queue/now-serving')).data.data;
      const fresh = newCallsSince(next, lastSeen.current);
      lastSeen.current = Math.max(lastSeen.current ?? 0, latestCallId(next));
      setBoard(next);
      setFailed(false);
      if (fresh.length) {
        const until = Date.now() + FLASH_MS;
        setLit((was) => ({ ...was, ...Object.fromEntries(fresh.map((c) => [c.station, until])) }));
        setLatest(callSentence(fresh[fresh.length - 1]));
        if (sound.current) {
          if (audio.current) playChime(audio.current);
          fresh.forEach(sayCall);
        }
      }
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => { read(); }, [read]);
  usePolling(read, POLL_MS);

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(tick);
  }, []);

  // The page's own colour reaches the edge: html keeps a scrollbar gutter for every other screen.
  useEffect(() => {
    const root = document.documentElement;
    const gutter = root.style.scrollbarGutter;
    const title = document.title;
    root.style.scrollbarGutter = 'auto';
    document.title = `Now serving | ${clinic.name}`;
    return () => {
      root.style.scrollbarGutter = gutter;
      document.title = title;
    };
  }, [clinic.name]);

  // A TV that sleeps shows nobody anything. Only offered over HTTPS or on this PC; nothing to do otherwise.
  useEffect(() => {
    let lock = null;
    const hold = () => navigator.wakeLock?.request?.('screen').then((l) => { lock = l; }).catch(() => {});
    hold();
    const onFull = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('visibilitychange', hold);
    document.addEventListener('fullscreenchange', onFull);
    return () => {
      document.removeEventListener('visibilitychange', hold);
      document.removeEventListener('fullscreenchange', onFull);
      lock?.release?.().catch?.(() => {});
    };
  }, []);

  const toggleSound = () => {
    const on = !soundOn;
    if (on) {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (Context && !audio.current) audio.current = new Context();
      audio.current?.resume?.();
      if (audio.current) playChime(audio.current);
    } else {
      window.speechSynthesis?.cancel?.();
    }
    sound.current = on;
    setSoundOn(on);
  };

  const stations = board?.stations || STATIONS.map((s) => ({ ...s, ticket: null, calledAt: null }));
  const recent = board?.recent || [];

  return (
    <div className="flex min-h-screen flex-col bg-rail text-rail-ink">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-rail-line px-4 py-3 sm:px-8 sm:py-4">
        <Logo className="h-10 w-10 flex-shrink-0 sm:h-12 sm:w-12" />
        <div className="min-w-0 flex-1 basis-48">
          <h1 className="m-0 text-2xl font-bold sm:text-3xl">Now serving</h1>
          <p className="m-0 text-note text-rail-ink-soft">{clinic.name}</p>
        </div>
        <p className="m-0 text-2xl font-semibold tabular-nums sm:text-3xl" data-testid="now-serving-clock">{clockOf(now)}</p>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={CONTROL} onClick={toggleSound} aria-pressed={soundOn} data-testid="now-serving-sound">
            {soundOn ? <Volume2 aria-hidden="true" className="h-4 w-4" /> : <VolumeX aria-hidden="true" className="h-4 w-4" />}
            {soundOn ? 'Sound on' : 'Turn on sound'}
          </button>
          {document.fullscreenEnabled && !fullscreen && (
            <button type="button" className={CONTROL} onClick={() => document.documentElement.requestFullscreen?.().catch(() => {})}>
              <Maximize aria-hidden="true" className="h-4 w-4" />
              Full screen
            </button>
          )}
        </div>
      </header>

      {failed && (
        <p role="alert" data-testid="now-serving-offline" className="m-0 flex items-center justify-center gap-2 border-b border-rail-line bg-rail-raised px-4 py-2 text-note font-semibold text-rail-ink">
          <WifiOff aria-hidden="true" className="h-4 w-4 flex-shrink-0" />
          This screen has stopped updating. Please ask at the front desk.
        </p>
      )}

      <p className="sr-only" role="status" aria-live="polite">{latest}</p>

      <main className="grid flex-1 auto-rows-fr grid-cols-1 gap-4 p-4 sm:grid-cols-2 sm:p-8 xl:grid-cols-3">
        {stations.map((s) => {
          const flashing = (lit[s.station] || 0) > now.getTime();
          const faded = !flashing && isStale(s.calledAt, now);
          return (
            <article
              key={s.station}
              data-testid="now-serving-tile"
              data-station={s.station}
              data-lit={flashing}
              className={`flex min-h-44 flex-col rounded-2xl border p-5 transition-colors duration-500 sm:p-6 ${
                flashing ? 'border-transparent bg-primary text-primary-foreground' : 'border-rail-line bg-rail-raised'
              }`}
            >
              <h2 className="m-0 text-xl font-semibold sm:text-2xl">{s.label}</h2>
              <p
                data-testid="now-serving-ticket"
                className={`m-0 flex flex-1 items-center justify-center py-2 font-bold leading-none tabular-nums ${
                  s.ticket ? `text-[clamp(3.5rem,8vw,9rem)] ${faded ? 'opacity-60' : ''}` : 'text-5xl text-rail-ink-faint'
                }`}
              >
                {s.ticket || '—'}
              </p>
              <p className={`m-0 text-center text-note ${flashing ? '' : 'text-rail-ink-soft'}`}>
                {s.ticket ? `Called at ${clockOf(s.calledAt)}` : 'Nobody called yet'}
              </p>
            </article>
          );
        })}

        <section aria-label="Called just before" data-testid="now-serving-recent" className="flex min-h-44 flex-col rounded-2xl border border-rail-line p-5 sm:p-6">
          <h2 className="m-0 text-xl font-semibold text-rail-ink-soft sm:text-2xl">Called just before</h2>
          {recent.length ? (
            <ul className="m-0 mt-3 flex list-none flex-col gap-2 p-0">
              {recent.map((c) => (
                <li key={c.id} className="flex items-baseline justify-between gap-3 text-lg">
                  <span className="font-bold tabular-nums">{c.ticket}</span>
                  <span className="min-w-0 flex-1 text-rail-ink-soft">{c.label}</span>
                  <span className="whitespace-nowrap text-note text-rail-ink-soft">{clockOf(c.calledAt)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 mt-3 text-note text-rail-ink-soft">Keep your ticket with you. Your number will appear here when it is your turn.</p>
          )}
        </section>
      </main>
    </div>
  );
}
