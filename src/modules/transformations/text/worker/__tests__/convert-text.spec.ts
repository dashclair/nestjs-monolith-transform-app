import { TEXT_PARSERS } from '../../parsers';
import { convertText, type TextConversionTask } from '../convert-text';

const limits = { maxDepth: 64, maxNodes: 1000 };

function run(
  task: Omit<Partial<TextConversionTask>, 'body'> & { body: string | Buffer },
) {
  return convertText({
    source: 'json',
    target: 'yaml',
    limits,
    ...task,
    body: Buffer.isBuffer(task.body) ? task.body : Buffer.from(task.body),
  });
}

describe('convertText', () => {
  afterEach(() => vi.restoreAllMocks());

  it('decodes, parses and serializes into UTF-8 bytes', () => {
    const outcome = run({ body: '﻿{"имя":"Анна"}' });

    expect(outcome).toEqual({
      ok: true,
      body: Buffer.from('имя: Анна\n', 'utf8'),
    });
  });

  it.each([
    ['json', 'json'],
    ['json', 'toml'],
  ])('rejects %s → %s as UNSUPPORTED_DIRECTION', (source, target) => {
    expect(
      run({ source, target, body: '{}' } as unknown as TextConversionTask),
    ).toMatchObject({ ok: false, code: 'UNSUPPORTED_DIRECTION' });
  });

  it('returns decoding errors as data', () => {
    expect(run({ body: Buffer.from([0xff, 0xfe, 0x7b, 0x00]) })).toMatchObject({
      ok: false,
      code: 'INVALID_ENCODING',
    });
    expect(run({ body: '  \n' })).toMatchObject({
      ok: false,
      code: 'EMPTY_FILE',
    });
  });

  it('checks structure limits after parsing', () => {
    expect(
      run({ body: '[1, 2, 3]', limits: { maxDepth: 64, maxNodes: 3 } }),
    ).toMatchObject({ ok: false, code: 'STRUCTURE_TOO_LARGE' });
    expect(
      run({ body: '[[1]]', limits: { maxDepth: 2, maxNodes: 100 } }),
    ).toMatchObject({ ok: false, code: 'STRUCTURE_TOO_LARGE' });
  });

  it('returns serializer errors as data', () => {
    expect(run({ target: 'csv', body: '[1, 2]' })).toMatchObject({
      ok: false,
      code: 'NOT_TABULAR',
    });
  });

  it('hides the text of unexpected errors behind INTERNAL_ERROR', () => {
    vi.spyOn(TEXT_PARSERS.get('json')!, 'parse').mockImplementation(() => {
      throw new Error('secret file contents');
    });

    expect(run({ body: '{}' })).toEqual({
      ok: false,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
    });
  });
});
