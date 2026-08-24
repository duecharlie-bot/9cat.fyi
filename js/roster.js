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

/* Roster rendering moved to ui.js; this module now contains roster rules only. */

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

