"use strict";

/* ============================================================
   ROSTER ELIGIBILITY & SLOT ASSIGNMENT

   Extracted from app.js without changing behavior. These helpers remain
   global for compatibility with the existing UI and regression harness.
   ============================================================ */

const SLOTS = ["PG","SG","SF","PF","C","G","F","UTIL","UTIL","BN","BN","BN","BN"];

function slotEligible(slot, p){
  if(slot === "UTIL" || slot === "BN") return true;
  if(slot === "G") return p.pos.some(x=>x==="PG"||x==="SG");
  if(slot === "F") return p.pos.some(x=>x==="SF"||x==="PF");
  return p.pos.includes(slot);
}

function assignSlots(roster){
  const slots = SLOTS.slice(0, cfg.size);
  const owner = new Array(slots.length).fill(-1);   // slot index -> player index

  const tryPlace = (pi, seen) => {
    for(let si = 0; si < slots.length; si++){
      if(seen[si] || !slotEligible(slots[si], roster[pi])) continue;
      seen[si] = true;
      if(owner[si] === -1 || tryPlace(owner[si], seen)){ owner[si] = pi; return true; }
    }
    return false;
  };

  // Most constrained players first — pure bench bodies shouldn't hog real slots.
  const order = roster.map((p,i)=>i).sort((a,b)=>{
    const n = i => slots.filter(s=>slotEligible(s, roster[i])).length;
    return n(a) - n(b);
  });
  const placed = new Set();
  order.forEach(pi=>{ if(tryPlace(pi, new Array(slots.length).fill(false))) placed.add(pi); });

  const unplaced = roster.map((p,i)=>i).filter(i=>!placed.has(i));
  return {slots, owner, unplaced};
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

function rosterGaps(roster){
  const counts = {};
  roster.forEach(r => r.pos.forEach(x => counts[x] = (counts[x]||0)+1));
  const missing = ["PG","SG","SF","PF","C"].filter(s => !(counts[s] > 0));
  const left = cfg.size - roster.length;
  const a = assignSlots(roster);
  const openSlots = a.slots.filter((_,i)=>a.owner[i] === -1);
  // Five of your own picks is effectively five rounds into your roster build.
  // From here on, having zero eligibility at ANY standard position is a hard
  // roster-balance warning. This replaces the older guard-only special case.
  const eligibilityMissing = missing.slice();
  const eligibilityAlert = roster.length >= 5 && eligibilityMissing.length > 0;
  const urgency = !missing.length ? 0 : Math.min(1, missing.length / Math.max(1, left - 1));
  return {missing, eligibilityMissing, eligibilityAlert, left, counts, urgency, openSlots};
}

function canFitRoster(roster, p){
  if(roster.length >= cfg.size) return false;
  return assignSlots(roster.concat([p])).unplaced.length === 0;
}

