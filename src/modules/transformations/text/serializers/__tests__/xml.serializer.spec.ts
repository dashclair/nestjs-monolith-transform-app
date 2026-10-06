import { XmlParser } from '../../parsers/xml.parser';
import { JsonValue } from '../../text.types';
import { XmlSerializer } from '../xml.serializer';

const DECLARATION = '<?xml version="1.0" encoding="UTF-8"?>\n';

describe('XmlSerializer', () => {
  const serializer = new XmlSerializer();

  it('always adds the XML declaration', () => {
    expect(serializer.serialize({ a: '1' }).startsWith(DECLARATION)).toBe(true);
  });

  it('uses the single key as the root element', () => {
    expect(serializer.serialize({ users: { user: ['a', 'b'] } })).toBe(
      `${DECLARATION}<users>\n  <user>a</user>\n  <user>b</user>\n</users>\n`,
    );
  });

  it('wraps several top-level keys in <root>', () => {
    expect(serializer.serialize({ a: 1, b: 2 })).toBe(
      `${DECLARATION}<root>\n  <a>1</a>\n  <b>2</b>\n</root>\n`,
    );
  });

  it('wraps a single key holding an array in <root> to keep one root element', () => {
    expect(serializer.serialize({ user: ['a', 'b'] })).toBe(
      `${DECLARATION}<root>\n  <user>a</user>\n  <user>b</user>\n</root>\n`,
    );
  });

  it('writes a top-level array as <root><item>', () => {
    expect(serializer.serialize([{ a: 1 }, { a: 2 }])).toBe(
      `${DECLARATION}<root>\n  <item>\n    <a>1</a>\n  </item>\n  <item>\n    <a>2</a>\n  </item>\n</root>\n`,
    );
  });

  it('writes @_ keys as attributes and #text as element text', () => {
    expect(
      serializer.serialize({ user: { '@_id': '1', '#text': 'Alice' } }),
    ).toBe(`${DECLARATION}<user id="1">Alice</user>\n`);
  });

  it('replaces invalid name characters and prefixes a leading digit with _', () => {
    const xml = serializer.serialize({
      row: { 'First Name': 'A', '1st': 'B', Имя: 'C' },
    });

    expect(xml).toContain('<First_Name>A</First_Name>');
    expect(xml).toContain('<_1st>B</_1st>');
    expect(xml).toContain('<Имя>C</Имя>');
  });

  it('writes null as an empty element', () => {
    expect(serializer.serialize({ a: { b: null } })).toContain('<b/>');
  });

  it('escapes special characters', () => {
    expect(serializer.serialize({ a: '<b> & "c"' })).toContain(
      '<a>&lt;b&gt; &amp; &quot;c&quot;</a>',
    );
  });

  it('round-trips through XmlParser', () => {
    const value: JsonValue = {
      users: {
        '@_count': '2',
        user: [{ '@_id': '1', '#text': 'Alice' }, { name: 'Bob' }],
      },
    };

    expect(
      new XmlParser().parse(serializer.serialize(value), {
        maxDepth: 64,
        maxNodes: 1_000_000,
      }),
    ).toEqual(value);
  });
});
