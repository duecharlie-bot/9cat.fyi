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

  test("Scoring gives more percentage impact to higher FT volume at the same percentage", ()=>{
    const list = [
      player("PG", {gp:72, ftm:9, fta:10}),
      player("SG", {gp:72, ftm:1.8, fta:2}),
      player("C",  {gp:72, ftm:5, fta:10})
    ];
    w.scorePool(list, {gpw:0, field:"testZ", totalField:"testTotal"});
    assert(list[0].testZ.ft > list[1].testZ.ft, "Same FT% on 10 attempts should matter more than on 2 attempts");
    assert(list[1].testZ.ft > list[2].testZ.ft, "90% FT should score above 50% FT");
  });

  test("Scoring treats fewer turnovers as better", ()=>{
    const list = [
      player("PG", {gp:72, to:1}),
      player("SG", {gp:72, to:3}),
      player("C",  {gp:72, to:5})
    ];
    w.scorePool(list, {gpw:0, field:"testZ", totalField:"testTotal"});
    assert(list[0].testZ.to > list[1].testZ.to, "1 TO should score better than 3 TO");
    assert(list[1].testZ.to > list[2].testZ.to, "3 TO should score better than 5 TO");
  });

  test("scoreBoth produces both durability-weighted and per-game score sets", ()=>{
    const oldGpw = w.eval("cfg.gpw");
    try{
      w.eval("cfg.gpw = 0.5");
      const list = [
        player("PG", {gp:82, pts:25, ast:7, fgm:8, fga:16, ftm:5, fta:6}),
        player("SG", {gp:60, pts:20, ast:4, fgm:7, fga:15, ftm:4, fta:5}),
        player("C",  {gp:72, pts:15, ast:2, fgm:6, fga:10, ftm:2, fta:4})
      ];
      w.scoreBoth(list);
      assert(list.every(p=>p.z && p.zpg), "Every player should receive z and zpg objects");
      assert(list.every(p=>Number.isFinite(p.total) && Number.isFinite(p.totalPg)), "Every player should receive total and totalPg");
    } finally {
      w.eval(`cfg.gpw = ${oldGpw}`);
    }
  });

  test("G and F flex slots accept only the correct position families", ()=>{
    assert(w.slotEligible("G", player("PG")), "G should accept PG");
    assert(w.slotEligible("G", player("SG")), "G should accept SG");
    assert(!w.slotEligible("G", player("SF")), "G should not accept SF");
    assert(w.slotEligible("F", player("SF")), "F should accept SF");
    assert(w.slotEligible("F", player("PF")), "F should accept PF");
    assert(!w.slotEligible("F", player("SG")), "F should not accept SG");
  });

  test("A centre cannot fit when the only remaining slot is G", ()=>{
    const oldSize = w.eval("cfg.size");
    try{
      w.eval("cfg.size = 6"); // PG, SG, SF, PF, C, G
      const roster = [player("PG"),player("SG"),player("SF"),player("PF"),player("C")];
      assert(!w.canFitRoster(roster, player("C")), "A second pure C should not fit into the remaining G slot");
      assert(w.canFitRoster(roster, player("PG")), "A PG should fit into the remaining G slot");
    } finally {
      w.eval(`cfg.size = ${oldSize}`);
    }
  });

  test("Roster legality is enforced on my turn", ()=>{
    const oldCfg = {teams:w.eval("cfg.teams"), slot:w.eval("cfg.slot"), size:w.eval("cfg.size")};
    const oldPool = w.eval("pool");
    const oldPicks = w.eval("picks");
    const oldLocks = w.eval("locks");
    try{
      const zeroZ = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      const mk = (id,name,pos)=>player(pos,{id,name,team:"TST",gp:72,adp:99,z:{...zeroZ},zpg:{...zeroZ},total:0,totalPg:0,last:null});
      const testPool = [
        mk(1,"PG","PG"), mk(2,"SG","SG"), mk(3,"SF","SF"), mk(4,"PF","PF"), mk(5,"C","C"),
        mk(6,"Wemby","C")
      ];
      // Seven logged picks means pick 8 in a 4-team snake, which is Team 1 / us.
      // Five of those picks belong to us, leaving only the G slot open in a 6-slot roster.
      const testPicks = [
        {playerId:1,teamIdx:0,overall:0}, {playerId:2,teamIdx:0,overall:1},
        {playerId:3,teamIdx:0,overall:2}, {playerId:4,teamIdx:0,overall:3},
        {playerId:5,teamIdx:0,overall:4}, {playerId:null,teamIdx:2,overall:5},
        {playerId:null,teamIdx:1,overall:6}
      ];
      w.__testPool = testPool; w.__testPicks = testPicks; w.__testLocks = {};
      w.eval("cfg.teams=4; cfg.slot=1; cfg.size=6; pool=window.__testPool; picks=window.__testPicks; locks=window.__testLocks");
      const state = w.evaluate();
      assert(state.enforceRosterFit, "Roster fit should be enforced when our team is on the clock");
      const wemby = state.avail.find(p=>p.id===6);
      assert(wemby && wemby.rosterFit === false, "Pure C should be unavailable when our only open slot is G");
    } finally {
      w.__oldPool = oldPool; w.__oldPicks = oldPicks; w.__oldLocks = oldLocks;
      w.eval(`cfg.teams=${oldCfg.teams}; cfg.slot=${oldCfg.slot}; cfg.size=${oldCfg.size}; pool=window.__oldPool; picks=window.__oldPicks; locks=window.__oldLocks`);
      delete w.__testPool; delete w.__testPicks; delete w.__testLocks; delete w.__oldPool; delete w.__oldPicks; delete w.__oldLocks;
    }
  });

  test("My roster slots do not block an opponent's pick", ()=>{
    const oldCfg = {teams:w.eval("cfg.teams"), slot:w.eval("cfg.slot"), size:w.eval("cfg.size")};
    const oldPool = w.eval("pool");
    const oldPicks = w.eval("picks");
    const oldLocks = w.eval("locks");
    try{
      const zeroZ = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      const mk = (id,name,pos)=>player(pos,{id,name,team:"TST",gp:72,adp:99,z:{...zeroZ},zpg:{...zeroZ},total:0,totalPg:0,last:null});
      const testPool = [
        mk(1,"PG","PG"), mk(2,"SG","SG"), mk(3,"SF","SF"), mk(4,"PF","PF"), mk(5,"C","C"),
        mk(6,"Wemby","C")
      ];
      // Six logged picks means pick 7 in a 4-team snake: Team 2, not us.
      const testPicks = [
        {playerId:1,teamIdx:0,overall:0}, {playerId:2,teamIdx:0,overall:1},
        {playerId:3,teamIdx:0,overall:2}, {playerId:4,teamIdx:0,overall:3},
        {playerId:5,teamIdx:0,overall:4}, {playerId:null,teamIdx:2,overall:5}
      ];
      w.__testPool = testPool; w.__testPicks = testPicks; w.__testLocks = {};
      w.eval("cfg.teams=4; cfg.slot=1; cfg.size=6; pool=window.__testPool; picks=window.__testPicks; locks=window.__testLocks");
      const state = w.evaluate();
      assert(!state.enforceRosterFit, "Our roster fit should not be enforced on another team's pick");
      const wemby = state.avail.find(p=>p.id===6);
      assert(wemby && wemby.rosterFit === true, "Wemby must stay selectable for the opponent even though he cannot fit our G-only opening");
    } finally {
      w.__oldPool = oldPool; w.__oldPicks = oldPicks; w.__oldLocks = oldLocks;
      w.eval(`cfg.teams=${oldCfg.teams}; cfg.slot=${oldCfg.slot}; cfg.size=${oldCfg.size}; pool=window.__oldPool; picks=window.__oldPicks; locks=window.__oldLocks`);
      delete w.__testPool; delete w.__testPicks; delete w.__testLocks; delete w.__oldPool; delete w.__oldPicks; delete w.__oldLocks;
    }
  });

  test("myNextPick follows snake order for my draft slot", ()=>{
    const oldTeams = w.eval("cfg.teams");
    const oldSlot = w.eval("cfg.slot");
    const oldSize = w.eval("cfg.size");
    try{
      w.eval("cfg.teams = 4; cfg.slot = 2; cfg.size = 5");
      equal(w.myNextPick(0), 1, "Slot 2's first pick should be overall index 1");
      equal(w.myNextPick(2), 6, "After slot 2's first pick, next snake pick should be overall index 6");
      equal(w.myNextPick(7), 9, "Third slot-2 pick should be overall index 9");
    } finally {
      w.eval(`cfg.teams=${oldTeams}; cfg.slot=${oldSlot}; cfg.size=${oldSize}`);
    }
  });

  test("reindex restores contiguous overall pick numbers", ()=>{
    const oldPicks = w.eval("picks");
    try{
      w.__testPicks = [
        {playerId:11,teamIdx:0,overall:0},
        {playerId:22,teamIdx:2,overall:4},
        {playerId:33,teamIdx:1,overall:9}
      ];
      w.eval("picks = window.__testPicks; reindex()");
      const overalls = w.eval("picks.map(p=>p.overall)");
      equal(JSON.stringify(overalls), JSON.stringify([0,1,2]));
    } finally {
      w.__oldPicks = oldPicks;
      w.eval("picks = window.__oldPicks");
      delete w.__testPicks; delete w.__oldPicks;
    }
  });

  test("draft assigns the player to the team currently on the clock", ()=>{
    const oldCfg = {teams:w.eval("cfg.teams"), slot:w.eval("cfg.slot"), size:w.eval("cfg.size")};
    const oldPicks = w.eval("picks");
    const oldRender = w.eval("render");
    const oldRenderLog = w.eval("renderLog");
    try{
      const id = w.eval("pool[0].id");
      w.__testPicks = [];
      w.__noop = ()=>{};
      w.eval("cfg.teams=4; cfg.slot=1; cfg.size=5; picks=window.__testPicks; render=window.__noop; renderLog=window.__noop");
      w.draft(id);
      const pk = w.eval("picks[0]");
      equal(pk.playerId, id);
      equal(pk.teamIdx, 0, "First overall pick should belong to Team 1");
      equal(pk.overall, 0);
      w.eval("clearTimeout(draft._t)");
    } finally {
      w.__oldPicks = oldPicks; w.__oldRender = oldRender; w.__oldRenderLog = oldRenderLog;
      w.eval(`cfg.teams=${oldCfg.teams}; cfg.slot=${oldCfg.slot}; cfg.size=${oldCfg.size}; picks=window.__oldPicks; render=window.__oldRender; renderLog=window.__oldRenderLog`);
      delete w.__testPicks; delete w.__noop; delete w.__oldPicks; delete w.__oldRender; delete w.__oldRenderLog;
    }
  });

  test("undo removes exactly the most recent pick", ()=>{
    const oldPicks = w.eval("picks");
    const oldRender = w.eval("render");
    try{
      w.__testPicks = [
        {playerId:11,teamIdx:0,overall:0},
        {playerId:22,teamIdx:1,overall:1},
        {playerId:33,teamIdx:2,overall:2}
      ];
      w.__noop = ()=>{};
      w.eval("picks=window.__testPicks; render=window.__noop");
      w.undo();
      equal(w.eval("picks.length"), 2);
      equal(w.eval("picks[picks.length-1].playerId"), 22);
    } finally {
      w.__oldPicks=oldPicks; w.__oldRender=oldRender;
      w.eval("picks=window.__oldPicks; render=window.__oldRender");
      delete w.__testPicks; delete w.__noop; delete w.__oldPicks; delete w.__oldRender;
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

frame.addEventListener("load",()=>setTimeout(run,150));
rerun.addEventListener("click",run);

// Attach the load listener before navigating the iframe. On a fast/cached
// Netlify preview the old harness could miss the iframe's load event and sit
// forever on "Loading nineCat…".
frame.src = "../index.html";

// Fallback in case a browser restores the frame unusually quickly.
setTimeout(()=>{
  if(summaryEl.textContent === "Loading nineCat…" || summaryEl.textContent === "Running…"){
    try{
      if(frame.contentDocument && frame.contentDocument.readyState === "complete") run();
    }catch(_e){}
  }
}, 1200);
