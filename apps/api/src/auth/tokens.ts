import { createHash, randomBytes } from 'node:crypto';
import { SignJWT, jwtVerify } from 'jose';

export interface AccessClaims {
  sub: string; // user id
  fam: string; // refresh token family (session family)
}

export class TokenService {
  private key: Uint8Array;
  constructor(
    secret: string,
    private ttlSeconds: number,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  get accessTtl(): number {
    return this.ttlSeconds;
  }

  async signAccess(claims: AccessClaims): Promise<string> {
    return new SignJWT({ fam: claims.fam })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(claims.sub)
      .setIssuedAt()
      .setIssuer('zoko-api')
      .setAudience('zoko-app')
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
  }

  async verifyAccess(token: string): Promise<AccessClaims | null> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        algorithms: ['HS256'],
        issuer: 'zoko-api',
        audience: 'zoko-app',
      });
      if (typeof payload.sub !== 'string' || typeof payload.fam !== 'string') return null;
      return { sub: payload.sub, fam: payload.fam };
    } catch {
      return null;
    }
  }
}

export function newRefreshToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
