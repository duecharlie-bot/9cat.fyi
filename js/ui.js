"use strict";

/* ============================================================
   UI / RENDERING LAYER

   Extracted from app.js without intentionally changing behavior.
   This file owns DOM rendering and view-only interactions. Core draft,
   scoring, roster, matchup, punt, recommendation, projection, and storage
   rules remain in their dedicated modules.
   ============================================================ */

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
  if(Math.abs(z) < NEUTRAL) return "var(--mid)";
  return z >= 0 ? "var(--cool)" : "var(--hot)";
}
function zOpacity(z){
  return Math.abs(z) < NEUTRAL ? 0.92 : Math.min(1, 0.86 + Math.abs(z)/5);
}
function profileZColor(z){
  if(Math.abs(z) < NEUTRAL) return "var(--dimmer)";
  return z >= 0 ? "var(--profile-cool)" : "var(--profile-hot)";
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
$("#b_help").onclick = ()=>{ closeMenu(); $("#helpmask").classList.add("on"); window.ninecatTrack?.("quick_start_opened"); };
$("#theme").onclick  = ()=>{
  document.body.dataset.theme = document.body.dataset.theme === "court" ? "arena" : "court";
  closeMenu(); render();
};
$("#reset").onclick = ()=>{
  closeMenu();
  if(!picks.length || confirm(`Clear all ${picks.length} logged picks? Your loaded projections stay.`)){
    picks = []; locks = {}; hoverId = null; selectedId = null; armedDraftId = null; ledgerTeam = null; clearState(); window.ninecatResetDraftAnalytics?.(); $("#q").value = ""; render();
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

    const eliteCut = Math.max(1, Math.ceil(live / 4));
    const elite = barW > 0 && rank !== null && rank <= eliteCut && curProfile >= 0.35;
    const weak = barW < 0 && rank !== null && rank > live - eliteCut && curProfile <= -0.35;
    const bar = `<div class="lbar ${barW>=0?"pos":"neg"}" style="${barW>=0
      ? `left:50%;width:${barW}%`
      : `right:50%;width:${-barW}%`}"></div>`;

    const ghost = ghostW === null ? "" : `<div class="lghost" style="${ghostW>=0
      ? `left:50%;width:${ghostW}%`
      : `right:50%;width:${-ghostW}%`}"></div>`;

    const lock = isMine ? (locks[c.k] || "") : "";
    return `<div class="lrow ${elite?"elite":""} ${weak?"weak":""} ${lock}">
      <span class="lcat" data-c="${c.k}" title="${isMine ? "Click through: auto \u2192 punt \u2192 chase \u2192 hard chase" : "Switch back to your team to set punts"}">${c.label}${cw(c.k)!==1?`<em class="cwx">\u00d7${cw(c.k)}</em>`:""}</span>
      <span class="ltrack"><span class="lmid"></span>${bar}${ghost}</span>
      <span class="lval">
        <span class="main" style="color:${roster.length?profileZColor(valZ):"var(--dimmer)"}">${valTxt}</span>
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
  if(!fitMode()) return Number.isFinite(p.fitDisplay) ? p.fitDisplay : p.fitAdj;
  const v = Number.isFinite(p.fitLastDisplay) ? p.fitLastDisplay : p.fitLast;
  return (v === null || v === undefined) ? -Infinity : v;
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
  const showRisk = teamOnClock(picks.length) === myTeamIdx();
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
  });

  boardIds = list.map(p=>p.id);
  $("#board").innerHTML = list.map((p,i)=> playerRow(p, {
    /*  Only warn about availability for players you're plausibly taking. A
        "gone soon" dot on someone ranked 40th is noise — it's true (the market
        rates him higher than the projections do) but it isn't a decision you
        actually face.                                                        */
    flagRisk: showRisk && p.risk > 0.6 && i < 15 && key === "fit",
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


function renderRoster(state){
  const viewing = (ledgerTeam === null || ledgerTeam >= cfg.teams) ? myTeamIdx() : ledgerTeam;
  const isMine = viewing === myTeamIdx();
  const r = isMine ? state.roster : allRosters()[viewing];
  $("#rosterhead").textContent = isMine ? "My Roster" : possessive(teamName(viewing)) + " Roster";
  $("#rostercount").textContent = `${r.length} / ${cfg.size}${r.length ? " · click player for stats" : ""}`;

  /* Positional warnings become hard constraints once roster flexibility is gone. */
  const g = state.gaps;
  const sig = `${g.missing.join(",")}|${g.eligibilityMissing.join(",")}|${g.openSlots.join(",")}|${g.eligibilityAlert}`;
  const onlyRestricted = g.openSlots.length && !g.openSlots.some(s=>s==="UTIL"||s==="BN");
  const needsAlert = g.eligibilityAlert || onlyRestricted || (g.missing.length && g.left > 0);
  // Positional warnings are actionable only on our pick. On another team's
  // clock, do not imply that our open slots restrict which player can be logged.
  const show = isMine && state.enforceRosterFit && needsAlert && ui.gapHidden !== sig;
  const gn = $("#rgap");
  gn.style.display = show ? "" : "none";
  if(show){
    const hard = g.eligibilityAlert || (onlyRestricted && g.openSlots.length <= 3);
    gn.className = "rgap " + (hard ? "hot" : g.urgency > 0.34 ? "warm" : "");
    let msg;
    if(g.eligibilityAlert){
      const missingText = g.eligibilityMissing.join(" / ");
      msg = `<b>ROSTER ALERT — YOUR ROSTER HAS NO ${missingText} ELIGIBILITY.</b> You are already 5+ picks in. Prioritize adding ${missingText} eligibility before the roster gets harder to balance.`;
    } else if(onlyRestricted){
      msg = `<b>ROSTER SLOTS ARE TIGHT.</b> Your open slots are ${g.openSlots.join(", ")}. The board will only recommend players who can legally fit one of them.`;
    } else {
      msg = `No ${g.missing.join(", ")} yet · ${g.left} pick${g.left===1?"":"s"} left. ${g.urgency > 0.34 ? `Worth covering soon.` : `You still have flexibility, but keep an eye on positional balance.`}`;
    }
    gn.innerHTML = `<span>${msg}</span><button class="dismiss" id="gapx" title="Dismiss">&times;</button>`;
    $("#gapx").onclick = ()=>{ ui.gapHidden = sig; render(); };
  }
  const {slots, owner, unplaced} = assignSlots(r);

  const rosterStat = (p, k) => {
    if(k === "fg") return p.fga ? (p.fgm / p.fga * 100).toFixed(1) + "%" : "—";
    if(k === "ft") return p.fta ? (p.ftm / p.fta * 100).toFixed(1) + "%" : "—";
    const v = Number(p[k]);
    return Number.isFinite(v) ? v.toFixed(1) : "—";
  };
  const projectionLine = p => `<div class="roster-proj">
      <div class="rp-head">Projected per game</div>
      ${CATS.map(c=>{
        const z = p.z && Number.isFinite(p.z[c.k]) ? p.z[c.k] : null;
        const style = z === null ? `` : ` style="color:${zColor(z)};opacity:${zOpacity(z)}"`;
        return `<div class="rp-stat"><span class="rp-k">${c.label}</span><span class="rp-v"${style}>${rosterStat(p,c.k)}</span></div>`;
      }).join("")}
    </div>`;

  $("#roster").innerHTML = slots.map((s,i)=>{
    const p = owner[i] === -1 ? null : r[owner[i]];
    const open = p && rosterInspectId === String(p.id);
    return `<div class="slot ${p?"roster-player":"open"}${open?" stats-open":""}"${p?` data-rpid="${String(p.id)}" title="Click to ${open?"hide":"show"} projected per-game stats"`:""}>
      <span class="idx mono">${s}</span>
      <span class="nm">${p ? p.name : "open"}</span>
      ${p ? `<span class="rpos">${p.pos.join("/")}</span><span class="roster-caret" aria-hidden="true">${open?"▴":"▾"}</span>` : ``}
      <span class="mono" style="color:var(--dim);font-size:11px">${p ? p.total.toFixed(1) : ""}</span>
    </div>${open ? projectionLine(p) : ""}`;
  }).join("") + (unplaced.length ? `<div class="slot"><span class="idx mono" style="color:var(--hot)">!</span>
      <span class="nm" style="color:var(--hot)">${unplaced.map(i=>r[i].name).join(", ")} — no eligible slot</span></div>` : ``);

  [...$("#roster").querySelectorAll(".roster-player[data-rpid]")].forEach(row=>{
    row.onclick = ()=>{
      const id = row.dataset.rpid;
      rosterInspectId = rosterInspectId === id ? null : id;
      render();
    };
  });
}
