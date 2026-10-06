import { YamlParser } from '../yaml.parser';

describe('YamlParser', () => {
  const parser = new YamlParser();

  it('keeps YAML types', () => {
    expect(
      parser.parse('n: 1\nb: true\nz: null\ns: "007"\nlist: [1, two]'),
    ).toEqual({
      n: 1,
      b: true,
      z: null,
      s: '007',
      list: [1, 'two'],
    });
  });

  it('uses the core schema: yes/no and dates stay strings', () => {
    expect(parser.parse('a: yes\nb: no\nc: 2020-01-01')).toEqual({
      a: 'yes',
      b: 'no',
      c: '2020-01-01',
    });
  });

  it('expands anchors and aliases', () => {
    expect(parser.parse('a: &x { k: 1 }\nb: *x')).toEqual({
      a: { k: 1 },
      b: { k: 1 },
    });
  });

  it('returns null for a comment-only document', () => {
    expect(parser.parse('# nothing here')).toBeNull();
  });

  it('throws PARSE_ERROR for a multi-document stream', () => {
    expect(() => parser.parse('a: 1\n---\nb: 2')).toThrow(
      expect.objectContaining({ code: 'PARSE_ERROR' }),
    );
  });

  it('throws PARSE_ERROR with line and column for a syntax error', () => {
    const parse = () => parser.parse('a: 1\nb: [1, 2\nc: 3');

    expect(parse).toThrow(expect.objectContaining({ code: 'PARSE_ERROR' }));
    expect(parse).toThrow(/^Invalid YAML \(line \d+ column \d+\)$/);
  });

  it.each(['!!js/function "return 1"', '!custom 1'])(
    'throws PARSE_ERROR for a custom tag: %s',
    (value) => {
      expect(() => parser.parse(`a: ${value}`)).toThrow(
        expect.objectContaining({ code: 'PARSE_ERROR' }),
      );
    },
  );

  it('throws UNSAFE_CONTENT for an alias bomb', () => {
    const bomb = [
      'a: &a [x, x, x, x, x, x, x, x, x]',
      'b: &b [*a, *a, *a, *a, *a, *a, *a, *a, *a]',
      'c: &c [*b, *b, *b, *b, *b, *b, *b, *b, *b]',
      'd: &d [*c, *c, *c, *c, *c, *c, *c, *c, *c]',
      'e: [*d, *d, *d, *d, *d, *d, *d, *d, *d]',
    ].join('\n');

    expect(() => parser.parse(bomb)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_CONTENT' }),
    );
  });
});
