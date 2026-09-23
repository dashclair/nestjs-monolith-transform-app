import type { FastifyRequest } from 'fastify';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  tokenVersion: number;
  type: 'access' | 'refresh';
  jti: string;
}

/**
 * The user fields `TokenService` needs to mint a token pair. Structurally
 * satisfied by the `User` entity, so `core/auth` doesn't depend on it.
 */
export interface TokenSubject {
  id: string;
  email: string;
  roles: ReadonlyArray<{ name: string }>;
  tokenVersion: number;
}

export interface RequestUser {
  userId: string;
  email: string;
  roles: string[];
}

export type RequestWithUser = FastifyRequest<{
  Params: Record<string, string>;
}> & {
  user?: RequestUser;
};
