"use strict";

/* ============================================================
   ROSTER ELIGIBILITY & SLOT ASSIGNMENT

   Automatic 13-slot default:
   PG, SG, G, SF, PF, F, C, C, UTIL, UTIL, BN, BN, BN

   - 13+ spots: extra spots become BN.
   - <13 spots: unrestricted (all UTIL) unless explicitly customized.
   - cfg.rosterSlots = null means automatic; otherwise it is a count object.
   ============================================================ */

const ROSTER_SLOT_KEYS = ["PG","SG","G","SF","PF","F","C","UTIL","BN"];
const STANDARD_13_ROSTER = Object.freeze({
  PG:1, SG:1, G:1, SF:1, PF:1, F:1, C:2, UTIL:2, BN:3
});

function blankRosterSlotCounts(){
  return Object.fromEntries(ROSTER_SLOT_KEYS.map(k=>[k,0]));
}

function sanitizeRosterSlotCounts(raw){
  if(!raw || typeof raw !== "object") return null;
  const out = blankRosterSlotCounts();
  ROSTER_SLOT_KEYS.forEach(k=>{
    const n = Math.trunc(Number(raw[k]));
    out[k] = Number.isFinite(n) ? Math.max(0, Math.min(MAX_ROSTER_SPOTS, n)) : 0;
  });
  const total = ROSTER_SLOT_KEYS.reduce((s,k)=>s+out[k],0);
  return total >= MIN_ROSTER_SPOTS && total <= MAX_ROSTER_SPOTS ? out : null;
}

function automaticRosterSlotCounts(size=cfg.size){
  const n = Math.max(MIN_ROSTER_SPOTS,
    Math.min(MAX_ROSTER_SPOTS, Math.trunc(Number(size)||13)));
  if(n < 13){
    const out = blankRosterSlotCounts();
    out.UTIL = n;
    return out;
  }
  const out = {...STANDARD_13_ROSTER};
  out.BN += n - 13;
  return out;
}

function activeRosterSlotCounts(){
  return sanitizeRosterSlotCounts(cfg.rosterSlots) || automaticRosterSlotCounts(cfg.size);
}

function expandRosterSlots(counts=activeRosterSlotCounts()){
  const slots = [];
  ROSTER_SLOT_KEYS.forEach(k=>{
    for(let i=0;i<(counts[k]||0);i++) slots.push(k);
  });
  return slots;
}

function rosterPositionsCustomized(){
  return !!sanitizeRosterSlotCounts(cfg.rosterSlots);
}

function rosterPositionsConstrained(){
  const c = activeRosterSlotCounts();
  return ROSTER_SLOT_KEYS.some(k=>k!=="UTIL" && k!=="BN" && (c[k]||0)>0);
}

function slotEligible(slot, p){
  if(slot === "UTIL" || slot === "BN") return true;
  if(slot === "G") return p.pos.some(x=>x==="PG"||x==="SG");
  if(slot === "F") return p.pos.some(x=>x==="SF"||x==="PF");
  return p.pos.includes(slot);
}

/* Match players to restrictive slots only. UTIL/BN are deliberately held back
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
  const slots = expandRosterSlots();
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
  remaining.slice(0,flexSlots.length).forEach((pi,i)=>{
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
  const slots = expandRosterSlots();
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

  // Do not allow a pick that leaves fewer future picks than required slots.
  const remainingAfter = cfg.size - after.length;
  return requiredOpenSlots(after).length <= remainingAfter;
}

/* Small bonus for covering a needed slot. It stays tiny while there is a large
   cushion and rises only as the positional deadline approaches. */
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
