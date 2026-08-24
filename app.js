"use strict";

let cfg = {
  teams:12, slot:5, size:13, aggr:5, k:7, gpw:0.5, scarcity:1.2,
  /*  Per-category weight, to match your league's scoring. 1 = counts normally,
      0 = not scored at all (8-cat leagues drop turnovers entirely). This is a
      LEAGUE SETTING, not a strategy — punting is separate and per-roster.    */
  /*  Turnovers ship at 0.75 rather than 1.0. Every rostered team finishes
      underwater in TO, so a category-league turnover loss is partly priced in
      already, and full weight pushed high-usage guards further down the board
      than the market will ever let you exploit. Set it back to 1 in Setup if
      your league scores all nine equally — that's the stricter reading.      */
  catW: {fg:1, ft:1, tpm:1, pts:1, reb:1, ast:1, stl:1, blk:1, to:0.75},
  names: []            // optional league team names, indexed by draft slot
};
const teamName = i => (cfg.names[i] && cfg.names[i].trim()) || ("Team " + (i+1));
const shortName = i => { const n = teamName(i); return n.length > 9 ? n.slice(0,8) + "\u2026" : n; };
const cw = k => cfg.catW[k] === undefined ? 1 : cfg.catW[k];
const DEFAULT_SHAPE = 0.5;   // balanced starting point for category shaping
let locks = {};
let shape = DEFAULT_SHAPE;   // 0 = pure value, 1 = full category shaping
let ui = {gapHidden:"", sugHidden:new Set()};                 // cat -> "punt" | "chase" (absent = auto)
let pool = [];
let picks = [];          // {playerId, teamIdx, overall}
let sortKey = "fit", sortDir = -1;
let posFilter = "ALL";
let hoverId = null;      // previewed player; persists until another row is hovered
let recMessageCleared = false; // CLEAR hides the comparison callout until another player is hovered
let rosterInspectId = null;   // click a drafted roster player to expand his projected per-game line
let selectedId = null;     // player currently being inspected
let armedDraftId = null;   // ONLY a first row/Enter confirmation arms a player for drafting
let boardIds = [];         // ids in the order currently rendered, for arrow keys

/*  Starred players are keyed by name, not pool index, so a watchlist survives
    re-importing projections — the ids shift, the names don't.                */
const STAR_KEY = "draftboard.stars.v1";
let starred = new Set();
try{ starred = new Set(JSON.parse(localStorage.getItem(STAR_KEY) || "[]")); }catch(e){}
function saveStars(){
  try{ localStorage.setItem(STAR_KEY, JSON.stringify([...starred])); }catch(e){}
}
const isStarred = p => starred.has(nameKey(p.name));
function toggleStar(p){
  const k = nameKey(p.name);
  if(starred.has(k)) starred.delete(k); else starred.add(k);
  // Starring is a separate action, not the second half of a draft confirmation.
  armedDraftId = null;
  saveStars(); render();
}
let flashPick = null;    // overall index of the pick to highlight briefly
let ledgerTeam = null;   // null = my team
let ledgerMode = "z";    // "z" or "tot"
let ledgerCollapsed = false;

/* ============================================================
   THE ENGINE
   ============================================================ */


/* Fixed replacement-level line for Yahoo players missing from the imported
   projection pool. This keeps one obscure/rookie pick from either breaking the
   sync or counting as literally zero production. */
const YAHOO_FALLBACK_LINE = Object.freeze({
  fgPct:0.45, fga:9.0,
  ftPct:0.75, fta:2.0,
  tpm:1.0, pts:12.0, reb:4.0, ast:4.0, stl:0.5, blk:0.5, to:1.5
});

function yahooPlaceholderPlayer(pk){
  if(!pk || !pk.outOfPool) return null;
  const pos = Array.isArray(pk.unknownPos) && pk.unknownPos.length ? pk.unknownPos : ["UTIL"];
  const l = YAHOO_FALLBACK_LINE;
  const p = {
    id:`__yahoo_unknown_${pk.overall}_${nameKey(pk.unknownName || "unknown")}`,
    name:pk.unknownName || "Yahoo player (out of projection pool)",
    team:pk.unknownTeam || "—", pos, gp:0, adp:null, valRank:null,
    fgm:l.fgPct*l.fga, fga:l.fga, ftm:l.ftPct*l.fta, fta:l.fta,
    tpm:l.tpm, pts:l.pts, reb:l.reb, ast:l.ast, stl:l.stl, blk:l.blk, to:l.to,
    z:{}, zpg:{}, total:0, totalPg:0, last:null,
    yahooPlaceholder:true, yahooFallbackLine:true
  };
  scorePlayerAgainstPool(p, pool);
  scorePlayerAgainstPool(p, pool, {gpw:0, field:"zpg", totalField:"totalPg"});
  return p;
}
function playerForPick(pk){
  if(!pk) return null;
  return (pk.playerId !== null && pk.playerId !== undefined ? pool.find(x=>x.id===pk.playerId) : null) || yahooPlaceholderPlayer(pk);
}
function myRoster(){
  return picks.filter(p=>p.teamIdx === myTeamIdx()).map(playerForPick).filter(Boolean);
}
function takenIds(){ return new Set(picks.map(p=>p.playerId).filter(id=>id !== null && id !== undefined)); }


// Team's summed z per category.


/*  Leverage weights.
    Win prob in a category ≈ sigmoid(teamZ / k). The marginal value of
    adding z there is the derivative: s*(1-s). Peaks at even, dies at
    locked-up or hopeless — which is what makes it punt on its own.  */


/*  Roster gaps are reported, never scored.

    Nudging a player's fit because he plays a position you're missing is how a
    36th-ranked centre ends up recommended over a 6th-ranked guard. Positional
    need is real, but it's a constraint you satisfy late with a replacement-level
    body — not a reason to pass on a better player in round four. So this returns
    information for the UI and contributes nothing to any score.               */


// P(gone before my next turn), from ADP vs picks remaining.






/* ============================================================
   RENDER
   ============================================================ */
const $ = s => document.querySelector(s);

function fmt(n, d=1){ return (n>=0?"":"") + n.toFixed(d); }
/*  A z of -0.03 is noise, not a weakness. Flipping hard from blue to red at
    exactly zero makes league-average look like a liability: Jalen Johnson's
    .482 FG% against a pool average of .483 rendered as a red mark.           */
const NEUTRAL = 0.22;
function zColor(z){
  if(Math.abs(z) < NEUTRAL) return "var(--dimmer)";
  return z >= 0 ? "var(--cool)" : "var(--hot)";
}
function zOpacity(z){
  return Math.abs(z) < NEUTRAL ? 0.55 : Math.min(1, 0.5 + Math.abs(z)/2.2);
}
const zText = z => Math.abs(z) < 0.05 ? "0.0" : z.toFixed(1);

function renderClock(state){
  const done = picks.length >= cfg.teams * cfg.size;
  const overall = picks.length;
  const onIdx = teamOnClock(overall);
  const mine = onIdx === myTeamIdx();
  const rd = Math.floor(overall / cfg.teams) + 1;
  const inRd = (overall % cfg.teams) + 1;

  /*  When it's your pick, "next turn" means the one AFTER this one — that's the
      number you're actually reasoning about when deciding who'll still be there. */
  const nxt = state.nxt;
  const until = nxt === null ? null : (mine ? state.gap : state.gap + 1);
  const untilText = until === null ? "—"
    : until === 0 ? "Back-to-back"
    : until === 1 ? "1 pick"
    : until + " picks";
  const nLbl = nxt === null ? "Next turn"
    : `Next turn · ${Math.floor(nxt/cfg.teams)+1}.${String((nxt%cfg.teams)+1).padStart(2,"0")}`;

  $("#clock").innerHTML = done
    ? `<div class="clock-cell onclock"><span class="k">Draft</span><span class="v">Complete</span></div>
       <div class="clock-gap"></div>
       <button class="clock-btn" id="undo">↶ Undo Pick</button>
       <button class="clock-btn" id="menubtn" title="Menu">☰</button>`
    : `
    <div class="clock-cell"><span class="k">Pick</span><span class="v">${overall+1}</span></div>
    <div class="clock-cell"><span class="k">Round</span><span class="v">${rd}.${String(inRd).padStart(2,"0")}</span></div>
    <div class="clock-cell ${mine?"you":"onclock"}" style="min-width:150px">
      <span class="k">${mine?"You're up":"On the clock"}</span>
      <span class="v" style="${!mine && teamName(onIdx).length>9 ? "font-size:15px" : ""}">${mine ? "YOUR PICK" : teamName(onIdx)}</span>
    </div>
    <div class="clock-cell"><span class="k">${nLbl}</span><span class="v" style="${until===0?"font-size:15px":""}">${untilText}</span></div>
    <div class="clock-gap"></div>
    <button class="clock-btn" id="undo">↶ Undo Pick</button>
    <button class="clock-btn" id="menubtn" title="Menu">☰</button>`;

  /*  Only the clock's own buttons need rewiring here — it's rebuilt every render,
      so a one-time binding would be dropped the first time a pick landed. The
      menu lives outside the clock and is wired once at boot.                 */
  const ub = $("#undo");
  ub.onclick = undo;
  ub.disabled = !picks.length;
  ub.style.opacity = picks.length ? 1 : .55;
  ub.title = picks.length ? `Undo pick ${picks.length} (${playerForPick(picks[picks.length-1])?.name || ""})` : "Nothing to undo";
  $("#menubtn").onclick = e=>{ e.stopPropagation(); $("#menu").classList.toggle("on"); };
}

// Menu actions — bound once.
function closeMenu(){ $("#menu").classList.remove("on"); }
document.addEventListener("click", closeMenu);
$("#menu").addEventListener("click", e=> e.stopPropagation());
$("#b_set").onclick  = ()=>{ closeMenu(); openSet(); };
$("#b_imp").onclick  = ()=>{ closeMenu(); $("#impmask").classList.add("on"); };
$("#b_help").onclick = ()=>{ closeMenu(); $("#helpmask").classList.add("on"); };
$("#theme").onclick  = ()=>{
  document.body.dataset.theme = document.body.dataset.theme === "court" ? "arena" : "court";
  closeMenu(); render();
};
$("#reset").onclick = ()=>{
  closeMenu();
  if(!picks.length || confirm(`Clear all ${picks.length} logged picks? Your loaded projections stay.`)){
    picks = []; locks = {}; hoverId = null; selectedId = null; armedDraftId = null; ledgerTeam = null; clearState(); $("#q").value = ""; render();
  }
};

/*  Player photo, with a monogram underneath.

    The id here is Basketball Reference's player code, carried over from the
    actuals import — NOT our internal pool index, which would have pulled up
    whichever face happened to sit at that number. Rookies and anyone who missed
    last season have no code, and hotlinked images can fail for reasons we can't
    see from here, so the monogram is always rendered behind and the <img> simply
    removes itself if it doesn't load.                                        */
function initials(name){
  const parts = name.replace(/[^A-Za-z\s.'-]/g,"").split(/\s+/).filter(Boolean);
  if(!parts.length) return "?";
  const a = parts[0][0] || "";
  const b = parts.length > 1 ? parts[parts.length-1][0] : "";
  return (a + b).toUpperCase();
}
function hueOf(name){
  let h = 0;
  for(let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) % 360;
  return h;
}
/*  Photos need a real NBA person id. Basketball Reference blocks hotlinking, and
    the BoxScore Lab export carries no id column at all, so there is nothing in
    the data to build a URL from. Instead the map is imported once and cached;
    nba.com serves its headshot CDN without referrer checks.                  */
const PHOTO_KEY = "draftboard.photos.v2";
const PHOTO_TRY = "draftboard.phototry.v1";

/*  A photo record is {s, i}: which service, and that service's id. Two services
    because they're reached differently — Sleeper publishes a player index that
    browsers may read cross-origin, so it can be fetched automatically; NBA's
    index cannot, so those ids arrive via the manual paste.                    */
let photoIds = {};
try{ photoIds = JSON.parse(localStorage.getItem(PHOTO_KEY) || "{}"); }catch(e){ photoIds = {}; }

function savePhotoIds(){
  try{ localStorage.setItem(PHOTO_KEY, JSON.stringify(photoIds)); }catch(e){}
}

function photoUrl(rec){
  if(!rec) return null;
  return rec.s === "s"
    ? `https://sleepercdn.com/content/nba/players/${rec.i}.jpg`
    : `https://cdn.nba.com/headshots/nba/latest/1040x760/${rec.i}.png`;
}

/*  Pull the whole player index and keep only name -> id. Runs once, then lives
    in localStorage. Any failure here is non-fatal: monograms already work, so
    this never blocks a draft.                                                */
async function fetchPhotoIds(){
  const res = await fetch("https://api.sleeper.app/v1/players/nba", {cache:"force-cache"});
  if(!res.ok) throw new Error("HTTP " + res.status);
  const data = await res.json();
  let n = 0;
  Object.keys(data).forEach(id=>{
    const p = data[id];
    const full = p && (p.full_name || [p.first_name, p.last_name].filter(Boolean).join(" "));
    if(!full || !/[a-z]/i.test(full)) return;
    const rec = {s:"s", i:String(p.player_id || id)};
    photoIds[nameKey(full)] = rec;
    const lk = "~" + lastKey(full);
    if(!photoIds[lk]) photoIds[lk] = rec;
    n++;
  });
  savePhotoIds();
  return n;
}

async function autoPhotos(silent){
  const st = $("#photostat");
  if(st && !silent){ st.textContent = "fetching\u2026"; st.style.color = "var(--dim)"; }
  try{
    await fetchPhotoIds();
    try{ localStorage.setItem(PHOTO_TRY, "ok"); }catch(e){}
    syncPhotoStat();
    render();
    return true;
  }catch(e){
    try{ localStorage.setItem(PHOTO_TRY, String(Date.now())); }catch(e2){}
    if(st && !silent){
      st.textContent = "automatic fetch failed \u2014 use the paste method below";
      st.style.color = "var(--hot)";
    }
    return false;
  }
}

function importPhotoIds(text){
  const map = {};
  String(text).split(/\r?\n/).forEach(line=>{
    const cells = line.split(/\t|,/).map(x=>x.trim()).filter(Boolean);
    if(cells.length < 2) return;
    const id = cells.find(x=>/^\d{3,9}$/.test(x));
    const name = cells.find(x=>/[A-Za-z]{2,}/.test(x) && !/^\d+$/.test(x));
    if(id && name){ const rec = {s:"n", i:id}; map[nameKey(name)] = rec; map["~" + lastKey(name)] = rec; }
  });
  const n = Object.keys(map).length;
  if(n){ photoIds = Object.assign({}, photoIds, map); savePhotoIds(); }
  return n;
}

function photoIdFor(p){
  const r = photoIds[nameKey(p.name)] || photoIds["~" + lastKey(p.name)] || null;
  if(!r) return null;
  return typeof r === "string" ? {s:"n", i:r} : r;   // tolerate the old flat format
}

function photoHTML(p){
  const mono = `<span class="mono-badge" style="--h:${hueOf(p.name)}">${initials(p.name)}</span>`;
  const url = photoUrl(photoIdFor(p));
  const img = url
    ? `<img src="${url}" alt="" loading="lazy"
           onload="this.parentNode.classList.add('has-photo')"
           onerror="this.remove()">`
    : "";
  return `<div class="rec-photo">${mono}${img}</div>`;
}

function renderRec(state){
  const {avail, w, riskGap, conviction} = state;
  if(!avail.length){ $("#rec").innerHTML = `<div class="empty">No players left in the pool.</div>`; return; }

  const eligible = avail.filter(p=>p.rosterFit !== false);
  if(!eligible.length){
    $("#rec").innerHTML = `<div class="empty"><b>No legal roster fit available.</b><br>Every remaining player is incompatible with your open roster slots.</div>`;
    return;
  }
  const recPool = eligible;
  const best = [...recPool].sort((a,b)=>fitFor(b)-fitFor(a))[0];
  const bestVal = [...recPool].sort((a,b)=>b.total-a.total)[0];
  const onIdx = teamOnClock(picks.length);
  const mine = onIdx === myTeamIdx();

  const contrib = CATS.map(c=>({c, v: w[c.k] * cw(c.k) * best.z[c.k]}))
                      .sort((a,b)=>b.v-a.v).filter(x=>x.v > 0.25).slice(0,4);

  // Only meaningful on your own clock — after you pick, it clears itself.
  const cost = bestVal.total - best.total;
  const differs = mine && bestVal.id !== best.id && cost > 0.4;

  /*  The panel follows your selection, falling back to the recommendation.
      Clicking a row used to draft instantly, which meant you could never look
      at anyone but the top name — and one stray click cost you a pick.       */
  const sel = selectedId !== null ? avail.find(p => p.id === selectedId) : null;
  if(selectedId !== null && !sel){
    selectedId = null;                                      // he just got drafted
    armedDraftId = null;
  }
  const prev = hoverId !== null && hoverId !== selectedId ? avail.find(p => p.id === hoverId) : null;
  if(hoverId !== null && !avail.find(p => p.id === hoverId)) hoverId = null;
  const shown = prev || sel || best;
  const isRec = shown.id === best.id;
  const previewing = !!prev;

  const shownContrib = CATS.map(c=>({c, v: w[c.k] * cw(c.k) * shown.z[c.k]}))
                           .sort((a,b)=>b.v-a.v).filter(x=>x.v > 0.25).slice(0,4);

  const fg1 = fitFor(best), fg2 = fitFor(shown);
  const runnerUp = [...recPool].sort((a,b)=>fitFor(b)-fitFor(a))[1] || null;
  const fitGap = (isFinite(fg1)?fg1:0) - (isFinite(fg2)?fg2:0);
  /*  One shape for all three states: a label, exactly two lines of text, and a
      button. Anything conditional here changes the panel height, and the ledger,
      punt radar and roster all shuffle underneath it every time you hover a
      different player.                                                        */
  const surname = p => p.name.split(" ").slice(-1)[0];
  let cmpK, cmpBody, cmpBtn, cmpId;
  if(!isRec){
    cmpK = fitGap > 0.05 ? `Board rates ${surname(best)} higher by ${fitGap.toFixed(1)}` : `Equal to the board's pick`;
    cmpBody = `Recommendation is <b>${best.name}</b> (fit ${isFinite(fg1)?fg1.toFixed(1):"—"}${best.valRank?`, #${best.valRank}`:``})
               versus <b>${shown.name}</b> at ${isFinite(fg2)?fg2.toFixed(1):"—"}.`;
    cmpBtn = `Back to ${surname(best)}`; cmpId = "r_back";
  } else if(differs){
    cmpK = `Costs you ${cost.toFixed(1)} of raw value`;
    cmpBody = `Highest value on the board is <b>${bestVal.name}</b> (${bestVal.total.toFixed(1)}${bestVal.valRank?`, #${bestVal.valRank}`:``}).
               ${conviction < 0.45
                 ? `Category fit is only ${Math.round(conviction*100)}% engaged, so trust the value.`
                 : `The board prefers ${surname(best)} on category fit${best.scarce - bestVal.scarce > 0.3 ? ` and availability` : ``}.`}`;
    cmpBtn = `Inspect ${surname(bestVal)}`; cmpId = "r_val";
  } else {
    cmpK = `Top of the board`;
    cmpBody = `Nothing available scores higher for your roster.${runnerUp
      ? ` Clear of <b>${runnerUp.name}</b> by ${(fg1 - fitFor(runnerUp)).toFixed(1)}.` : ``}`;
    cmpBtn = runnerUp ? `Compare ${surname(runnerUp)}` : `—`; cmpId = "r_next";
  }
  /* CLEAR returns the recommendation card to a quiet default state instead of
      leaving a large empty hole. Hovering/selecting another player restores the
      normal comparison card because those interactions clear recMessageCleared. */
  const reasonLabels = shownContrib.slice(0,3).map(x=>x.c.label);
  const reasonText = reasonLabels.length >= 3
    ? `${reasonLabels[0]}, ${reasonLabels[1]} and ${reasonLabels[2]}`
    : reasonLabels.length === 2
      ? `${reasonLabels[0]} and ${reasonLabels[1]}`
      : reasonLabels[0] || `your strongest categories`;
  const availabilityText = shown.scarce > 0.3
    ? ` He is also unlikely to make it back to your next pick.`
    : shown.scarce < -0.3
      ? ` He may still be available later, so you have some flexibility.`
      : ``;
  const defaultCompare = `
    <div class="tradeoff rec-default">
      <div class="k">Why ${surname(shown)}?</div>
      <div class="tt">Best available fit for your roster. Adds <b>${reasonText}</b>${availabilityText}</div>
    </div>`;

  const compare = recMessageCleared
    ? defaultCompare
    : `
    <div class="tradeoff">
      <div class="k">${cmpK}</div>
      <div class="tt">${cmpBody}</div>
      <button class="mini" id="${cmpId}"${cmpId==="r_next" && !runnerUp ? " disabled" : ""}>${cmpBtn}</button>
    </div>`;

  $("#rec").innerHTML = `
    <div class="rec-eyebrow">${previewing ? "Previewing" : !isRec ? "Selected" : mine ? "Take him" : "Best available · not your pick"}${
      fitMode() ? ` <span style="color:var(--dimmer)">· fit from last season</span>` : ``}</div>
    <div class="rec-top">
      <div class="rec-info">
        <div class="rec-name">${shown.name}</div>
        <div class="rec-sub">${shown.pos.join(" / ")} · ${shown.team}${shown.valRank?` · Value Rank #${shown.valRank}`:``} · <span title="Add up the nine category numbers to the right and you get this. It's the player in a vacuum — total production, before anything about your roster. Switch the view to Z-scores to see the columns add up.">Total ${shown.total.toFixed(1)}</span></div>
        <div class="rec-why">
          ${shownContrib.map(x=>`<span class="chip up">${x.c.label} +${shown.z[x.c.k].toFixed(1)}</span>`).join("")}
          ${shown.scarce > 0.3 ? `<span class="chip risk">Gone before your next turn</span>` : ``}
          ${shown.scarce < -0.3 && riskGap > 0 ? `<span class="chip">Would still be there in ${riskGap} pick${riskGap===1?"":"s"}</span>` : ``}
        </div>
      </div>
      ${photoHTML(shown)}
    </div>
    <div class="rec-actions">
      <button class="btn primary" id="r_draft">Draft ${shown.name.split(" ").slice(-1)[0]} to ${mine ? "my team" : teamName(onIdx)}</button>
      <button class="btn" id="r_clear">Clear</button>
    </div>
    `;
  $("#r_draft").onclick = ()=> draft(shown.id);
  const rb = $("#r_back");  if(rb) rb.onclick = ()=>{ recMessageCleared = false; selectedId = null; hoverId = null; armedDraftId = null; render(); };
  const rc = $("#r_clear"); if(rc) rc.onclick = ()=>{ selectedId = null; hoverId = null; armedDraftId = null; render(); };
  const rv = $("#r_val");   if(rv) rv.onclick = ()=>{ recMessageCleared = false; selectedId = bestVal.id; hoverId = bestVal.id; armedDraftId = null; render(); };
  const rn = $("#r_next");  if(rn && runnerUp) rn.onclick = ()=>{ recMessageCleared = false; selectedId = runnerUp.id; hoverId = runnerUp.id; armedDraftId = null; render(); };
}

/*  Every team's roster in a single pass. Cheap enough to recompute each render:
    one walk over the pick log plus a map lookup, not a scan per team.        */
function allRosters(){
  const out = Array.from({length: cfg.teams}, ()=>[]);
  picks.forEach(pk=>{
    const p = playerForPick(pk);
    if(p && pk.teamIdx >= 0 && pk.teamIdx < cfg.teams) out[pk.teamIdx].push(p);
  });
  return out;
}

/*  Par, in real units: what one roster spot is worth if you drafted an average
    rostered player. Gives the totals bars something to measure against even
    when only your own team has picks — comparing to the league mean alone
    would leave every bar flat in round one.                                 */
function leagueRates(){
  const rostered = [...pool].sort((a,b)=>b.total-a.total).slice(0, cfg.teams * cfg.size);
  const s = teamTotals(rostered);
  const n = rostered.length || 1;
  const per = {};
  ["tpm","pts","reb","ast","stl","blk","to"].forEach(k=> per[k] = s[k]/n);
  per.fg = s.fga ? s.fgm/s.fga : 0;
  per.ft = s.fta ? s.ftm/s.fta : 0;
  return per;
}

// Reference value for a category given how many players are on the roster.
function catRef(per, k, size){
  return (k === "fg" || k === "ft") ? per[k] : per[k] * size;
}

function fmtTotal(k, v){
  if(v === null) return "\u2014";
  if(k === "fg" || k === "ft") return v.toFixed(3).replace(/^0/,"");
  return v.toFixed(1);
}

const possessive = n => /s$/i.test(n) ? n + "\u2019" : n + "\u2019s";

function renderLedger(state){
  const rosters = allRosters();
  const viewing = (ledgerTeam === null || ledgerTeam >= cfg.teams) ? myTeamIdx() : ledgerTeam;
  const isMine = viewing === myTeamIdx();

  const roster = isMine ? state.roster : rosters[viewing];
  const tz = isMine ? state.tz : teamZ(roster);
  const w = isMine ? state.w : leverage(tz, state.conviction);
  const n = Math.max(roster.length, 1);

  // Standings per category, so you can see who's actually winning each one.
  const allZ = rosters.map((r,i)=> i === viewing ? tz : teamZ(r));
  const live = allZ.filter((_,i)=> rosters[i].length > 0).length;

  // Ghost preview only makes sense on your own board.
  // Hover wins while the cursor is over a row; otherwise the selection stays pinned.
  const previewId = hoverId !== null ? hoverId : selectedId;
  const hov = (isMine && previewId !== null) ? pool.find(p=>p.id===previewId) : null;

  $("#ledgerteam").innerHTML = rosters.map((r,i)=>
    `<option value="${i}" ${i===viewing?"selected":""}>${i===myTeamIdx()?"My team":teamName(i)}${r.length?` (${r.length})`:""}</option>`).join("");

  const totals = teamTotals(roster);
  const per = leagueRates();
  const hovTotals = hov ? teamTotals(roster.concat([hov])) : null;
  const allTotals = rosters.map((r,i)=> i === viewing ? totals : teamTotals(r));
  const asTotals = ledgerMode === "tot";

  $("#ledger").innerHTML = CATS.map(c=>{
    const lev = w[c.k] > 1.05;
    const flip = c.neg ? -1 : 1;          // fewer turnovers is better
    let barW, ghostW, valTxt, valZ, rank;
    let nextTxt = null, better = 0;

    /* Bar geometry represents the roster's CATEGORY PROFILE and therefore never
       changes when you toggle the number display between Z and Totals. Only the
       labels/ranks change. The hover ghost uses the same fixed profile scale. */
    const curProfile = roster.length ? tz[c.k] / n : 0;
    const nextProfile = hov ? (tz[c.k] + hov.z[c.k]) / (roster.length + 1) : null;
    const profileScale = v => Math.max(-1, Math.min(1, v / 2)) * 50;
    barW = profileScale(curProfile);
    ghostW = nextProfile === null ? null : profileScale(nextProfile);
    valZ = curProfile;

    if(asTotals){
      const v = catTotal(totals, c.k);
      valTxt = roster.length ? fmtTotal(c.k, v) : "\u2014";

      if(hovTotals){
        const hv = catTotal(hovTotals, c.k);
        nextTxt = fmtTotal(c.k, hv);
        // In real units, fewer turnovers is the improvement.
        better = (hv !== null && v !== null) ? (hv - v) * flip : 0;
      }

      rank = roster.length
        ? 1 + allTotals.filter((t,i)=>{
            if(!rosters[i].length || i === viewing) return false;
            const o = catTotal(t, c.k), m = catTotal(totals, c.k);
            return o !== null && m !== null && (o - m) * flip > 0;
          }).length
        : null;
    } else {
      valTxt = roster.length ? fmt(curProfile, 2) : "\u2014";
      if(nextProfile !== null){
        nextTxt = fmt(nextProfile, 2);
        better = nextProfile - curProfile; // z is sign-corrected, so higher is always better
      }
      rank = roster.length ? 1 + allZ.filter((t,i)=> rosters[i].length > 0 && t[c.k] > tz[c.k]).length : null;
    }

    const bar = `<div class="lbar ${barW>=0?"pos":"neg"}" style="${barW>=0
      ? `left:50%;width:${barW}%`
      : `right:50%;width:${-barW}%`}"></div>`;

    const ghost = ghostW === null ? "" : `<div class="lghost" style="${ghostW>=0
      ? `left:50%;width:${ghostW}%`
      : `right:50%;width:${-ghostW}%`}"></div>`;

    const lock = isMine ? (locks[c.k] || "") : "";
    return `<div class="lrow ${lev?"lev":""} ${lock}">
      <span class="lcat" data-c="${c.k}" title="${isMine ? "Click through: auto \u2192 punt \u2192 chase \u2192 hard chase" : "Switch back to your team to set punts"}">${c.label}${cw(c.k)!==1?`<em class="cwx">\u00d7${cw(c.k)}</em>`:""}</span>
      <span class="ltrack"><span class="lmid"></span>${bar}${ghost}</span>
      <span class="lval">
        <span style="color:${roster.length?zColor(valZ):"var(--dimmer)"}">${valTxt}</span>
        ${nextTxt !== null ? `<em class="lnext ${better>0?"up":better<0?"dn":""}">\u2192 ${nextTxt}</em>` : ``}
      </span>
      <span class="lrank ${rank===1?"first":""}" title="${rank?`${rank} of ${live} drafted teams`:""}">${rank?`${rank}/${live}`:"\u2014"}</span>
    </div>`;
  }).join("");

  if(isMine){
    [...$("#ledger").querySelectorAll(".lcat")].forEach(el=>{
      el.onclick = ()=>{
        const k = el.dataset.c;
        const next = locks[k] === undefined ? "punt" : locks[k] === "punt" ? "chase"
                   : locks[k] === "chase" ? "chase2" : undefined;
        setLock(k, next);
      };
    });
  }

  /* Head-to-head uses actual projected production, never summed z-scores. */
  if(!isMine && roster.length && state.roster.length){
    const {rows,won,tied,lost,tot,verdict} = compareTeams(state.roster, roster, CATS, cw);
    $("#h2h").innerHTML = `
      <div class="h2h-head">
        <span class="k">You vs ${teamName(viewing)}</span>
        <span class="score ${verdict}">${won}–${lost}${tied?`–${tied}`:""}</span>
      </div>
      <div class="h2h-grid">
        ${rows.map(r=>`<span class="h2hc ${r.tie?"t":r.win?"w":"l"}">
          ${r.c.label}<em>${r.display}</em></span>`).join("")}
      </div>
      <div class="h2h-note">${verdict === "win" ? `You lead ${won} of ${tot} categories on current projected totals.`
        : verdict === "lose" ? `They lead ${lost} of ${tot}. Closest gaps are the ones worth attacking.`
        : `The matchup is even on current projected totals.`}
        Counting stats are team total vs team total; FG% and FT% are volume-weighted percentage vs percentage.</div>`;
    $("#h2h").style.display = "";
  } else {
    $("#h2h").style.display = "none";
  }

  $("#ledgerkey").innerHTML = asTotals
    ? `Combined projected per-game production of the roster \u2014 counting stats summed, percentages recombined by volume. Bar lengths always show the same category profile as Z mode, so toggling Z/Totals changes the numbers, not the shape of your roster. The right-hand figure is the rank among drafted teams.`
    : ``;

  $("#ledgernote").textContent = isMine
    ? (roster.length ? "Hover a player to preview" : "Draft someone to begin")
    : `${roster.length} drafted \u00b7 Read-only`;
}

// One stat cell. Per-game modes show the real number but keep the z-score
// colouring, so you can read impact and raw output at the same time.
function statCell(p, c, mode){
  if(mode === "z"){
    const z = p.z[c.k];
    return `<td class="mono" style="color:${zColor(z)};opacity:${zOpacity(z)}">${zText(z)}</td>`;
  }
  const src = mode === "last" ? p.last : p;
  let v = null, z = null;
  if(src){
    if(c.k === "fg") v = src.fga ? (src.fgm/src.fga).toFixed(3).replace(/^0/,"") : null;
    else if(c.k === "ft") v = src.fta ? (src.ftm/src.fta).toFixed(3).replace(/^0/,"") : null;
    else if(typeof src[c.k] === "number") v = src[c.k].toFixed(1);
    const zs = src.zpg || src.z;
    if(zs && typeof zs[c.k] === "number") z = zs[c.k];
  }
  if(v === null) return `<td class="mono" style="color:var(--dimmer)">—</td>`;
  if(z === null) return `<td class="mono" style="color:var(--dim)">${v}</td>`;
  return `<td class="mono" style="color:${zColor(z)};opacity:${zOpacity(z)}">${v}</td>`;
}

/*  Which fit to display. In "Last season per game" the Fit column answers the
    same question against last year's real production instead of a projection.
    The ledger deliberately stays on projections — it describes the roster you
    are actually building, not a hypothetical replay of last season.         */
function fitMode(){ return $("#mode").value === "last"; }
function fitFor(p){
  if(!fitMode()) return p.fitAdj;
  return (p.fitLast === null || p.fitLast === undefined) ? -Infinity : p.fitLast;
}

// Sort value for a column, so the first click always puts "best" on top.
function sortVal(p, key, mode){
  if(key === "fit")   return fitFor(p);
  if(key === "total") return p.total;
  if(key === "rank")  return p.valRank == null ? -Infinity : -p.valRank;
  if(key === "adp") {
    const adp = Number(p.adp);
    return (!Number.isFinite(adp) || adp <= 0) ? -Infinity : -adp; // blanks/invalid ADP always count as missing
  }
  if(mode === "z")    return p.z[key];
  const src = mode === "last" ? p.last : p;
  if(!src) return -Infinity;
  if(key === "fg") return src.fga ? src.fgm/src.fga : -Infinity;
  if(key === "ft") return src.fta ? src.ftm/src.fta : -Infinity;
  const raw = src[key];
  if(typeof raw !== "number") return -Infinity;
  return key === "to" ? -raw : raw;      // fewer turnovers is better
}

/*  Shared by the main board and the starred list so the two stay identical in
    layout and behaviour — same columns, same widths, same interactions.      */
function playerRow(p, opts){
  const o = opts || {};
  const rk = p.valRank ?? null;
  const gone = o.takenBy !== undefined && o.takenBy !== null;
  const mode = $("#mode").value;
  const star = `<span class="star${isStarred(p)?" on":""}" data-star="${p.id}"
     title="${isStarred(p)?"Remove from starred":"Star this player"}">${isStarred(p)?"\u2605":"\u2606"}</span>`;

  const nofit = !gone && p.rosterFit === false;
  return `<tr data-id="${p.id}" class="${gone?"gone ":""}${nofit?"nofit ":""}${!gone&&p.id===selectedId?"sel ":""}${o.top?"top":""}"${nofit?' title="No legal roster slot available for this player"':''}>
      <td class="l">
        <div class="pname">${star}${p.name}${
          o.flagRisk?'<span class="risk-dot" title="Likely gone before your next turn"></span>':''}${
          !gone && p.id===armedDraftId?'<span class="again">click again to draft</span>':''}</div>
        <div class="ppos">${gone
          ? `<span class="takenby">Drafted by ${o.takenBy}</span>`
          : `${p.pos.join("/")} \u00b7 ${p.team}${p.gp?` \u00b7 ${p.gp} GP`:""}`}</div>
      </td>
      <td class="fit mono" style="color:${(isFinite(fitFor(p))&&fitFor(p)>=0)?"var(--chalk)":"var(--dimmer)"}">${
        isFinite(fitFor(p)) ? fitFor(p).toFixed(1) : "\u2014"}</td>
      <td class="mono" style="color:${rk?"var(--chalk)":"var(--dimmer)"}">${rk ?? "\u2014"}</td>
      <td class="mono" style="color:var(--dim)">${Number.isFinite(Number(p.adp)) && Number(p.adp) > 0 ? Number(p.adp).toFixed(0) : "\u2014"}</td>
      <td class="mono" style="color:var(--dim)">${p.total.toFixed(1)}</td>
      ${CATS.map(c=>statCell(p,c,mode)).join("")}
    </tr>`;
}

/*  Clicking the star must not also select or draft the row underneath it.    */
function wireRows(container, opts){
  const o = opts || {};
  [...container.querySelectorAll("tr[data-id]")].forEach(tr=>{
    const id = +tr.dataset.id;
    const p = pool.find(x=>x.id === id);
    const st = tr.querySelector(".star");
    if(st) st.onclick = e=>{ e.stopPropagation(); toggleStar(p); };
    if(tr.classList.contains("gone") || tr.classList.contains("nofit")) return;   // unavailable: display only
    tr.onclick = ()=>{
      // Draft only when THIS player was explicitly armed by a previous row click.
      // Being selected by the recommendation panel, keyboard navigation, etc. is
      // not enough to make a single row click commit a pick.
      if(armedDraftId === id){
        armedDraftId = null;
        draft(id);
      } else {
        recMessageCleared = false;
        selectedId = id;
        hoverId = id;
        armedDraftId = id;
        render();
      }
    };
    tr.onmouseenter = ()=>{
      recMessageCleared = false;
      if(hoverId === id) return;
      hoverId = id;
      const s2 = evaluate();
      renderRec(s2); renderLedger(s2); markFocus();
    };
  });
}

function renderStars(state){
  const byId = new Map(pool.map(p=>[p.id, p]));
  const takenBy = new Map();
  picks.forEach(pk=> takenBy.set(pk.playerId, pk.teamIdx));

  const list = pool.filter(isStarred);
  $("#starcount").textContent = list.length ? `${list.length}` : "";
  $("#starwrap").style.display = list.length ? "" : "none";
  if($("#starbody")) $("#starbody").style.display = starsOpen ? "" : "none";
  if(!list.length){ $("#starboard").innerHTML = ""; return; }

  const key = sortKey;
  const sorted = [...list].sort((a,b)=>{
    const ag = takenBy.has(a.id), bg = takenBy.has(b.id);
    if(ag !== bg) return ag ? 1 : -1;          // drafted ones sink to the bottom
    const av = sortVal(a,key,$("#mode").value), bv = sortVal(b,key,$("#mode").value);
    const an = !isFinite(av), bn = !isFinite(bv);
    if(an || bn) return an && bn ? 0 : (an ? 1 : -1);
    return (bv - av) * (sortDir === -1 ? 1 : -1);
  });

  $("#starboard").innerHTML = sorted.map(p=>{
    const t = takenBy.has(p.id) ? teamName(takenBy.get(p.id)) : null;
    return playerRow(p, {takenBy: t});
  }).join("");
  wireRows($("#starboard"));
}

function renderBoard(state){
  const q = fold($("#q").value.trim());
  const mode = $("#mode").value;
  let list = state.avail;
  if(posFilter !== "ALL") list = list.filter(p=>p.pos.includes(posFilter));
  /*  Match team and position as well as name — "DEN" or "C" is often what you
      actually want mid-draft when you're hunting a specific need.           */
  if(q) list = list.filter(p =>
    fold(p.name).includes(q) ||
    fold(p.team).includes(q) ||
    p.pos.some(x => fold(x) === q));

  const key = sortKey;
  list = [...list].sort((a,b)=>{
    if(key === "fit" && (a.rosterFit === false || b.rosterFit === false) && a.rosterFit !== b.rosterFit)
      return a.rosterFit === false ? 1 : -1;
    if(key === "name") return a.name.localeCompare(b.name) * (sortDir === -1 ? 1 : -1);
    const av = sortVal(a,key,mode), bv = sortVal(b,key,mode);
    /*  A missing value is not a low value. Left as -Infinity it sorts as "worst",
        which floats blanks to the top the moment you reverse the direction — and
        two blanks subtract to NaN, which leaves the comparator undefined. Blanks
        go last in both directions, always.                                     */
    const ab = !isFinite(av), bb = !isFinite(bv);
    if(ab || bb) return ab && bb ? 0 : (ab ? 1 : -1);
    return (bv - av) * (sortDir === -1 ? 1 : -1);
  }).slice(0, 80);

  boardIds = list.map(p=>p.id);
  $("#board").innerHTML = list.map((p,i)=> playerRow(p, {
    /*  Only warn about availability for players you're plausibly taking. A
        "gone soon" dot on someone ranked 40th is noise — it's true (the market
        rates him higher than the projections do) but it isn't a decision you
        actually face.                                                        */
    flagRisk: p.risk > 0.6 && i < 15 && key === "fit",
    top: i === 0 && key === "fit"
  })).join("") || `<tr><td class="l" colspan="14" style="padding:24px;color:var(--dimmer)">No players match. Clear the search or change the position filter.</td></tr>`;

  // First click inspects; clicking the already-selected player commits.
  // Hover previews and STAYS put — see wireRows.
  wireRows($("#board"));
}

/*  Move the "previewing" outline without re-rendering the whole board — hover
    fires constantly and rebuilding 200 rows per row-crossing is wasteful.   */
function markFocus(){
  const rows = document.querySelectorAll("#board tr[data-id], #starboard tr[data-id]");
  rows.forEach(tr=>{
    const on = +tr.dataset.id === hoverId && hoverId !== selectedId;
    tr.classList.toggle("focus", on);
  });
}

/*  Applying a punt silently reshuffles the whole board, which is unnerving if
    you can't see what moved. Snapshot the ranking before and after, then show
    the biggest movers plus an undo.                                          */
let lastChange = null;

function rankSnapshot(){
  const st = evaluate();
  const m = new Map();
  [...st.avail].sort((a,b)=>b.fitAdj-a.fitAdj).forEach((p,i)=> m.set(p.id, {rank:i+1, name:p.name}));
  return m;
}

function setLock(k, val){
  const before = rankSnapshot();
  const prev = {...locks};
  if(val === undefined) delete locks[k]; else locks[k] = val;
  const after = rankSnapshot();

  const movers = [];
  after.forEach((a, id)=>{
    const b = before.get(id);
    if(!b) return;
    if(b.rank <= 20 || a.rank <= 20) movers.push({name:a.name, from:b.rank, to:a.rank, d:b.rank-a.rank});
  });
  movers.sort((x,y)=>Math.abs(y.d)-Math.abs(x.d));

  const label = CATS.find(c=>c.k===k).label;
  lastChange = {
    text: val === undefined ? `Cleared ${label}` : val === "punt" ? `Punted ${label}`
        : val === "chase2" ? `Hard chasing ${label}` : `Chasing ${label}`,
    prev,
    up: movers.filter(m=>m.d > 0).slice(0,3),
    down: movers.filter(m=>m.d < 0).slice(0,3)
  };
  render();
}

function undoLock(){
  if(!lastChange) return;
  locks = {...lastChange.prev};
  lastChange = null;
  render();
}

/*  Explain, in plain terms, what the slider is doing right now — including
    which categories the weighting currently favours and ignores.            */
function shapeBlurb(state){
  const pct = Math.round(state.conviction * 100);
  const punted = CATS.filter(c=>locks[c.k]==="punt").map(c=>c.label);
  if(state.conviction === 0)
    return "Overall Value = the best projected player available. Team Needs = the player who best fills holes in your current category profile.";
  const ranked = CATS.filter(c=>!locks[c.k]).sort((a,b)=>state.w[b.k]-state.w[a.k]);
  const hi = ranked.slice(0,2).map(c=>c.label).join(" and ");
  const base = `Overall Value = best projected player available. Team Needs = fills the holes in your current category profile. At ${pct}%, the board ${pct < 35 ? "mostly favours overall value" : pct < 70 ? "balances both" : "leans heavily toward team needs"}.`;
  const detail = hi ? ` Right now it is giving extra weight to ${hi}.` : "";
  const puntNote = punted.length ? ` ${punted.join(", ")} ${punted.length===1?"is":"are"} punted and ignored by Fit.` : "";
  return base + detail + puntNote;
}



function renderSuggest(state){
  const el = $("#suggest");
  const punted = CATS.filter(c=>locks[c.k]==="punt");
  const chased = CATS.filter(c=>locks[c.k]==="chase"||locks[c.k]==="chase2");
  const active = [...punted, ...chased];

  // Every category, always visible — click to cycle auto -> punt -> chase.
  const picker = `
    <div class="active">
      <span class="pickerlbl">Set by hand</span>
      ${CATS.map(c=>{
        const st = locks[c.k] || "auto";
        return `<span class="lockchip ${st}" data-c="${c.k}" title="${
          st==="punt" ? "Punted — counts for nothing. Click to chase instead."
          : st==="chase2" ? "Hard chase — weighted well past natural maximum. Click to clear."
          : st==="chase" ? "Chasing — weighted at maximum. Click to return to auto."
          : "Auto. Click to punt."}">${c.label}${st==="punt"?" ✕":st==="chase"?" ▲":st==="chase2"?" ▲▲":""}</span>`;
      }).join("")}
      ${active.length ? `<span class="lockchip clear" data-all="1">Clear all</span>` : ``}
    </div>`;

  // What the last change actually did to the board.
  const diff = !lastChange ? "" : `
    <div class="sug diff">
      <div class="k">${lastChange.text}</div>
      ${lastChange.up.length ? `<div><span class="up">▲ Rose</span> — ${lastChange.up.map(m=>m.name).join(", ")}</div>` : ``}
      ${lastChange.down.length ? `<div><span class="dn">▼ Fell</span> — ${lastChange.down.map(m=>m.name).join(", ")}</div>` : ``}
      ${!lastChange.up.length && !lastChange.down.length ? `<div style="color:var(--dimmer)">Board order barely moved.</div>` : ``}
      <button class="mini" id="undolock">Undo</button>
      <button class="dismiss" id="diffx" title="Dismiss">&times;</button>
    </div>`;

  const chaseSug = suggestChase(state);
  const chaseBox = chaseSug ? `<div class="sug ${chaseSug.punts===3?"warn":""}">
      <div class="k">${chaseSug.punts===3?"Protect your five-category path":"Consider chasing " + chaseSug.cat.label}</div>
      ${chaseSug.punts===3
        ? `You already have <b>3 punts</b>. Do not let a fourth category slip away. <b>${chaseSug.cat.label}</b> is your weakest remaining category, so hard-chase it now.`
        : `You already have <b>2 punts</b>, and <b>${chaseSug.cat.label}</b> is weak enough to put a fourth category at risk later. Consider chasing it now.`}
      <button class="mini" data-chase="${chaseSug.cat.k}">Chase ${chaseSug.cat.label}</button>
    </div>` : "";

  let body;
  if(punted.length >= 4){
    body = `<div class="sug warn">
      <div class="k">Four punts is too many</div>
      You need to win five of nine categories. Punting ${punted.length} leaves
      ${9-punted.length} to fight over, so you'd have to sweep almost all of them every week.</div>`;
  } else if(punted.length >= 2){
    body = `<div class="sug quiet">
      <b style="color:var(--chalk)">Punt limit reached.</b> You already have ${punted.length} punts, so nineCat will not recommend punting any additional categories.
      From here, recommendations focus on protecting and chasing the seven categories you still need to compete in.
    </div>`;
  } else {
    const all = suggestPunts(state);
    const sug = all.filter(x=>!ui.sugHidden.has(x.cat.k));
    if(!sug.length){
      body = state.roster.length < 2
        ? `<div class="sug quiet">Draft a couple of players and this will suggest categories worth abandoning. You can punt anything by hand above at any time.</div>`
        : `<div class="sug quiet">No obvious punts${all.length?` beyond the ${all.length} you dismissed`:``}. Your roster is still balanced enough to compete across the board${active.length?`, beyond what you've set by hand`:``}.
           ${ui.sugHidden.size ? `<a href="#" id="unhide">Show ${ui.sugHidden.size} dismissed</a>` : ``}</div>`;
    } else {
      body = sug.map(s=>`
        <div class="sug">
          <div class="k">Consider punting ${s.cat.label}</div>
          Drafting best-available finishes you <b>${Math.abs(s.gap).toFixed(1)} behind</b> a typical team here.
          ${s.reach < 0
            ? `Even chasing it all draft doesn't reach par — it's not winnable.`
            : `Chasing it back to par costs about <b>${s.cost.toFixed(0)}</b> of value spent on players you'd otherwise pass.`}
          <button class="mini" data-c="${s.cat.k}">Punt ${s.cat.label}</button>
          <button class="dismiss" data-hide="${s.cat.k}" title="Dismiss">&times;</button>
        </div>`).join("") +
        `<div class="sug quiet">Suggestions only — nothing is applied until you click.
         ${ui.sugHidden.size ? `<a href="#" id="unhide">Show ${ui.sugHidden.size} dismissed</a>` : ``}</div>`;
    }
  }

  el.innerHTML = picker + diff + chaseBox + body;

  [...el.querySelectorAll(".sug button[data-c]")].forEach(b=>{
    b.onclick = ()=> setLock(b.dataset.c, "punt");
  });
  [...el.querySelectorAll(".sug button[data-chase]")].forEach(b=>{
    b.onclick = ()=> setLock(b.dataset.chase, "chase2");
  });
  [...el.querySelectorAll(".lockchip[data-c]")].forEach(b=>{
    b.onclick = ()=>{
      const k = b.dataset.c;
      setLock(k, locks[k] === undefined ? "punt" : locks[k] === "punt" ? "chase"
               : locks[k] === "chase" ? "chase2" : undefined);
    };
  });
  const clr = el.querySelector('.lockchip[data-all]');
  if(clr) clr.onclick = ()=>{ locks = {}; lastChange = null; render(); };
  const u = el.querySelector("#undolock");
  if(u) u.onclick = undoLock;
  const dx = el.querySelector("#diffx");
  if(dx) dx.onclick = ()=>{ lastChange = null; render(); };
  [...el.querySelectorAll("button[data-hide]")].forEach(b=>{
    b.onclick = ()=>{ ui.sugHidden.add(b.dataset.hide); render(); };
  });
  const uh = el.querySelector("#unhide");
  if(uh) uh.onclick = e=>{ e.preventDefault(); ui.sugHidden.clear(); render(); };
}

/*  Roster slots, assigned properly.

    The panel used to drop the nth player drafted into the nth slot, which
    happily parked an SF/PF in the centre slot and told you the roster was fine.
    This is a bipartite matching: players on one side, slots on the other, an
    edge where the player is actually eligible. Kuhn's algorithm finds a maximum
    matching, so if a legal arrangement exists it gets found — and anyone left
    over genuinely doesn't fit.                                               */


function renderLog(){
  $("#logcount").textContent = picks.length ? `${picks.length} pick${picks.length===1?"":"s"}` : "";
  const recent = [...picks].reverse();
  $("#log").innerHTML = recent.length ? recent.map(pk=>{
    const p = playerForPick(pk);
    const mine = pk.teamIdx === myTeamIdx();
    const rd = Math.floor(pk.overall / cfg.teams) + 1;
    return `<div class="slot${pk.overall === flashPick ? " flash" : ""}">
      <span class="idx mono">${rd}.${String((pk.overall % cfg.teams)+1).padStart(2,"0")}</span>
      <span class="nm" style="${mine?"color:var(--ok);font-weight:600":""}">${p?p.name:"?"}${pk.outOfPool?` <span style="color:var(--dimmer);font-size:10px">· OUT OF POOL · 12/4/4 FALLBACK</span>`:""}</span>
      <span class="mono" style="color:var(--dimmer);font-size:10px">${mine?"YOU":shortName(pk.teamIdx)}</span>
      <button class="px" data-o="${pk.overall}" title="Remove this pick">×</button>
    </div>`;
  }).join("") : `<div class="empty" style="padding:14px 0">No picks yet. Click any player on the board to log him to whoever's on the clock.</div>`;

  [...$("#log").querySelectorAll(".px")].forEach(b=>{
    b.onclick = e=>{ e.stopPropagation(); picks = picks.filter(p=>p.overall !== +b.dataset.o); reindex(); render(); };
  });
}


function render(){
  const state = evaluate();
  const pct = Math.round(state.conviction * 100);
  $("#shape").value = pct;
  $("#shapev").textContent = `${pct}%`;
  $("#shapeauto").classList.toggle("on", Math.abs(shape - DEFAULT_SHAPE) < 0.005);
  $("#shaperow").title = shapeBlurb(state);
  renderClock(state);
  renderRec(state);
  renderLedger(state);
  renderSuggest(state);
  renderBoard(state);
  renderStars(state);
  renderRoster(state);
  renderLog();
  saveState();
}

/* ============================================================
   WIRING
   ============================================================ */
$("#posfilter").innerHTML = ["ALL","PG","SG","SF","PF","C"]
  .map(p=>`<button data-p="${p}" class="${p==="ALL"?"on":""}">${p}</button>`).join("");
[...$("#posfilter").querySelectorAll("button")].forEach(b=>{
  b.onclick = ()=>{
    posFilter = b.dataset.p;
    [...$("#posfilter").querySelectorAll("button")].forEach(x=>x.classList.toggle("on", x===b));
    saveSettings(); render();
  };
});

// Column sorting — click to sort, click again to flip direction.
[...document.querySelectorAll("thead th")].forEach(th=>{
  th.onclick = ()=>{
    const k = th.dataset.s;
    if(!k) return;
    if(sortKey === k) sortDir = -sortDir;
    else { sortKey = k; sortDir = -1; }
    saveSettings();
    [...document.querySelectorAll("thead th")].forEach(x=>{
      x.classList.toggle("on", x.dataset.s === sortKey);
      const a = x.querySelector(".arw");
      if(a) a.textContent = sortDir === -1 ? "▾" : "▴";
    });
    const state = evaluate();
    renderBoard(state);
    renderStars(state);
  };
});
document.querySelector('thead th[data-s="fit"]').classList.add("on");

// Games-played weight
const GPW_LABEL = v => v < 0.15 ? "Per game" : v < 0.4 ? "Light" : v < 0.65 ? "Balanced" : v < 0.9 ? "Heavy" : "Full season";
$("#gpw").addEventListener("input", e=>{
  cfg.gpw = +e.target.value / 100;
  $("#gpwv").textContent = GPW_LABEL(cfg.gpw);
  saveSettings();
  scorePool(pool);
  const used = pool.map(p=>p.last).filter(Boolean);
  if(used.length) scoreBoth(used);
  render();
});
document.querySelector('thead th[data-s="fit"]').classList.add("on");

$("#mode").addEventListener("change", ()=>{ saveSettings(); render(); });
[...$("#ledgermode").querySelectorAll("button")].forEach(b=>{
  b.onclick = ()=>{
    ledgerMode = b.dataset.m;
    [...$("#ledgermode").querySelectorAll("button")].forEach(x=>x.classList.toggle("on", x===b));
    saveSettings(); render();
  };
});
$("#ledgerteam").addEventListener("change", e=>{
  const v = +e.target.value;
  ledgerTeam = (v === myTeamIdx()) ? null : v;
  render();
});
$("#ledgercollapse").addEventListener("click", ()=>{
  ledgerCollapsed = !ledgerCollapsed;
  $("#ledgerbody").classList.toggle("hide", ledgerCollapsed);
  $("#ledgercollapse").textContent = ledgerCollapsed ? "Expand" : "Collapse";
  $("#ledgercollapse").setAttribute("aria-expanded", String(!ledgerCollapsed));
  saveSettings();
});

// The GP slider is inert unless the loaded data actually carries a GP column.
function syncGPW(){
  const has = pool.some(p=>p.gp > 0);
  $("#gpw").disabled = !has;
  $("#gpw").style.opacity = has ? 1 : .35;
  $("#gpwlab").textContent = has ? "Games Played Weight" : "Games Played Weight — no GP column in this data";
  $("#gpw").value = Math.round(cfg.gpw * 100);   // put the handle where the value actually is
  $("#gpwv").textContent = has ? GPW_LABEL(cfg.gpw) : "Inactive";
}

$("#shape").addEventListener("input", e=>{ shape = +e.target.value / 100; render(); });
$("#shapeauto").onclick = ()=>{ shape = DEFAULT_SHAPE; render(); };

// Tuning stays folded away until asked for — two sliders is the single biggest
// source of "too much going on" before anyone has made a pick.
function setTuning(open){
  $("#tuning").classList.toggle("hide", !open);
  $("#tuningcaret").textContent = open ? "\u25be" : "\u25b8";
}
/*  Collapse state for the starred list, kept with the other view preferences. */
let starsOpen = true;
function setStarsOpen(open){
  starsOpen = open;
  const body = $("#starbody");
  if(body) body.style.display = open ? "" : "none";
  $("#starcaret").textContent = open ? "\u25be" : "\u25b8";
  $("#starbtn").setAttribute("aria-expanded", open ? "true" : "false");
}
$("#starbtn").onclick = ()=>{ setStarsOpen(!starsOpen); saveSettings(); };

$("#tuningbtn").onclick = ()=>{
  setTuning($("#tuning").classList.contains("hide"));
  saveSettings();
};


$("#q").addEventListener("input", ()=> renderBoard(evaluate()));
$("#q").addEventListener("keydown", e=>{
  if(e.key === "Enter"){
    const first = $("#board").querySelector("tr[data-id]");
    const fid = first ? +first.dataset.id : null;
    if(fid !== null){
      if(armedDraftId === fid) draft(fid);    // Enter twice to commit
      else { selectedId = fid; hoverId = fid; armedDraftId = fid; render(); }
    }
  }
});
document.addEventListener("keydown", e=>{
  if(e.key === "/" && document.activeElement !== $("#q")){ e.preventDefault(); $("#q").focus(); }
  if((e.metaKey||e.ctrlKey) && e.key === "z"){ e.preventDefault(); undo(); }
  if(e.key === "Escape" && (selectedId !== null || hoverId !== null || armedDraftId !== null)){
    selectedId = null; hoverId = null; armedDraftId = null; render();
  }
});

// Settings
function paintNameGrid(){
  // Preview the values currently entered in the modal without mutating the saved setup.
  const teams = Math.max(4, +$("#s_teams").value || cfg.teams);
  const slot = Math.min(teams, Math.max(1, +$("#s_slot").value || cfg.slot));
  $("#s_names").innerHTML = Array.from({length: teams}, (_,i)=>
    `<div class="fld"><label>${i+1 === slot ? "You \u00b7 slot " + (i+1) : "Slot " + (i+1)}</label>
     <input type="text" data-n="${i}" maxlength="18" placeholder="Team ${i+1}"
       value="${(cfg.names[i]||"").replace(/"/g,"&quot;")}"
       ${i+1===slot ? 'style="border-color:var(--ok)"' : ''}></div>`).join("");
}

function paintCatGrid(){
  $("#s_cats").innerHTML = CATS.map(c=>
    `<div class="fld"><label>${c.label}</label>
     <input type="number" data-w="${c.k}" min="0" max="3" step="0.25" value="${cw(c.k)}"></div>`).join("");
}
let firstRun = false;

function openSet(){
  $("#s_teams").value = cfg.teams; $("#s_slot").value = cfg.slot;
  $("#s_size").value = cfg.size;   $("#s_aggr").value = cfg.aggr;
  paintCatGrid();
  paintNameGrid();
  $("#s_intro").style.display = firstRun ? "" : "none";
  const catDetails = $("#catweightsdetails");
  if(catDetails) catDetails.open = false;
  $("#s_save").textContent = firstRun ? "Save and continue" : (picks.length ? "Save and reset picks" : "Save setup");
  $("#setmask").classList.add("on");
  setTimeout(()=>{ const f = $("#s_teams"); if(f && f.focus){ f.focus(); if(f.select) f.select(); } }, 30);
}
function setCatPreset(o){
  CATS.forEach(c=>{
    const el = $("#s_cats").querySelector(`input[data-w="${c.k}"]`);
    if(el) el.value = o[c.k] === undefined ? 1 : o[c.k];
  });
}
$("#s_close").onclick = ()=> $("#setmask").classList.remove("on");
$("#help_close").onclick = ()=> $("#helpmask").classList.remove("on");

/*  The table header sticks below the search bar. Measuring beats hardcoding —
    the bar's height changes with font size and zoom.                        */
function syncStickyTop(){
  const sw = document.querySelector(".searchwrap");
  if(sw) document.documentElement.style.setProperty("--stickytop", sw.offsetHeight + "px");
}
window.addEventListener("resize", syncStickyTop);
syncStickyTop();

/*  Escape closes whichever dialog is open. Every modal had a Cancel button and
    a backdrop click, but Escape is what people actually reach for.          */
/*  Arrow keys walk the board and Enter drafts, so a fast draft never needs the
    mouse. Ignored while typing, so the search box still behaves normally.   */
document.addEventListener("keydown", e=>{
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((e.target.tagName || ""));
  if(typing || !boardIds.length) return;
  if(e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Enter") return;

  if(e.key === "Enter"){
    if(selectedId !== null){
      e.preventDefault();
      if(armedDraftId === selectedId) draft(selectedId);
      else { armedDraftId = selectedId; render(); }
    }
    return;
  }
  e.preventDefault();
  const at = boardIds.indexOf(selectedId);
  const next = e.key === "ArrowDown"
    ? (at < 0 ? 0 : Math.min(at + 1, boardIds.length - 1))
    : (at < 0 ? 0 : Math.max(at - 1, 0));
  selectedId = boardIds[next];
  hoverId = selectedId;          // keep the preview in step with the keyboard
  armedDraftId = null;           // navigation inspects; it never pre-confirms a draft
  render();
  const row = $("#board").querySelector(`tr[data-id="${selectedId}"]`);
  if(row && row.scrollIntoView) row.scrollIntoView({block:"nearest"});
});

document.addEventListener("keydown", e=>{
  if(e.key !== "Escape") return;
  const open = ["#setmask","#impmask","#helpmask"].map($).filter(m=>m && m.classList.contains("on"));
  if(open.length){ open.forEach(m=>m.classList.remove("on")); e.stopPropagation(); }
});

/*  Draggable split. Stored as a left-column fraction rather than pixels so it
    survives a window resize.                                                 */
const SPLIT_KEY = "draftboard.split.v1";
const SPLIT_DEFAULT = 1.35 / 2.35;
function applySplit(frac){
  const f = Math.max(0.28, Math.min(0.78, frac));
  document.querySelector(".shell").style.gridTemplateColumns =
    `minmax(0,${f}fr) 5px minmax(0,${1-f}fr)`;
  return f;
}
let splitFrac = SPLIT_DEFAULT;
try{ const v = parseFloat(localStorage.getItem(SPLIT_KEY)); if(!isNaN(v)) splitFrac = v; }catch(e){}
applySplit(splitFrac);

(function(){
  const grip = $("#grip");
  let dragging = false;
  const move = e=>{
    if(!dragging) return;
    const x = (e.touches ? e.touches[0].clientX : e.clientX);
    splitFrac = applySplit(x / window.innerWidth);
    e.preventDefault();
  };
  const stop = ()=>{
    if(!dragging) return;
    dragging = false;
    grip.classList.remove("drag");
    document.body.style.userSelect = "";
    try{ localStorage.setItem(SPLIT_KEY, String(splitFrac)); }catch(e){}
  };
  const start = e=>{
    dragging = true;
    grip.classList.add("drag");
    document.body.style.userSelect = "none";   // stop the drag selecting the board
    e.preventDefault();
  };
  grip.addEventListener("mousedown", start);
  grip.addEventListener("touchstart", start, {passive:false});
  window.addEventListener("mousemove", move);
  window.addEventListener("touchmove", move, {passive:false});
  window.addEventListener("mouseup", stop);
  window.addEventListener("touchend", stop);
  grip.addEventListener("dblclick", ()=>{
    splitFrac = applySplit(SPLIT_DEFAULT);
    try{ localStorage.setItem(SPLIT_KEY, String(splitFrac)); }catch(e){}
  });
})();
$("#helpmask").addEventListener("click", e=>{ if(e.target === $("#helpmask")) $("#helpmask").classList.remove("on"); });

// Close the setup modal when the user clicks the backdrop,
// but keep clicks inside the modal itself from dismissing it.
$("#setmask").addEventListener("click", e=>{
  if(e.target === e.currentTarget) e.currentTarget.classList.remove("on");
});
$("#s_teams").addEventListener("input", paintNameGrid);
$("#s_slot").addEventListener("input", paintNameGrid);
$("#s_cats_std").onclick = ()=> setCatPreset({});
$("#s_cats_8").onclick = ()=> setCatPreset({to:0});
$("#s_save").onclick = ()=>{
  const oldStructure = {teams:cfg.teams, slot:cfg.slot, size:cfg.size};
  cfg.teams = Math.max(4, +$("#s_teams").value || 12);
  cfg.slot  = Math.min(cfg.teams, Math.max(1, +$("#s_slot").value || 1));
  cfg.size  = Math.max(5, +$("#s_size").value || 13);
  cfg.aggr  = Math.max(0, Math.min(10, +$("#s_aggr").value));
  const structureChanged = oldStructure.teams !== cfg.teams || oldStructure.slot !== cfg.slot || oldStructure.size !== cfg.size;
  cfg.names = [];
  [...$("#s_names").querySelectorAll("input[data-n]")].forEach(el=>{
    cfg.names[+el.dataset.n] = el.value.trim();
  });
  [...$("#s_cats").querySelectorAll("input[data-w]")].forEach(el=>{
    const v = parseFloat(el.value);
    cfg.catW[el.dataset.w] = isNaN(v) ? 1 : Math.max(0, Math.min(3, v));
  });
  scoreBoth(pool);
  const lastRows = pool.map(p=>p.last).filter(Boolean);
  if(lastRows.length) scoreBoth(lastRows);
  cfg.k     = Math.max(1, 12 - cfg.aggr);   // higher aggression = sharper sigmoid

  /* Once a draft has started, saving League Setup is deliberately a fresh-start
     action. The button says “Save and reset picks” so there is no hidden side effect.
     Before any picks exist, setup changes simply save normally. */
  const resetDraft = picks.length > 0;
  if(resetDraft){
    picks = []; locks = {}; hoverId = null; selectedId = null; armedDraftId = null;
    rosterInspectId = null; ledgerTeam = null; recMessageCleared = false;
    ui.gapHidden = ""; ui.sugHidden.clear(); clearState(); $("#q").value = "";
  } else {
    picks = picks.filter(p => p.overall < cfg.teams * cfg.size);
    reindex();
  }
  saveSettings();                 // persist league setup the moment it's confirmed
  $("#setmask").classList.remove("on");
  render();
  if(firstRun){ firstRun = false; $("#helpmask").classList.add("on"); }
};

// Import
$("#imp_close").onclick = ()=> $("#impmask").classList.remove("on");

// Close the projections modal when the user clicks the backdrop,
// but keep clicks inside the modal itself from dismissing it.
$("#impmask").addEventListener("click", e=>{
  if(e.target === e.currentTarget) e.currentTarget.classList.remove("on");
});

$("#imp_go").onclick = ()=>{
  const rows = dedupe(parsePool($("#impbox").value));
  const msg = $("#impmsg");
  const skipped = parsePool.skipped || [];

  if(rows.length < 5){
    msg.className = "msg bad";
    msg.innerHTML = `Parsed only ${rows.length} rows. Each needs a name and a field-goal column carrying
      makes and attempts. First unreadable row:<br>
      <span class="mono" style="color:var(--dimmer)">${(skipped[0]||"—").slice(0,110).replace(/</g,"&lt;")}</span>`;
    return;
  }

  /* ---- this season's projections: replace the pool ---- */
  saveProjectionText($("#impbox").value);
  pool = rows; picks = []; locks = {};
  scoreBoth(pool);
  const withGP = pool.filter(p=>p.gp>0).length;
  const withRank = pool.filter(p=>p.srcRank!==null).length;
  const withADP = pool.filter(p=>p.adp!==null).length;

  msg.className = "msg good";
  msg.innerHTML = `Loaded <b>${pool.length}</b> players
    ${withGP ? `· ${withGP} with GP (durability slider live)` : `· no GP column, durability slider stays off`}
    ${withRank ? `· ${withRank} with source rank` : ``}
    ${withADP ? `· ${withADP} with ADP` : `· no ADP, run risk falls back to value rank`}
    ${skipped.length ? `· skipped ${skipped.length} rows` : ``}
    <table class="prev"><tr><th class="l">Sanity check</th><th>POS</th><th>FG</th><th>FT</th><th>PTS</th><th>REB</th><th>GP</th></tr>
    ${pool.slice(0,4).map(p=>`<tr><td class="l">${p.name}</td><td>${p.pos.join("/")}</td>
      <td class="mono">${p.fgm}/${p.fga}</td><td class="mono">${p.ftm}/${p.fta}</td>
      <td class="mono">${p.pts}</td><td class="mono">${p.reb}</td><td class="mono">${p.gp||"—"}</td></tr>`).join("")}</table>`;

  $("#banner").classList.add("hide");
  syncGPW();

  // A new projection pool should reset draft-specific state, but it should NOT
  // wipe league setup. At this point picks/locks are already empty and `pool`
  // is the newly imported pool, so save the new clean draft state with the
  // existing league settings before reloading.
  saveState();

  // The pasted projection text is already persisted in localStorage.
  // Reboot the page so the normal startup path reloads the pool and
  // attaches the built-in historical data before rendering.
  $("#impmask").classList.remove("on");
  setTimeout(()=> window.location.reload(), 150);
};


/* ============================================================
   YAHOO LIVE DRAFT BRIDGE — pick-number aware + fallback-line placeholders (v0.5)
   ------------------------------------------------------------
   Yahoo can render several draft-board cells out of chronological order. The
   extension therefore sends Yahoo's printed pick numbers (1.03, 1.06, etc.)
   and, when supported, an ordered snapshot. 9cat buffers/reconciles by that
   explicit order instead of treating "first DOM mutation seen" as "next pick".
   ============================================================ */
const YAHOO_PAGE_SOURCE = "9cat-page";
const YAHOO_EXT_SOURCE  = "9cat-extension";
const YAHOO_CAPABILITIES = ["yahoo-pick-number-v1", "yahoo-snapshot-v1", "yahoo-out-of-pool-v1", "yahoo-fallback-line-v1"];
const yahooPickBuffer = new Map();   // overall pick number -> Yahoo pick record

function yahooSyncPill(){
  let el = document.getElementById("yahooSyncPill");
  if(el) return el;
  const host = document.querySelector(".searchwrap");
  if(!host) return null;
  el = document.createElement("span");
  el.id = "yahooSyncPill";
  el.style.cssText = [
    "flex:0 0 auto","align-self:stretch","display:flex","align-items:center",
    "padding:0 9px","border:1px solid var(--line)","border-radius:var(--r)",
    "font-family:'Saira Condensed',sans-serif","font-weight:700","font-size:10px",
    "letter-spacing:.08em","text-transform:uppercase","color:var(--dimmer)",
    "background:var(--panel)"
  ].join(";");
  host.appendChild(el);
  return el;
}

function setYahooSyncStatus(text, tone="dim"){
  const el = yahooSyncPill();
  if(!el) return;
  el.textContent = text;
  el.style.color = tone === "ok" ? "var(--ok)" : tone === "bad" ? "var(--hot)" : tone === "warn" ? "var(--wood)" : "var(--dimmer)";
  el.style.borderColor = tone === "ok" ? "var(--okk-bd)" : tone === "bad" ? "var(--neg-bd)" : tone === "warn" ? "var(--wood)" : "var(--line)";
}

function yahooMatchPlayer(rawName){
  const name = String(rawName || "").trim();
  if(!name) return null;
  const exactKey = nameKey(name);
  let matches = pool.filter(p => nameKey(p.name) === exactKey);
  if(matches.length === 1) return matches[0];

  const parts = nameParts(name);
  const fallback = parts.length ? (parts[parts.length-1] + (parts[0]?.[0] || "")) : "";
  if(!fallback) return null;
  matches = pool.filter(p => {
    const pp = nameParts(p.name);
    return pp.length && (pp[pp.length-1] + (pp[0]?.[0] || "")) === fallback;
  });
  return matches.length === 1 ? matches[0] : null;
}

function pickName(pk){ return playerForPick(pk)?.name || pk?.unknownName || ""; }

function announceNinecatState(){
  const ordered = [...picks].sort((a,b)=>a.overall-b.overall);
  window.postMessage({
    source: YAHOO_PAGE_SOURCE,
    type: "NINECAT_READY",
    playerNames: pool.map(p=>p.name),
    /*  Teams disambiguate abbreviated names. Yahoo renders "A. THOMPSON" for
        both Amen (HOU) and Ausar (DET); without the team there is no way to
        tell them apart, and guessing wrong corrupts the draft.              */
    playerTeams: pool.map(p=>p.team || ""),
    /* Stable identity fallback for Yahoo abbreviations that remain ambiguous
       even after NBA-team matching (e.g. Jalen/Jaylin Williams are both OKC).
       This is the board's fixed Value Rank (#), not the dynamic Fit rank. */
    playerRanks: pool.map(p=>Number.isFinite(p.valRank) ? p.valRank : null),
    pickNames: ordered.map(pickName).filter(Boolean),
    teamCount: cfg.teams,
    rosterSize: cfg.size,
    capabilities: YAHOO_CAPABILITIES
  }, "*");
}

function yahooAck(status, name, detail=""){
  window.postMessage({ source:YAHOO_PAGE_SOURCE, type:"YAHOO_ACK", status, name, detail }, "*");
}

/*  A pick used to be thrown away unless Yahoo's payload carried an integer
    overall-pick number. The DOM path doesn't need one — position in the draft
    results list IS the pick number — so a missing pickNo now means "append",
    not "discard". This was the reason nothing ever synced.                  */
function normalizeYahooPick(raw, fallbackNo){
  const name = String(raw?.name || "").trim();
  if(!name) return null;
  let pickNo = +raw?.pickNo;
  if(!Number.isInteger(pickNo) || pickNo < 1){
    pickNo = Number.isInteger(fallbackNo) && fallbackNo > 0 ? fallbackNo : null;
  }
  if(pickNo === null) return null;
  return { ...raw, name, pickNo };
}

function bufferYahooPicks(rawPicks){
  let n = 0;
  for(const raw of rawPicks || []){
    n++;
    const p = normalizeYahooPick(raw, n);
    if(!p) continue;
    yahooPickBuffer.set(p.pickNo, p);
  }
}

function contiguousYahooBuffer(){
  const out = [];
  for(let n=1;;n++){
    const p = yahooPickBuffer.get(n);
    if(!p) break;
    out.push(p);
  }
  return out;
}

/* Reconcile only from a contiguous 1..N Yahoo prefix. This guarantees a later
   tile such as 1.06 can never be mistaken for pick 1.03. If the current 9cat
   log is already longer than the available Yahoo prefix, wait for the rescan to
   catch up before correcting it so a partial render never truncates the draft. */
function reconcileYahooBuffer(){
  const ordered = contiguousYahooBuffer();
  const bufferedCount = yahooPickBuffer.size;
  const gapPickNo = bufferedCount > ordered.length ? ordered.length + 1 : null;
  if(!ordered.length){
    setYahooSyncStatus("Yahoo · buffering", "warn");
    yahooAck("buffering", "", "Waiting for Yahoo pick #1 / earlier picks");
    return false;
  }

  const resolved = [];
  const used = new Set();
  for(const yp of ordered){
    if(yp.outOfPool){
      const ukey = `u:${nameKey(yp.name)}:${String(yp.team||"").toUpperCase()}`;
      if(used.has(ukey)){
        setYahooSyncStatus(`Yahoo · duplicate #${yp.pickNo}`, "bad");
        yahooAck("unmatched", yp.name, `Same out-of-pool Yahoo player appeared twice by pick #${yp.pickNo}`);
        break;
      }
      used.add(ukey);
      resolved.push({ yahoo:yp, player:null, outOfPool:true });
      continue;
    }
    const p = yahooMatchPlayer(yp.name);
    if(!p){
      setYahooSyncStatus(`Yahoo · unmatched #${yp.pickNo}`, "bad");
      yahooAck("unmatched", yp.name, `Could not uniquely match Yahoo pick #${yp.pickNo}`);
      break;
    }
    const pkey=`p:${p.id}`;
    if(used.has(pkey)){
      setYahooSyncStatus(`Yahoo · duplicate #${yp.pickNo}`, "bad");
      yahooAck("unmatched", yp.name, `Same player appeared twice in Yahoo snapshot by pick #${yp.pickNo}`);
      break;
    }
    used.add(pkey);
    resolved.push({ yahoo:yp, player:p, outOfPool:false });
  }

  if(!resolved.length) return false;

  const current = [...picks].sort((a,b)=>a.overall-b.overall);
  const currentKey = pk => pk?.outOfPool
    ? `u:${nameKey(pk.unknownName||"")}:${String(pk.unknownTeam||"").toUpperCase()}`
    : `p:${pk?.playerId}`;
  const resolvedKey = x => x?.outOfPool
    ? `u:${nameKey(x.yahoo?.name||"")}:${String(x.yahoo?.team||"").toUpperCase()}`
    : `p:${x?.player?.id}`;
  const compareN = Math.min(current.length, resolved.length);
  let mismatch = false;
  for(let i=0;i<compareN;i++){
    if(currentKey(current[i]) !== resolvedKey(resolved[i])){ mismatch = true; break; }
  }

  /*  Yahoo is the source of truth.

      This used to refuse any snapshot shorter than the existing log, so a stale
      9cat draft left over from a previous session deadlocked syncing forever —
      "waiting for Yahoo snapshot to cover 43 picks" while Yahoo only had 8, and
      it never would. Now: if the overlapping picks DISAGREE, the old log is
      wrong and gets rebuilt from Yahoo. Only a clean prefix waits, since that's
      the genuine partial-render case worth protecting.                        */
  if(resolved.length < current.length && !mismatch){
    setYahooSyncStatus(`Yahoo · ${resolved.length}/${current.length}`, "warn");
    yahooAck("buffering", "", `Yahoo snapshot covers ${resolved.length} of ${current.length} logged picks`);
    return false;
  }

  const changed = mismatch || resolved.length !== current.length;
  if(!changed){
    if(gapPickNo){
      setYahooSyncStatus(`Yahoo · waiting for #${gapPickNo} · ${bufferedCount} seen`, "warn");
      yahooAck("buffering", "", `Captured ${bufferedCount} Yahoo picks but pick #${gapPickNo} is missing`);
      return false;
    }
    setYahooSyncStatus(`Yahoo · synced ${resolved.length}`, "ok");
    return true;
  }

  const wasCorrection = current.length > 0 && mismatch;
  picks = resolved.map((x,i)=> x.outOfPool ? ({
    playerId:null,
    unknownName:x.yahoo.name,
    unknownTeam:String(x.yahoo.team||"").toUpperCase(),
    unknownPos:Array.isArray(x.yahoo.pos) ? x.yahoo.pos : [],
    outOfPool:true,
    teamIdx:teamOnClock(i),
    overall:i
  }) : ({
    playerId:x.player.id,
    teamIdx:teamOnClock(i),
    overall:i
  }));

  selectedId = null;
  hoverId = null;
  armedDraftId = null;
  flashPick = picks.length ? picks.length - 1 : null;
  clearTimeout(reconcileYahooBuffer._flash);
  reconcileYahooBuffer._flash = setTimeout(()=>{ flashPick = null; renderLog(); }, 1500);
  render();

  const last = resolved.at(-1);
  if(gapPickNo) setYahooSyncStatus(`Yahoo · waiting for #${gapPickNo} · ${bufferedCount} seen`, "warn");
  else setYahooSyncStatus(`Yahoo · synced ${picks.length}`, "ok");
  yahooAck(wasCorrection ? "corrected" : "applied", last?.player?.name || last?.yahoo?.name || "",
    `${wasCorrection ? "Rebuilt" : "Synced"} picks 1-${picks.length} in Yahoo order`);
  if(gapPickNo) yahooAck("buffering", "", `Captured ${bufferedCount} Yahoo picks but pick #${gapPickNo} is missing`);
  announceNinecatState();
  return !gapPickNo;
}

function applyYahooDraftSnapshot(rawPicks){
  bufferYahooPicks(Array.isArray(rawPicks) ? rawPicks : []);
  return reconcileYahooBuffer();
}

function applyYahooDraftPick(raw){
  const obj = (raw && typeof raw === "object") ? raw : {name:raw};
  const explicit = normalizeYahooPick(obj);
  if(explicit){
    yahooPickBuffer.set(explicit.pickNo, explicit);
    return reconcileYahooBuffer();
  }

  // Compatibility with the original v0.1 extension only. v0.3 always sends an
  // explicit pick number and never uses this sequential fallback.
  const name = String(obj?.name || "").trim();
  const p = yahooMatchPlayer(name);
  if(!p){
    setYahooSyncStatus("Yahoo · unmatched", "bad");
    yahooAck("unmatched", name, "No unique player match in the current 9cat pool");
    return false;
  }
  if(takenIds().has(p.id)){
    yahooAck("duplicate", p.name, "Player is already in the 9cat pick log");
    return true;
  }
  draft(p.id);
  setYahooSyncStatus(`Yahoo · synced ${picks.length}`, "ok");
  yahooAck("applied", p.name, `Logged as pick ${picks.length}`);
  announceNinecatState();
  return true;
}

window.addEventListener("message", e=>{
  if(e.source !== window || !e.data || e.data.source !== YAHOO_EXT_SOURCE) return;
  const d = e.data;
  if(d.type === "REQUEST_STATE") announceNinecatState();
  if(d.type === "YAHOO_PICK") applyYahooDraftPick(d.pick || {name:d.name});
  if(d.type === "YAHOO_SNAPSHOT") applyYahooDraftSnapshot(d.picks || []);
  if(d.type === "YAHOO_RESET_CAPTURE") yahooPickBuffer.clear();
  if(d.type === "YAHOO_STATUS"){
    if(d.enabled === false) setYahooSyncStatus("Yahoo · paused", "warn");
    else if(d.yahooConnected){
      const contiguous = +d.contiguousCount || 0;
      const captured = +d.capturedCount || 0;
      if(captured > contiguous){
        setYahooSyncStatus(`Yahoo · waiting for #${contiguous + 1} · ${captured} seen`, "warn");
      } else {
        const n = contiguous || captured || 0;
        setYahooSyncStatus(`Yahoo · live${n ? ` ${n}` : ""}`, "ok");
      }
    } else setYahooSyncStatus("Yahoo · waiting", "dim");
  }
});

document.addEventListener("visibilitychange", ()=>{
  if(!document.hidden) setTimeout(announceNinecatState, 80);
});
setTimeout(announceNinecatState, 0);

// Boot
const savedProjectionText = loadProjectionText();
/*  Settings must load BEFORE scoring. cfg.gpw feeds straight into scoreBoth, so
    scoring first meant every refresh silently used the default games-played
    weight and threw away the saved one — the slider snapping back was the
    visible half of it; the z-scores being wrong was the half you couldn't see. */
loadSettings();
pool = dedupe(parsePool(savedProjectionText || RAW));
scoreBoth(pool);
const matched = pool.length ? attachLast(dedupe(parsePool(RAW_LAST))) : 0;
const resumed = loadState();
syncGPW();

if(!pool.length){
  $("#banner").innerHTML =
    `<span>No projections loaded yet — open Projections and paste a table to begin.</span>`
    + `<button id="b_banner2">Load projections</button>`;
} else {
  $("#banner").innerHTML =
    `<span>${pool.length} players loaded with projections, ADP and games played. `
    + `${matched} matched to last season's actuals.`
    + `${resumed ? ` Resumed your draft at pick ${picks.length + 1}.` : ``}</span>`
    + `<button id="b_banner2">Load different data</button>`
    + `<button id="b_dismiss" class="x" title="Dismiss">&times;</button>`;
}
$("#banner").classList.remove("hide");
$("#b_banner2").onclick = ()=> $("#impmask").classList.add("on");
$("#i_photoauto").onclick = ()=> autoPhotos(false);
$("#i_photogo").onclick = ()=>{
  const n = importPhotoIds($("#i_photos").value);
  $("#i_photomsg").textContent = n ? `${n} ids saved` : "Nothing recognised \u2014 each line needs a name and a numeric id";
  $("#i_photomsg").style.color = n ? "var(--ok)" : "var(--hot)";
  syncPhotoStat();
  if(n) render();
};

/*  Tells you how many players on the CURRENT board actually resolved to a photo.
    "12 ids saved" is useless on its own — what matters is whether they matched
    the names in your projection pool.                                        */
function syncPhotoStat(){
  const el = $("#photostat"); if(!el) return;
  if(!pool.length){ el.textContent = "load projections first"; return; }
  const hit = pool.filter(p => photoIdFor(p)).length;
  el.textContent = hit ? `${hit} of ${pool.length} players matched` : "not set up";
  el.style.color = hit ? "var(--ok)" : "var(--dimmer)";
  const d = $("#photodetails");
  if(d && hit) d.open = false;
}
const bd = $("#b_dismiss"); if(bd) bd.onclick = ()=> $("#banner").classList.add("hide");
/*  First visit opens Setup, not the importer. Teams and draft slot decide the
    snake order, which decides "next turn in N picks", which decides scarcity on
    every player — wrong there and nothing looks broken, the numbers are just
    quietly wrong all draft. Saving chains straight into Projections.         */
const SEEN_KEY = "draftboard.seen.v1";
let seenBefore = false;
try{ seenBefore = localStorage.getItem(SEEN_KEY) === "1"; }catch(e){}

if(!seenBefore){
  firstRun = true;
  openSet();
  try{ localStorage.setItem(SEEN_KEY, "1"); }catch(e){}
} else if(!pool.length){
  $("#impmask").classList.add("on");
}
syncPhotoStat();
applyUIPrefs();     // restore view preferences before the first paint
render();

/*  First run with no photos cached: try once, quietly, after the board is up.
    A failure is remembered so it doesn't retry on every load — but it will try
    again after a day in case the network was simply down.                    */
(function primePhotos(){
  if(Object.keys(photoIds).length) return;
  let last = null;
  try{ last = localStorage.getItem(PHOTO_TRY); }catch(e){}
  if(last === "ok") return;
  if(last && Date.now() - Number(last) < 86400000) return;
  setTimeout(()=> autoPhotos(true), 400);
})();

/* ============================================================
   YAHOO SYNC — stub, deliberately not wired up.

   Yahoo now gates Fantasy API access behind an approval application
   (sports.yahoo.com/developer/access). If you get approved, the shape
   is: OAuth2 with an https://localhost callback, then poll

     GET /fantasy/v2/league/{game_key}.l.{league_id}/draftresults?format=json

   every ~5s while league draft_status is "drafting". Map each result's
   {round, pick, team_key, player_key} onto the picks[] array below and
   call render(). Test it in a mock draft BEFORE you rely on it — verify
   picks actually appear mid-draft rather than only at postdraft.

   async function syncYahoo(leagueKey, token){
     const r = await fetch(`/api/yahoo/league/${leagueKey}/draftresults`,
                           {headers:{Authorization:`Bearer ${token}`}});
     const data = await r.json();
     // ...map to picks[], dedupe on overall, then render()
   }
   Note: the fetch must go through your own small proxy — Yahoo does not
   send CORS headers, so a browser-only call will be blocked.
   ============================================================ */
