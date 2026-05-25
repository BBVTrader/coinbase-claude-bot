#!/usr/bin/env bash
set -e
BOLD="\033[1m"; GREEN="\033[32m"; YELLOW="\033[33m"; RED="\033[31m"; RESET="\033[0m"
BOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="/var/log/claude-bot"

echo -e "${BOLD}Coinbase Claude Bot — setup${RESET}"
echo "Bot directory: $BOT_DIR"

node -e "process.exit(parseInt(process.versions.node)<18?1:0)" || { echo -e "${RED}Node 18+ required${RESET}"; exit 1; }
echo -e "${GREEN}✓ Node.js $(node --version)${RESET}"
command -v claude &>/dev/null || { echo -e "${RED}Claude Code not found${RESET}"; exit 1; }
echo -e "${GREEN}✓ Claude Code found${RESET}"

cd "$BOT_DIR/mcp-server" && npm install --silent
echo -e "${GREEN}✓ MCP dependencies installed${RESET}"

sudo mkdir -p "$LOG_DIR" && sudo chmod 755 "$LOG_DIR"

cd "$BOT_DIR"

# Read the cdp_api_key.json if it exists
if [ -f "$HOME/Downloads/cdp_api_key.json" ]; then
  KEY_NAME=$(node -e "const f=require('$HOME/Downloads/cdp_api_key.json');console.log(f.name)")
  PRIV_KEY=$(node -e "const f=require('$HOME/Downloads/cdp_api_key.json');console.log(f.privateKey.replace(/\n/g,'\\\\n'))")
  echo -e "${GREEN}✓ Found cdp_api_key.json — extracting keys${RESET}"
else
  KEY_NAME="YOUR_API_KEY_NAME"
  PRIV_KEY="YOUR_PRIVATE_KEY"
  echo -e "${YELLOW}⚠ cdp_api_key.json not found — fill in .env manually${RESET}"
fi

cat > .env << ENVEOF
COINBASE_API_KEY_NAME=$KEY_NAME
COINBASE_PRIVATE_KEY=$PRIV_KEY
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_service_role_key_here
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/your_webhook
STRATEGY_DIR=$BOT_DIR/claude-config
CLAUDE_CODE_BIN=claude
KILL_SWITCH_PATH=/tmp/HALT_TRADING
MAX_NOTIONAL_PCT=0.30
MAX_CONCURRENT=3
PRICE_SANITY_PCT=0.02
ENVEOF
echo -e "${GREEN}✓ .env created${RESET}"

mkdir -p "$HOME/.claude"
cat "$BOT_DIR/claude-config/mcp.json" | sed "s|PATH_TO_BOT|$BOT_DIR|g" > "$HOME/.claude/.mcp.json"
echo -e "${GREEN}✓ MCP config written${RESET}"

ENTRY="*/15 * * * * cd $BOT_DIR && node --env-file=$BOT_DIR/.env scripts/entry-scan.js >> $LOG_DIR/entry.log 2>&1"
MONITOR="* * * * * cd $BOT_DIR && node --env-file=$BOT_DIR/.env scripts/position-monitor.js >> $LOG_DIR/monitor.log 2>&1"
(crontab -l 2>/dev/null | grep -v "entry-scan\|position-monitor"; echo "$ENTRY"; echo "$MONITOR") | crontab -
echo -e "${GREEN}✓ Cron jobs installed${RESET}"

echo -e "${YELLOW}
╔══════════════════════════════════════════════════════════╗
║  Next steps:                                             ║
║  1. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to .env    ║
║  2. Run supabase/schema.sql in Supabase SQL editor       ║
║  3. Run: node --env-file=.env scripts/entry-scan.js      ║
╚══════════════════════════════════════════════════════════╝${RESET}"
echo -e "Kill: ${BOLD}touch /tmp/HALT_TRADING${RESET}  |  Resume: ${BOLD}rm /tmp/HALT_TRADING${RESET}"
echo -e "${GREEN}${BOLD}Setup complete.${RESET}"
