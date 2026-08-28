"use strict";

/* ============================================================
   ROSTER ELIGIBILITY & SLOT ASSIGNMENT

   cfg.rosterSlots:
   - null => use the default slot list for cfg.size
   - array => custom ordered list, one value per roster spot

   The default is Yahoo-style. For a 5-player roster that means:
   PG, SG, SF, PF, C

   Standard 13-player roster:
   PG, SG, G, SF, PF, F, C, C, UTIL, UTIL, BN, BN, BN
   ============================================================ */

const ROSTER_SLOT_KEYS = ["PG","SG","G","SF","PF","F","C","UTIL","BN"];

const DEFAULT_ROSTER_BY_SIZE = Object.freeze({
  5:  ["PG","SG","SF","PF","C"],
  6:  ["PG","SG","G","SF","PF","C"],
  7:  ["PG","SG","G","SF","PF","F","C"],
  8:  ["PG","SG","G","SF","PF","F","C","C"],
  9:  ["PG","SG","G","SF","PF","F","C","C","UTIL"],
  10: ["PG","SG","G","SF","PF","F","C","C","UTIL","UTIL"],
  11: ["PG","SG","G","SF","PF","F","C","C","UTIL","UTIL","BN"],
  12: ["PG","SG","G","SF","PF","F","C","C","UTIL","UTIL","BN","BN"],
  13: ["PG","SG","G","SF","PF","F","C","C","UTIL","UTIL","BN","BN","BN"]
});

function defaultRosterSlots(size=cfg.size){
  const n = Math.max(MIN_ROSTER_SPOTS,
    Math.min(MAX_ROSTER_SPOTS, Math.trunc(Number(size)||13)));

  if(DEFAULT_ROSTER_BY_SIZE[n]) return DEFAULT_ROSTER_BY_SIZE[n].slice();

  const base = DEFAULT_ROSTER_BY_SIZE[13].slice();
  while(base.length < n) base.push("BN");
  return base.slice(0,n);
}

/* V1 stored a count object (e.g. {PG:1,C:2,...}). Accept it once and migrate
   it to the new slot-by-slot list. */
function countObjectToSlotList(raw){
  if(!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const out = [];
  ROSTER_SLOT_KEYS.forEach(k=>{
    const n = Math.max(0, Math.min(MAX_ROSTER_SPOTS, Math.trunc(Number(raw[k])||0)));
    for(let i=0;i<n;i++) out.push(k);
  });
  return out.length ? out : null;
}

function sanitizeRosterSlotList(raw, size=cfg.size){
  const n = Math.max(MIN_ROSTER_SPOTS,
    Math.min(MAX_ROSTER_SPOTS, Math.trunc(Number(size)||13)));

  let list = Array.isArray(raw) ? raw.slice() : countObjectToSlotList(raw);
  if(!list) return null;

  list = list
    .map(x=>String(x||"").toUpperCase())
    .filter(x=>ROSTER_SLOT_KEYS.includes(x));

  if(!list.length) return null;

  // A saved custom list always follows the authoritative roster-spots count.
  // Trim if size went down; fill new positions from the default if size went up.
  const defaults = defaultRosterSlots(n);
  list = list.slice(0,n);
  while(list.length < n) list.push(defaults[list.length] || "BN");
  return list;
}

function activeRosterSlots(){
  return sanitizeRosterSlotList(cfg.rosterSlots, cfg.size) || defaultRosterSlots(cfg.size);
}

function expandRosterSlots(){
  return activeRosterSlots().slice();
}

function rosterPositionsCustomized(){
  return !!sanitizeRosterSlotList(cfg.rosterSlots, cfg.size);
}

function rosterPositionsConstrained(){
  return activeRosterSlots().some(s=>s!=="UTIL" && s!=="BN");
}

function slotEligible(slot, p){
  if(slot === "UTIL" || slot === "BN") return true;
  if(slot === "G") return p.pos.some(x=>x==="PG"||x==="SG");
  if(slot === "F") return p.pos.some(x=>x==="SF"||x==="PF");
  return p.pos.includes(slot);
}

/* Match players to restrictive slots first. UTIL/BN are deliberately held back
   so a flexible slot never steals a player needed at C/PG/etc. */
function matchRestrictedSlots(roster, slots){
  const restricted = slots
    .map((slot,si)=>({slot,si}))
    .filter(x=>x.slot!=="UTIL" && x.slot!=="BN");
  const owner = new Array(restricted.length).fill(-1);

  const eligCount = pi => restricted.reduce(
    (n,x)=>n+(slotEligible(x.slot, roster[pi])?1:0), 0
  );
  const order = roster.map((_,i)=>i).sort((a,b)=>eligCount(a)-eligCount(b));

  const tryPlace = (pi, seen)=>{
    for(let ri=0;ri<restricted.length;ri++){
      if(seen[ri] || !slotEligible(restricted[ri].slot, roster[pi])) continue;
      seen[ri] = true;
      if(owner[ri] === -1 || tryPlace(owner[ri], seen)){
        owner[ri] = pi;
        return true;
      }
    }
    return false;
  };
  order.forEach(pi=>tryPlace(pi, new Array(restricted.length).fill(false)));
  return {restricted, owner};
}

function assignSlots(roster){
  const slots = activeRosterSlots();
  const owner = new Array(slots.length).fill(-1);
  const matched = matchRestrictedSlots(roster, slots);
  const used = new Set();

  matched.restricted.forEach((x,ri)=>{
    const pi = matched.owner[ri];
    if(pi !== -1){
      owner[x.si] = pi;
      used.add(pi);
    }
  });

  const flexSlots = slots
    .map((slot,si)=>({slot,si}))
    .filter(x=>x.slot==="UTIL" || x.slot==="BN")
    .map(x=>x.si);
  const remaining = roster.map((_,i)=>i).filter(i=>!used.has(i));

  remaining.slice(0, flexSlots.length).forEach((pi,i)=>{
    owner[flexSlots[i]] = pi;
    used.add(pi);
  });

  return {
    slots,
    owner,
    unplaced: roster.map((_,i)=>i).filter(i=>!used.has(i))
  };
}

function requiredOpenSlots(roster){
  const slots = activeRosterSlots();
  const matched = matchRestrictedSlots(roster, slots);
  return matched.restricted
    .filter((_,ri)=>matched.owner[ri] === -1)
    .map(x=>x.slot);
}

function summarizeSlots(slots){
  const counts = {};
  slots.forEach(s=>counts[s]=(counts[s]||0)+1);
  return ROSTER_SLOT_KEYS
    .filter(k=>counts[k])
    .map(k=>counts[k] > 1 ? `${k} ×${counts[k]}` : k);
}

function rosterGaps(roster){
  const left = Math.max(0, cfg.size - roster.length);
  const assignment = assignSlots(roster);
  const openSlots = assignment.slots.filter((_,i)=>assignment.owner[i] === -1);
  const reqOpen = requiredOpenSlots(roster);
  const eligibilityMissing = [...new Set(reqOpen)];
  const hardDeadline = reqOpen.length > 0 && left > 0 && reqOpen.length >= left;
  const cushion = Math.max(0, left - reqOpen.length);
  const urgency = reqOpen.length ? Math.max(0, Math.min(1, 1-cushion/5)) : 0;

  return {
    missing:eligibilityMissing.slice(),
    eligibilityMissing,
    eligibilityAlert:hardDeadline,
    requiredOpenSlots:reqOpen,
    requiredOpenCount:reqOpen.length,
    requiredOpenLabels:summarizeSlots(reqOpen),
    hardDeadline,
    left,
    urgency,
    openSlots
  };
}

function canFitRoster(roster, p){
  if(roster.length >= cfg.size) return false;
  const after = roster.concat([p]);
  if(assignSlots(after).unplaced.length) return false;

  const remainingAfter = cfg.size - after.length;
  return requiredOpenSlots(after).length <= remainingAfter;
}

function rosterNeedBonus(roster, p){
  if(!rosterPositionsConstrained()) return 0;
  const before = requiredOpenSlots(roster).length;
  if(!before) return 0;
  const after = requiredOpenSlots(roster.concat([p])).length;
  const covered = Math.max(0, before-after);
  if(!covered) return 0;

  const left = Math.max(1, cfg.size-roster.length);
  const cushion = Math.max(0, left-before);
  const urgency = Math.max(0, Math.min(1, 1-cushion/5));
  return covered * (0.08 + 0.72*urgency);
}
