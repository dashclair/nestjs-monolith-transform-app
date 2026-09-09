export interface JwtPayload {
  sub: string;
  email: string;
  role: string; // update roles: string[]
  tokenVersion: number;
  type: 'access' | 'refresh';
}

export interface RequestUser {
  userId: string;
  email: string;
  role: string;
}
