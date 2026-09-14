import { describe, expect, it } from 'vitest';
import { loadOnce } from '../../src/lib/lazyScreen';

// A screen's code arrives the first time it is opened. [1.87.0] The one failure handled in code is
// a tab left open across a deploy, asking for a file the deploy replaced: reload once to pick up
// the new build, and never more than once.

const memory = ({ blocked = false } = {}) => {
  const flags = new Set();
  return {
    flags,
    get: (key) => flags.has(key),
    set: (key) => { if (blocked) return false; flags.add(key); return true; },
    remove: (key) => { flags.delete(key); },
  };
};

const counter = () => {
  const reload = () => { reload.calls += 1; };
  reload.calls = 0;
  return reload;
};

const stillPending = (promise) => Promise.race([
  promise.then(() => 'settled', () => 'settled'),
  new Promise((resolve) => setTimeout(() => resolve('pending'), 20)),
]);

const missing = () => Promise.reject(new Error('Failed to fetch dynamically imported module'));
const screen = { default: () => null };

describe('loadOnce', () => {
  it('hands back the screen without reloading', async () => {
    const reload = counter();
    await expect(loadOnce(() => Promise.resolve(screen), { storage: memory(), reload })).resolves.toBe(screen);
    expect(reload.calls).toBe(0);
  });

  it('reloads once when a screen is missing, and waits for the reload rather than failing', async () => {
    const storage = memory();
    const reload = counter();
    const result = loadOnce(missing, { storage, reload });
    expect(await stillPending(result)).toBe('pending');
    expect(reload.calls).toBe(1);
    expect(storage.flags.size).toBe(1);
  });

  it('shows the error, without reloading again, when the screen is still missing after that reload', async () => {
    const storage = memory();
    loadOnce(missing, { storage, reload: counter() });
    await Promise.resolve();

    const reload = counter();
    await expect(loadOnce(missing, { storage, reload })).rejects.toThrow(/dynamically imported/);
    expect(reload.calls).toBe(0);
  });

  it('forgets the reload once a screen loads, so a later deploy can reload again', async () => {
    const storage = memory();
    loadOnce(missing, { storage, reload: counter() });
    await Promise.resolve();

    await loadOnce(() => Promise.resolve(screen), { storage, reload: counter() });
    expect(storage.flags.size).toBe(0);
  });

  it('never reloads when it has nowhere to remember that it did', async () => {
    const reload = counter();
    await expect(loadOnce(missing, { storage: memory({ blocked: true }), reload })).rejects.toThrow();
    expect(reload.calls).toBe(0);
  });
});
