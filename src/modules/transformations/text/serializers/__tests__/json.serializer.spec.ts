import { JsonParser } from '../../parsers/json.parser';
import { JsonValue } from '../../text.types';
import { JsonSerializer } from '../json.serializer';

describe('JsonSerializer', () => {
  const serializer = new JsonSerializer();

  it('pretty-prints with 2-space indentation', () => {
    expect(serializer.serialize({ a: 1, b: [true, null] })).toBe(
      '{\n  "a": 1,\n  "b": [\n    true,\n    null\n  ]\n}',
    );
  });

  it('escapes special characters in strings', () => {
    expect(serializer.serialize({ a: 'say "hi"\n' })).toBe(
      '{\n  "a": "say \\"hi\\"\\n"\n}',
    );
  });

  it('round-trips through JsonParser', () => {
    const value: JsonValue = {
      users: [
        { id: 1, name: 'Alice', tags: ['a'] },
        { id: 2, name: null },
      ],
    };

    expect(new JsonParser().parse(serializer.serialize(value))).toEqual(value);
  });
});
