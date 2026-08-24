"use strict";

/* ============================================================
   RECOMMENDATION ENGINE
   Availability, category-profile scoring, scarcity/run risk,
   and roster-aware Fit evaluation. Extracted from app.js without
   intentionally changing product behavior.
   ============================================================ */

function available(){ const t = takenIds(); return pool.filter(p=>!t.has(p.id)); }

function teamZ(roster){
  const z = {};
  CATS.forEach(c=> z[c.k] = roster.reduce((s,p)=>s + p.z[c.k], 0));
  return z;
}

function runRisk(p, gapPicks){
  if(gapPicks <= 0) return 0;
  const spare = p.adp - (picks.length + 1);
  const x = (gapPicks - spare) / 4;
  return 1 / (1 + Math.exp(-x));
}

/*  FIT is a decision score, so its displayed zero should mean "typical option
    available right now" rather than "average player in the top-200 scoring
    population." Re-center the display on the median FIT of roughly the next
    two rounds of fantasy-relevant players. This changes only the displayed
    level; subtracting one common baseline preserves every FIT ordering/gap. */
const FIT_MARKET_ROUNDS = 2;

function fitMedian(values){
  const a = values.filter(Number.isFinite).sort((x,y)=>x-y);
  if(!a.length) return 0;
  const m = Math.floor(a.length/2);
  return a.length % 2 ? a[m] : (a[m-1] + a[m]) / 2;
}

function applyFitMarketBaseline(avail){
  const eligible = avail.filter(p=>p.rosterFit !== false);
  const windowSize = Math.max(1, cfg.teams * FIT_MARKET_ROUNDS);
  const market = [...eligible]
    .sort((a,b)=>{
      const ar = Number.isFinite(a.valRank) ? a.valRank : Infinity;
      const br = Number.isFinite(b.valRank) ? b.valRank : Infinity;
      if(ar !== br) return ar - br;
      return (b.total || 0) - (a.total || 0);
    })
    .slice(0, windowSize);

  const fitBaseline = fitMedian(market.map(p=>p.fitAdj));
  const fitLastBaseline = fitMedian(market.map(p=>p.fitLast));

  avail.forEach(p=>{
    p.fitDisplay = Number.isFinite(p.fitAdj) ? p.fitAdj - fitBaseline : p.fitAdj;
    p.fitLastDisplay = Number.isFinite(p.fitLast) ? p.fitLast - fitLastBaseline : p.fitLast;
  });

  return {fitBaseline, fitLastBaseline, fitWindowSize:market.length};
}

function evaluate(){
  const roster = myRoster();
  const tz = teamZ(roster);

  // Full category shaping once roughly half the roster is set.
  const ramp = Math.min(roster.length / Math.max(2, cfg.size * 0.45), 1);
  /*  The slider says exactly what gets applied — no hidden ramp. It used to
      scale itself with roster size, which meant the reset button appeared to do
      nothing: you were already in "auto", so clicking it changed no state.
      ramp is still reported so the tooltip can warn when standings are thin.  */
  const conviction = shape;
  const w = leverage(tz, conviction);

  const here = picks.length;
  const nxt = myNextPick(here + 1);
  const gap = nxt === null ? 0 : nxt - here - 1;

  /*  At the snake turn your next pick lands immediately after this one, so
      nobody can be taken in between and every risk computes to zero. True, but
      useless — it wipes the board clean of markers exactly when you're making
      two picks at once. What matters there is who survives to the pick AFTER
      the pair, so measure against that instead.                              */
  let riskGap = gap;
  if(gap === 0 && nxt !== null){
    const second = myNextPick(nxt + 1);
    if(second !== null) riskGap = second - here - 2;
  }

  const avail = available();
  /*  Roster-slot legality is a constraint only when WE are on the clock.
      On an opponent's pick we still need to be able to log any player they can
      legally draft for their own roster, even if that player would not fit ours.
      Using our open slots on every turn was greying out players like Wembanyama
      while entering Team 2's pick.                                             */
  const enforceRosterFit = teamOnClock(picks.length) === myTeamIdx();
  avail.forEach(p=>{
    p.rosterFit = !enforceRosterFit || canFitRoster(roster, p);
    p.fit = CATS.reduce((s,c)=>s + w[c.k] * cw(c.k) * p.z[c.k], 0);
    p.risk = runRisk(p, riskGap);
    /*  Scarcity. A player certain to survive to your next turn is worth less
        NOW than an equal player who won't be — you can have him either way.
        Centred on 0.5 so it's a real swing, not the old ±5% rounding error.  */
    p.scarce = cfg.scarcity * (p.risk - 0.5);
    p.fitAdj = p.fit + p.scarce;

    /*  The same fit, recomputed from what the player actually did last season:
        same category weights, same roster leverage, same scarcity — only the
        production changes. Answers "what if the projection is wrong and he just
        repeats himself?" Null when there's no prior season to draw on.       */
    p.fitLast = (p.last && p.last.z)
      ? CATS.reduce((s,c)=>s + w[c.k] * cw(c.k) * p.last.z[c.k], 0) + p.scarce
      : null;
  });

  const fitMarket = applyFitMarketBaseline(avail);

  return {roster, tz, w, avail, gap, riskGap, nxt, conviction, ramp,
          enforceRosterFit, gaps: rosterGaps(roster), ...fitMarket};
}
