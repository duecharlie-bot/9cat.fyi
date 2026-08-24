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






/* Rendering and presentation helpers live in js/ui.js. */

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
const importEsc = s => String(s ?? "").replace(/[&<>"']/g, ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));

function projectionImportPreview(validation, sourceLabel=""){
  const msg = $("#impmsg");
  const go = $("#imp_go");
  go.disabled = !validation.ok;

  if(!validation.ok){
    const detail = validation.errors?.[0] && validation.errors[0] !== validation.message
      ? `<div class="mono" style="color:var(--dimmer);margin-top:5px">${importEsc(validation.errors[0])}</div>`
      : "";
    msg.className = "msg bad";
    msg.innerHTML = `${importEsc(validation.message)}${detail}`;
    return;
  }

  const rows = validation.rows;
  msg.className = "msg good";
  msg.innerHTML = `<b>Ready to import ${rows.length} players.</b>
    ${sourceLabel ? `<span style="color:var(--dimmer)"> ${importEsc(sourceLabel)}</span>` : ""}
    <div class="mono" style="font-size:10px;color:var(--dimmer);margin-top:5px">${validation.withADP}/${rows.length} with ADP · ${validation.withGP}/${rows.length} with GP · strict nineCat CSV validated</div>
    <table class="prev"><tr><th class="l">Sanity check</th><th>ADP</th><th>POS</th><th>FG</th><th>FT</th><th>PTS</th><th>REB</th></tr>
    ${rows.slice(0,4).map(p=>`<tr><td class="l">${importEsc(p.name)}</td><td class="mono">${p.adp ?? "—"}</td><td>${importEsc(p.pos.join("/"))}</td>
      <td class="mono">${p.fgm}/${p.fga}</td><td class="mono">${p.ftm}/${p.fta}</td>
      <td class="mono">${p.pts}</td><td class="mono">${p.reb}</td></tr>`).join("")}</table>`;
}

function setProjectionImportText(text, sourceLabel=""){
  $("#impbox").value = String(text || "");
  const validation = validateProjectionImport($("#impbox").value);
  projectionImportPreview(validation, sourceLabel);
  return validation;
}

async function loadProjectionCsvFile(file){
  if(!file) return;
  const meta = $("#impfilemeta");
  const name = String(file.name || "projections.csv");
  if(!/\.csv$/i.test(name)){
    meta.textContent = `${name} · not a CSV file`;
    meta.style.color = "var(--hot)";
    setProjectionImportText("");
    return;
  }
  try{
    const text = await file.text();
    meta.textContent = `${name} · ${Math.max(1, Math.round(file.size/1024))} KB`;
    meta.style.color = "var(--dim)";
    setProjectionImportText(text, name);
  }catch(e){
    meta.textContent = `${name} · could not read file`;
    meta.style.color = "var(--hot)";
    setProjectionImportText("");
  }
}

$("#imp_close").onclick = ()=> $("#impmask").classList.remove("on");

// Close the projections modal when the user clicks the backdrop,
// but keep clicks inside the modal itself from dismissing it.
$("#impmask").addEventListener("click", e=>{
  if(e.target === e.currentTarget) e.currentTarget.classList.remove("on");
});

$("#impfile").addEventListener("change", e=> loadProjectionCsvFile(e.target.files?.[0]));
const impdrop = $("#impdrop");
["dragenter","dragover"].forEach(type=>impdrop.addEventListener(type, e=>{
  e.preventDefault(); e.stopPropagation(); impdrop.classList.add("drag");
}));
["dragleave","drop"].forEach(type=>impdrop.addEventListener(type, e=>{
  e.preventDefault(); e.stopPropagation(); impdrop.classList.remove("drag");
}));
impdrop.addEventListener("drop", e=> loadProjectionCsvFile(e.dataTransfer?.files?.[0]));
impdrop.addEventListener("keydown", e=>{
  if(e.key === "Enter" || e.key === " "){ e.preventDefault(); $("#impfile").click(); }
});

$("#impbox").addEventListener("input", ()=>{
  $("#impfilemeta").textContent = "Pasted CSV";
  $("#impfilemeta").style.color = "var(--dimmer)";
  projectionImportPreview(validateProjectionImport($("#impbox").value), "Pasted CSV");
});
$("#imp_go").disabled = true;

$("#imp_go").onclick = ()=>{
  const csvText = $("#impbox").value;
  const validation = validateProjectionImport(csvText);
  const rows = validation.rows;

  if(!validation.ok){
    projectionImportPreview(validation);
    return;
  }

  /* ---- this season's projections: replace the pool ---- */
  saveProjectionText(csvText);
  pool = rows; picks = []; locks = {};
  scoreBoth(pool);

  $("#banner").classList.add("hide");
  syncGPW();

  // A new projection pool should reset draft-specific state, but it should NOT
  // wipe league setup. At this point picks/locks are already empty and `pool`
  // is the newly imported pool, so save the new clean draft state with the
  // existing league settings before reloading.
  saveState();

  // The validated CSV is already persisted in localStorage. Reboot so the
  // normal startup path attaches the built-in historical data before rendering.
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
    `<span>No projections loaded yet — open Projections and import a nineCat CSV to begin.</span>`
    + `<button id="b_banner2">Load projections</button>`;
} else {
  const datasetMeta = projectionDatasetMeta(savedProjectionText, pool.length);
  const historyLabel = (typeof ACTUALS_DATASET_META !== "undefined" && ACTUALS_DATASET_META.label)
    ? ACTUALS_DATASET_META.label
    : "last season's actuals";
  $("#banner").innerHTML =
    `<span>${projectionDatasetSummary(datasetMeta)} · ${matched} matched to ${historyLabel}.`
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
