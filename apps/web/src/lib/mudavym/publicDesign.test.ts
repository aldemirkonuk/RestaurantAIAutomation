import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PUBLIC_OVERRIDE_KEY, isPublicDesignOn, usePublicDesign } from './publicDesign';

/**
 * ADR 0133 §Decision 1 — the public door's one switch.
 *
 * The env is baked in by Vite at build time; in this runner it is whatever
 * `import.meta.env.VITE_MUDAVYM_PUBLIC` resolves to (unset unless the shell
 * sets it), so the env cases stub `import.meta.env` directly.
 */
describe('publicDesign — ADR 0133', () => {
  // `vi.stubEnv` writes BOTH `process.env` and `import.meta.env`, which is the
  // only way a value set in a test reaches the module's own `import.meta.env`.
  const setEnv = (v: string | undefined) => {
    if (v === undefined) vi.stubEnv('VITE_MUDAVYM_PUBLIC', undefined as unknown as string);
    else vi.stubEnv('VITE_MUDAVYM_PUBLIC', v);
  };

  beforeEach(() => {
    setEnv(undefined);
    window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.removeItem(PUBLIC_OVERRIDE_KEY);
    vi.restoreAllMocks();
  });

  it('absence is off — no env, no override → false', () => {
    expect(isPublicDesignOn()).toBe(false);
    expect(usePublicDesign()).toBe(false);
  });

  it.each(['1', 'true', 'on', ' ON '])('the deployment switch %j turns it on', (v) => {
    setEnv(v);
    expect(isPublicDesignOn()).toBe(true);
  });

  it.each(['0', 'false', 'off', 'yes', 'maybe', ''])(
    'an env value that is not an explicit yes (%j) stays off',
    (v) => {
      setEnv(v);
      expect(isPublicDesignOn()).toBe(false);
    },
  );

  it('the localStorage override wins over the env, both ways', () => {
    setEnv('1');
    window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'off');
    expect(isPublicDesignOn()).toBe(false);

    setEnv(undefined);
    window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'on');
    expect(isPublicDesignOn()).toBe(true);
  });

  it('an unparseable override falls through to the env', () => {
    window.localStorage.setItem(PUBLIC_OVERRIDE_KEY, 'sometimes');
    expect(isPublicDesignOn()).toBe(false);
    setEnv('true');
    expect(isPublicDesignOn()).toBe(true);
  });

  it('blocked storage behaves as no override', () => {
    setEnv('1');
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(isPublicDesignOn()).toBe(true);
  });
});
