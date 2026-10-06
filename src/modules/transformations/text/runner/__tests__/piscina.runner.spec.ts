import type { ConfigService } from '@/core/config/config.service';

import { PiscinaRunner } from '../piscina.runner';
import type { TextConversionTask } from '../../worker/convert-text';

// piscina needs a compiled .js worker file that vitest does not build — the
// pool is replaced and only the runner's own logic is checked.
const pool = vi.hoisted(() => ({
  options: undefined as unknown,
  queueSize: 0,
  run: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock('piscina', () => ({
  default: class {
    constructor(options: unknown) {
      pool.options = options;
    }
    get queueSize() {
      return pool.queueSize;
    }
    run = pool.run;
    destroy = pool.destroy;
  },
}));

describe('PiscinaRunner', () => {
  const get = vi.fn(() => '3');
  const config = { get } as unknown as ConfigService;
  const task: TextConversionTask = {
    source: 'json',
    target: 'csv',
    body: Buffer.from('[]'),
    limits: { maxDepth: 64, maxNodes: 1000 },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    pool.queueSize = 0;
  });

  it('sizes the pool from TRANSFORM_TEXT_WORKERS (a string) with a 4x queue', () => {
    new PiscinaRunner(config);

    expect(get).toHaveBeenCalledWith('TRANSFORM_TEXT_WORKERS');
    expect(pool.options).toMatchObject({
      maxThreads: 3,
      maxQueue: 12,
      filename: expect.stringMatching(
        /worker[\\/]text-conversion\.worker\.js$/,
      ) as unknown,
    });
  });

  it('passes the task and the abort signal to the pool', async () => {
    const outcome = { ok: true, body: new Uint8Array() };
    pool.run.mockResolvedValueOnce(outcome);
    const { signal } = new AbortController();

    await expect(new PiscinaRunner(config).run(task, signal)).resolves.toBe(
      outcome,
    );
    expect(pool.run).toHaveBeenCalledExactlyOnceWith(task, { signal });
  });

  it('rejects with 503 BUSY without queueing when the queue is full', async () => {
    pool.queueSize = 12;

    await expect(
      new PiscinaRunner(config).run(task, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'BUSY', status: 503 });
    expect(pool.run).not.toHaveBeenCalled();
  });

  it('maps piscina rejecting a full queue to 503 BUSY', async () => {
    pool.run.mockRejectedValueOnce(new Error('Task queue is at limit'));

    await expect(
      new PiscinaRunner(config).run(task, new AbortController().signal),
    ).rejects.toMatchObject({ code: 'BUSY', status: 503 });
  });

  it('passes other pool errors through', async () => {
    const error = new Error('worker crashed');
    pool.run.mockRejectedValueOnce(error);

    await expect(
      new PiscinaRunner(config).run(task, new AbortController().signal),
    ).rejects.toBe(error);
  });

  it('destroys the pool on module destroy', async () => {
    await new PiscinaRunner(config).onModuleDestroy();

    expect(pool.destroy).toHaveBeenCalledOnce();
  });
});
