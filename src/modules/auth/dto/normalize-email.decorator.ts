import { Transform, TransformFnParams } from 'class-transformer';

/**
 * Trims and lowercases an email field before validation/persistence, so
 * `Foo@Example.com` and `foo@example.com` are treated as the same address
 * everywhere (DTO input, uniqueness checks, DB lookups).
 */
export function NormalizeEmail(): PropertyDecorator {
  return Transform(({ value }: TransformFnParams): unknown =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  );
}
