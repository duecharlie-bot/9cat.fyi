/* nineCat punt / chase strategy logic
   Extracted from app.js without intentional behavior changes.
   This file relies on the existing shared app state (CATS, cfg, locks, pool, picks, cw). */

/*  Leverage weights, damped by conviction.

    The raw weights say "concentrate on categories that are still coin flips."
    That's right late and badly wrong early: after three picks your category
    standings are noise, and acting on them hands you a 36th-ranked center over
    a 14th-ranked guard. conviction ramps 0 -> 1 as the roster fills, blending
    the weights toward flat. Flat weights mean fit == raw value, i.e. best
    player available, which is the correct early-round strategy.              */
function leverage(tz, conviction){
  const w = {};
  CATS.forEach(c=>{
    if(locks[c.k] === "punt"){ w[c.k] = 0; return; }
    const s = 1 / (1 + Math.exp(-tz[c.k] / cfg.k));
    w[c.k] = s * (1 - s);
    /*  chase pins a category at the natural maximum of s(1-s); chase2 goes past
        it, which no roster state can produce on its own. Use it when you've
        decided to win a category outright rather than merely contest it.     */
    /*  0.25 is the natural ceiling of s(1-s), so pinning chase there did nothing
        at all when a category was already even — it only ever undid the damping
        on categories you'd locked up or abandoned. Both tiers now sit above the
        ceiling, so chase actually tilts the board and hard chase dominates.   */
    if(locks[c.k] === "chase")  w[c.k] = 0.40;
    if(locks[c.k] === "chase2") w[c.k] = 0.80;
  });
  const tot = CATS.reduce((s,c)=>s + w[c.k], 0) || 1;
  const live = CATS.filter(c=>locks[c.k] !== "punt").length || 1;
  CATS.forEach(c=>{
    const full = w[c.k] / tot * live;
    // Manual locks are deliberate, so honour them at full strength immediately.
    const forced = locks[c.k] !== undefined;
    w[c.k] = forced ? full : 1 + conviction * (full - 1);
  });
  return w;
}

/*  Which categories are natural punts?

    A category is worth abandoning when two things are true at once: drafting
    best-available leaves you losing it anyway, and dragging it back to even
    would cost more total value than it's worth. Chasing a category you can't
    win is the most expensive mistake in a category league — you pay full price
    for players and finish ninth anyway.

    This suggests; it never applies anything on its own.                      */
function suggestPunts(state){
  const {roster, avail, tz, nxt} = state;
  const left = cfg.size - roster.length;
  const puntedCount = CATS.filter(c=>locks[c.k] === "punt").length;
  // Hard stop: once a team has committed to two punts, never recommend another.
  // From that point on, Punt Radar should protect the remaining seven categories
  // by suggesting chases rather than encouraging a third or fourth punt.
  if(puntedCount >= 2) return [];
  if(roster.length < 2 || left < 2) return [];

  /*  Par matters more than zero here. Z-scores are measured against the whole
      player pool, but only the top (teams x size) get rostered — so a rival
      team's standing in a category is NOT zero. Turnovers are the clearest
      case: value and turnovers are positively correlated, so every good team
      finishes underwater in TO. Judged against zero, TO looks like a punt for
      everyone. Judged against par, it only looks like one if you're unusually
      bad at it.                                                              */
  const rostered = [...pool].sort((a,b)=>b.total-a.total).slice(0, cfg.teams * cfg.size);
  const par = {};
  CATS.forEach(c=>{
    const mean = rostered.reduce((s,p)=>s+p.z[c.k], 0) / (rostered.length || 1);
    par[c.k] = mean * cfg.size;
  });

  // Players realistically still there when you pick again.
  const cutoff = (nxt === null ? picks.length : nxt) + 1;
  let plausible = avail.filter(p => p.adp === null || p.adp >= cutoff);
  if(plausible.length < left * 2) plausible = avail;

  const topN = (arr, key, n) => [...arr].sort((a,b)=>key(b)-key(a)).slice(0, n);
  const bpa = topN(plausible, p=>p.total, left);
  const bpaValue = bpa.reduce((s,p)=>s+p.total, 0);

  const out = [];
  CATS.forEach(c=>{
    if(locks[c.k] || cw(c.k) < 0.1) return;   // weight 0 = not scored, nothing to punt
    const chase = topN(plausible, p=>p.z[c.k], left);

    const drift  = tz[c.k] + bpa.reduce((s,p)=>s+p.z[c.k], 0);
    const chased = tz[c.k] + chase.reduce((s,p)=>s+p.z[c.k], 0);
    const cost   = bpaValue - chase.reduce((s,p)=>s+p.total, 0);

    // How far below a rival team you land on the natural path.
    const gap = drift - par[c.k];
    // Would chasing even get you to par? If not, it's hopeless, not expensive.
    const reach = chased - par[c.k];

    out.push({cat:c, drift, chased, cost, gap, reach, par:par[c.k]});
  });

  return out
    .filter(x => x.gap < -2.0 && x.cost > 8)
    .sort((a,b) => a.gap - b.gap)
    .slice(0, 3);
}

function suggestChase(state){
  const punted = CATS.filter(c=>locks[c.k]==="punt");
  if(punted.length < 2 || punted.length > 3 || !state.roster.length) return null;
  const rostered = [...pool].sort((a,b)=>b.total-a.total).slice(0, cfg.teams * cfg.size);
  const meanZ = {};
  CATS.forEach(c=> meanZ[c.k] = rostered.reduce((sum,p)=>sum+p.z[c.k],0) / (rostered.length || 1));
  const candidates = CATS.filter(c=>cw(c.k)>0.05 && locks[c.k]!=="punt" && locks[c.k]!=="chase2")
    .map(c=>({cat:c, gap:state.tz[c.k] - meanZ[c.k]*state.roster.length}))
    .sort((a,b)=>a.gap-b.gap);
  const weakest = candidates[0] || null;
  if(!weakest) return null;
  if(punted.length === 2 && weakest.gap > -0.65) return null;
  return {...weakest, punts:punted.length};
}
