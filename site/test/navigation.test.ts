import { afterEach, describe, expect, it, vi } from 'vitest';
import { toggleTheme } from '../src/lib/navigation';

describe('toggleTheme', () => {
  afterEach(() => vi.unstubAllGlobals());

  it("steps the site kit's theme, which stores it under the kit's key", () => {
    const next = vi.fn(() => 'light');
    vi.stubGlobal('window', { siteTheme: { next } });
    toggleTheme();
    expect(next).toHaveBeenCalledOnce();
  });

  it('does nothing when the kit did not load', () => {
    vi.stubGlobal('window', {});
    expect(() => toggleTheme()).not.toThrow();
  });
});
