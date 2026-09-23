import type { FastifyRequest } from 'fastify';
import { ExtractJwt } from 'passport-jwt';

export function cookieExtractor(req: FastifyRequest): string | null {
  return req.cookies?.access_token ?? null;
}

export const jwtFromRequestExtractor = ExtractJwt.fromExtractors([
  cookieExtractor,
  ExtractJwt.fromAuthHeaderAsBearerToken(),
]);
