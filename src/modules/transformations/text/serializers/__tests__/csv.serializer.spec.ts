import { CsvSerializer } from '../csv.serializer';

describe('CsvSerializer', () => {
  const serializer = new CsvSerializer();

  it('writes an array of flat objects as rows', () => {
    expect(
      serializer.serialize([
        { id: 1, name: 'Alice', ok: true },
        { id: 2, name: 'Bob', ok: false },
      ]),
    ).toBe('id,name,ok\n1,Alice,true\n2,Bob,false\n');
  });

  it('writes a single object as one row', () => {
    expect(serializer.serialize({ a: '1', b: '2' })).toBe('a,b\n1,2\n');
  });

  it('does not unwrap a single key holding a primitive', () => {
    expect(serializer.serialize({ root: { name: 'Alice' } })).toBe(
      'name\nAlice\n',
    );
  });

  it('unwraps single-key objects down to the rows', () => {
    expect(
      serializer.serialize({ root: { item: [{ a: '1' }, { a: '2' }] } }),
    ).toBe('a\n1\n2\n');
  });

  it('flattens nested objects and arrays with dot notation', () => {
    expect(serializer.serialize([{ a: { b: 1 }, tags: ['x', 'y'] }])).toBe(
      'a.b,tags.0,tags.1\n1,x,y\n',
    );
  });

  it('unions columns in order of appearance and leaves missing values and null empty', () => {
    expect(
      serializer.serialize([
        { a: 1, b: null },
        { c: 3, a: 2 },
      ]),
    ).toBe('a,b,c\n1,,\n2,,3\n');
  });

  it('quotes values with commas, quotes and line breaks', () => {
    expect(serializer.serialize([{ a: 'x, "y"\nz' }])).toBe(
      'a\n"x, ""y""\nz"\n',
    );
  });

  it.each([
    ['=SUM(A1)', "'=SUM(A1)"],
    ['+cmd', "'+cmd"],
    ['-cmd', "'-cmd"],
    ['@cmd', "'@cmd"],
    ['\tcmd', "'\tcmd"],
    ['-5', '-5'],
    ['+1.5e3', '+1.5e3'],
  ])('guards against formula injection: %j → %j', (input, expected) => {
    expect(serializer.serialize([{ a: input }])).toBe(`a\n${expected}\n`);
  });

  it('does not touch negative numbers', () => {
    expect(serializer.serialize([{ a: -5 }])).toBe('a\n-5\n');
  });

  it('returns an empty string for an empty array', () => {
    expect(serializer.serialize([])).toBe('');
  });

  it.each([
    ['an array of primitives', [1, 2, 3]],
    [
      'an array of arrays',
      [
        [1, 2],
        [3, 4],
      ],
    ],
    ['a top-level primitive', 'text'],
  ])('throws NOT_TABULAR for %s', (_, value) => {
    expect(() => serializer.serialize(value)).toThrow(
      expect.objectContaining({ code: 'NOT_TABULAR' }),
    );
  });
});
