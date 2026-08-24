"use strict";

const frame = document.getElementById("app");
const resultsEl = document.getElementById("results");
const summaryEl = document.getElementById("summary");
const rerun = document.getElementById("rerun");

const tests = [];
function test(name, fn){ tests.push({name,fn}); }
function assert(condition, message="Assertion failed"){
  if(!condition) throw new Error(message);
}
function equal(actual, expected, message=""){
  if(actual !== expected) throw new Error(message || `Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function approx(actual, expected, eps=1e-9, message=""){
  if(Math.abs(actual-expected) > eps) throw new Error(message || `Expected ${expected}, got ${actual}`);
}

function player(pos, overrides={}){
  return {pos:Array.isArray(pos)?pos:[pos], fgm:0,fga:0,ftm:0,fta:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0, ...overrides};
}

function registerTests(w){
  test("FG% recombines makes / attempts (not average of player percentages)", ()=>{
    const roster = [
      player("SG", {fgm:10,fga:20}),
      player("SF", {fgm:2,fga:5})
    ];
    const totals = w.teamTotals(roster);
    approx(w.catTotal(totals,"fg"), 12/25);
    approx(w.catTotal(totals,"fg"), 0.48);
  });

  test("FT% recombines makes / attempts", ()=>{
    const roster = [
      player("PG", {ftm:9,fta:10}),
      player("C",  {ftm:1,fta:2})
    ];
    const totals = w.teamTotals(roster);
    approx(w.catTotal(totals,"ft"), 10/12);
  });

  test("Counting categories add roster production together", ()=>{
    const roster = [
      player("PG", {pts:28,reb:4,ast:7,tpm:3,to:4}),
      player("C",  {pts:20,reb:11,ast:3,tpm:1,to:2})
    ];
    const t = w.teamTotals(roster);
    equal(t.pts,48); equal(t.reb,15); equal(t.ast,10); equal(t.tpm,4); equal(t.to,6);
  });

  test("H2H percentage comparison is symmetric", ()=>{
    const a = w.catTotal(w.teamTotals([player("PG",{ftm:9,fta:10})]),"ft");
    const b = w.catTotal(w.teamTotals([player("SG",{ftm:8,fta:10})]),"ft");
    const ab = a-b;
    const ba = b-a;
    assert(ab > 0, "Team A should beat Team B in FT%");
    assert(ba < 0, "Reversing teams must reverse the FT% result");
    approx(ab, -ba);
  });

  test("Turnovers are lower-is-better and symmetric", ()=>{
    const a = w.catTotal(w.teamTotals([player("PG",{to:2})]),"to");
    const b = w.catTotal(w.teamTotals([player("SG",{to:4})]),"to");
    const abAdvantage = (a-b) * -1;
    const baAdvantage = (b-a) * -1;
    assert(abAdvantage > 0, "2 TO should beat 4 TO");
    assert(baAdvantage < 0, "Reversing teams must reverse the TO result");
  });

  test("4-team snake order reverses correctly", ()=>{
    const oldTeams = w.eval("cfg.teams");
    try{
      w.eval("cfg.teams = 4");
      const order = Array.from({length:8},(_,i)=>w.teamOnClock(i));
      equal(JSON.stringify(order), JSON.stringify([0,1,2,3,3,2,1,0]));
    } finally {
      w.eval(`cfg.teams = ${oldTeams}`);
    }
  });

  test("Roster slot matcher accepts a legal PG/SG/SF/PF/C five-man roster", ()=>{
    const oldSize = w.eval("cfg.size");
    try{
      w.eval("cfg.size = 5");
      const roster = [player("PG"),player("SG"),player("SF"),player("PF"),player("C")];
      equal(w.assignSlots(roster).unplaced.length,0);
    } finally {
      w.eval(`cfg.size = ${oldSize}`);
    }
  });

  test("Roster slot matcher rejects a five-man roster with no C when C is required", ()=>{
    const oldSize = w.eval("cfg.size");
    try{
      w.eval("cfg.size = 5");
      const roster = [player("PG"),player("SG"),player("SF"),player("PF"),player("PG")];
      equal(w.assignSlots(roster).unplaced.length,1);
    } finally {
      w.eval(`cfg.size = ${oldSize}`);
    }
  });

  test("After 5 players, missing standard-position eligibility triggers a roster alert", ()=>{
    const oldSize = w.eval("cfg.size");
    try{
      w.eval("cfg.size = 13");
      const roster = [player("PG"),player("SG"),player("SF"),player("PF"),player("PG")];
      const gaps = w.rosterGaps(roster);
      assert(gaps.eligibilityAlert, "Expected eligibility alert after five drafted players");
      assert(gaps.eligibilityMissing.includes("C"), "Expected C to be reported missing");
    } finally {
      w.eval(`cfg.size = ${oldSize}`);
    }
  });
}

async function run(){
  resultsEl.innerHTML = "";
  summaryEl.textContent = "Running…";
  tests.length = 0;
  const w = frame.contentWindow;
  registerTests(w);
  let passed=0;
  for(const t of tests){
    const row = document.createElement("div");
    row.className="test";
    try{
      await t.fn();
      passed++;
      row.classList.add("pass");
      row.innerHTML=`<div class="mark">✓</div><div class="name"></div>`;
    }catch(err){
      row.classList.add("fail");
      row.innerHTML=`<div class="mark">✕</div><div class="name"></div>`;
      const detail=document.createElement("div");
      detail.className="detail";
      detail.textContent=err && err.stack ? err.stack : String(err);
      row.appendChild(detail);
    }
    row.querySelector(".name").textContent=t.name;
    resultsEl.appendChild(row);
  }
  const failed=tests.length-passed;
  summaryEl.textContent=`${passed} passed · ${failed} failed · ${tests.length} total`;
}

frame.addEventListener("load",()=>setTimeout(run,100));
rerun.addEventListener("click",run);
