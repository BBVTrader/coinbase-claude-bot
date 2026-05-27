
import { createRequire } from 'module';
const req = createRequire('/Users/robertbiddlev/coinbase-claude-bot/mcp-server/package.json');
const { CBAdvancedTradeClient } = req('coinbase-api');
import { readFileSync } from 'fs';
const key = JSON.parse(readFileSync('/Users/robertbiddlev/Downloads/cdp_api_key.json','utf8'));
const client = new CBAdvancedTradeClient({ apiKey: key.name, apiSecret: key.privateKey });
const accounts = await client.getAccounts();
console.log('SUCCESS!', JSON.stringify(accounts?.accounts?.slice(0,2), null, 2));
