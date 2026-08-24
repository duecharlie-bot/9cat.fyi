/* ============================================================
   DRAFT ENGINE
   Extracted from app.js without behavioural changes.
   Owns snake order, current-team helpers, drafting, reindexing, and undo.
   ============================================================ */

// Snake: which team is on the clock at a given overall pick (0-indexed team).
function teamOnClock(overall){
  const rd = Math.floor(overall / cfg.teams);
  const idx = overall % cfg.teams;
  return rd % 2 === 0 ? idx : cfg.teams - 1 - idx;
}
function myTeamIdx(){ return cfg.slot - 1; }
function myNextPick(from){
  for(let o = from; o < cfg.teams * cfg.size; o++)
    if(teamOnClock(o) === myTeamIdx()) return o;
  return null;
}

function reindex(){ picks.sort((a,b)=>a.overall-b.overall).forEach((p,i)=>p.overall=i); }

function draft(id){
  if(picks.length >= cfg.teams * cfg.size) return;
  if(takenIds().has(id)) return;
  picks.push({playerId:id, teamIdx:teamOnClock(picks.length), overall:picks.length});
  $("#q").value = "";
  hoverId = null;
  selectedId = null;
  armedDraftId = null;
  /*  Brief highlight on the pick that just landed. Mid-draft it's easy to lose
      track of whether a click actually registered.                          */
  flashPick = picks.length - 1;
  clearTimeout(draft._t);
  draft._t = setTimeout(()=>{ flashPick = null; renderLog(); }, 1700);
  render();
}

function undo(){ picks.pop(); armedDraftId = null; render(); }
