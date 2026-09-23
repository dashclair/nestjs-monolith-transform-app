import type { FastifyRequest } from 'fastify';

import { cookieExtractor, jwtFromRequestExtractor } from '../jwt-extractors';

function buildRequest(overrides: Partial<FastifyRequest> = {}): FastifyRequest {
  return {
    cookies: {},
    headers: {},
    ...overrides,
  } as unknown as FastifyRequest;
}

describe('cookieExtractor', () => {
  it('returns the access_token cookie value when present', () => {
    const req = buildRequest({ cookies: { access_token: 'cookie-token' } });
    expect(cookieExtractor(req)).toBe('cookie-token');
  });

  it('returns null when there is no access_token cookie', () => {
    const req = buildRequest({ cookies: {} });
    expect(cookieExtractor(req)).toBeNull();
  });

  it('returns null when there are no cookies at all', () => {
    const req = buildRequest({ cookies: undefined });
    expect(cookieExtractor(req)).toBeNull();
  });
});

describe('jwtFromRequestExtractor', () => {
  it('prefers the cookie over the Authorization header when both are present', () => {
    const req = buildRequest({
      cookies: { access_token: 'cookie-token' },
      headers: { authorization: 'Bearer header-token' },
    });
    expect(jwtFromRequestExtractor(req)).toBe('cookie-token');
  });

  it('falls back to the Authorization header when there is no cookie', () => {
    const req = buildRequest({
      cookies: {},
      headers: { authorization: 'Bearer header-token' },
    });
    expect(jwtFromRequestExtractor(req)).toBe('header-token');
  });

  it('returns null when neither the cookie nor the header is present', () => {
    const req = buildRequest({ cookies: {}, headers: {} });
    expect(jwtFromRequestExtractor(req)).toBeNull();
  });
});
