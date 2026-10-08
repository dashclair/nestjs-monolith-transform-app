import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { TEXT_FORMATS, type TextFormat } from '../../core/types';
import { TEXT_PARSERS } from '../parsers';
import { convertText } from '../worker/convert-text';

// Inputs cover the rules of each format (quoting, Cyrillic, nesting,
// attributes, CDATA, YAML core schema, formula injection); every expected
// output was reviewed by hand against the T-020 conversion rules.
const FIXTURES = join(__dirname, '..', '__fixtures__');
const limits = { maxDepth: 64, maxNodes: 1_000_000 };

// git may check the fixtures out with CRLF (core.autocrlf) — compare as LF.
const read = (...path: string[]) =>
  readFileSync(join(FIXTURES, ...path), 'utf8').replace(/\r\n/g, '\n');

function convert(source: TextFormat, target: TextFormat, text: string) {
  const outcome = convertText({
    source,
    target,
    body: Buffer.from(text),
    limits,
  });
  if (!outcome.ok) throw new Error(`${outcome.code}: ${outcome.message}`);
  return Buffer.from(outcome.body).toString('utf8');
}

const directions = TEXT_FORMATS.flatMap((source) =>
  TEXT_FORMATS.filter((target) => target !== source).map(
    (target) => [source, target] as const,
  ),
);

describe('text conversion golden files', () => {
  it('covers all 12 directions', () => {
    expect(directions).toHaveLength(12);
  });

  it.each(directions)('%s → %s', (source, target) => {
    expect(convert(source, target, read(`input.${source}`))).toBe(
      read('expected', `${source}-to-${target}.${target}`),
    );
  });

  it.each<TextFormat>(['xml', 'yaml'])(
    '%s → json → %s keeps the data',
    (format) => {
      const input = read(`input.${format}`);
      const back = convert('json', format, convert(format, 'json', input));
      const parser = TEXT_PARSERS.get(format)!;

      expect(parser.parse(back, limits)).toEqual(parser.parse(input, limits));
    },
  );
});
