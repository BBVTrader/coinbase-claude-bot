/**
 * Writes audit logs, positions, equity snapshots, and trade records
 * to Supabase using the service role key (bypasses RLS).
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

export class SupabaseLogger {
  constructor() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      console.error('Warning: SUPABASE_URL or SUPABASE_SERVICE_KEY not set — logging disabled');
      this.disabled = true;
    }
  }

  async _insert(table, row) {
    if (this.disabled) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey':        SUPABASE_KEY,
          'Prefer':        'return=minimal'
        },
        body: JSON.stringify(row)
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`Supabase insert ${table} failed:`, err);
      }
    } catch (e) {
      console.error(`Supabase logger error (${table}):`, e.message);
    }
  }

  async _upsert(table, row, onConflict) {
    if (this.disabled) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey':        SUPABASE_KEY,
          'Prefer':        `return=minimal,resolution=merge-duplicates`,
          'on-conflict':   onConflict
        },
        body: JSON.stringify(row)
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`Supabase upsert ${table} failed:`, err);
      }
    } catch (e) {
      console.error(`Supabase logger error (${table}):`, e.message);
    }
  }

  async _delete(table, filter) {
    if (this.disabled) return;
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'apikey':        SUPABASE_KEY
        }
      });
      if (!res.ok) {
        const err = await res.text();
        console.error(`Supabase delete ${table} failed:`, err);
      }
    } catch (e) {
      console.error(`Supabase logger error (${table}):`, e.message);
    }
  }

  async auditLog(toolName, params, response, riskPassed, riskReason) {
    await this._insert('audit_log', {
      tool_name:   toolName,
      params:      params,
      response:    response,
      risk_passed: riskPassed,
      risk_reason: riskReason
    });
  }

  async syncPositions(positions) {
    // Delete all current positions then re-insert fresh state
    await this._delete('positions', 'id=neq.00000000-0000-0000-0000-000000000000');
    for (const p of positions) {
      await this._upsert('positions', {
        symbol:         p.symbol,
        side:           p.side,
        entry_price:    p.entry_price,
        current_price:  p.mark_price,
        qty:            p.size,
        leverage:       p.leverage,
        stop_loss:      p.stop_loss,
        take_profit:    p.take_profit,
        unrealised_pnl: p.unrealised_pnl,
        unrealised_pct: p.entry_price > 0
          ? ((p.mark_price - p.entry_price) / p.entry_price) * (p.side === 'long' ? 1 : -1)
          : 0,
        updated_at: new Date().toISOString()
      }, 'symbol');
    }
  }

  async snapshotEquity(wallet, positions) {
    await this._insert('equity_snapshots', {
      equity_usd:     wallet.equity,
      available_usd:  wallet.available,
      open_positions: positions.length
    });
  }

  async logDecision({ cycle_type, symbol, action, reasoning, market_data, risk_check, executed, error }) {
    await this._insert('decisions', {
      cycle_type, symbol, action, reasoning,
      market_data, risk_check, executed,
      error: error ?? null
    });
  }

  async logTrade({ symbol, side, entry_price, exit_price, qty, leverage, pnl_usd, pnl_pct, hold_minutes, entry_time, exit_time, rationale, exit_reason, order_ids }) {
    await this._insert('trades', {
      symbol, side, entry_price, exit_price, qty, leverage,
      pnl_usd, pnl_pct, hold_minutes, entry_time, exit_time,
      rationale, exit_reason, order_ids
    });
  }
}
