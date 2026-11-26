// P1-V2 (PERF_VOICE.md): the restart watchdog must count only genuine
// server-death signals. A TimeoutError means SLOW (single-threaded server
// busy mid-generation), not dead — two slow syntheses used to trip
// `restart_voice_server` against a healthy server.

import { describe, expect, it } from 'vitest';
import { isServerDeathError } from '@/services/narration/narrationQwenProvider';

describe('isServerDeathError', () => {
  it('exempts TimeoutError (slow, not dead)', () => {
    expect(isServerDeathError(new DOMException('synthesis timeout', 'TimeoutError'))).toBe(false);
  });

  it('exempts AbortError (caller cancelled)', () => {
    expect(isServerDeathError(new DOMException('aborted', 'AbortError'))).toBe(false);
  });

  it('counts transport failures (connection refused, EPIPE)', () => {
    expect(isServerDeathError(new TypeError('fetch failed'))).toBe(true);
    expect(isServerDeathError(new TypeError('Failed to fetch'))).toBe(true);
  });

  it('counts other unexpected errors', () => {
    expect(isServerDeathError(new Error('boom'))).toBe(true);
    expect(isServerDeathError('string rejection')).toBe(true);
    expect(isServerDeathError(undefined)).toBe(true);
  });
});
