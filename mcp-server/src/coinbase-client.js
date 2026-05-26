import { createRequire } from 'module';
import { readFileSync } from 'fs';

const _require = createRequire(import.meta.url);
const { CBAdvancedTradeClient } = _require('coinbase-api');

const GRAN_MAP = {
  '1': 'ONE_MINUTE', '5': 'FIVE_MINUTE', '15': 'FIFTEEN_MINUTE',
  '60': 'ONE_HOUR', '240': 'FOUR_HOUR', 'D': 'ONE_DAY', 'W': 'ONE_WEEK'
};

function loadCredentials() {
  if (process.env.COINBASE_KEY_FILE) {
    const kf = JSON.parse(readFileSync(process.env.COINBASE_KEY_FILE, 'utf8'));
    return { apiKey: kf.name, apiSecret: kf.privateKey };
  }
  const apiKey = process.env.COINBASE_API_KEY_NAME;
  const apiSecret = (process.env.COINBASE_PRIVATE_KEY ?? '').replace(/\\n/g, '\n');
  if (!apiKey || !apiSecret) throw new Error('Set COINBASE_KEY_FILE or COINBASE_API_KEY_NAME + COINBASE_PRIVATE_KEY');
  return { apiKey, apiSecret };
}

export class CoinbaseClient {
  constructor() {
    this._client = new CBAdvancedTradeClient(loadCredentials());
  }

  async getKlines(symbol, interval, n = 100) {
    const gran = GRAN_MAP[interval] ?? 'ONE_HOUR';
    const secPerCandle = interval === 'D' ? 86400 : interval === 'W' ? 604800 : parseInt(interval) * 60;
    const end = Math.floor(Date.now() / 1000);
    const start = end - n * secPerCandle;
    const data = await this._client.getProductCandles({
      product_id: symbol, start: start.toString(), end: end.toString(), granularity: gran, limit: n
    });
    return (data.candles ?? []).reverse().map(c => ({
      time: parseInt(c.start) * 1000, open: parseFloat(c.open),
      high: parseFloat(c.high), low: parseFloat(c.low),
      close: parseFloat(c.close), volume: parseFloat(c.volume)
    }));
  }

  async getOrderbook(symbol, depth = 25) {
    const data = await this._client.getProductBook({ product_id: symbol, limit: depth });
    return {
      bids: (data.pricebook?.bids ?? []).map(b => [parseFloat(b.price), parseFloat(b.size)]),
      asks: (data.pricebook?.asks ?? []).map(a => [parseFloat(a.price), parseFloat(a.size)])
    };
  }

  async getTicker(symbol) {
    const data = await this._client.getProduct({ product_id: symbol });
    return {
      symbol,
      last_price: parseFloat(data.price ?? 0),
      bid: parseFloat(data.best_bid ?? 0),
      ask: parseFloat(data.best_ask ?? 0),
      volume_24h: parseFloat(data.volume_24h ?? 0),
      funding_rate: null
    };
  }

  async getWalletBalance() {
    const data = await this._client.getAccounts({ limit: 250 });
    const accounts = data.accounts ?? [];
    const usdAccount = accounts.find(a => a.currency === 'USD') ?? {};
    const availableUSD = parseFloat(usdAccount.available_balance?.value ?? 0);

    // Convert each holding to USD using live prices
    let totalEquityUSD = availableUSD;
    for (const a of accounts) {
      const bal = parseFloat(a.available_balance?.value ?? 0);
      if (!bal || a.currency === 'USD') continue;
      if (a.currency === 'USDC' || a.currency === 'USDT' || a.currency === 'DAI') {
        totalEquityUSD += bal; // stablecoins are 1:1
        continue;
      }
      try {
        const ticker = await this.getTicker(`${a.currency}-USD`);
        if (ticker.last_price > 0) totalEquityUSD += bal * ticker.last_price;
      } catch { /* skip illiquid/unlisted assets */ }
    }

    return {
      equity: totalEquityUSD,
      available: availableUSD,
      wallet_balance: availableUSD,
      unrealised_pnl: 0,
      margin_ratio: 0
    };
  }

  async getPositions() { return []; }

  async getOpenOrders() {
    const data = await this._client.getOrders({ order_status: ['OPEN'], limit: 50 });
    return (data.orders ?? []).map(o => ({
      order_id: o.order_id, symbol: o.product_id, side: o.side,
      qty: parseFloat(o.order_configuration?.limit_limit_gtc?.base_size ?? 0),
      price: parseFloat(o.order_configuration?.limit_limit_gtc?.limit_price ?? 0),
      order_type: o.order_type, status: o.status
    }));
  }

  async getTradeHistory(days = 7) {
    const start = new Date(Date.now() - days * 86400000).toISOString();
    const data = await this._client.getOrders({ order_status: ['FILLED'], start_date: start, limit: 100 });
    return (data.orders ?? []).map(o => ({
      symbol: o.product_id, side: o.side,
      qty: parseFloat(o.filled_size ?? 0),
      price: parseFloat(o.average_filled_price ?? 0),
      pnl: 0, fee: parseFloat(o.total_fees ?? 0), time: o.created_time
    }));
  }

  async getFundingRate(symbol) { return { symbol, rate: null }; }

  async placeOrder({ symbol, side, qty, order_type = 'Limit', price }) {
    const body = {
      client_order_id: `claude-${Date.now()}`,
      product_id: symbol,
      side: side === 'Buy' ? 'BUY' : 'SELL',
      order_configuration: {}
    };
    if (order_type === 'Market') {
      body.order_configuration.market_market_ioc = { base_size: qty.toString() };
    } else {
      body.order_configuration.limit_limit_gtc = {
        base_size: qty.toString(), limit_price: price.toString(), post_only: false
      };
    }
    return this._client.submitOrder(body);
  }

  async cancelOrder(symbol, order_id) {
    return this._client.cancelOrders({ order_ids: [order_id] });
  }

  async setLeverage(symbol, leverage) { return { note: 'Not applicable on Coinbase spot' }; }
  async setTpSl(symbol, take_profit, stop_loss) { return { note: 'Place as separate orders on Coinbase' }; }
  async closePosition(symbol, qty) { return { note: 'Cancel open orders instead' }; }
}
