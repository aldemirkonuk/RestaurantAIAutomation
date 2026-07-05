#!/usr/bin/env node
/**
 * Audit API credentials — reports OK / FAIL / MISSING / SKIP (no secrets printed).
 * Usage: node scripts/audit-api-credentials.js
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.resolve(__dirname, '..');

function stripEnvValue(raw) {
  let v = String(raw || '').trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq <= 0 || line.trimStart().startsWith('#')) continue;
    const k = line.slice(0, eq).trim();
    const v = stripEnvValue(line.slice(eq + 1));
    if (k && process.env[k] === undefined) process.env[k] = v;
  }
}

['.env', 'apps/api-gateway/.env', 'services/agent-orchestrator/.env'].forEach((rel) => {
  loadEnvFile(path.join(ROOT, rel));
});

const results = [];

function record(name, status, detail) {
  results.push({ name, status, detail });
}

async function fetchJson(url, options = {}) {
  const lib = url.startsWith('https') ? https : http;
  return new Promise((resolve, reject) => {
    const req = lib.request(url, { method: options.method || 'GET', ...options }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        let json = null;
        try {
          json = JSON.parse(body);
        } catch {
          /* ignore */
        }
        resolve({ status: res.statusCode, body, json });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function testGmailOAuth() {
  const clientId = process.env.GMAIL_CLIENT_ID || process.env.OAUTH_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !refreshToken) {
    record('Gmail OAuth (refresh token)', 'MISSING', 'Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN');
    return;
  }
  try {
    const googleapis = require(path.join(ROOT, 'apps/api-gateway/node_modules/googleapis'));
    const { google } = googleapis;
    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });
    const { token } = await oauth2.getAccessToken();
    if (token) {
      record('Gmail OAuth (refresh token)', 'OK', 'Access token obtained');
    } else {
      record('Gmail OAuth (refresh token)', 'FAIL', 'No access token returned');
    }
  } catch (e) {
    const msg = e.message || String(e);
    const expired =
      /invalid_grant|expired|revoked|unauthorized_client|invalid_client/i.test(msg) ||
      (e.response?.data?.error && /invalid_grant|unauthorized_client/.test(e.response.data.error));
    record(
      'Gmail OAuth (refresh token)',
      expired ? 'EXPIRED' : 'FAIL',
      e.response?.data?.error_description || e.response?.data?.error || msg,
    );
  }
}

async function testGoogleGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    record('Google Gemini API', 'MISSING', 'GEMINI_API_KEY not set');
    return;
  }
  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Reply with exactly: ok' }] }],
        generationConfig: { maxOutputTokens: 5 },
      }),
    });
    if (res.status === 200) {
      record('Google Gemini API', 'OK', 'generateContent succeeded');
    } else if (res.status === 403 || res.status === 401) {
      const err = res.json?.error?.message || res.body.slice(0, 120);
      record('Google Gemini API', 'EXPIRED', err);
    } else {
      record('Google Gemini API', 'FAIL', `HTTP ${res.status}: ${res.json?.error?.message || 'unknown'}`);
    }
  } catch (e) {
    record('Google Gemini API', 'FAIL', e.message);
  }
}

async function testGoogleMaps() {
  const key = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
  if (!key) {
    record('Google Maps / Places API', 'MISSING', 'VITE_GOOGLE_MAPS_API_KEY not set');
    return;
  }
  try {
    const url = `https://places.googleapis.com/v1/places:autocomplete?key=${encodeURIComponent(key)}`;
    const res = await fetchJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: 'test', languageCode: 'en' }),
    });
    if (res.status === 200) {
      record('Google Maps / Places API', 'OK', 'Places autocomplete responded');
    } else if (res.status === 403 || res.status === 401) {
      record('Google Maps / Places API', 'EXPIRED', res.json?.error?.message || 'API key invalid or restricted');
    } else {
      record('Google Maps / Places API', 'FAIL', `HTTP ${res.status}`);
    }
  } catch (e) {
    record('Google Maps / Places API', 'FAIL', e.message);
  }
}

async function testSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) {
    record('Supabase', 'MISSING', 'SUPABASE_URL or key not set');
    return;
  }
  try {
    const res = await fetchJson(`${url.replace(/\/$/, '')}/rest/v1/`, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
    });
    if (res.status === 200 || res.status === 404) {
      record('Supabase', 'OK', 'REST API reachable with key');
    } else if (res.status === 401 || res.status === 403) {
      record('Supabase', 'EXPIRED', `HTTP ${res.status} — key may be invalid`);
    } else {
      record('Supabase', 'FAIL', `HTTP ${res.status}`);
    }
  } catch (e) {
    record('Supabase', 'FAIL', e.message);
  }
}

async function testAnthropic() {
  const key = process.env.CLAUDE_API_KEY || process.env.ANTHROPIC_API_KEY;
  if (!key) {
    record('Anthropic (Claude)', 'MISSING', 'CLAUDE_API_KEY / ANTHROPIC_API_KEY not set');
    return;
  }
  try {
    const res = await fetchJson('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 5,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.status === 200) {
      record('Anthropic (Claude)', 'OK', 'API key accepted');
    } else if (res.status === 401) {
      record('Anthropic (Claude)', 'EXPIRED', 'Invalid or revoked API key');
    } else {
      record('Anthropic (Claude)', 'FAIL', `HTTP ${res.status}: ${res.json?.error?.message || 'unknown'}`);
    }
  } catch (e) {
    record('Anthropic (Claude)', 'FAIL', e.message);
  }
}

async function testOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key) {
    record('OpenAI', 'MISSING', 'OPENAI_API_KEY not set');
    return;
  }
  try {
    const res = await fetchJson('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
    });
    if (res.status === 200) {
      record('OpenAI', 'OK', 'API key accepted');
    } else if (res.status === 401) {
      record('OpenAI', 'EXPIRED', 'Invalid or revoked API key');
    } else {
      record('OpenAI', 'FAIL', `HTTP ${res.status}`);
    }
  } catch (e) {
    record('OpenAI', 'FAIL', e.message);
  }
}

async function testPlivo() {
  const id = process.env.PLIVO_AUTH_ID;
  const token = process.env.PLIVO_AUTH_TOKEN;
  if (!id || !token) {
    record('Plivo SMS', 'MISSING', 'PLIVO_AUTH_ID / PLIVO_AUTH_TOKEN not set');
    return;
  }
  try {
    const auth = Buffer.from(`${id}:${token}`).toString('base64');
    const res = await fetchJson(`https://api.plivo.com/v1/Account/${id}/`, {
      method: 'GET',
      headers: { Authorization: `Basic ${auth}` },
    });
    if (res.status === 200) {
      record('Plivo SMS', 'OK', 'Credentials accepted');
    } else if (res.status === 401 || res.status === 403) {
      record('Plivo SMS', 'EXPIRED', 'Invalid credentials');
    } else {
      record('Plivo SMS', 'FAIL', `HTTP ${res.status}`);
    }
  } catch (e) {
    record('Plivo SMS', 'FAIL', e.message);
  }
}

async function testSerper() {
  const key = process.env.SERPER_API_KEY;
  if (!key) {
    record('Serper (web search)', 'MISSING', 'SERPER_API_KEY not set');
    return;
  }
  try {
    const res = await fetchJson('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-KEY': key },
      body: JSON.stringify({ q: 'test', num: 1 }),
    });
    if (res.status === 200) {
      record('Serper (web search)', 'OK', 'API key accepted');
    } else if (res.status === 401 || res.status === 403) {
      record('Serper (web search)', 'EXPIRED', 'Invalid API key');
    } else {
      record('Serper (web search)', 'FAIL', `HTTP ${res.status}`);
    }
  } catch (e) {
    record('Serper (web search)', 'FAIL', e.message);
  }
}

async function testServiceHealth(name, url, healthPath = '/health') {
  if (!url) {
    record(name, 'MISSING', 'URL not set in env');
    return;
  }
  try {
    const res = await fetchJson(`${url.replace(/\/$/, '')}${healthPath}`);
    // Gateway health endpoints require auth — a 401 still proves the service is up and routed.
    if (res.status === 200 || res.status === 401) {
      record(name, 'OK', `HTTP ${res.status}`);
    } else {
      record(name, 'FAIL', `HTTP ${res.status}`);
    }
  } catch (e) {
    record(name, 'FAIL', e.message);
  }
}

async function testGmailAccessTokenIfSet() {
  const access = process.env.GMAIL_ACCESS_TOKEN;
  if (!access) {
    record('Gmail access token (env)', 'SKIP', 'GMAIL_ACCESS_TOKEN not set (short-lived; refresh token is what matters)');
    return;
  }
  try {
    const res = await fetchJson('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      method: 'GET',
      headers: { Authorization: `Bearer ${access}` },
    });
    if (res.status === 200) {
      record('Gmail access token (env)', 'OK', 'Still valid (will expire ~1h)');
    } else if (res.status === 401) {
      record('Gmail access token (env)', 'EXPIRED', 'Expected — use refresh token in production');
    } else {
      record('Gmail access token (env)', 'FAIL', `HTTP ${res.status}`);
    }
  } catch (e) {
    record('Gmail access token (env)', 'FAIL', e.message);
  }
}

async function main() {
  console.log('\nWineOps API credential audit\n' + '='.repeat(50));

  await testGmailOAuth();
  await testGmailAccessTokenIfSet();
  await testGoogleGemini();
  await testGoogleMaps();
  await testSupabase();
  await testAnthropic();
  await testOpenAI();
  await testPlivo();
  await testSerper();
  await testServiceHealth('API Gateway (deployed)', process.env.API_GATEWAY_URL, '/api/v1/health/agents');
  await testServiceHealth('Agent Orchestrator (deployed)', process.env.AGENT_ORCHESTRATOR_URL);

  const expired = results.filter((r) => r.status === 'EXPIRED');
  const fail = results.filter((r) => r.status === 'FAIL');
  const ok = results.filter((r) => r.status === 'OK');
  const missing = results.filter((r) => r.status === 'MISSING');
  const skip = results.filter((r) => r.status === 'SKIP');

  console.log('');
  for (const r of results) {
    const icon =
      r.status === 'OK' ? '✅' : r.status === 'EXPIRED' ? '🔴' : r.status === 'MISSING' ? '⚪' : r.status === 'SKIP' ? '⏭' : '⚠️';
    console.log(`${icon} ${r.name.padEnd(32)} ${r.status.padEnd(8)} ${r.detail}`);
  }

  console.log('\n' + '='.repeat(50));
  console.log(`Summary: ${ok.length} OK | ${expired.length} EXPIRED/invalid | ${fail.length} FAIL | ${missing.length} missing | ${skip.length} skipped`);
  console.log(`\nTreat as "expired or unusable": ${expired.length + fail.length} of ${results.length} checked\n`);

  process.exit(expired.length + fail.length > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
