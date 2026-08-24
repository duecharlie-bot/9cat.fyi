"use strict";

/*
  Matchup math lives here so team-v-team comparisons have one source of truth.
  Counting categories are summed. FG% and FT% are recombined from total makes
  and attempts, so higher-volume shooters have the correct influence.
*/

function teamTotals(roster){
  const t = {fgm:0,fga:0,ftm:0,fta:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
  roster.forEach(p=>{ for(const k in t) t[k] += p[k] || 0; });
  return t;
}

function catTotal(t, k){
  if(k === "fg") return t.fga ? t.fgm/t.fga : null;
  if(k === "ft") return t.fta ? t.ftm/t.fta : null;
  return t[k];
}

function compareTeams(mineRoster, theirRoster, cats, categoryWeight){
  const mineTotals = teamTotals(mineRoster);
  const theirTotals = teamTotals(theirRoster);
  const weight = typeof categoryWeight === "function" ? categoryWeight : ()=>1;

  const rows = cats.filter(c=>weight(c.k) > 0.05).map(c=>{
    const mineV = catTotal(mineTotals, c.k);
    const theirV = catTotal(theirTotals, c.k);
    const raw = (mineV === null || theirV === null) ? 0 : mineV - theirV;
    const advantage = raw * (c.neg ? -1 : 1);
    const tie = Math.abs(advantage) <= 0.00005;
    const win = !tie && advantage > 0;
    const display = (c.k === "fg" || c.k === "ft")
      ? `${raw>=0?"+":""}${(raw*100).toFixed(1)}%`
      : `${raw>=0?"+":""}${raw.toFixed(1)}`;
    return {c,display,win,tie,raw,advantage,mineV,theirV};
  });

  const won = rows.filter(r=>r.win).length;
  const tied = rows.filter(r=>r.tie).length;
  const lost = rows.length - won - tied;
  const tot = rows.length;
  const verdict = won > lost ? "win" : won < lost ? "lose" : "tie";

  return {mineTotals,theirTotals,rows,won,tied,lost,tot,verdict};
}
