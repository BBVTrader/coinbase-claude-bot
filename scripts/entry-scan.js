import { spawn } from "child_process";
import { readFileSync } from "fs";
import { resolve as pathResolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env before importing modules that capture env vars at module scope.
// Shell env may contain stale placeholder values — override them here.
const envPath = pathResolve(dirname(fileURLToPath(import.meta.url)), "../.env");
try {
  readFileSync(envPath, "utf8").split("\n").forEach(line => {
    const m = line.match(/^([^#][^=]*)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
} catch {}

// Dynamic imports so env vars are set before module-level constants are captured
const { CoinbaseClient } = await import("../mcp-server/src/coinbase-client.js");
const { SupabaseLogger } = await import("../mcp-server/src/supabase-logger.js");
const { sendDiscordAlert } = await import("./discord.js");

const client = new CoinbaseClient();
const logger = new SupabaseLogger();

// Execute claude directly (not via node — .exe is a shell wrapper, not an ES module)
const CLAUDE = "/usr/local/bin/claude";

async function run() {
  const startTime = Date.now();
  console.log("["+new Date().toISOString()+"] Entry scan starting");
  try {
    const prompt = "You are running an entry scan cycle. Read CLAUDE.md for your full strategy, then execute the entry scan cycle. Current UTC time: "+new Date().toISOString();
    const mcpConfig = pathResolve(dirname(fileURLToPath(import.meta.url)), "../claude-config/mcp.json");
    const output = await new Promise((resolve, reject) => {
      const p = spawn(CLAUDE, ["--print", "--dangerously-skip-permissions", "--mcp-config", mcpConfig, "--", prompt], {
        cwd: process.env.STRATEGY_DIR,
        env: { ...process.env, PATH: "/usr/local/bin:/usr/bin:/bin" },
        timeout: 300000
      });
      let out = "";
      p.stdout.on("data", d => { out += d.toString(); process.stdout.write(d); });
      p.stderr.on("data", d => process.stderr.write(d));
      p.on("close", () => resolve(out));
      p.on("error", reject);
    });
    const [wallet, positions] = await Promise.all([client.getWalletBalance(), client.getPositions()]);
    await logger.syncPositions(positions);
    await logger.snapshotEquity(wallet, positions);
    const elapsed = ((Date.now()-startTime)/1000).toFixed(1);
    await sendDiscordAlert({ title: "Entry scan complete", equity: wallet.equity, upnl: 0, positions: positions.length, elapsed, summary: output.slice(-800) });
    console.log("["+new Date().toISOString()+"] Done in "+elapsed+"s");
  } catch(err) {
    console.error("Error:", err.message);
    process.exit(1);
  }
}
run();
