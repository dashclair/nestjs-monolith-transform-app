import { CsvParser } from '../csv.parser';

describe('CsvParser', () => {
  const parser = new CsvParser();

  it('parses rows into objects keyed by header, all values as strings', () => {
    expect(parser.parse('id,name\n007,Alice\n1e5,Bob')).toEqual([
      { id: '007', name: 'Alice' },
      { id: '1e5', name: 'Bob' },
    ]);
  });

  it('handles quoted fields with commas, escaped quotes and line breaks', () => {
    expect(parser.parse('a,b\n"x, ""y""\nz",2')).toEqual([
      { a: 'x, "y"\nz', b: '2' },
    ]);
  });

  it('keeps empty cells as empty strings', () => {
    expect(parser.parse('a,b,c\n1,,3')).toEqual([{ a: '1', b: '', c: '3' }]);
  });

  it('returns [] for a header-only file', () => {
    expect(parser.parse('a,b\n')).toEqual([]);
  });

  it('throws PARSE_ERROR for a duplicate column name', () => {
    expect(() => parser.parse('a,a\n1,2')).toThrow(
      expect.objectContaining({ code: 'PARSE_ERROR' }),
    );
  });

  it('throws PARSE_ERROR for an empty column name', () => {
    expect(() => parser.parse('a,\n1,2')).toThrow(
      expect.objectContaining({ code: 'PARSE_ERROR' }),
    );
  });

  it('throws PARSE_ERROR with the line number for a row with a wrong field count', () => {
    expect(() => parser.parse('a,b\n1,2\n3')).toThrow(
      expect.objectContaining({
        code: 'PARSE_ERROR',
        message: 'Invalid CSV at line 3',
      }),
    );
  });
});
