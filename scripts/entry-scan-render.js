/**
 * Coinbase BBV Claude Bot — Render Edition (No API Credits)
 * 
 * Strategy logic hardcoded in JS — no Claude/Anthropic API needed.
 * Runs as continuous loop on Render free tier.
 * Persistent disk at /data for trade logs.
 * 
 * Strategy from CLAUDE.md:
 * - Bias: price vs 50D EMA + RSI + 4H structure
 * - Entry: swing level + RSI <75 + volume > 20avg + MACD aligned + 2:1 R/R
 * - Size: 1% equity risk per trade
 * - Stop: below swing low + 0.3% buffer
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env
const envPath = pathResolve(__dirname, "../.env");
try {
  readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const m = line.match(/^([^#][^=]*)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

const { CoinbaseClient } = await import("../mcp-server/src/coinbase-client.js");
const { SupabaseLogger } = await import("../mcp-server/src/supabase-logger.js");

const client   = new CoinbaseClient();
const logger   = new SupabaseLogger();
const INTERVAL = 15 * 60 * 1000; // 15 minutes
const SYMBOLS  = ["BTC-USD", "ETH-USD", "SOL-USD"];

// =============================================================================
// TECHNICAL INDICATORS
// =============================================================================

function ema(closes, period) {
  const k = 2 / (period + 1);
  let val  = closes[0];
  for (let i = 1; i < closes.length; i++) {
    val = closes[i] * k + val * (1 - k);
  }
  return val;
}

function rsi(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const rs = gains / (losses || 0.001);
  return 100 - 100 / (1 + rs);
}

function macd(closes) {
  const ema12 = ema(closes.slice(-26), 12);
  const ema26 = ema(closes.slice(-26), 26);
  return ema12 - ema26;
}

function avgVolume(candles, period = 20) {
  const vols = candles.slice(-period - 1, -1).map(c => c.volume);
  return vols.reduce((a, b) => a + b, 0) / vols.length;
}

function swingLow(candles, lookback = 10) {
  return Math.min(...candles.slice(-lookback).map(c => c.low));
}

function swingHigh(candles, lookback = 10) {
  return Math.max(...candles.slice(-lookback).map(c => c.high));
}

// 4H structure — higher highs + higher lows = bullish, opposite = bearish
function get4HStructure(candles4h) {
  const recent = candles4h.slice(-8);
  const highs  = recent.map(c => c.high);
  const lows   = recent.map(c => c.low);
  const hhhl   = highs[highs.length-1] > highs[0] && lows[lows.length-1] > lows[0];
  const lhll   = highs[highs.length-1] < highs[0] && lows[lows.length-1] < lows[0];
  return hhhl ? "BULLISH" : lhll ? "BEARISH" : "NEUTRAL";
}

// =============================================================================
// STRATEGY ENGINE
// =============================================================================

async function analyzeSymbol(symbol) {
  try {
    const [daily, h4] = await Promise.all([
      client.getKlines(symbol, "D", 100),
      client.getKlines(symbol, "240", 60),
    ]);

    const closes     = daily.map(c => c.close);
    const price      = closes[closes.length - 1];
    const ema50      = ema(closes.slice(-50), 50);
    const rsi14      = rsi(closes);
    const macdVal    = macd(closes);
    const lastVol    = daily[daily.length - 1].volume;
    const avgVol     = avgVolume(daily);
    const structure  = get4HStructure(h4);
    const swing_low  = swingLow(daily);
    const swing_high = swingHigh(daily);

    // === BIAS DETERMINATION ===
    let bias = "NEUTRAL";
    if (price > ema50 && rsi14 >= 45 && rsi14 <= 75 && structure === "BULLISH") {
      bias = "BULLISH";
    } else if (price < ema50 && rsi14 < 45 && structure === "BEARISH") {
      bias = "BEARISH";
    }

    // === ENTRY CRITERIA (all must be true for BULLISH) ===
    const criteria = {
      hasBias:       bias === "BULLISH",
      rsiOk:         rsi14 < 75,
      volumeOk:      lastVol > avgVol,
      macdAligned:   macdVal > 0,
      atGoodLevel:   price <= ema50 * 1.02, // near EMA or pullback
    };

    const allMet     = Object.values(criteria).every(Boolean);
    const metCount   = Object.values(criteria).filter(Boolean).length;

    // === POSITION SIZING ===
    // Risk 1% of equity, stop = swing_low - 0.3% buffer
    let stopLoss     = null;
    let targetPrice  = null;
    let riskReward   = null;

    if (allMet) {
      stopLoss    = swing_low * (1 - 0.003);
      const risk  = price - stopLoss;
      targetPrice = price + (risk * 2); // 2:1 R/R
      riskReward  = 2.0;
    }

    return {
      symbol,
      price,
      ema50:      parseFloat(ema50.toFixed(2)),
      rsi14:      parseFloat(rsi14.toFixed(1)),
      macd:       parseFloat(macdVal.toFixed(2)),
      lastVol:    parseFloat(lastVol.toFixed(0)),
      avgVol:     parseFloat(avgVol.toFixed(0)),
      structure,
      bias,
      criteria,
      allMet,
      metCount,
      stopLoss:   stopLoss   ? parseFloat(stopLoss.toFixed(2))   : null,
      targetPrice: targetPrice ? parseFloat(targetPrice.toFixed(2)) : null,
      riskReward,
    };
  } catch (err) {
    return { symbol, error: err.message };
  }
}

// =============================================================================
// TRADE LOGGING
// =============================================================================

const TRADE_LOG = existsSync("/data") ? "/data/trades.json" : "/tmp/trades.json";

function logSignal(signal) {
  const record = {
    ts:        new Date().toISOString(),
    ...signal,
  };
  try {
    const line = JSON.stringify(record) + "\n";
    const fs   = { appendFileSync: (path, data) => {
      import("fs").then(m => m.appendFileSync(path, data));
    }};
    import("fs").then(m => m.appendFileSync(TRADE_LOG, line));
  } catch {}
}

// =============================================================================
// MAIN SCAN LOOP
// =============================================================================

let cycleCount = 0;
let lastScan   = null;
let lastReport = "";
let isRunning  = false;
const startTime = Date.now();

async function runScan() {
  if (isRunning) return;
  isRunning = true;
  const scanStart = Date.now();
  cycleCount++;

  console.log(`\n[${ new Date().toISOString()}] === Scan #${cycleCount} ===`);

  try {
    const [wallet, positions] = await Promise.all([
      client.getWalletBalance(),
      client.getPositions(),
    ]);

    console.log(`Equity: $${wallet.equity.toFixed(2)} | Available: $${wallet.available.toFixed(2)} | Positions: ${positions.length}`);

    // Analyze all symbols
    const analyses = await Promise.all(SYMBOLS.map(analyzeSymbol));

    let report = `Scan #${cycleCount} @ ${new Date().toISOString()}\n`;
    report    += `Equity: $${wallet.equity.toFixed(2)} | Available: $${wallet.available.toFixed(2)}\n\n`;

    const setups = [];

    for (const a of analyses) {
      if (a.error) {
        report += `${a.symbol}: ERROR — ${a.error}\n`;
        continue;
      }

      const volFlag  = a.lastVol > a.avgVol ? "✓" : "✗";
      const macdFlag = a.macd > 0 ? "✓" : "✗";
      const rsiFlag  = a.rsi14 < 75 ? "✓" : "✗";

      report += `${a.symbol.padEnd(10)} bias=${a.bias.padEnd(8)} RSI=${a.rsi14} MACD=${a.macd > 0 ? "+" : ""}${a.macd} vol=${volFlag} structure=${a.structure}\n`;
      report += `  price=$${a.price} ema50=$${a.ema50} criteria met: ${a.metCount}/5\n`;

      if (a.allMet) {
        report += `  *** SETUP FOUND *** stop=$${a.stopLoss} target=$${a.targetPrice} R/R=2:1\n`;
        setups.push(a);
        logSignal({ type: "SETUP", ...a });
      }
    }

    // Risk gate — only trade if we have available USD
    if (setups.length > 0 && wallet.available > 50) {
      report += `\n⚡ ${setups.length} setup(s) found with $${wallet.available.toFixed(2)} available\n`;
      report += `NOTE: Auto-execution not enabled — review setups and place manually or enable auto-trade\n`;
      // TODO: add order placement here once validated
    } else if (setups.length > 0) {
      report += `\nSetups found but insufficient USD available ($${wallet.available.toFixed(2)})\n`;
    } else {
      report += `\nNo setups — market conditions don't meet all 5 criteria\n`;
    }

    lastReport = report;
    lastScan   = new Date().toISOString();
    console.log(report);

    // Log to Supabase
    await logger.syncPositions(positions);
    await logger.snapshotEquity(wallet, positions);

    const elapsed = ((Date.now() - scanStart) / 1000).toFixed(1);
    console.log(`Scan complete in ${elapsed}s — next scan in 15 minutes`);

  } catch (err) {
    console.error(`Scan error: ${err.message}`);
  } finally {
    isRunning = false;
  }
}

// =============================================================================
// HEALTH SERVER (required for Render — prevents shutdown)
// =============================================================================

const healthServer = http.createServer((req, res) => {
  const uptime   = Math.floor((Date.now() - startTime) / 1000);
  const nextScan = lastScan
    ? Math.max(0, Math.floor((new Date(lastScan).getTime() + INTERVAL - Date.now()) / 1000))
    : 0;

  if (req.url === "/report") {
    res.writeHead(200, { "Content-Type": "text/plain", "Access-Control-Allow-Origin": "*" });
    res.end(lastReport || "No scan run yet");
    return;
  }

  const payload = {
    status:        "running",
    bot:           "coinbase-bbv-claude-bot",
    version:       "v1.0-no-api",
    cycle:         cycleCount,
    uptime_sec:    uptime,
    last_scan:     lastScan,
    next_scan_sec: nextScan,
    symbols:       SYMBOLS,
    endpoints:     ["/", "/report"],
  };

  res.writeHead(200, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(payload, null, 2));
});

const PORT = parseInt(process.env.PORT || "10001");
healthServer.listen(PORT, () => {
  console.log(`\nCoinbase BBV Claude Bot (No-API edition) starting...`);
  console.log(`Health server: http://localhost:${PORT}`);
  console.log(`Report: http://localhost:${PORT}/report`);
  console.log(`Symbols: ${SYMBOLS.join(", ")}`);
  console.log(`Interval: 15 minutes`);
  console.log(`Supabase: ${process.env.SUPABASE_URL || "NOT SET"}`);
  console.log(`Coinbase key: ${process.env.COINBASE_KEY_FILE || process.env.COINBASE_API_KEY_NAME ? "SET" : "NOT SET"}`);
});

// Run immediately then every 15 minutes
await runScan();
setInterval(runScan, INTERVAL);
