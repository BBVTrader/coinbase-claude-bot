/**
 * Sends structured alerts to Discord via webhook.
 * Set DISCORD_WEBHOOK_URL in your environment.
 */

const WEBHOOK = process.env.DISCORD_WEBHOOK_URL;

export async function sendDiscordAlert({ title, equity, upnl, positions, elapsed, summary, error }) {
  if (!WEBHOOK) return;

  const isError = !!error;
  const color   = isError ? 0xE24B4A : (upnl >= 0 ? 0x3B6D11 : 0xBA7517);

  const fields = [];
  if (equity   != null) fields.push({ name: 'Equity',    value: `$${equity.toFixed(2)}`,        inline: true });
  if (upnl     != null) fields.push({ name: 'Unrealised',value: `${upnl >= 0 ? '+' : ''}$${upnl.toFixed(2)}`, inline: true });
  if (positions != null) fields.push({ name: 'Positions', value: `${positions}/3`,               inline: true });
  if (elapsed  != null) fields.push({ name: 'Duration',  value: `${elapsed}s`,                  inline: true });
  if (error    != null) fields.push({ name: 'Error',     value: `\`\`\`${error.slice(0,500)}\`\`\`` });
  if (summary  != null) fields.push({ name: 'Summary',   value: `\`\`\`${summary}\`\`\`` });

  const body = {
    embeds: [{
      title,
      color,
      fields,
      timestamp: new Date().toISOString(),
      footer: { text: 'Bybit Claude Bot' }
    }]
  };

  try {
    await fetch(WEBHOOK, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body)
    });
  } catch (e) {
    console.error('Discord alert failed:', e.message);
  }
}
