import { describe, expect, it, vi } from 'vitest';
import fc from 'fast-check';
import { format } from 'util';
import { logError } from './log.js';

// Any text, with line breaks of every kind mixed in often
const breaks = [0x0a, 0x0d, 0x2028, 0x2029].map((c) => String.fromCharCode(c));
const tricky = fc.string({
  unit: fc.oneof(fc.constantFrom(...breaks), fc.string({ unit: 'binary', maxLength: 1 })),
});

describe('logError (property-based)', () => {
  it('always writes one line, whatever the error text contains', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fc.assert(
      fc.property(tricky, fc.boolean(), (text, fromPlaid) => {
        spy.mockClear();
        logError(
          'Sync error',
          fromPlaid ? { response: { data: { error_message: text } } } : new Error(text),
        );
        const line = format(...(spy.mock.calls[0] as [string, ...unknown[]]));
        expect(line.startsWith('Sync error: ')).toBe(true);
        // No line breaks of any kind (including Unicode line/paragraph separators)
        for (const b of breaks) expect(line).not.toContain(b);
      }),
    );
    spy.mockRestore();
  });
});
