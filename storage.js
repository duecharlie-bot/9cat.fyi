"use strict";

/*  Draft state survives a refresh.

    Picks reference pool indices, so a saved draft is only meaningful against
    the same pool — restoring picks onto a different projection set would
    silently rename every player on your roster. The signature guards that.   */
const SAVE_KEY = "draftboard.v1";
const CFG_KEY  = "draftboard.league.v1";   // settings, kept away from draft state
const PROJ_KEY = "draftboard.projections.v1";
const poolSig = () => pool.length + "|" + (pool[0] ? pool[0].name : "");

function saveProjectionText(text){
  try{ localStorage.setItem(PROJ_KEY, text); }catch(e){}
}

function loadProjectionText(){
  try{ return localStorage.getItem(PROJ_KEY) || ""; }catch(e){ return ""; }
}

/*  League settings live in their own key, deliberately.

    They used to ride along inside the draft-state blob, which coupled them to
    the pool signature and to every code path that cleared or replaced a draft.
    Importing projections is exactly such a path — and league setup is the first
    thing a user is asked for, so losing it there is the worst possible moment.
    Settings are about the league; picks are about one draft. Different keys.  */
/*  View preferences ride with the league settings rather than living in a
    scatter of one-off keys. Anything the user deliberately set should still be
    set after a refresh — which display mode, which sort, whether Tuning is
    open, how wide the panels are.                                            */
function uiPrefs(){
  return {
    tuning: !$("#tuning").classList.contains("hide"),
    starsOpen,
    mode: $("#mode") ? $("#mode").value : "z",
    ledgerMode, ledgerCollapsed, posFilter, sortKey, sortDir,
    split: typeof splitFrac === "number" ? splitFrac : undefined
  };
}

function saveSettings(){
  try{
    localStorage.setItem(CFG_KEY, JSON.stringify({
      cfg, shape, theme: document.body.dataset.theme, ui: uiPrefs()
    }));
  }catch(e){}
}

function loadSettings(){
  try{
    const d = JSON.parse(localStorage.getItem(CFG_KEY) || "null");
    if(!d) return false;
    if(d.cfg) Object.assign(cfg, d.cfg);
    if(typeof d.shape === "number") shape = d.shape;
    if(d.theme) document.body.dataset.theme = d.theme;
    if(d.ui) pendingUI = d.ui;      // applied once the elements exist
    return true;
  }catch(e){ return false; }
}

/*  Restored after boot, because several of these live on DOM elements that the
    render pass reads from.                                                   */
let pendingUI = null;
function applyUIPrefs(){
  const u = pendingUI;
  if(!u) return;
  if(typeof u.ledgerMode === "string") ledgerMode = u.ledgerMode;
  if(typeof u.ledgerCollapsed === "boolean") ledgerCollapsed = u.ledgerCollapsed;
  if(typeof u.posFilter === "string")  posFilter  = u.posFilter;
  if(typeof u.sortKey === "string")    sortKey    = u.sortKey;
  if(u.sortDir === 1 || u.sortDir === -1) sortDir = u.sortDir;
  if(typeof u.mode === "string" && $("#mode")) $("#mode").value = u.mode;
  if(typeof u.split === "number"){ splitFrac = applySplit(u.split); }
  setTuning(!!u.tuning);
  if(typeof u.starsOpen === "boolean") setStarsOpen(u.starsOpen);

  [...$("#ledgermode").querySelectorAll("button")].forEach(b=>
    b.classList.toggle("on", b.dataset.m === ledgerMode));
  [...$("#posfilter").querySelectorAll("button")].forEach(b=>
    b.classList.toggle("on", b.dataset.p === posFilter));
  $("#ledgerbody").classList.toggle("hide", ledgerCollapsed);
  $("#ledgercollapse").textContent = ledgerCollapsed ? "Expand" : "Collapse";
  $("#ledgercollapse").setAttribute("aria-expanded", String(!ledgerCollapsed));
  pendingUI = null;
}

function saveState(){
  saveSettings();
  try{
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      sig: poolSig(), picks, locks, ledgerTeam
    }));
  }catch(e){ /* private browsing, quota, file:// restrictions — not worth failing over */ }
}

function loadState(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return false;
    const d = JSON.parse(raw);
    // Legacy blobs carried settings too; honour them once so nobody loses a setup.
    if(d.cfg) Object.assign(cfg, d.cfg);
    if(typeof d.shape === "number") shape = d.shape;
    if(d.theme) document.body.dataset.theme = d.theme;
    if(d.sig !== poolSig()) return false;      // different data loaded; keep settings, drop picks
    if(Array.isArray(d.picks)) picks = d.picks;
    if(d.locks && typeof d.locks === "object") locks = d.locks;
    ledgerTeam = (typeof d.ledgerTeam === "number") ? d.ledgerTeam : null;
    return picks.length > 0;
  }catch(e){ return false; }
}

function clearState(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }   // settings untouched by design
