#!/usr/bin/env node
/**
 * Gmail OAuth2 Re-authentication Script
 * ======================================
 * Run this when GMAIL_REFRESH_TOKEN has expired / been revoked (invalid_grant).
 *
 * Usage:
 *   node scripts/gmail-reauth.js
 *   node scripts/gmail-reauth.js --email=you@example.com
 *
 * If the browser opens on the wrong Google account, this script uses
 * prompt=select_account+consent so Google shows the account picker. You can
 * also set GMAIL_LOGIN_HINT in apps/api-gateway/.env (or pass --email).
 *
 * What it does:
 *   1. Starts a local server on port 3001 to receive the OAuth callback
 *   2. Prints an authorization URL — opens it automatically (or copy it)
 *   3. Authorize with the wineops.ai@gmail.com account in your browser
 *   4. Prints the new GMAIL_REFRESH_TOKEN and GMAIL_ACCESS_TOKEN
 *   5. Copy GMAIL_REFRESH_TOKEN into Railway env vars and your .env file
 *
 * Requirements:
 *   - Add http://localhost:3001/oauth2callback to your Google Cloud Console
 *     OAuth2 client's "Authorized redirect URIs"
 *     (APIs & Services → Credentials → your OAuth client → Edit)
 */

const http = require('http');
const path = require('path');
const url = require('url');

const envPath = path.resolve(__dirname, '../apps/api-gateway/.env');
// Parse .env manually to avoid dotenv dep at root
const fs = require('fs');

function stripEnvValue(raw) {
  let v = raw.trim();
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  ) {
    v = v.slice(1, -1);
  }
  return v.trim();
}

if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
    const eq = line.indexOf('=');
    if (eq > 0) {
      const k = line.slice(0, eq).trim();
      let v = stripEnvValue(line.slice(eq + 1));
      if (k && !process.env[k]) process.env[k] = v;
    }
  });
}

const googleapis = (() => {
  try { return require(path.resolve(__dirname, '../apps/api-gateway/node_modules/googleapis')); }
  catch { return require('googleapis'); }
})();
const { google } = googleapis;

const clientId     = stripEnvValue(process.env.GMAIL_CLIENT_ID     || process.env.OAUTH_CLIENT_ID     || '');
const clientSecret = stripEnvValue(process.env.GMAIL_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET || '');

const emailArg = process.argv.find((a) => a.startsWith('--email='));
const emailFromCli = emailArg ? emailArg.slice('--email='.length).trim() : '';
/** Prefer explicit OAuth hint: same mailbox you want the refresh token for. */
const loginHint =
  emailFromCli ||
  process.env.GMAIL_LOGIN_HINT ||
  process.env.GMAIL_SENDER_EMAIL ||
  process.env.GMAIL_USER ||
  '';

if (!clientId || !clientSecret) {
  console.error('❌  GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in apps/api-gateway/.env');
  process.exit(1);
}

const PORT = 3001;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.modify',
];

const authUrlOpts = {
  access_type: 'offline',
  scope: SCOPES,
  // Always show Google's account chooser so you are not stuck on the default session.
  prompt: 'select_account consent',
};
if (loginHint && loginHint.includes('@')) {
  authUrlOpts.login_hint = loginHint;
}

const authUrl = oauth2Client.generateAuthUrl(authUrlOpts);

console.log('\n════════════════════════════════════════════════════════════');
console.log('  Gmail Re-Authorization — WineOps AI');
console.log('════════════════════════════════════════════════════════════\n');
if (loginHint) {
  console.log(`Account hint (you can still pick another on Google's screen): ${loginHint}\n`);
} else {
  console.log('No login hint set — Google will show all accounts. Set GMAIL_LOGIN_HINT or use --email=you@gmail.com to pre-select.\n');
}
console.log('TIP: If the wrong account opens, use a private/incognito window, sign in only to the sender mailbox, then paste the URL below.\n');
console.log('IMPORTANT: Google Cloud → APIs & Services → Credentials → your OAuth client:');
console.log(`   • Application type must be **Web application** (not Desktop / iOS / TV).`);
console.log(`   • Authorized redirect URIs must include exactly:`);
console.log(`     ${REDIRECT_URI}`);
console.log('   • Optional: also add http://127.0.0.1:3001/oauth2callback if localhost behaves oddly.\n');
console.log(`Using OAuth client_id prefix: ${clientId.slice(0, 12)}…\n`);
console.log('Opening browser for authorization — choose the Gmail account that should SEND mail...\n');
console.log('If the browser does not open, paste this URL manually:');
console.log('\n   ' + authUrl + '\n');

// Try to open browser automatically
try {
  const { execSync } = require('child_process');
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
  execSync(`${cmd} "${authUrl}"`, { stdio: 'ignore' });
} catch { /* ignore — user can paste the URL */ }

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (s) => s.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  if (parsed.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end();
    return;
  }

  const code = parsed.query.code;
  const errParam = parsed.query.error;

  if (errParam) {
    // `errParam` is a query-string value, so it is attacker-supplied whenever
    // someone can get this short-lived localhost server to load a crafted URL.
    // Escaping it keeps the reflected value out of the DOM (js/reflected-xss);
    // stripping control characters keeps it from forging terminal lines
    // (js/log-injection).
    const safeHtml = escapeHtml(String(errParam));
    // JSON.stringify rather than a control-character strip: it escapes CR/LF
    // into \r\n literals, quotes the result so the boundary of the untrusted
    // value is visible in the terminal, and is a form both a reader and a
    // static analyser recognise as encoded.
    const safeLog = JSON.stringify(String(errParam).slice(0, 200));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2>❌ Authorization denied: ${safeHtml}</h2><p>Close this tab and check the terminal.</p>`);
    console.error(`\n❌  Authorization denied: ${safeLog}`);
    server.close();
    return;
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h2>❌ No code received</h2>');
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken({
      code,
      redirect_uri: REDIRECT_URI,
    });

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <h2>✅ Authorization successful!</h2>
      <p>Return to your terminal — the tokens have been printed there.</p>
      <p>You can close this tab.</p>
    `);

    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  ✅  New tokens — copy GMAIL_REFRESH_TOKEN into Railway + .env');
    console.log('════════════════════════════════════════════════════════════\n');

    if (tokens.refresh_token) {
      console.log('GMAIL_REFRESH_TOKEN=' + tokens.refresh_token);
    } else {
      console.log('⚠  No new refresh token returned.');
      console.log('   Revoke existing access first, then retry:');
      console.log('   https://myaccount.google.com/permissions → Remove WineOps AI → re-run script\n');
    }

    if (tokens.access_token) {
      console.log('\nGMAIL_ACCESS_TOKEN=' + tokens.access_token);
    }

    console.log('\nToken expiry:', tokens.expiry_date ? new Date(tokens.expiry_date).toISOString() : 'n/a');
    console.log('\nOnly GMAIL_REFRESH_TOKEN is permanent. Update it in Railway env vars, then redeploy.\n');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h2>❌ Token exchange failed</h2><pre>${err.message}</pre>`);
    console.error('\n❌  Token exchange failed:', err.message);
    const data = err.response?.data;
    if (data) console.error('    Google says:', JSON.stringify(data));
    if (String(err.message).includes('unauthorized_client') || data?.error === 'unauthorized_client') {
      console.error(`
Fix "unauthorized_client" (Google rejects this client for the code exchange):
  1. Open the SAME GCP project as this client_id (${clientId.slice(0, 16)}…).
  2. Credentials → OAuth 2.0 Client IDs → open that client → Type = Web application.
  3. Under "Authorized redirect URIs", add exactly:
       ${REDIRECT_URI}
     Save. Wait ~1–2 minutes, then run this script again (use a NEW auth URL).
  4. Copy Client ID + Client secret from THAT row into apps/api-gateway/.env (no extra quotes/spaces).
  5. Do not use a "Desktop app" client for this script — create Web application if needed.
  6. If you used an old bookmarked consent URL, close it — always paste the URL printed by this run.
`);
    }
  }

  server.close();
});

server.listen(PORT, () => {
  console.log(`Listening for OAuth callback on http://localhost:${PORT}/oauth2callback`);
  console.log('Waiting for browser authorization...\n');
});
