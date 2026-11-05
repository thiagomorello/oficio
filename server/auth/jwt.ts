// JWT de sessão (HS256, 30 dias). `pv` = password_version: mudar a senha derruba as sessões antigas.
import jwt from 'jsonwebtoken';

export const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

export interface SessionClaims {
  sub: string;
  pv: number;
  adm: boolean;
}

export function signSession(claims: SessionClaims, secret: string): string {
  return jwt.sign({ pv: claims.pv, adm: claims.adm }, secret, { algorithm: 'HS256', subject: claims.sub, expiresIn: SESSION_MAX_AGE_S });
}

export function verifySession(token: string, secret: string): { userId: number; pv: number } | null {
  try {
    const p = jwt.verify(token, secret, { algorithms: ['HS256'] });
    if (typeof p === 'string') return null;
    const userId = Number(p.sub);
    const pv = Number(p.pv);
    if (!Number.isInteger(userId) || userId <= 0 || !Number.isInteger(pv)) return null;
    return { userId, pv };
  } catch {
    return null;
  }
}
