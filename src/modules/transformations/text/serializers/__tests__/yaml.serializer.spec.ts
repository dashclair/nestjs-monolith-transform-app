import { YamlParser } from '../../parsers/yaml.parser';
import { JsonValue } from '../../text.types';
import { YamlSerializer } from '../yaml.serializer';

describe('YamlSerializer', () => {
  const serializer = new YamlSerializer();

  it('stringifies nested values', () => {
    expect(serializer.serialize({ a: 1, b: [true, null], c: { d: 'x' } })).toBe(
      'a: 1\nb:\n  - true\n  - null\nc:\n  d: x\n',
    );
  });

  it('quotes strings that would otherwise be read as another type', () => {
    expect(serializer.serialize({ a: '007', b: 'true' })).toBe(
      'a: "007"\nb: "true"\n',
    );
  });

  it('round-trips through YamlParser', () => {
    const value: JsonValue = {
      users: [
        { id: 1, name: 'Alice', tags: ['a', 'b'] },
        { id: 2, name: null },
      ],
    };

    expect(new YamlParser().parse(serializer.serialize(value))).toEqual(value);
  });
});
