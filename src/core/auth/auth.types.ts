export interface JwtPayload {
  sub: string;
  email: string;
  roles: string[];
  tokenVersion: number;
  type: 'access' | 'refresh';
}

export interface RequestUser {
  userId: string;
  email: string;
  roles: string[];
}
