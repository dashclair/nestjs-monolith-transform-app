import { JsonParser } from '../json.parser';

describe('JsonParser', () => {
  const parser = new JsonParser();

  it('parses an object keeping value types', () => {
    expect(parser.parse('{"a":1,"b":true,"c":null,"d":"007"}')).toEqual({
      a: 1,
      b: true,
      c: null,
      d: '007',
    });
  });

  it('parses a top-level array', () => {
    expect(parser.parse('[{"a":1},{"a":2}]')).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('keeps the last value for a duplicate key', () => {
    expect(parser.parse('{"a":1,"a":2}')).toEqual({ a: 2 });
  });

  it('throws PARSE_ERROR with line and column for invalid JSON', () => {
    expect(() => parser.parse('{\n"a": 1\n,}')).toThrow(
      expect.objectContaining({
        code: 'PARSE_ERROR',
        message: 'Invalid JSON (line 3 column 2)',
      }),
    );
  });

  it('does not leak file contents into the error message', () => {
    expect(() => parser.parse('secret-token')).toThrow(
      expect.objectContaining({ code: 'PARSE_ERROR' }),
    );
    // Passes only if the thrown error's message does not match.
    expect(() => parser.parse('secret-token')).not.toThrow(/secret/);
  });

  it('throws PARSE_ERROR for truncated JSON', () => {
    expect(() => parser.parse('[1, 2')).toThrow(
      expect.objectContaining({ code: 'PARSE_ERROR' }),
    );
  });
});
