import { InlineRunner } from '../inline.runner';
import type { TextConversionTask } from '../../worker/convert-text';

describe('InlineRunner', () => {
  const runner = new InlineRunner();
  const task: TextConversionTask = {
    source: 'csv',
    target: 'json',
    body: Buffer.from('a,b\n1,2\n'),
    limits: { maxDepth: 64, maxNodes: 1000 },
  };

  it('runs the worker code in the current thread', async () => {
    const outcome = await runner.run(task, new AbortController().signal);

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(JSON.parse(Buffer.from(outcome.body).toString())).toEqual([
        { a: '1', b: '2' },
      ]);
    }
  });

  it('returns conversion errors as data, like the worker', async () => {
    const outcome = await runner.run(
      { ...task, body: Buffer.from('a,a\n1,2\n') },
      new AbortController().signal,
    );

    expect(outcome).toMatchObject({ ok: false, code: 'PARSE_ERROR' });
  });

  it('rejects with the abort reason when the signal is already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('timed out');
    controller.abort(reason);

    await expect(runner.run(task, controller.signal)).rejects.toBe(reason);
  });
});
