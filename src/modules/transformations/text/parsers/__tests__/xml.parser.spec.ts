import { XmlParser } from '../xml.parser';

describe('XmlParser', () => {
  const limits = { maxDepth: 64, maxNodes: 1_000_000 };
  const parser = {
    parse: (text: string) => new XmlParser().parse(text, limits),
  };

  it('keeps the root element as a key and all values as strings', () => {
    expect(
      parser.parse('<user><id>007</id><active>true</active></user>'),
    ).toEqual({
      user: { id: '007', active: 'true' },
    });
  });

  it('maps attributes to @_ keys and element text to #text', () => {
    expect(parser.parse('<user id="1" admin="true">Alice</user>')).toEqual({
      user: { '@_id': '1', '@_admin': 'true', '#text': 'Alice' },
    });
  });

  it('turns repeated elements into an array and a single one into an object', () => {
    expect(parser.parse('<users><user>a</user><user>b</user></users>')).toEqual(
      {
        users: { user: ['a', 'b'] },
      },
    );
    expect(parser.parse('<users><user>a</user></users>')).toEqual({
      users: { user: 'a' },
    });
  });

  it('turns CDATA into text', () => {
    expect(parser.parse('<a><![CDATA[<b>&]]></a>')).toEqual({ a: '<b>&' });
  });

  it('drops the declaration, comments and processing instructions', () => {
    const xml =
      '<?xml version="1.0"?><?xml-stylesheet href="s.xsl"?><!-- note --><a>1</a>';

    expect(parser.parse(xml)).toEqual({ a: '1' });
  });

  it('keeps namespace prefixes in names', () => {
    expect(
      parser.parse('<ns:a xmlns:ns="urn:x"><ns:b>1</ns:b></ns:a>'),
    ).toEqual({
      'ns:a': { '@_xmlns:ns': 'urn:x', 'ns:b': '1' },
    });
  });

  it('throws UNSAFE_CONTENT for a DOCTYPE', () => {
    const xml =
      '<!DOCTYPE a [<!ENTITY x SYSTEM "file:///etc/passwd">]><a>&x;</a>';

    expect(() => parser.parse(xml)).toThrow(
      expect.objectContaining({ code: 'UNSAFE_CONTENT' }),
    );
  });

  it('throws PARSE_ERROR with line and column for invalid XML', () => {
    expect(() => parser.parse('<a>\n<secret>\n</a>')).toThrow(
      expect.objectContaining({
        code: 'PARSE_ERROR',
        message: 'Invalid XML (line 3 column 1)',
      }),
    );
  });

  it('throws STRUCTURE_TOO_LARGE when nesting exceeds maxDepth, not the parser default', () => {
    const nested = (depth: number) =>
      '<a>'.repeat(depth) + '</a>'.repeat(depth);

    // fast-xml-parser lets maxNestedTags + 1 levels through; the tree check
    // after parsing (in convertText) covers that last level.
    expect(() =>
      new XmlParser().parse(nested(5), { maxDepth: 3, maxNodes: 100 }),
    ).toThrow(expect.objectContaining({ code: 'STRUCTURE_TOO_LARGE' }));
    // Far past fast-xml-parser's own default of 100 nested tags.
    expect(() => parser.parse(nested(200_000))).toThrow(
      expect.objectContaining({ code: 'STRUCTURE_TOO_LARGE' }),
    );
  });
});
