import { ConversionEngine } from '../conversion-engine';
import type { FormatPair } from '../types';

class FakeEngine extends ConversionEngine {
  readonly kind = 'image';

  constructor(private readonly pairs: FormatPair[]) {
    super();
  }

  supportedPairs = () => this.pairs;
  detectFormat = () => null;
  sizeLimit = () => 0;
  validateOptions = () => ({});
  convert = () => Promise.reject(new Error('not used'));
}

describe('ConversionEngine.getFormats', () => {
  it('groups targets by source in pair order', () => {
    const engine = new FakeEngine([
      { source: 'svg', target: 'png' },
      { source: 'png', target: 'jpeg' },
      { source: 'svg', target: 'jpeg' },
    ]);

    expect(engine.getFormats()).toEqual([
      { source: 'svg', target: ['png', 'jpeg'] },
      { source: 'png', target: ['jpeg'] },
    ]);
  });

  it('returns an empty list without pairs', () => {
    expect(new FakeEngine([]).getFormats()).toEqual([]);
  });
});
