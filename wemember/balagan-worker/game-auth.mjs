import { SESSION_COOKIE, sessionCookie, verifySession } from './session.mjs';

const hub = 'https://balagan.live';
const pendingCookie = '__Host-balagan-handoff';
const attrs = '; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=';
const hex = bytes => Array.from(bytes, n => n.toString(16).padStart(2, '0')).join('');
const random = length => hex(crypto.getRandomValues(new Uint8Array(length)));
const proof = async value => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
function cookie(request, name) {
  return request.headers.get('Cookie')?.split(/;\s*/).find(c => c.startsWith(name + '='))?.slice(name.length + 1);
}
function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
  for (const value of cookies) headers.append('Set-Cookie', value);
  return new Response(null, { status: 303, headers });
}
function safePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(value)) return '/';
  const url = new URL(value, 'https://game.invalid');
  return url.origin === 'https://game.invalid' ? url.pathname + url.search + url.hash : '/';
}
function hubFetch(env,path,init) {
  return env.BALAGAN.fetch(new Request(hub + path, init));
}

export async function gameAuth(request, env, game) {
  const url = new URL(request.url);
  if (request.method !== 'GET') return null;
  if (url.pathname === '/auth/start') {
    const verifier = random(32), state = random(16);
    const next = safePath(url.searchParams.get('next'));
    const challenge = await proof(verifier);
    const target = url.searchParams.get('action') === 'register' ? '/register' : '/api/authorize';
    const query = new URLSearchParams({ game, challenge, state });
    return redirect(hub + target + '?' + query, [
      pendingCookie + '=' + encodeURIComponent(JSON.stringify({ verifier,state,next })) + attrs + '900'
    ]);
  }
  if (url.pathname !== '/auth/callback') return null;
  let pending;
  try { pending = JSON.parse(decodeURIComponent(cookie(request,pendingCookie) || 'null')); }
  catch { pending = null; }
  const code = url.searchParams.get('code');
  if (!pending || !code || pending.state !== url.searchParams.get('state')) return new Response('Sign-in expired. Return to the game and sign in again.',{status:400});
  const result = await hubFetch(env, '/api/exchange', { method:'POST', headers:{
    'X-Balagan-Game':game, 'X-Balagan-Code':code, 'X-Balagan-Proof':pending.verifier
  }});
  if (!result.ok) return new Response('Sign-in expired. Return to the game and sign in again.', { status: 401 });
  const { token, expiresAt } = await result.json();
  if (!await verifySession(env.BALAGAN_JWT_SECRET, token, game)) return new Response('Could not verify sign-in.', {status:502});
  return redirect(safePath(pending.next), [
    pendingCookie + '=' + attrs + '0', sessionCookie(token,expiresAt)
  ]);
}

export async function gameUser(request, env, game) {
  const token = cookie(request, SESSION_COOKIE);
  if (!await verifySession(env.BALAGAN_JWT_SECRET, token, game)) return null;
  const result = await hubFetch(env, '/api/session', { headers:{ 'X-Balagan-Game':game, Authorization:'Bearer ' + token }});
  if (result.status === 401) return null;
  if (!result.ok) throw new Error('Balagan could not confirm the session.');
  return result.json();
}
