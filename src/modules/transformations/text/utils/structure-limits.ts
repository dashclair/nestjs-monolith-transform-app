import { HttpStatus } from '@nestjs/common';
import { TransformationError } from '../../core/transformation-error';
import { JsonValue, StructureLimits } from '../text.types';

export function assertStructureLimits(
  root: JsonValue,
  { maxDepth, maxNodes }: StructureLimits,
): void {
  const stack: Array<{ value: JsonValue; depth: number }> = [
    { value: root, depth: 1 },
  ];
  let nodes = 0;

  while (stack.length > 0) {
    const { value, depth } = stack.pop()!;
    nodes += 1;

    if (depth > maxDepth || nodes > maxNodes) {
      throw new TransformationError(
        'STRUCTURE_TOO_LARGE',
        HttpStatus.BAD_REQUEST,
        'Structure is too large',
      );
    }

    if (value !== null && typeof value === 'object') {
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children)
        stack.push({ value: child, depth: depth + 1 });
    }
  }
}
