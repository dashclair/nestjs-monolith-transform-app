import { isSameId } from '../is-same-id';

describe('isSameId', () => {
  const ID = '3f2b8c1e-9d4a-4e6b-8f7a-1c2d3e4f5a6b';

  it('returns true for identical ids', () => {
    expect(isSameId(ID, ID)).toBe(true);
  });

  it('returns true when the ids differ only in letter case', () => {
    expect(isSameId(ID, ID.toUpperCase())).toBe(true);
    expect(isSameId(ID.toUpperCase(), ID)).toBe(true);
  });

  it('returns false for different ids', () => {
    expect(isSameId(ID, '00000000-0000-4000-8000-000000000000')).toBe(false);
  });

  it('returns false when either side is missing', () => {
    expect(isSameId(ID, undefined)).toBe(false);
    expect(isSameId(undefined, ID)).toBe(false);
    expect(isSameId(null, null)).toBe(false);
    expect(isSameId('', '')).toBe(false);
  });
});
