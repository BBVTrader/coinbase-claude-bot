/**
 * Risk Gate for Coinbase Advanced (spot trading).
 * Adapted from the Bybit version — leverage checks removed.
 */

import fs from 'fs';

const KILL_SWITCH_PATH    = process.env.KILL_SWITCH_PATH    ?? '/tmp/HALT_TRADING';
const MAX_DAILY_DRAWDOWN  = parseFloat(process.env.MAX_DAILY_DRAWDOWN  ?? '-0.05');
const MAX_NOTIONAL_PCT    = parseFloat(process.env.MAX_NOTIONAL_PCT    ?? '0.30');
const MAX_CONCURRENT      = parseInt(process.env.MAX_CONCURRENT        ?? '3');
const PRICE_SANITY_PCT    = parseFloat(process.env.PRICE_SANITY_PCT    ?? '0.02');

export class RiskGate {
  constructor(client) {
    this.client = client;
  }

  async check(toolName, args) {
    // 1. Kill switch
    if (fs.existsSync(KILL_SWITCH_PATH)) {
      return { passed: false, reason: `Kill switch active: ${KILL_SWITCH_PATH} exists` };
    }

    const wallet = await this.client.getWalletBalance();
    const nav    = wallet.equity;

    if (toolName === 'place_order') {
      const { symbol, qty, price, order_type } = args;

      // 2. Notional cap
      const ticker      = await this.client.getTicker(symbol);
      const refPrice    = price ?? ticker.last_price;
      const notional    = qty * refPrice;
      const notionalPct = notional / nav;
      if (notionalPct > MAX_NOTIONAL_PCT) {
        return { passed: false, reason: `Notional cap: order is ${(notionalPct*100).toFixed(1)}% of NAV (limit ${MAX_NOTIONAL_PCT*100}%)` };
      }

      // 3. Price sanity for limit orders
      if (order_type === 'Limit' && price) {
        const deviation = Math.abs(price - ticker.last_price) / ticker.last_price;
        if (deviation > PRICE_SANITY_PCT) {
          return { passed: false, reason: `Price sanity: limit ${price} deviates ${(deviation*100).toFixed(2)}% from market ${ticker.last_price}` };
        }
      }

      // 4. Concurrent open orders cap
      const openOrders = await this.client.getOpenOrders();
      const symbols = [...new Set(openOrders.map(o => o.symbol))];
      if (!symbols.includes(symbol) && symbols.length >= MAX_CONCURRENT) {
        return { passed: false, reason: `Concurrent cap: already have orders on ${symbols.length} symbols (limit ${MAX_CONCURRENT})` };
      }
    }

    return { passed: true, reason: null };
  }
}
