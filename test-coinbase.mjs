import { createRequire } from 'module';
const require = createRequire('/Users/robertbiddlev/coinbase-claude-bot/mcp-server/package.json');
const { sign } = require('jsonwebtoken');
const crypto = require('crypto');

const key_name = process.env.COINBASE_API_KEY_NAME;
const key_secret = process.env.COINBASE_PRIVATE_KEY.replace(/\\n/g, '\n');

console.log('Key name:', key_name?.slice(0, 30) + '...');
console.log('Key starts with:', key_secret?.slice(0, 27));

const token = sign(
  { iss: 'cdp', nbf: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+120, sub: key_name },
  key_secret,
  { algorithm: 'ES256', header: { kid: key_name, nonce: crypto.randomBytes(16).toString('hex') } }
);

const res = await fetch('https://api.coinbase.com/api/v3/brokerage/accounts', {
  headers: { 'Authorization': 'Bearer ' + token }
});
const j = await res.json();
console.log(JSON.stringify(j?.accounts?.slice(0,2) ?? j, null, 2));
