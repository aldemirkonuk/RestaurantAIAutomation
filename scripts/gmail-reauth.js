#!/usr/bin/env node
/**
 * Gmail OAuth2 Re-authentication Script
 * ======================================
 * Run this when GMAIL_REFRESH_TOKEN has expired / been revoked (invalid_grant).
 *
 * Usage:
 *   node scripts/gmail-reauth.js
 *
 * What it does:
 *   1. Prints an authorization URL — open it in your browser
 *   2. Authorize with the wineops.ai@gmail.com account
 *   3. Paste the code Google gives you back into this terminal
 *   4. Prints the new GMAIL_REFRESH_TOKEN and GMAIL_ACCESS_TOKEN
 *   5. Copy those values into your .env file
 */

const path = require('path');
const readline = require('readline');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

// googleapis lives in the api-gateway package
const googleapis = (() => {
  try { return require('./apps/api-gateway/node_modules/googleapis'); }
  catch { return require('googleapis'); }
})();
const { google } = googleapis;

const clientId     = process.env.GMAIL_CLIENT_ID     || process.env.OAUTH_CLIENT_ID;
const clientSecret = process.env.GMAIL_CLIENT_SECRET || process.env.OAUTH_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('❌  GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET must be set in .env');
  process.exit(1);
}

// Use localhost redirect — matches "Web application" credential's allowed redirect URIs.
// If you get a redirect_uri_mismatch error, add http://localhost:3000/oauth2callback to your
// Google Cloud Console → Credentials → OAuth2 Client → Authorized redirect URIs.
const REDIRECT_URI = 'urn:ietf:wg:oauth:2.0:oob'; // out-of-band — no redirect server needed

const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.readonly',
];

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: SCOPES,
  prompt: 'consent', // force re-consent so Google issues a new refresh token
});

console.log('\n════════════════════════════════════════════════════════════');
console.log('  Gmail Re-Authorization — WineOps AI');
console.log('════════════════════════════════════════════════════════════\n');
console.log('1. Open this URL in your browser (use wineops.ai@gmail.com):\n');
console.log('   ' + authUrl);
console.log('\n2. Authorize the app, then copy the code Google shows you.\n');

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.question('3. Paste the code here → ', async (code) => {
  rl.close();
  try {
    const { tokens } = await oauth2Client.getToken(code.trim());
    console.log('\n════════════════════════════════════════════════════════════');
    console.log('  ✅  New tokens received — copy these into your .env file:');
    console.log('════════════════════════════════════════════════════════════\n');
    if (tokens.refresh_token) {
      console.log('GMAIL_REFRESH_TOKEN=' + tokens.refresh_token);
    } else {
      console.log('⚠  No new refresh token returned.');
      console.log('   If you already authorized this app before, revoke access first:');
      console.log('   https://myaccount.google.com/permissions → Remove WineOps AI → retry\n');
    }
    if (tokens.access_token) {
      console.log('GMAIL_ACCESS_TOKEN=' + tokens.access_token);
    }
    console.log('\nToken expiry:', new Date(tokens.expiry_date).toISOString());
    console.log('\nRemember: Access tokens expire in ~1 hour.');
    console.log('Only GMAIL_REFRESH_TOKEN is permanent (keep it secret).\n');
  } catch (err) {
    console.error('\n❌  Token exchange failed:', err.message);
    if (err.response?.data) {
      console.error('    Google says:', JSON.stringify(err.response.data));
    }
  }
});
