/* ============================================================
   SCORING
   Extracted from app.js without changing scoring behaviour.
   Depends on the existing app globals CATS, cfg, cw and pool.
   ============================================================ */

function mean(a){ return a.reduce((s,x)=>s+x,0) / (a.length||1); }
function sd(a){ const m = mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))) || 1; }

/*  Volume-weighted percentage impact, then z-score against the pool.

    Availability: a 55-game guy and a 78-game guy with identical per-game
    lines are not worth the same. effGP blends between pure per-game
    (weight 0) and true season totals (weight 1), so the slider decides how
    hard durability counts.  */
function scorePool(list, opts){
  if(!list.length) return;
  const o = opts || {};
  const field = o.field || "z";
  const totalField = o.totalField || "total";
  const useGpw = o.gpw === undefined ? cfg.gpw : o.gpw;

  const gps = list.map(p=>p.gp).filter(g=>g>0).sort((a,b)=>a-b);
  const medGP = gps.length ? gps[Math.floor(gps.length/2)] : 72;
  const eff = new Map();
  list.forEach(p=>{
    const g = p.gp > 0 ? p.gp : medGP;
    eff.set(p, Math.pow(medGP, 1-useGpw) * Math.pow(g, useGpw));
  });

  const sum = f => list.reduce((s,p)=>s + f(p), 0);
  const lgFG = sum(p=>p.fgm*eff.get(p)) / (sum(p=>p.fga*eff.get(p)) || 1);
  const lgFT = sum(p=>p.ftm*eff.get(p)) / (sum(p=>p.fta*eff.get(p)) || 1);

  const raws = new Map();
  list.forEach(p=>{
    const s = eff.get(p) / medGP;
    raws.set(p, {
      fg:  p.fga * s * ((p.fgm/(p.fga||1)) - lgFG),
      ft:  p.fta * s * ((p.ftm/(p.fta||1)) - lgFT),
      tpm:p.tpm*s, pts:p.pts*s, reb:p.reb*s, ast:p.ast*s,
      stl:p.stl*s, blk:p.blk*s, to:p.to*s
    });
  });

  const stats = {};
  CATS.forEach(c=>{
    const vals = list.map(p=>raws.get(p)[c.k]);
    stats[c.k] = {m:mean(vals), s:sd(vals)};
  });

  list.forEach(p=>{
    const r = raws.get(p);
    p[field] = {};
    CATS.forEach(c=>{
      let z = (r[c.k] - stats[c.k].m) / stats[c.k].s;
      if(c.neg) z = -z;                              // turnovers: fewer is better
      p[field][c.k] = z;
    });
    p[totalField] = CATS.reduce((s,c)=>s + cw(c.k) * p[field][c.k], 0);
  });

  if(field === "z"){
    /*  Rank by our own Total, fixed over the whole pool so a number never shifts
      as others get drafted. Showing the source's ranking here invited an obvious
      question with an unsatisfying answer — why is Shai 3rd at 11.3 when
      Wembanyama is 2nd at 9.9? Because that ranking used different category
      weights than the ones on screen.                                        */
  [...list].sort((a,b)=>b.total-a.total).forEach((p,i)=>{ p.valRank = i+1; });

  // Fallback ADP = overall value rank
    const byVal = [...list].sort((a,b)=>b.total-a.total);
    byVal.forEach((p,i)=>{ if(p.adp === null) p.adp = i+1; });
  }
}

/*  Two scorings per dataset:
      z    — durability weighted, what the Fit engine ranks on
      zpg  — pure per-game, used only to colour the per-game display modes
    Colouring a per-game number with a games-played-adjusted score makes the
    figure and its colour disagree: an elite rebounder who missed half a season
    shows a strong REB average tinted red.                                    */
function scoreBoth(list){
  scorePool(list);
  scorePool(list, {gpw:0, field:"zpg", totalField:"totalPg"});
}

/* Score one external/fallback player against the CURRENT projection pool.
   We cannot call scorePool([player]) because a one-player population would
   make every category a meaningless zero. This mirrors scorePool's math, but
   derives the league averages and standard deviations from `refList` and then
   applies them to the one player. */
function scorePlayerAgainstPool(player, refList, opts){
  const list = Array.isArray(refList) && refList.length ? refList : pool;
  if(!player || !list.length) return player;
  const o = opts || {};
  const field = o.field || "z";
  const totalField = o.totalField || "total";
  const useGpw = o.gpw === undefined ? cfg.gpw : o.gpw;

  const gps = list.map(p=>p.gp).filter(g=>g>0).sort((a,b)=>a-b);
  const medGP = gps.length ? gps[Math.floor(gps.length/2)] : 72;
  const eff = new Map();
  list.forEach(p=>{
    const g = p.gp > 0 ? p.gp : medGP;
    eff.set(p, Math.pow(medGP, 1-useGpw) * Math.pow(g, useGpw));
  });

  const sum = f => list.reduce((s,p)=>s + f(p), 0);
  const lgFG = sum(p=>p.fgm*eff.get(p)) / (sum(p=>p.fga*eff.get(p)) || 1);
  const lgFT = sum(p=>p.ftm*eff.get(p)) / (sum(p=>p.fta*eff.get(p)) || 1);

  const rawFor = (p, effectiveGP)=>{
    const s = effectiveGP / medGP;
    return {
      fg:  p.fga * s * ((p.fgm/(p.fga||1)) - lgFG),
      ft:  p.fta * s * ((p.ftm/(p.fta||1)) - lgFT),
      tpm:p.tpm*s, pts:p.pts*s, reb:p.reb*s, ast:p.ast*s,
      stl:p.stl*s, blk:p.blk*s, to:p.to*s
    };
  };

  const referenceRaws = list.map(p=>rawFor(p, eff.get(p)));
  const stats = {};
  CATS.forEach(c=>{
    const vals = referenceRaws.map(r=>r[c.k]);
    stats[c.k] = {m:mean(vals), s:sd(vals)};
  });

  // Out-of-pool fallback players deliberately use median durability: the fixed
  // line is meant to be a replacement-level estimate, not a GP prediction.
  const pg = player.gp > 0 ? player.gp : medGP;
  const peff = Math.pow(medGP, 1-useGpw) * Math.pow(pg, useGpw);
  const r = rawFor(player, peff);
  player[field] = {};
  CATS.forEach(c=>{
    let z = (r[c.k] - stats[c.k].m) / stats[c.k].s;
    if(c.neg) z = -z;
    player[field][c.k] = z;
  });
  player[totalField] = CATS.reduce((sum,c)=>sum + cw(c.k) * player[field][c.k], 0);
  return player;
}
