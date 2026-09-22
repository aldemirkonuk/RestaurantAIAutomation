import { describe, expect, it } from 'vitest';
import { COMMIT_META_NAME, UNKNOWN_COMMIT, resolveCommitSha } from './build-provenance';

// Pure-function tests only: resolveCommitSha takes its environment and its
// git reader as arguments precisely so this file never has to mutate
// process.env or run a real `git`. Every branch of the priority order is
// exercised, including the case the whole file exists for — nothing
// resolves, and the answer is the literal "unknown", never "" or undefined.

const noHead = () => null;

describe('resolveCommitSha', () => {
  it('prefers VERCEL_GIT_COMMIT_SHA over everything else', () => {
    const got = resolveCommitSha(
      { VERCEL_GIT_COMMIT_SHA: 'aaa1111', RAILWAY_GIT_COMMIT_SHA: 'bbb2222' },
      () => 'ccc3333',
    );
    expect(got).toBe('aaa1111');
  });

  it('falls back to RAILWAY_GIT_COMMIT_SHA when Vercel is unset', () => {
    const got = resolveCommitSha({ RAILWAY_GIT_COMMIT_SHA: 'bbb2222' }, () => 'ccc3333');
    expect(got).toBe('bbb2222');
  });

  it('falls back to git rev-parse HEAD when neither platform variable is set', () => {
    const got = resolveCommitSha({}, () => 'ccc3333');
    expect(got).toBe('ccc3333');
  });

  it('treats a blank or whitespace-only variable as absent, not as an id', () => {
    const got = resolveCommitSha(
      { VERCEL_GIT_COMMIT_SHA: '   ', RAILWAY_GIT_COMMIT_SHA: '' },
      () => 'ccc3333',
    );
    expect(got).toBe('ccc3333');
  });

  it('trims surrounding whitespace off a variable that IS used', () => {
    const got = resolveCommitSha({ VERCEL_GIT_COMMIT_SHA: '  aaa1111  ' }, noHead);
    expect(got).toBe('aaa1111');
  });

  it('trims surrounding whitespace off a git HEAD that IS used', () => {
    const got = resolveCommitSha({}, () => '  ccc3333\n');
    expect(got).toBe('ccc3333');
  });

  // THE case this file exists for: no env variable, no git checkout. Must be
  // the literal marker, never "", never undefined/omitted — a blank value
  // reads as "nobody looked yet"; "unknown" is a claim the deploy check can
  // fail loudly against.
  it('reports the UNKNOWN_COMMIT marker when nothing resolves — never empty', () => {
    const got = resolveCommitSha({}, noHead);
    expect(got).toBe(UNKNOWN_COMMIT);
    expect(got).not.toBe('');
    expect(got).toBeTruthy();
  });

  it('reports UNKNOWN_COMMIT when the git reader returns only whitespace', () => {
    const got = resolveCommitSha({}, () => '   ');
    expect(got).toBe(UNKNOWN_COMMIT);
  });

  it('the meta tag name is stable — the check script greps for it by name', () => {
    expect(COMMIT_META_NAME).toBe('mudavym:commit');
  });
});
