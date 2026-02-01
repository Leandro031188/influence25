import fetch from 'node-fetch';

export function buildAuthUrl({ state, scopes }) {
  const clientId = process.env.META_CLIENT_ID;
  const redirectUri = process.env.META_REDIRECT_URI;
  const scope = encodeURIComponent(scopes.join(','));
  const url =
    `https://www.facebook.com/v19.0/dialog/oauth?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${encodeURIComponent(state)}` +
    `&response_type=code` +
    `&scope=${scope}`;
  return url;
}

export async function exchangeCodeForToken(code) {
  const clientId = process.env.META_CLIENT_ID;
  const clientSecret = process.env.META_CLIENT_SECRET;
  const redirectUri = process.env.META_REDIRECT_URI;
  const url =
    `https://graph.facebook.com/v19.0/oauth/access_token?client_id=${encodeURIComponent(clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&client_secret=${encodeURIComponent(clientSecret)}` +
    `&code=${encodeURIComponent(code)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Token exchange failed');
  return j; // { access_token, token_type, expires_in }
}

// Basic "me" — you will adapt endpoints/scopes depending on your IG product settings.
export async function fetchMe(accessToken) {
  const url = `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(accessToken)}`;
  const r = await fetch(url);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error?.message || 'Fetch me failed');
  return j;
}
