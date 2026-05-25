#!/usr/bin/env node
/**
 * Coinbase Advanced Trade MCP Server
 * Bridges Claude Code to Coinbase Advanced API via JWT auth.
 *
 * Env vars required:
 *   COINBASE_API_KEY_NAME  (the "name" field from cdp_api_key.json)
 *   COINBASE_PRIVATE_KEY   (the "privateKey" field from cdp_api_key.json)
 *   SUPABASE_URL, SUPABASE_SERVICE_KEY
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { CoinbaseClient }  from './coinbase-client.js';
import { RiskGate }        from './risk-gate.js';
import { SupabaseLogger }  from './supabase-logger.js';

const client = new CoinbaseClient();
const risk   = new RiskGate(client);
const logger = new SupabaseLogger();
const server = new Server({ name: 'coinbase-mcp', version: '1.0.0' }, { capabilities: { tools: {} } });

const READ_TOOLS = [
  { name: 'get_klines',         description: 'OHLCV candles for a Coinbase product (e.g. BTC-USD)', inputSchema: { type:'object', properties:{ symbol:{type:'string'}, interval:{type:'string',enum:['1','5','15','60','240','D','W']}, n:{type:'number',default:100} }, required:['symbol','interval'] } },
  { name: 'get_orderbook',      description: 'Order book bids and asks', inputSchema: { type:'object', properties:{ symbol:{type:'string'}, depth:{type:'number',default:25} }, required:['symbol'] } },
  { name: 'get_ticker',         description: 'Last price, 24h volume', inputSchema: { type:'object', properties:{ symbol:{type:'string'} }, required:['symbol'] } },
  { name: 'get_wallet_balance', description: 'Account balances and equity', inputSchema: { type:'object', properties:{} } },
  { name: 'get_positions',      description: 'Open positions (spot orders)', inputSchema: { type:'object', properties:{} } },
  { name: 'get_open_orders',    description: 'All open unfilled orders', inputSchema: { type:'object', properties:{} } },
  { name: 'get_trade_history',  description: 'Recent filled orders', inputSchema: { type:'object', properties:{ days:{type:'number',default:7} } } },
  { name: 'get_funding_rate',   description: 'Funding rate (n/a for spot)', inputSchema: { type:'object', properties:{ symbol:{type:'string'} }, required:['symbol'] } }
];

const WRITE_TOOLS = [
  { name: 'place_order',    description: 'Place a limit or market order. Passes through risk gate.', inputSchema: { type:'object', properties:{ symbol:{type:'string',description:'e.g. BTC-USD'}, side:{type:'string',enum:['Buy','Sell']}, qty:{type:'number'}, leverage:{type:'number',default:1}, order_type:{type:'string',enum:['Limit','Market'],default:'Limit'}, price:{type:'number'}, rationale:{type:'string'} }, required:['symbol','side','qty'] } },
  { name: 'cancel_order',   description: 'Cancel an open order', inputSchema: { type:'object', properties:{ symbol:{type:'string'}, order_id:{type:'string'} }, required:['symbol','order_id'] } },
  { name: 'set_leverage',   description: 'Set leverage (n/a for spot)', inputSchema: { type:'object', properties:{ symbol:{type:'string'}, leverage:{type:'number'} }, required:['symbol','leverage'] } },
  { name: 'set_tp_sl',      description: 'Set take-profit / stop-loss', inputSchema: { type:'object', properties:{ symbol:{type:'string'}, take_profit:{type:'number'}, stop_loss:{type:'number'} }, required:['symbol'] } },
  { name: 'close_position', description: 'Close a position / sell holdings', inputSchema: { type:'object', properties:{ symbol:{type:'string'}, qty:{type:'number'} }, required:['symbol'] } }
];

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [...READ_TOOLS, ...WRITE_TOOLS] }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const isWrite = WRITE_TOOLS.some(t => t.name === name);
  let riskResult = { passed: true, reason: null };
  try {
    if (isWrite) {
      riskResult = await risk.check(name, args);
      if (!riskResult.passed) {
        await logger.auditLog(name, args, null, false, riskResult.reason);
        return { content: [{ type:'text', text: JSON.stringify({ error:'RISK_GATE_BLOCKED', reason:riskResult.reason }) }] };
      }
    }
    const response = await dispatch(name, args);
    await logger.auditLog(name, args, response, riskResult.passed, riskResult.reason);
    return { content: [{ type:'text', text: JSON.stringify(response) }] };
  } catch (err) {
    await logger.auditLog(name, args, null, false, err.message);
    return { content: [{ type:'text', text: JSON.stringify({ error: err.message }) }] };
  }
});

async function dispatch(name, args) {
  switch (name) {
    case 'get_klines':         return client.getKlines(args.symbol, args.interval, args.n ?? 100);
    case 'get_orderbook':      return client.getOrderbook(args.symbol, args.depth ?? 25);
    case 'get_ticker':         return client.getTicker(args.symbol);
    case 'get_funding_rate':   return client.getFundingRate(args.symbol);
    case 'get_wallet_balance': return client.getWalletBalance();
    case 'get_positions':      return client.getPositions();
    case 'get_open_orders':    return client.getOpenOrders();
    case 'get_trade_history':  return client.getTradeHistory(args.days ?? 7);
    case 'place_order':        return client.placeOrder(args);
    case 'cancel_order':       return client.cancelOrder(args.symbol, args.order_id);
    case 'set_leverage':       return client.setLeverage(args.symbol, args.leverage);
    case 'set_tp_sl':          return client.setTpSl(args.symbol, args.take_profit, args.stop_loss);
    case 'close_position':     return client.closePosition(args.symbol, args.qty);
    default:                   throw new Error(`Unknown tool: ${name}`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('Coinbase MCP server running');
