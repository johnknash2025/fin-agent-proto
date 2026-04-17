export type EnvDB = { DB?: D1Database };

export async function getEtfId(env: EnvDB, symbol: string) {
  if (!env.DB) return null;
  const row = await env.DB.prepare("SELECT id FROM etf WHERE symbol = ?1").bind(symbol).first<{id:number}>();
  return row?.id ?? null;
}

export async function getHoldings(env: EnvDB, symbol: string) {
  if (!env.DB) return null;
  const etfId = await getEtfId(env, symbol);
  if (!etfId && etfId !== 0) return null;
  const rs = await env.DB.prepare("SELECT asset_symbol, asset_name, weight FROM holdings WHERE etf_id = ?1 ORDER BY line ASC LIMIT 100").bind(etfId).all();
  return (rs.results || []).map(r => ({ symbol: r.asset_symbol, name: r.asset_name, weight: r.weight }));
}

export async function getSeries(env: EnvDB, symbol: string) {
  if (!env.DB) return null;
  const rs = await env.DB.prepare("SELECT t, close FROM series_daily WHERE symbol = ?1 ORDER BY t ASC").bind(symbol).all();
  return (rs.results || []).map(r => ({ t: r.t, c: r.close }));
}

