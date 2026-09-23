import type { FastifyRequest } from 'fastify';

export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  tokenVersion: number;
  type: 'access' | 'refresh';
  jti: string;
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
