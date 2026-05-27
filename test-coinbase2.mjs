import { createRequire } from 'module';
const require = createRequire('/Users/robertbiddlev/coinbase-claude-bot/mcp-server/package.json');
const { Coinbase, CoinbaseOptions } = require('@coinbase/coinbase-sdk');
import { readFileSync } from 'fs';

const keyFile = JSON.parse(readFileSync('/Users/robertbiddlev/Downloads/cdp_api_key.json', 'utf8'));

const coinbase = new Coinbase({
  apiKeyName: keyFile.name,
  privateKey: keyFile.privateKey
});

try {
  const accounts = await coinbase.getAccounts();
  console.log('SUCCESS! Accounts:', JSON.stringify(accounts, null, 2));
} catch (e) {
  console.log('Error:', e.message);
}
