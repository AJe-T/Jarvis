import { describe, expect, it } from 'vitest';
import { nodeRunsTools, testIsolationFlag } from './tool-runtime';

describe('Node flags for self-built tools', () => {
  it('Node 22 gets the experimental isolation flag; 23.6+ and 24+ the stable one (2.55.1)', () => {
    // Node 22 stops with "bad option" on --test-isolation, so every tool's unit check failed there.
    expect(testIsolationFlag('v22.14.0')).toBe('--experimental-test-isolation=none');
    expect(testIsolationFlag('v22.23.4')).toBe('--experimental-test-isolation=none');
    expect(testIsolationFlag('v23.5.0')).toBe('--experimental-test-isolation=none');
    expect(testIsolationFlag('v23.6.0')).toBe('--test-isolation=none');
    expect(testIsolationFlag('v24.11.0')).toBe('--test-isolation=none');
    expect(testIsolationFlag('26.0.0')).toBe('--test-isolation=none');
    expect(testIsolationFlag('garbage')).toBe('--experimental-test-isolation=none');
  });

  it('tools need Node 22.14+, 23.6+ or 24+', () => {
    expect(nodeRunsTools('v22.13.1')).toBe(false);
    expect(nodeRunsTools('v22.14.0')).toBe(true);
    expect(nodeRunsTools('v23.5.0')).toBe(false);
    expect(nodeRunsTools('v24.0.0')).toBe(true);
  });
});
