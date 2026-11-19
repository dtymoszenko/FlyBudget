/** How many of a batch's requests are in flight at once */
const BATCH_CONCURRENCY = 6;

/**
 * Runs `request` for every id, a few at a time, and waits for all of them even when some
 * fail: the ids that succeeded, and the errors of those that didn't (the rows that did change
 * stay changed).
 */
export async function settleEach(ids: string[], request: (id: string) => Promise<unknown>) {
  const done: string[] = [];
  const errors: unknown[] = [];
  let next = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++]!;
      await request(id).then(
        () => done.push(id),
        (e: unknown) => errors.push(e),
      );
    }
  };
  await Promise.all(Array.from({ length: BATCH_CONCURRENCY }, worker));
  return { done, errors };
}
