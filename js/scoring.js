/* ============================================================
   SCORING
   Extracted from app.js without changing scoring behaviour.
   Depends on the existing app globals CATS, cfg, cw and pool.
   ============================================================ */

const SCORING_BASELINE_SIZE = 200;

function mean(a){ return a.reduce((s,x)=>s+x,0) / (a.length||1); }
function sd(a){ const m = mean(a); return Math.sqrt(mean(a.map(x=>(x-m)**2))) || 1; }

function buildScoreModel(refList, useGpw){
  const gps = refList.map(p=>p.gp).filter(g=>g>0).sort((a,b)=>a-b);
  const medGP = gps.length ? gps[Math.floor(gps.length/2)] : 72;

  const effectiveGP = p=>{
    const g = p.gp > 0 ? p.gp : medGP;
    return Math.pow(medGP, 1-useGpw) * Math.pow(g, useGpw);
  };

  const sum = f => refList.reduce((s,p)=>s + f(p), 0);
  const lgFG = sum(p=>p.fgm*effectiveGP(p)) / (sum(p=>p.fga*effectiveGP(p)) || 1);
  const lgFT = sum(p=>p.ftm*effectiveGP(p)) / (sum(p=>p.fta*effectiveGP(p)) || 1);

  const rawFor = p=>{
    const s = effectiveGP(p) / medGP;
    return {
      fg:  p.fga * s * ((p.fgm/(p.fga||1)) - lgFG),
      ft:  p.fta * s * ((p.ftm/(p.fta||1)) - lgFT),
      tpm:p.tpm*s, pts:p.pts*s, reb:p.reb*s, ast:p.ast*s,
      stl:p.stl*s, blk:p.blk*s, to:p.to*s
    };
  };

  const referenceRaws = refList.map(rawFor);
  const stats = {};
  CATS.forEach(c=>{
    const vals = referenceRaws.map(r=>r[c.k]);
    stats[c.k] = {m:mean(vals), s:sd(vals)};
  });

  return {rawFor, stats};
}

function totalAgainstModel(p, model){
  const r = model.rawFor(p);
  return CATS.reduce((sum,c)=>{
    let z = (r[c.k] - model.stats[c.k].m) / model.stats[c.k].s;
    if(c.neg) z = -z;
    return sum + cw(c.k) * z;
  }, 0);
}

function scoringBaseline(list, useGpw, size=SCORING_BASELINE_SIZE){
  if(list.length <= size) return list;

  // Preliminary full-pool score only decides who belongs in the baseline.
  const preliminary = buildScoreModel(list, useGpw);
  return [...list]
    .sort((a,b)=>totalAgainstModel(b, preliminary)-totalAgainstModel(a, preliminary))
    .slice(0, size);
}

/* Volume-weighted percentage impact, then z-score against the top-200
   fantasy-relevant baseline. Every imported player still receives a score. */
function scorePool(list, opts){
  if(!list.length) return;
  const o = opts || {};
  const field = o.field || "z";
  const totalField = o.totalField || "total";
  const useGpw = o.gpw === undefined ? cfg.gpw : o.gpw;
  const baselineSize = o.baselineSize || SCORING_BASELINE_SIZE;
  const refList = Array.isArray(o.refList) && o.refList.length
    ? o.refList
    : scoringBaseline(list, useGpw, baselineSize);

  const model = buildScoreModel(refList, useGpw);

  list.forEach(p=>{
    const r = model.rawFor(p);
    p[field] = {};
    CATS.forEach(c=>{
      let z = (r[c.k] - model.stats[c.k].m) / model.stats[c.k].s;
      if(c.neg) z = -z;
      p[field][c.k] = z;
    });
    p[totalField] = CATS.reduce((s,c)=>s + cw(c.k) * p[field][c.k], 0);
  });

  if(field === "z"){
    [...list].sort((a,b)=>b.total-a.total).forEach((p,i)=>{ p.valRank = i+1; });

    // Fallback ADP = overall value rank when the source has no ADP.
    const byVal = [...list].sort((a,b)=>b.total-a.total);
    byVal.forEach((p,i)=>{ if(p.adp === null) p.adp = i+1; });
  }
}

/* Two scorings per dataset:
     z   — durability weighted, what Fit ranks on
     zpg — pure per-game, used to colour per-game display modes */
function scoreBoth(list){
  scorePool(list);
  scorePool(list, {gpw:0, field:"zpg", totalField:"totalPg"});
}

/* Score one external/fallback player against the same top-200 projection
   baseline used by the main board. */
function scorePlayerAgainstPool(player, refList, opts){
  const list = Array.isArray(refList) && refList.length ? refList : pool;
  if(!player || !list.length) return player;
  const o = opts || {};
  const field = o.field || "z";
  const totalField = o.totalField || "total";
  const useGpw = o.gpw === undefined ? cfg.gpw : o.gpw;
  const baselineSize = o.baselineSize || SCORING_BASELINE_SIZE;
  const reference = Array.isArray(o.refList) && o.refList.length
    ? o.refList
    : scoringBaseline(list, useGpw, baselineSize);
  const model = buildScoreModel(reference, useGpw);

  const r = model.rawFor(player);
  player[field] = {};
  CATS.forEach(c=>{
    let z = (r[c.k] - model.stats[c.k].m) / model.stats[c.k].s;
    if(c.neg) z = -z;
    player[field][c.k] = z;
  });
  player[totalField] = CATS.reduce((sum,c)=>sum + cw(c.k) * player[field][c.k], 0);
  return player;
}
