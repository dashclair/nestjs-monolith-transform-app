import { FastifyReply } from 'fastify';
import ms, { type StringValue } from 'ms';

import { TokenPair } from './services/token.service';

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
    path: '/',
    maxAge: ms(config.accessTtl) / 1000,
  });
  response.setCookie('refresh_token', tokens.refreshToken, {
    httpOnly: true,
    secure: config.secure,
    sameSite: config.sameSite,
    path: '/auth/refresh',
    maxAge: ms(config.refreshTtl) / 1000,
  });
}
