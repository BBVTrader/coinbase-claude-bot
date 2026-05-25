import { CoinbaseClient } from '../mcp-server/src/coinbase-client.js';
import { SupabaseLogger } from '../mcp-server/src/supabase-logger.js';

const client = new CoinbaseClient();
const logger = new SupabaseLogger();

async function run() {
  const [wallet, positions] = await Promise.all([client.getWalletBalance(), client.getOpenOrders()]);
  await logger.snapshotEquity(wallet, positions);
  console.log(`[${new Date().toISOString()}] Monitor: equity $${wallet.equity.toFixed(2)} | open orders: ${positions.length}`);
}
run();
