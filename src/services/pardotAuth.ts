// ─────────────────────────────────────────────────────────────────────────────
// Pardot API v5 — OAuth2 token service
//
// Uses Salesforce Connected App (username-password OAuth flow) to obtain an
// access token that carries the pardot_api scope. The token is cached in
// memory and refreshed automatically when it expires (~2 hours).
//
// Required env vars:
//   SF_CLIENT_ID     — External Client App Consumer Key
//   SF_CLIENT_SECRET — External Client App Consumer Secret
// No username/password needed — Client Credentials flow is server-to-server only.
//
// Usage:
//   import { getPardotToken } from '../services/pardotAuth.js';
//   const token = await getPardotToken();  // Bearer token for Pardot v5
// ─────────────────────────────────────────────────────────────────────────────

interface TokenCache {
  token:     string;
  expiresAt: number; // ms since epoch
}

let cache: TokenCache | null = null;

export const PARDOT_BU_ID   = '0UvHp000000CavpKAC';
export const PARDOT_V5_BASE = 'https://pi.pardot.com/api/v5/objects';

export async function getPardotToken(): Promise<string> {
  // Return cached token if still valid (5-min buffer before real expiry)
  if (cache && Date.now() < cache.expiresAt - 5 * 60_000) {
    return cache.token;
  }

  const clientId     = process.env.SF_CLIENT_ID;
  const clientSecret = process.env.SF_CLIENT_SECRET;
  // Client Credentials flow must hit the org's instance URL, not login.salesforce.com
  const instanceUrl  = process.env.SF_INSTANCE_URL ?? 'https://progressivedental.my.salesforce.com';

  if (!clientId || !clientSecret) {
    throw new Error(
      'Missing Pardot OAuth credentials. Set SF_CLIENT_ID and SF_CLIENT_SECRET in your environment.'
    );
  }

  const body = new URLSearchParams({
    grant_type:    'client_credentials',
    client_id:     clientId,
    client_secret: clientSecret,
  });

  const resp = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method:  'POST',
    body,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });

  const data = await resp.json() as {
    access_token?: string;
    error?:        string;
    error_description?: string;
  };

  if (!data.access_token) {
    throw new Error(
      `Pardot OAuth failed: ${data.error ?? 'unknown'} — ${data.error_description ?? JSON.stringify(data)}`
    );
  }

  // Salesforce access tokens issued via username-password flow last ~2 hours
  cache = { token: data.access_token, expiresAt: Date.now() + 2 * 60 * 60_000 };
  return data.access_token;
}

// Convenience: make a Pardot v5 API GET request
export async function pardotV5Get<T>(
  endpoint: string,
  params: Record<string, string> = {},
): Promise<T> {
  const token = await getPardotToken();
  const url   = new URL(`${PARDOT_V5_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const resp = await fetch(url.toString(), {
    headers: {
      Authorization:           `Bearer ${token}`,
      'Pardot-Business-Unit-Id': PARDOT_BU_ID,
    },
  });

  const result = await resp.json() as T & { code?: number; message?: string };

  if (!resp.ok) {
    throw new Error(`Pardot v5 error ${resp.status}: ${result.message ?? JSON.stringify(result)}`);
  }

  return result;
}
