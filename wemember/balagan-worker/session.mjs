export const SESSION_SECONDS = 77 * 86400;
export const SESSION_COOKIE = '__Host-balagan';
const issuer = 'https://balagan.live';
const clock = () => Math.floor(Date.now() / 1000);
const utf8 = new TextEncoder();

function encode(bytes) {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
function decode(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid encoding');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}
const encodeJson = value => encode(utf8.encode(JSON.stringify(value)));
const decodeJson = value => JSON.parse(new TextDecoder().decode(decode(value)));
const jwtHeader = encodeJson({ alg: 'HS256', typ: 'JWT' });

async function keyFromHex(secret) {
  if (!/^[0-9a-f]{64}$/i.test(secret || '')) throw new Error('Invalid Balagan signing secret configuration');
  const bytes = Uint8Array.from(secret.match(/../g), part => parseInt(part, 16));
  return crypto.subtle.importKey('raw', bytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

export async function signSession(secret, session, audience, now = clock()) {
  if (session.expires_at <= now || session.expires_at > now + SESSION_SECONDS) throw new Error('Invalid session expiry');
  const payload = encodeJson({ iss: issuer, aud: audience, sub: session.user_id, sid: session.id, iat: now, exp: session.expires_at });
  const input = jwtHeader + '.' + payload;
  const signature = await crypto.subtle.sign('HMAC', await keyFromHex(secret), utf8.encode(input));
  return input + '.' + encode(new Uint8Array(signature));
}

export async function verifySession(secret, token, audience, now = clock()) {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const [header, body, signature, extra] = token.split('.');
  if (extra !== undefined || header !== jwtHeader || !body || !signature) return null;
  const key = await keyFromHex(secret);
  try {
    if (!await crypto.subtle.verify('HMAC', key, decode(signature), utf8.encode(header + '.' + body))) return null;
    const claims = decodeJson(body);
    if (claims.iss !== issuer || claims.aud !== audience || typeof claims.sub !== 'string' || typeof claims.sid !== 'string'
      || !Number.isSafeInteger(claims.iat) || !Number.isSafeInteger(claims.exp) || claims.iat > now
      || claims.exp <= now || claims.exp > claims.iat + SESSION_SECONDS) return null;
    return claims;
  } catch {
    return null;
  }
}

export function sessionCookie(token, expiresAt, now = clock()) {
  const age = token ? Math.max(0, Math.min(expiresAt - now, SESSION_SECONDS)) : 0;
  return SESSION_COOKIE + '=' + token + '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=' + age;
}

export async function findLiveSession(db, claims, now = clock()) {
  if (!claims) return null;
  return db.prepare(
    'SELECT u.id, u.username FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.user_id = ? AND s.expires_at = ? AND s.expires_at > ?'
  ).bind(claims.sid, claims.sub, claims.exp, now).first();
}
