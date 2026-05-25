import { spawn } from "child_process";
import { CoinbaseClient } from "../mcp-server/src/coinbase-client.js";
import { SupabaseLogger } from "../mcp-server/src/supabase-logger.js";
import { sendDiscordAlert } from "./discord.js";
const client = new CoinbaseClient();
const logger = new SupabaseLogger();
const CLAUDE = "/usr/local/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe";
async function run() {
  const startTime = Date.now();
  console.log("["+new Date().toISOString()+"] Entry scan starting");
  try {
    const prompt = "You are running an entry scan cycle. Read CLAUDE.md for your full strategy, then execute the entry scan cycle. Current UTC time: "+new Date().toISOString();
    const output = await new Promise((resolve,reject) => {
      const p = spawn(process.execPath,[CLAUDE,"--print",prompt],{cwd:process.env.STRATEGY_DIR,env:{...process.env,PATH:"/usr/local/bin:/usr/bin:/bin"},timeout:300000});
      let out="";
      p.stdout.on("data",d=>{out+=d.toString();process.stdout.write(d);});
      p.stderr.on("data",d=>process.stderr.write(d));
      p.on("close",()=>resolve(out));
      p.on("error",reject);
    });
    const [wallet,positions] = await Promise.all([client.getWalletBalance(),client.getPositions()]);
    await logger.syncPositions(positions);
    await logger.snapshotEquity(wallet,positions);
    const elapsed=((Date.now()-startTime)/1000).toFixed(1);
    await sendDiscordAlert({title:"Entry scan complete",equity:wallet.equity,upnl:0,positions:positions.length,elapsed,summary:output.slice(-800)});
    console.log("["+new Date().toISOString()+"] Done in "+elapsed+"s");
  } catch(err) {
    console.error("Error:",err.message);
    process.exit(1);
  }
}
run();
