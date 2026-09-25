import { FastifyReply } from 'fastify';
import ms, { type StringValue } from 'ms';

import { TokenPair } from './services/token.service';

const ACCESS_COOKIE_PATH = '/';
const REFRESH_COOKIE_PATH = '/auth';

export function setAuthCookies(
  response: FastifyReply,
  tokens: TokenPair,
  config: {
    secure: boolean;
    sameSite: 'lax' | 'strict' | 'none';
    accessTtl: StringValue;
    refreshTtl: StringValue;
  },
): void {
  response.setCookie('access_token', tokens.accessToken, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: ACCESS_COOKIE_PATH,
    maxAge: ms(config.accessTtl) / 1000,
  });
  response.setCookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: REFRESH_COOKIE_PATH,
    maxAge: ms(config.refreshTtl) / 1000,
  });
}

export function clearAuthCookies(response: FastifyReply): void {
  response.clearCookie('access_token', { path: ACCESS_COOKIE_PATH });
  response.clearCookie('refresh_token', { path: REFRESH_COOKIE_PATH });
}
