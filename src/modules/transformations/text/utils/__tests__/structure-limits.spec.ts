import { assertStructureLimits } from '../structure-limits';
import type { JsonValue } from '../../text.types';

const nested = (depth: number): JsonValue =>
  depth === 1 ? 'leaf' : { a: nested(depth - 1) };

describe('assertStructureLimits', () => {
  const tooLarge = expect.objectContaining({
    code: 'STRUCTURE_TOO_LARGE',
  }) as unknown;

  it('accepts a tree exactly at the depth limit and rejects one level more', () => {
    const limits = { maxDepth: 64, maxNodes: 1000 };

    expect(() => assertStructureLimits(nested(64), limits)).not.toThrow();
    expect(() => assertStructureLimits(nested(65), limits)).toThrow(tooLarge);
  });

  it('counts every node, primitives and the root included', () => {
    // root array + 3 items = 4 nodes
    const value = [1, 'two', null];

    expect(() =>
      assertStructureLimits(value, { maxDepth: 64, maxNodes: 4 }),
    ).not.toThrow();
    expect(() =>
      assertStructureLimits(value, { maxDepth: 64, maxNodes: 3 }),
    ).toThrow(tooLarge);
  });

  it('counts object values but not keys', () => {
    expect(() =>
      assertStructureLimits({ a: 1, b: 2 }, { maxDepth: 2, maxNodes: 3 }),
    ).not.toThrow();
  });

  it('walks deep trees iteratively, without overflowing the stack', () => {
    let deep: JsonValue = 'leaf';
    for (let i = 0; i < 100_000; i++) deep = [deep];

    expect(() =>
      assertStructureLimits(deep, { maxDepth: 200_000, maxNodes: 200_000 }),
    ).not.toThrow();
  });
});
