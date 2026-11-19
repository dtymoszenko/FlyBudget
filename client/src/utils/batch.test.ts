import { describe, it, expect } from 'vitest';
import { settleEach } from './batch';

describe('settleEach', () => {
  it('runs every request, a few at a time, and keeps going past failures', async () => {
    let running = 0;
    let most = 0;
    const ids = Array.from({ length: 20 }, (_, i) => String(i));
    const { done, errors } = await settleEach(ids, async (id) => {
      most = Math.max(most, ++running);
      await new Promise((r) => setTimeout(r, 1));
      running--;
      if (Number(id) % 5 === 0) throw new Error(id);
    });
    expect(most).toBe(6);
    expect(done).toHaveLength(16);
    expect(errors.map((e) => (e as Error).message).sort()).toEqual(['0', '10', '15', '5']);
  });
});
