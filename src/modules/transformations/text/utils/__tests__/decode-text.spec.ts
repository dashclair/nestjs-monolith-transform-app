import { decodeHead, decodeText } from '../decode-text';

describe('decodeHead', () => {
  it.each([
    ['2-byte (Cyrillic)', 'я'],
    ['3-byte (CJK)', '中'],
    ['4-byte (emoji)', '😀'],
  ])('ignores a %s character cut off at the end of the head', (_, char) => {
    const full = Buffer.from(`{"a":"${char}`, 'utf8');
    const head = full.subarray(0, full.length - 1);

    expect(() => decodeText(head)).toThrow();
    expect(decodeHead(head)).toBe('{"a":"');
  });

  it('decodes a complete head unchanged', () => {
    expect(decodeHead(Buffer.from('{"a":"я"}', 'utf8'))).toBe('{"a":"я"}');
  });

  it('still rejects invalid bytes that are not a cut-off tail', () => {
    const head = Buffer.concat([
      Buffer.from('{"a":'),
      Buffer.from([0xff]),
      Buffer.from('"}'),
    ]);

    expect(() => decodeHead(head)).toThrow('Invalid encoding');
  });

  it('still rejects a UTF-16 BOM', () => {
    expect(() => decodeHead(Buffer.from([0xff, 0xfe, 0x7b, 0x00]))).toThrow(
      'Invalid encoding',
    );
  });
});
