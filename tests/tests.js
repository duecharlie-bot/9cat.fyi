"use strict";

const frame = document.getElementById("app");
const resultsEl = document.getElementById("results");
const summaryEl = document.getElementById("summary");
const rerun = document.getElementById("rerun");

const tests = [];
let testRunInProgress = false;
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
  return {pos:Array.isArray(pos)?pos:[pos], gp:1, fgm:0,fga:0,ftm:0,fta:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0, ...overrides};
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

  test("Projected season counting totals multiply each player by GP", ()=>{
    const roster = [
      player("PG", {gp:10,pts:20,reb:4,ast:7,tpm:3,to:4}),
      player("C",  {gp:5, pts:10,reb:8,ast:2,tpm:1,to:2})
    ];
    const t = w.teamTotals(roster);
    equal(t.pts,250);
    equal(t.reb,80);
    equal(t.ast,80);
    equal(t.tpm,35);
    equal(t.to,50);
  });

  test("Projected FG% and FT% weight shooting volume by GP", ()=>{
    const roster = [
      player("SG", {gp:10,fgm:5,fga:10,ftm:8,fta:10}),
      player("SF", {gp:5, fgm:9,fga:10,ftm:9,fta:10})
    ];
    const t = w.teamTotals(roster);
    approx(w.catTotal(t,"fg"), 95/150);
    approx(w.catTotal(t,"ft"), 125/150);
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

  test("Default 5-player roster is PG, SG, SF, PF, C", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval("cfg.size=5; cfg.rosterSlots=null");
      equal(JSON.stringify(w.expandRosterSlots()),
        JSON.stringify(["PG","SG","SF","PF","C"]));
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("Default 13-player roster uses the standard Yahoo-style slot mix", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval("cfg.size=13; cfg.rosterSlots=null");
      equal(JSON.stringify(w.expandRosterSlots()),
        JSON.stringify(["PG","SG","G","SF","PF","F","C","C","UTIL","UTIL","BN","BN","BN"]));
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("Default rosters above 13 add extra bench spots", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval("cfg.size=15; cfg.rosterSlots=null");
      const slots = w.expandRosterSlots();
      equal(slots.filter(s=>s==="C").length,2);
      equal(slots.filter(s=>s==="BN").length,5);
      equal(slots.length,15);
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("Every roster spot can be customized to C", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval(`cfg.size=5; cfg.rosterSlots=["C","C","C","C","C"]`);
      equal(JSON.stringify(w.expandRosterSlots()),
        JSON.stringify(["C","C","C","C","C"]));
      equal(w.assignSlots([player("C"),player("C"),player("C"),player("C"),player("C")]).unplaced.length,0);
      assert(!w.canFitRoster([], player("PG")), "A pure PG should not fit an all-C custom roster");
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
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

  test("Scoring baseline is capped at the top 200 projected players", ()=>{
    const makeList = count => Array.from({length:count},(_,i)=>
      player("PG", {gp:72, pts:201-i, ast:(i%10)+1, reb:(i%7)+1, fgm:5, fga:10, ftm:4, fta:5})
    );

    const top200 = makeList(200);
    w.scorePool(top200, {gpw:0});
    const topScore = top200[0].z.pts;
    const topTotal = top200[0].total;

    const withFringe = makeList(200);
    withFringe.push(player("PG", {gp:72, pts:0, ast:0, reb:0, fgm:1, fga:10, ftm:1, fta:5}));
    w.scorePool(withFringe, {gpw:0});

    approx(withFringe[0].z.pts, topScore, 1e-9,
      "A player below the top-200 baseline should not drag down the PTS mean/SD");
    approx(withFringe[0].total, topTotal, 1e-9,
      "A player below the top-200 baseline should not change top-player Total");
    equal(withFringe[200].valRank, 201, "The fringe player should still be ranked/scored");
  });

  test("G and F flex slots accept only the correct position families", ()=>{
    assert(w.slotEligible("G", player("PG")), "G should accept PG");
    assert(w.slotEligible("G", player("SG")), "G should accept SG");
    assert(!w.slotEligible("G", player("SF")), "G should not accept SF");
    assert(w.slotEligible("F", player("SF")), "F should accept SF");
    assert(w.slotEligible("F", player("PF")), "F should accept PF");
    assert(!w.slotEligible("F", player("SG")), "F should not accept SG");
  });

  test("A centre cannot fit when a custom roster's only remaining slot is G", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval(`cfg.rosterSlots=["PG","SG","G","SF","PF","C"]; cfg.size=6`);
      const roster = [player("PG"),player("SG"),player("SF"),player("PF"),player("C")];
      assert(!w.canFitRoster(roster,player("C")), "A second pure C should not fit into the remaining G slot");
      assert(w.canFitRoster(roster,player("PG")), "A PG should fit into the remaining G slot");
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("Late draft legality prevents skipping two required C slots", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval(`cfg.rosterSlots=["PG","SG","SF","C","C"]; cfg.size=5`);
      const roster = [player("PG"),player("SG"),player("SF")];
      assert(!w.canFitRoster(roster,player("PG")), "Guard should be blocked when both remaining picks must be C");
      assert(w.canFitRoster(roster,player("C")), "C should keep a legal finish possible");
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("Roster legality is enforced on my turn", ()=>{
    const oldCfg = {teams:w.eval("cfg.teams"), slot:w.eval("cfg.slot"), size:w.eval("cfg.size"), rosterSlots:w.eval("cfg.rosterSlots")};
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
      w.__testPool = testPool; w.__testPicks = testPicks; w.__testLocks = {}; w.__oldRosterSlots = oldCfg.rosterSlots;
      w.eval(`cfg.teams=4; cfg.slot=1; cfg.rosterSlots=["PG","SG","G","SF","PF","C"]; cfg.size=6; pool=window.__testPool; picks=window.__testPicks; locks=window.__testLocks`);
      const state = w.evaluate();
      assert(state.enforceRosterFit, "Roster fit should be enforced when our team is on the clock");
      const wemby = state.avail.find(p=>p.id===6);
      assert(wemby && wemby.rosterFit === false, "Pure C should be unavailable when our only open slot is G");
    } finally {
      w.__oldPool = oldPool; w.__oldPicks = oldPicks; w.__oldLocks = oldLocks;
      w.eval(`cfg.teams=${oldCfg.teams}; cfg.slot=${oldCfg.slot}; cfg.size=${oldCfg.size}; cfg.rosterSlots=window.__oldRosterSlots; pool=window.__oldPool; picks=window.__oldPicks; locks=window.__oldLocks`);
      delete w.__testPool; delete w.__testPicks; delete w.__testLocks; delete w.__oldPool; delete w.__oldPicks; delete w.__oldLocks; delete w.__oldRosterSlots;
    }
  });

  test("My roster slots do not block an opponent's pick", ()=>{
    const oldCfg = {teams:w.eval("cfg.teams"), slot:w.eval("cfg.slot"), size:w.eval("cfg.size"), rosterSlots:w.eval("cfg.rosterSlots")};
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
      w.__testPool = testPool; w.__testPicks = testPicks; w.__testLocks = {}; w.__oldRosterSlots = oldCfg.rosterSlots;
      w.eval(`cfg.teams=4; cfg.slot=1; cfg.rosterSlots=["PG","SG","G","SF","PF","C"]; cfg.size=6; pool=window.__testPool; picks=window.__testPicks; locks=window.__testLocks`);
      const state = w.evaluate();
      assert(!state.enforceRosterFit, "Our roster fit should not be enforced on another team's pick");
      const wemby = state.avail.find(p=>p.id===6);
      assert(wemby && wemby.rosterFit === true, "Wemby must stay selectable for the opponent even though he cannot fit our G-only opening");
    } finally {
      w.__oldPool = oldPool; w.__oldPicks = oldPicks; w.__oldLocks = oldLocks;
      w.eval(`cfg.teams=${oldCfg.teams}; cfg.slot=${oldCfg.slot}; cfg.size=${oldCfg.size}; cfg.rosterSlots=window.__oldRosterSlots; pool=window.__oldPool; picks=window.__oldPicks; locks=window.__oldLocks`);
      delete w.__testPool; delete w.__testPicks; delete w.__testLocks; delete w.__oldPool; delete w.__oldPicks; delete w.__oldLocks; delete w.__oldRosterSlots;
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

  test("Two punts hard-stop any further automatic punt recommendations", ()=>{
    const oldLocks = w.eval("locks");
    try{
      w.__testLocks = {fg:"punt", ft:"punt"};
      w.eval("locks = window.__testLocks");
      const state = {
        roster:[player("PG"),player("SG")],
        avail:[],
        tz:{fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0},
        nxt:null
      };
      const suggestions = w.suggestPunts(state);
      equal(suggestions.length, 0, "Once two categories are punted, nineCat must never suggest a third punt");
    } finally {
      w.__oldLocks = oldLocks;
      w.eval("locks = window.__oldLocks");
      delete w.__testLocks; delete w.__oldLocks;
    }
  });

  test("With two punts, a clearly weak remaining category can trigger a chase recommendation", ()=>{
    const oldLocks = w.eval("locks");
    const oldPool = w.eval("pool");
    const oldCfg = {teams:w.eval("cfg.teams"), size:w.eval("cfg.size")};
    try{
      const zero = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      w.__testLocks = {fg:"punt", ft:"punt"};
      w.__testPool = Array.from({length:12},(_,i)=>({id:900+i,total:10-i/10,z:{...zero}}));
      w.eval("locks=window.__testLocks; pool=window.__testPool; cfg.teams=4; cfg.size=3");
      const tz = {...zero, blk:-4};
      const state = {roster:[player("PG"),player("SG"),player("SF")], tz};
      const suggestion = w.suggestChase(state);
      assert(suggestion, "Expected a chase recommendation with two punts and a badly weak category");
      equal(suggestion.cat.k, "blk", "BLK should be identified as the weak category to protect");
      equal(suggestion.punts, 2);
    } finally {
      w.__oldLocks=oldLocks; w.__oldPool=oldPool;
      w.eval(`locks=window.__oldLocks; pool=window.__oldPool; cfg.teams=${oldCfg.teams}; cfg.size=${oldCfg.size}`);
      delete w.__testLocks; delete w.__testPool; delete w.__oldLocks; delete w.__oldPool;
    }
  });

  test("With three punts, chase protection becomes aggressive before a fourth category is lost", ()=>{
    const oldLocks = w.eval("locks");
    const oldPool = w.eval("pool");
    const oldCfg = {teams:w.eval("cfg.teams"), size:w.eval("cfg.size")};
    try{
      const zero = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      w.__testLocks = {fg:"punt", ft:"punt", tpm:"punt"};
      w.__testPool = Array.from({length:12},(_,i)=>({id:950+i,total:10-i/10,z:{...zero}}));
      w.eval("locks=window.__testLocks; pool=window.__testPool; cfg.teams=4; cfg.size=3");
      // This gap is intentionally mild: with only two punts it would not clear
      // the -0.65 threshold, but at three punts we protect the weakest live cat.
      const tz = {...zero, reb:-0.2};
      const state = {roster:[player("PG"),player("SG"),player("SF")], tz};
      const suggestion = w.suggestChase(state);
      assert(suggestion, "Three punts should proactively protect the weakest remaining category");
      equal(suggestion.cat.k, "reb");
      equal(suggestion.punts, 3);
    } finally {
      w.__oldLocks=oldLocks; w.__oldPool=oldPool;
      w.eval(`locks=window.__oldLocks; pool=window.__oldPool; cfg.teams=${oldCfg.teams}; cfg.size=${oldCfg.size}`);
      delete w.__testLocks; delete w.__testPool; delete w.__oldLocks; delete w.__oldPool;
    }
  });

  test("Hard chase weights a category more strongly than a normal chase", ()=>{
    const oldLocks = w.eval("locks");
    try{
      const tz = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      w.__testLocks = {blk:"chase"};
      w.eval("locks=window.__testLocks");
      const chase = w.leverage(tz, 0.5).blk;
      w.__testLocks = {blk:"chase2"};
      w.eval("locks=window.__testLocks");
      const hard = w.leverage(tz, 0.5).blk;
      assert(hard > chase, "Hard chase should weight BLK more than normal chase");
      // leverage() normalizes all live category weights after applying the
      // raw chase pins. With every other category at its natural 0.25 weight:
      // normal chase = 0.40 / (0.40 + 8*0.25) * 9 = 1.50
      // hard chase   = 0.80 / (0.80 + 8*0.25) * 9 = 18/7 ≈ 2.5714
      approx(chase, 1.50);
      approx(hard, 18/7);
    } finally {
      w.__oldLocks=oldLocks;
      w.eval("locks=window.__oldLocks");
      delete w.__testLocks; delete w.__oldLocks;
    }
  });


  test("Recommendation pool excludes players already drafted", ()=>{
    const oldPool = w.eval("pool");
    const oldPicks = w.eval("picks");
    try{
      const zeroZ = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      const a = player("PG", {id:101,name:"Taken",team:"TST",gp:72,adp:20,z:{...zeroZ},zpg:{...zeroZ},total:0,totalPg:0,last:null});
      const b = player("SG", {id:102,name:"Available",team:"TST",gp:72,adp:21,z:{...zeroZ},zpg:{...zeroZ},total:0,totalPg:0,last:null});
      w.__testPool=[a,b]; w.__testPicks=[{playerId:101,teamIdx:0,overall:0}];
      w.eval("pool=window.__testPool; picks=window.__testPicks");
      const ids = w.available().map(p=>p.id);
      equal(JSON.stringify(ids), JSON.stringify([102]));
    } finally {
      w.__oldPool=oldPool; w.__oldPicks=oldPicks;
      w.eval("pool=window.__oldPool; picks=window.__oldPicks");
      delete w.__testPool; delete w.__testPicks; delete w.__oldPool; delete w.__oldPicks;
    }
  });

  test("Run risk is higher for a player likely to be gone before the next turn", ()=>{
    const oldPicks = w.eval("picks");
    try{
      w.__testPicks=[];
      w.eval("picks=window.__testPicks");
      const early = w.runRisk({adp:4}, 10);
      const late  = w.runRisk({adp:30}, 10);
      assert(early > late, `Expected earlier ADP to have higher run risk (${early} vs ${late})`);
      assert(early >= 0 && early <= 1 && late >= 0 && late <= 1, "Run risk should remain a probability");
    } finally {
      w.__oldPicks=oldPicks;
      w.eval("picks=window.__oldPicks");
      delete w.__testPicks; delete w.__oldPicks;
    }
  });

  test("Scarcity boosts otherwise-equal players who are unlikely to survive", ()=>{
    const oldCfg = {teams:w.eval("cfg.teams"),slot:w.eval("cfg.slot"),size:w.eval("cfg.size"),scarcity:w.eval("cfg.scarcity")};
    const oldPool=w.eval("pool"), oldPicks=w.eval("picks"), oldLocks=w.eval("locks"), oldShape=w.eval("shape");
    try{
      const zeroZ = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      const mk=(id,name,adp)=>player("PG",{id,name,team:"TST",gp:72,adp,z:{...zeroZ},zpg:{...zeroZ},total:0,totalPg:0,last:null});
      w.__testPool=[mk(201,"Early ADP",3),mk(202,"Late ADP",40)];
      w.__testPicks=[]; w.__testLocks={};
      w.eval("cfg.teams=4; cfg.slot=1; cfg.size=5; cfg.scarcity=1; pool=window.__testPool; picks=window.__testPicks; locks=window.__testLocks; shape=0");
      const state=w.evaluate();
      const early=state.avail.find(p=>p.id===201), late=state.avail.find(p=>p.id===202);
      assert(early.fitAdj > late.fitAdj, `Expected scarcity to favor likely-gone player (${early.fitAdj} vs ${late.fitAdj})`);
    } finally {
      w.__oldPool=oldPool; w.__oldPicks=oldPicks; w.__oldLocks=oldLocks;
      w.eval(`cfg.teams=${oldCfg.teams}; cfg.slot=${oldCfg.slot}; cfg.size=${oldCfg.size}; cfg.scarcity=${oldCfg.scarcity}; pool=window.__oldPool; picks=window.__oldPicks; locks=window.__oldLocks; shape=${oldShape}`);
      delete w.__testPool; delete w.__testPicks; delete w.__testLocks; delete w.__oldPool; delete w.__oldPicks; delete w.__oldLocks;
    }
  });

  test("FIT display is centered on the next two rounds of available value", ()=>{
    const oldTeams = w.eval("cfg.teams");
    try{
      w.eval("cfg.teams=2");                    // two rounds = four players
      const rows = [
        {valRank:1,total:10,fitAdj:4,fitLast:8,rosterFit:true},
        {valRank:2,total:9, fitAdj:3,fitLast:7,rosterFit:true},
        {valRank:3,total:8, fitAdj:2,fitLast:6,rosterFit:true},
        {valRank:4,total:7, fitAdj:1,fitLast:5,rosterFit:true},
        {valRank:5,total:6, fitAdj:-100,fitLast:-100,rosterFit:true}
      ];
      w.__fitRows=rows;
      const market = w.eval("applyFitMarketBaseline(window.__fitRows)");
      approx(market.fitBaseline, 2.5);
      equal(market.fitWindowSize, 4);
      approx(rows[0].fitDisplay, 1.5);
      approx(rows[3].fitDisplay, -1.5);
      approx(rows[4].fitDisplay, -102.5, 1e-9, "A deep fringe player must not drag down the current-market zero");
      approx(rows[0].fitDisplay - rows[1].fitDisplay, rows[0].fitAdj - rows[1].fitAdj, 1e-9, "Re-centering must preserve FIT gaps/order");
    } finally {
      w.eval(`cfg.teams=${oldTeams}`);
      delete w.__fitRows;
    }
  });

  test("Hard chase tilts Fit toward the chased category", ()=>{
    const oldCfg = {teams:w.eval("cfg.teams"),slot:w.eval("cfg.slot"),size:w.eval("cfg.size"),scarcity:w.eval("cfg.scarcity")};
    const oldCatW=w.eval("cfg.catW"), oldPool=w.eval("pool"), oldPicks=w.eval("picks"), oldLocks=w.eval("locks"), oldShape=w.eval("shape");
    try{
      const zeroZ = {fg:0,ft:0,tpm:0,pts:0,reb:0,ast:0,stl:0,blk:0,to:0};
      const astZ={...zeroZ,ast:1};
      const ptsZ={...zeroZ,pts:1};
      const mk=(id,name,z)=>player("PG",{id,name,team:"TST",gp:72,adp:30,z,zpg:{...z},total:1,totalPg:1,last:null});
      w.__testPool=[mk(301,"AST specialist",astZ),mk(302,"PTS specialist",ptsZ)];
      w.__testPicks=[]; w.__testLocks={ast:"chase2"}; w.__testCatW={};
      w.eval("cfg.teams=4; cfg.slot=1; cfg.size=5; cfg.scarcity=0; cfg.catW=window.__testCatW; pool=window.__testPool; picks=window.__testPicks; locks=window.__testLocks; shape=0");
      const state=w.evaluate();
      const ast=state.avail.find(p=>p.id===301), pts=state.avail.find(p=>p.id===302);
      assert(ast.fitAdj > pts.fitAdj, `Expected hard-chased AST player to rank above equal PTS player (${ast.fitAdj} vs ${pts.fitAdj})`);
    } finally {
      w.__oldPool=oldPool; w.__oldPicks=oldPicks; w.__oldLocks=oldLocks; w.__oldCatW=oldCatW;
      w.eval(`cfg.teams=${oldCfg.teams}; cfg.slot=${oldCfg.slot}; cfg.size=${oldCfg.size}; cfg.scarcity=${oldCfg.scarcity}; cfg.catW=window.__oldCatW; pool=window.__oldPool; picks=window.__oldPicks; locks=window.__oldLocks; shape=${oldShape}`);
      delete w.__testPool; delete w.__testPicks; delete w.__testLocks; delete w.__testCatW; delete w.__oldPool; delete w.__oldPicks; delete w.__oldLocks; delete w.__oldCatW;
    }
  });


  test("Projection text round-trips through local storage", ()=>{
    const key = w.eval("PROJ_KEY");
    const old = w.localStorage.getItem(key);
    try{
      const sample = "Player\tPTS\nTest Guard\t22.4";
      w.saveProjectionText(sample);
      equal(w.loadProjectionText(), sample);
    } finally {
      if(old === null) w.localStorage.removeItem(key); else w.localStorage.setItem(key, old);
    }
  });

  test("League settings save and restore independently of draft picks", ()=>{
    const key = w.eval("CFG_KEY");
    const oldRaw = w.localStorage.getItem(key);
    const oldCfg = JSON.parse(JSON.stringify(w.eval("cfg")));
    const oldShape = w.eval("shape");
    const oldTheme = w.document.body.dataset.theme;
    const oldPending = w.eval("pendingUI");
    try{
      w.eval("cfg.teams=7; cfg.slot=3; shape=0.37; document.body.dataset.theme='court'; saveSettings()");
      w.eval("cfg.teams=4; cfg.slot=1; shape=0.91; document.body.dataset.theme='arena'; pendingUI=null");
      assert(w.loadSettings(), "Expected saved league settings to load");
      equal(w.eval("cfg.teams"), 7);
      equal(w.eval("cfg.slot"), 3);
      approx(w.eval("shape"), 0.37);
      equal(w.document.body.dataset.theme, "court");
    } finally {
      w.__oldCfgCopy = oldCfg; w.__oldPending = oldPending; w.__oldShape = oldShape; w.__oldTheme = oldTheme;
      w.eval("Object.assign(cfg, window.__oldCfgCopy); shape=window.__oldShape; document.body.dataset.theme=window.__oldTheme; pendingUI=window.__oldPending");
      delete w.__oldCfgCopy; delete w.__oldPending; delete w.__oldShape; delete w.__oldTheme;
      if(oldRaw === null) w.localStorage.removeItem(key); else w.localStorage.setItem(key, oldRaw);
    }
  });

  test("Draft state round-trips when the projection-pool signature matches", ()=>{
    const saveKey = w.eval("SAVE_KEY");
    const cfgKey = w.eval("CFG_KEY");
    const oldSaveRaw = w.localStorage.getItem(saveKey);
    const oldCfgRaw = w.localStorage.getItem(cfgKey);
    const oldPicks = w.eval("picks"), oldLocks = w.eval("locks"), oldLedgerTeam = w.eval("ledgerTeam");
    try{
      w.__testPicks = [{playerId:987,teamIdx:2,overall:0}];
      w.__testLocks = {blk:"chase2",to:"punt"};
      w.eval("picks=window.__testPicks; locks=window.__testLocks; ledgerTeam=2; saveState()");
      w.eval("picks=[]; locks={}; ledgerTeam=null");
      assert(w.loadState(), "Expected matching draft state to restore");
      equal(w.eval("picks.length"), 1);
      equal(w.eval("picks[0].playerId"), 987);
      equal(w.eval("locks.blk"), "chase2");
      equal(w.eval("locks.to"), "punt");
      equal(w.eval("ledgerTeam"), 2);
    } finally {
      w.__oldPicks=oldPicks; w.__oldLocks=oldLocks; w.__oldLedgerTeam=oldLedgerTeam;
      w.eval("picks=window.__oldPicks; locks=window.__oldLocks; ledgerTeam=window.__oldLedgerTeam");
      delete w.__testPicks; delete w.__testLocks; delete w.__oldPicks; delete w.__oldLocks; delete w.__oldLedgerTeam;
      if(oldSaveRaw === null) w.localStorage.removeItem(saveKey); else w.localStorage.setItem(saveKey, oldSaveRaw);
      if(oldCfgRaw === null) w.localStorage.removeItem(cfgKey); else w.localStorage.setItem(cfgKey, oldCfgRaw);
    }
  });

  test("Saved picks are rejected when the projection-pool signature changes", ()=>{
    const key = w.eval("SAVE_KEY");
    const oldRaw = w.localStorage.getItem(key);
    const oldPicks = w.eval("picks"), oldLocks = w.eval("locks"), oldLedgerTeam = w.eval("ledgerTeam");
    try{
      w.__sentinelPicks=[{playerId:111,teamIdx:0,overall:0}];
      w.__sentinelLocks={ast:"chase"};
      w.eval("picks=window.__sentinelPicks; locks=window.__sentinelLocks; ledgerTeam=1");
      w.localStorage.setItem(key, JSON.stringify({sig:"definitely-not-this-pool",picks:[{playerId:999,teamIdx:3,overall:0}],locks:{blk:"punt"},ledgerTeam:3}));
      assert(!w.loadState(), "Mismatched projection signature must not restore the saved draft");
      equal(w.eval("picks[0].playerId"), 111, "Current picks should remain untouched on signature mismatch");
      equal(w.eval("locks.ast"), "chase");
      equal(w.eval("ledgerTeam"), 1);
    } finally {
      w.__oldPicks=oldPicks; w.__oldLocks=oldLocks; w.__oldLedgerTeam=oldLedgerTeam;
      w.eval("picks=window.__oldPicks; locks=window.__oldLocks; ledgerTeam=window.__oldLedgerTeam");
      delete w.__sentinelPicks; delete w.__sentinelLocks; delete w.__oldPicks; delete w.__oldLocks; delete w.__oldLedgerTeam;
      if(oldRaw === null) w.localStorage.removeItem(key); else w.localStorage.setItem(key, oldRaw);
    }
  });

  test("Clearing draft state preserves league settings and projection text", ()=>{
    const saveKey=w.eval("SAVE_KEY"), cfgKey=w.eval("CFG_KEY"), projKey=w.eval("PROJ_KEY");
    const oldSave=w.localStorage.getItem(saveKey), oldCfg=w.localStorage.getItem(cfgKey), oldProj=w.localStorage.getItem(projKey);
    try{
      w.localStorage.setItem(saveKey, "draft-test");
      w.localStorage.setItem(cfgKey, "settings-test");
      w.localStorage.setItem(projKey, "projections-test");
      w.clearState();
      equal(w.localStorage.getItem(saveKey), null);
      equal(w.localStorage.getItem(cfgKey), "settings-test");
      equal(w.localStorage.getItem(projKey), "projections-test");
    } finally {
      if(oldSave===null) w.localStorage.removeItem(saveKey); else w.localStorage.setItem(saveKey,oldSave);
      if(oldCfg===null) w.localStorage.removeItem(cfgKey); else w.localStorage.setItem(cfgKey,oldCfg);
      if(oldProj===null) w.localStorage.removeItem(projKey); else w.localStorage.setItem(projKey,oldProj);
    }
  });


  test("Name matching folds accents and punctuation consistently", ()=>{
    equal(w.eval('nameKey("Nikola Jokić")'), w.eval('nameKey("Nikola Jokic")'));
    equal(w.eval('nameKey("Luka Dončić Jr.")'), w.eval('nameKey("Luka Doncic")'));
  });

  test("Projection parser reads header-mapped made/attempt columns", ()=>{
    const text = [
      "Player\tPos\tTeam\tGP\tFGM\tFGA\tFTM\tFTA\t3PM\tPTS\tREB\tAST\tSTL\tBLK\tTO\tADP",
      "Victor Wembanyama\tC\tSAS\t71\t10.2\t19.1\t5.3\t6.1\t3.2\t28.9\t11.4\t4.2\t1.3\t3.7\t3.4\t2.0"
    ].join("\n").replace(/\\\t/g,"\t").replace(/\\\n/g,"\n");
    const rows = w.parsePool(text);
    equal(rows.length, 1);
    equal(rows[0].name, "Victor Wembanyama");
    equal(rows[0].pos[0], "C");
    approx(rows[0].fgm, 10.2); approx(rows[0].fga, 19.1);
    approx(rows[0].ftm, 5.3); approx(rows[0].fta, 6.1);
    approx(rows[0].pts, 28.9); approx(rows[0].adp, 2.0);
  });

  test("Projection parser reads combined percentage volume cells", ()=>{
    const text = [
      "Player\tPos\tTeam\tGP\tFG%\tFT%\t3PM\tPTS\tREB\tAST\tSTL\tBLK\tTO",
      "Nikola Jokic\tC\tDEN\t79\t57.4% (11.2/19.5)\t81.2% (5.2/6.4)\t2.0\t29.6\t12.7\t10.2\t1.7\t0.7\t3.4"
    ].join("\n").replace(/\\\t/g,"\t").replace(/\\\n/g,"\n");
    const rows = w.parsePool(text);
    equal(rows.length, 1);
    approx(rows[0].fgm, 11.2); approx(rows[0].fga, 19.5);
    approx(rows[0].ftm, 5.2); approx(rows[0].fta, 6.4);
    approx(rows[0].ast, 10.2);
  });

  test("Projection parser ignores repeated header rows", ()=>{
    const header = "Player\tPos\tTeam\tGP\tFGM\tFGA\tFTM\tFTA\t3PM\tPTS\tREB\tAST\tSTL\tBLK\tTO".replace(/\\\t/g,"\t");
    const a = "Player A\tPG\tAAA\t70\t7\t14\t4\t5\t2\t20\t4\t8\t1\t0.2\t3".replace(/\\\t/g,"\t");
    const b = "Player B\tC\tBBB\t72\t6\t10\t2\t4\t0\t14\t10\t2\t0.5\t2\t2".replace(/\\\t/g,"\t");
    const rows = w.parsePool([header,a,header,b].join("\n"));
    equal(rows.length, 2);
    equal(rows[0].name, "Player A");
    equal(rows[1].name, "Player B");
  });

  test("Projection dedupe keeps the highest-GP row and reindexes ids", ()=>{
    const rows = [
      {name:"Example Player",gp:22,id:99,pts:10},
      {name:"Example Player",gp:61,id:100,pts:18},
      {name:"Other Player",gp:70,id:101,pts:12}
    ];
    const out = w.dedupe(rows);
    equal(out.length, 2);
    equal(out.find(x=>x.name==="Example Player").pts, 18);
    equal(JSON.stringify(out.map(x=>x.id)), JSON.stringify([0,1]));
  });


  test("Roster alert sits above the recommendation panel", ()=>{
    const alertEl = w.document.getElementById("rgap");
    const recEl = w.document.getElementById("rec");
    assert(alertEl && recEl, "Expected both roster alert and recommendation elements");
    const pos = alertEl.compareDocumentPosition(recEl);
    assert((pos & w.Node.DOCUMENT_POSITION_FOLLOWING) !== 0, "Roster alert should appear before the recommendation panel in the DOM");
  });

  test("Team Profile collapse control hides and restores the profile body", ()=>{
    const btn = w.document.getElementById("ledgercollapse");
    const body = w.document.getElementById("ledgerbody");
    assert(btn && body, "Expected ledger collapse controls");
    const startedHidden = body.classList.contains("hide");
    // Normalize to expanded first.
    if(startedHidden) btn.click();
    assert(!body.classList.contains("hide"), "Ledger should be expanded before collapse test");
    btn.click();
    assert(body.classList.contains("hide"), "Collapse should hide the ledger body");
    equal(btn.textContent.trim(), "Expand");
    btn.click();
    assert(!body.classList.contains("hide"), "Expand should restore the ledger body");
    equal(btn.textContent.trim(), "Collapse");
    // Restore the user's starting state.
    if(startedHidden) btn.click();
  });

  test("Z and Totals modes keep identical Team Profile bar geometry", ()=>{
    const oldPicks = w.eval("picks");
    const oldMode = w.eval("ledgerMode"); w.__oldLedgerMode=oldMode;
    const oldTeam = w.eval("ledgerTeam"); w.__oldLedgerTeam=oldTeam;
    const oldHover = w.eval("hoverId"); w.__oldHover=oldHover;
    const oldSelected = w.eval("selectedId"); w.__oldSelected=oldSelected;
    try{
      const firstId = w.eval("pool[0] && pool[0].id");
      assert(firstId !== undefined && firstId !== null, "Expected at least one projection player");
      w.__testPicks=[{playerId:firstId,teamIdx:w.myTeamIdx(),overall:0}];
      w.eval("picks=window.__testPicks; ledgerTeam=null; hoverId=null; selectedId=null; ledgerMode='z'");
      const state=w.evaluate();
      w.renderLedger(state);
      const zBars=[...w.document.querySelectorAll("#ledger .lbar")].map(el=>el.getAttribute("style"));
      assert(zBars.length===9, `Expected 9 category bars, got ${zBars.length}`);
      w.eval("ledgerMode='tot'");
      w.renderLedger(state);
      const totalBars=[...w.document.querySelectorAll("#ledger .lbar")].map(el=>el.getAttribute("style"));
      equal(JSON.stringify(totalBars), JSON.stringify(zBars), "Toggling Z/Totals must not change bar widths or positions");
    } finally {
      w.__oldPicks=oldPicks;
      w.eval("picks=window.__oldPicks; ledgerMode=window.__oldLedgerMode; ledgerTeam=window.__oldLedgerTeam; hoverId=window.__oldHover; selectedId=window.__oldSelected");
      delete w.__testPicks; delete w.__oldPicks;
      delete w.__oldLedgerMode; delete w.__oldLedgerTeam; delete w.__oldHover; delete w.__oldSelected;
    }
  });

  test("Recommendation panel is compact and keeps the Clear control", ()=>{
    const oldSelected=w.eval("selectedId"), oldHover=w.eval("hoverId"); w.__oldSelected=oldSelected; w.__oldHover=oldHover;
    try{
      w.eval("selectedId=null; hoverId=null");
      const state=w.evaluate();
      w.renderRec(state);
      assert(w.document.querySelector("#r_clear"), "Recommendation panel should include Clear");
      assert(!w.document.querySelector("#rec .tradeoff"), "Removed recommendation-fit/comparison sub-box should stay absent");
    } finally {
      w.__oldSelected=oldSelected; w.__oldHover=oldHover;
      w.eval("selectedId=window.__oldSelected; hoverId=window.__oldHover");
      delete w.__oldSelected; delete w.__oldHover;
    }
  });

  test("Expanded My Roster projections use category performance colouring", ()=>{
    const oldPicks=w.eval("picks"), oldInspect=w.eval("rosterInspectId"), oldLedgerTeam=w.eval("ledgerTeam"); w.__oldPicks=oldPicks; w.__oldInspect=oldInspect; w.__oldLedgerTeam=oldLedgerTeam;
    try{
      const firstId=w.eval("pool[0] && pool[0].id");
      assert(firstId !== undefined && firstId !== null, "Expected at least one projection player");
      w.__testPicks=[{playerId:firstId,teamIdx:w.myTeamIdx(),overall:0}];
      w.eval("picks=window.__testPicks; ledgerTeam=null; rosterInspectId=String(window.__testPicks[0].playerId)");
      const state=w.evaluate();
      w.renderRoster(state);
      const panel=w.document.querySelector("#roster .roster-proj");
      assert(panel, "Expected expanded projected-per-game panel");
      const values=[...panel.querySelectorAll(".rp-v")];
      equal(values.length, 9, "Expected all 9 category projection values");
      assert(values.some(el=>(el.getAttribute("style")||"").includes("color:")), "Expected projection values to carry category colours");
    } finally {
      w.__oldPicks=oldPicks; w.__oldInspect=oldInspect; w.__oldLedgerTeam=oldLedgerTeam;
      w.eval("picks=window.__oldPicks; rosterInspectId=window.__oldInspect; ledgerTeam=window.__oldLedgerTeam");
      delete w.__testPicks; delete w.__oldPicks; delete w.__oldInspect; delete w.__oldLedgerTeam;
    }
  });

  test("Bundled current-season projection dataset parses to the expected 500-player Yahoo pool", ()=>{
    const rows = w.eval("dedupe(parsePool(RAW))");
    equal(rows.length, 500, "Bundled Yahoo projection pool size changed unexpectedly");
    equal(rows[0].name, "Victor Wembanyama");
    equal(rows[rows.length-1].name, "Nate Williams");
  });

  test("Bundled historical actuals dataset is present and substantial", ()=>{
    const rows = w.eval("dedupe(parsePool(RAW_LAST))");
    assert(rows.length > 100, `Expected a substantial historical dataset, got ${rows.length} rows`);
  });

  test("Historical actuals can still match normalized current-player names", ()=>{
    const current = w.eval("dedupe(parsePool(RAW))");
    const hist = w.eval("dedupe(parsePool(RAW_LAST))");
    const currentKeys = new Set(current.map(p=>w.eval(`nameKey(${JSON.stringify(p.name)})`)));
    const historicalKeys = new Set(hist.map(p=>w.eval(`nameKey(${JSON.stringify(p.name)})`)));
    for(const expected of ["Nikola Jokic","Luka Doncic","Shai Gilgeous-Alexander"]){
      const key = w.eval(`nameKey(${JSON.stringify(expected)})`);
      assert(currentKeys.has(key), `${expected} should exist in current projections`);
      assert(historicalKeys.has(key), `${expected} should match historical actuals after normalization`);
    }
  });

  test("Bundled projection dataset exposes season and update metadata", ()=>{
    const meta = w.eval("PROJECTION_DATASET_META");
    equal(meta.kind, "bundled");
    equal(meta.season, "2026-27");
    equal(meta.updated, "2026-08-27");
    equal(meta.label, "2026–27 Projections");
  });

  test("Bundled Yahoo refresh uses Aug 27 GP, ADP and season-derived rates", ()=>{
    const current = w.eval("dedupe(parsePool(RAW))");
    const byName = new Map(current.map(p=>[p.name,p]));
    const wemby = byName.get("Victor Wembanyama");
    const jokic = byName.get("Nikola Jokic");
    assert(wemby && jokic, "Expected Wembanyama and Jokic in refreshed projections");
    approx(wemby.adp, 2.3);
    equal(wemby.gp, 68);
    approx(wemby.pts * wemby.gp, 1750, 0.01);
    approx(wemby.blk * wemby.gp, 230, 0.01);
    approx(wemby.fgm / wemby.fga, .519, 0.00005);
    approx(jokic.adp, 4.1);
    approx(jokic.pts * jokic.gp, 1975, 0.01);
    approx(jokic.ast * jokic.gp, 717, 0.01);
    approx(jokic.fgm / jokic.fga, .573, 0.00005);
  });

  test("Historical dataset exposes source and data-through metadata", ()=>{
    const meta = w.eval("ACTUALS_DATASET_META");
    equal(meta.kind, "historical");
    equal(meta.source, "BoxScore Lab");
    equal(meta.license, "CC BY 4.0");
    equal(meta.dataThrough, "2026-08-09");
  });

  test("Bundled projection summary includes label, player count and updated date", ()=>{
    const summary = w.eval("projectionDatasetSummary(projectionDatasetMeta('', 500))");
    equal(summary, "2026–27 Projections · 500 players · Updated Aug 27, 2026");
  });

  test("Custom projection imports are clearly distinguished from bundled data", ()=>{
    const meta = w.eval("projectionDatasetMeta('custom table', 184)");
    equal(meta.kind, "custom");
    equal(meta.label, "Custom projections");
    equal(meta.playerCount, 184);
    equal(w.eval("projectionDatasetSummary(projectionDatasetMeta('custom table', 184))"), "Custom projections · 184 players");
  });

  test("Player-name normalization rules are loaded from dedicated data", ()=>{
    const rules = w.eval("PLAYER_NAME_RULES");
    equal(rules.foldChars["đ"], "d");
    assert(rules.suffixes.includes("jr"), "Expected Jr suffix rule");
    assert(rules.suffixes.includes("iii"), "Expected III suffix rule");
  });

  test("Source team abbreviations are centralized in player-name rules", ()=>{
    const teams = w.eval("PLAYER_NAME_RULES.teamAbbreviations");
    for(const t of ["NY","NYK","NO","NOP","PHO","PHX","GS","GSW"]){
      assert(teams.includes(t), `Expected ${t} team abbreviation`);
    }
  });

  test("Generational suffixes still normalize to the same player key", ()=>{
    equal(w.eval(`nameKey("Jaren Jackson Jr.")`), w.eval(`nameKey("Jaren Jackson")`));
    equal(w.eval(`nameKey("Trey Murphy III")`), w.eval(`nameKey("Trey Murphy")`));
  });

  test("Player cleanup preserves suffixes while stripping source team and position", ()=>{
    equal(w.eval(`cleanName("Trey Murphy III NO SG/SF")`), "Trey Murphy III");
    equal(w.eval(`cleanName("Stephen Curry GSW PG")`), "Stephen Curry");
  });


  test("Restore default projections clears only the custom projection override", ()=>{
    const projKey = w.eval("PROJ_KEY");
    const cfgKey = w.eval("CFG_KEY");
    const saveKey = w.eval("SAVE_KEY");
    const starKey = w.eval("STAR_KEY");

    const oldProj = w.localStorage.getItem(projKey);
    const oldCfg = w.localStorage.getItem(cfgKey);
    const oldSave = w.localStorage.getItem(saveKey);
    const oldStars = w.localStorage.getItem(starKey);

    try{
      w.localStorage.setItem(projKey, "CUSTOM CSV");
      w.localStorage.setItem(cfgKey, "KEEP SETTINGS");
      w.localStorage.setItem(saveKey, "DRAFT STATE");
      w.localStorage.setItem(starKey, "KEEP STARS");

      equal(w.clearProjectionText(), true);
      equal(w.localStorage.getItem(projKey), null, "Projection override should be removed");
      equal(w.localStorage.getItem(cfgKey), "KEEP SETTINGS", "League settings should be preserved");
      equal(w.localStorage.getItem(saveKey), "DRAFT STATE", "Projection helper itself should not silently clear draft state");
      equal(w.localStorage.getItem(starKey), "KEEP STARS", "Starred players should be preserved");

      // The actual restore action separately calls clearState(), because picks
      // are pool-specific. Verify that helper still leaves settings/stars alone.
      w.clearState();
      equal(w.localStorage.getItem(saveKey), null, "Restore should be able to reset draft state");
      equal(w.localStorage.getItem(cfgKey), "KEEP SETTINGS");
      equal(w.localStorage.getItem(starKey), "KEEP STARS");
    } finally {
      const restore = (k,v)=> v === null ? w.localStorage.removeItem(k) : w.localStorage.setItem(k,v);
      restore(projKey, oldProj);
      restore(cfgKey, oldCfg);
      restore(saveKey, oldSave);
      restore(starKey, oldStars);
    }
  });

  test("Projection import validation rejects an empty import without creating rows", ()=>{
    const v = w.validateProjectionImport("");
    equal(v.ok, false);
    equal(v.code, "empty");
    equal(v.rows.length, 0);
    assert(v.message.includes("Choose a projections CSV"), "Expected strict CSV import guidance");
  });

  test("Projection import validation rejects legacy source-table headers", ()=>{
    const text = [
      "R#\tPLAYER\tADP\tPOS\tTEAM\tGP\tMPG\tFG%\tFT%\t3PM\tPTS\tTREB\tAST\tSTL\tBLK\tTO\tTOTAL",
      "1\tAlpha One\t10\tPG\tAAA\t70\t34\t0.50 (5/10)\t0.80 (4/5)\t2\t20\t5\t5\t1\t0.5\t2\t1"
    ].join("\n");
    const v = w.validateProjectionImport(text);
    equal(v.ok, false);
    equal(v.code, "bad-header");
    assert(v.message.includes("PLAYER,ADP,POS,TEAM"), "Expected canonical header guidance");
  });

  test("Projection import validation requires a meaningful canonical CSV pool", ()=>{
    const text = [
      "PLAYER,ADP,POS,TEAM,GP,MPG,FGM,FGA,FTM,FTA,3PM,PTS,REB,AST,STL,BLK,TO",
      "Alpha One,10,PG,AAA,70,34,5,10,4,5,2,20,5,5,1,0.5,2",
      "Bravo Two,20,SG,BBB,68,33,4.8,10,4.1,5,2,18,4,4,1,0.4,2"
    ].join("\n");
    const v = w.validateProjectionImport(text);
    equal(v.ok, false);
    equal(v.code, "too-few-players");
    equal(v.rows.length, 2);
    assert(v.message.includes("at least 5 players"), "Expected minimum-pool guidance");
  });

  test("Projection import validation rejects duplicate canonical player names", ()=>{
    const header = "PLAYER,ADP,POS,TEAM,GP,MPG,FGM,FGA,FTM,FTA,3PM,PTS,REB,AST,STL,BLK,TO";
    const rows = [
      "Alpha One,10,PG,AAA,70,34,5,10,4,5,2,20,5,5,1,0.5,2",
      "Bravo Two,20,SG,BBB,70,33,4.8,10,4.1,5,2,18,4,4,1,0.4,2",
      "Charlie Three,30,SF,CCC,70,32,4.7,10,3.8,5,1,16,6,3,1,0.6,2",
      "Delta Four,40,PF,DDD,70,31,5.2,10,3.5,5,1,14,8,2,1,1,2",
      "Echo Five,50,C,EEE,70,30,5.5,10,3.4,5,0,12,10,2,0.8,1.5,2",
      "Alpha One,11,PG,AAA,82,35,5.1,10,4,5,2,21,5,5,1,0.5,2"
    ];
    const v = w.validateProjectionImport([header, ...rows].join("\n"));
    equal(v.ok, false);
    equal(v.code, "duplicate-players");
    equal(v.parsedRows, 6);
    equal(v.rows.length, 6);
    equal(v.duplicates, 1);
    assert(v.message.includes("Alpha One"), "Expected duplicate player to be named");
  });

  test("Projection import validation reports optional GP and ADP coverage", ()=>{
    const text = [
      "PLAYER,ADP,POS,TEAM,GP,MPG,FGM,FGA,FTM,FTA,3PM,PTS,REB,AST,STL,BLK,TO",
      "Alpha One,10,PG,AAA,70,34,5,10,4,5,2,20,5,5,1,0.5,2",
      "Bravo Two,20,SG,BBB,68,33,4.8,10,4.1,5,2,18,4,4,1,0.4,2",
      "Charlie Three,30,SF,CCC,66,32,4.7,10,3.8,5,1,16,6,3,1,0.6,2",
      "Delta Four,40,PF,DDD,64,31,5.2,10,3.5,5,1,14,8,2,1,1,2",
      "Echo Five,50,C,EEE,62,30,5.5,10,3.4,5,0,12,10,2,0.8,1.5,2"
    ].join("\n");
    const v = w.validateProjectionImport(text);
    equal(v.ok, true);
    equal(v.rows.length, 5);
    equal(v.withGP, 5);
    equal(v.withADP, 5);
    equal(v.withKnownPos, 5);
    equal(v.rows[0].mpg, 34);
    equal(v.rows[0].srcRank, null, "Source rank should not exist in canonical imports");
  });


  test("Roster positions render one dropdown per roster spot", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval("cfg.size=5; cfg.rosterSlots=null; openSet()");
      const selects = [...w.document.querySelectorAll('#s_roster_slots select[data-rslot-index]')];
      equal(selects.length,5,"Expected exactly five position dropdowns");
      equal(JSON.stringify(selects.map(x=>x.value)),
        JSON.stringify(["PG","SG","SF","PF","C"]));

      selects.forEach(s=>{
        s.value="C";
        s.dispatchEvent(new Event("change",{bubbles:true}));
      });
      equal(+w.document.getElementById("s_size").value,5,
        "Changing positions must not change Roster spots");
      equal(JSON.stringify([...w.document.querySelectorAll('#s_roster_slots select')].map(x=>x.value)),
        JSON.stringify(["C","C","C","C","C"]));

      w.document.getElementById("s_roster_default").click();
      equal(JSON.stringify([...w.document.querySelectorAll('#s_roster_slots select')].map(x=>x.value)),
        JSON.stringify(["PG","SG","SF","PF","C"]),
        "Reset to Default should restore the default five slots");
      w.document.getElementById("s_close").click();
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("Changing Roster spots changes the number of position dropdowns", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval("cfg.size=5; cfg.rosterSlots=null; openSet()");
      const input = w.document.getElementById("s_size");
      input.value=6;
      input.dispatchEvent(new Event("input",{bubbles:true}));
      const selects=[...w.document.querySelectorAll('#s_roster_slots select[data-rslot-index]')];
      equal(selects.length,6);
      equal(JSON.stringify(selects.map(x=>x.value)),
        JSON.stringify(["PG","SG","G","SF","PF","C"]));
      w.document.getElementById("s_close").click();
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("League setup caps team count at 24 before rendering team-name fields", ()=>{
    const teams = w.document.getElementById("s_teams");
    const slot = w.document.getElementById("s_slot");
    const oldTeams = teams.value, oldSlot = slot.value;
    try{
      equal(teams.max, "24", "Teams input should advertise the 24-team cap");
      teams.value = "5000000";
      slot.value = "5";
      w.paintNameGrid();
      equal(teams.value, "24", "Huge manually typed team counts should be clamped immediately");
      equal(w.document.querySelectorAll("#s_names input[data-n]").length, 24, "Team-name grid must never allocate more than 24 teams");
      equal(slot.max, "24", "Draft-slot control should follow the clamped team count");
    } finally {
      teams.value = oldTeams; slot.value = oldSlot; w.paintNameGrid();
    }
  });

  test("V1 roster-position count objects migrate to slot lists", ()=>{
    const oldSize = w.eval("cfg.size"), oldSlots = w.eval("cfg.rosterSlots");
    w.__oldRosterSlots = oldSlots;
    try{
      w.eval(`cfg.size=5; cfg.rosterSlots={PG:0,SG:0,G:0,SF:0,PF:0,F:0,C:5,UTIL:0,BN:0}; normalizeCfgAfterLoad()`);
      equal(JSON.stringify(w.eval("cfg.rosterSlots")),
        JSON.stringify(["C","C","C","C","C"]));
    } finally {
      w.eval(`cfg.size=${oldSize}; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldRosterSlots;
    }
  });

  test("Loaded league settings sanitize oversized team and roster counts", ()=>{
    const old = {teams:w.eval("cfg.teams"), slot:w.eval("cfg.slot"), size:w.eval("cfg.size"), names:w.eval("cfg.names"), rosterSlots:w.eval("cfg.rosterSlots")};
    try{
      w.__oldNames = old.names; w.__oldRosterSlots = old.rosterSlots;
      w.eval("cfg.rosterSlots=null; cfg.teams=5000000; cfg.slot=5000000; cfg.size=5000000; cfg.names=Array.from({length:30},(_,i)=>'T'+i); normalizeCfgAfterLoad()");
      equal(w.eval("cfg.teams"), 24);
      equal(w.eval("cfg.slot"), 24);
      equal(w.eval("cfg.size"), 20);
      equal(w.eval("cfg.names.length"), 24);
    } finally {
      w.eval(`cfg.teams=${old.teams}; cfg.slot=${old.slot}; cfg.size=${old.size}; cfg.names=window.__oldNames; cfg.rosterSlots=window.__oldRosterSlots`);
      delete w.__oldNames; delete w.__oldRosterSlots;
    }
  });

  test("League setup only closes with Save Setup or Cancel", ()=>{
    const mask = w.document.getElementById("setmask");
    const oldFirstRun = w.eval("firstRun");
    try{
      w.eval("firstRun = false");
      w.openSet();
      assert(mask.classList.contains("on"), "League Setup should be open");

      mask.dispatchEvent(new w.MouseEvent("click", {bubbles:true}));
      assert(mask.classList.contains("on"), "Backdrop click must not close League Setup");

      w.document.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
      assert(mask.classList.contains("on"), "Escape must not close League Setup");

      w.document.getElementById("s_close").click();
      assert(!mask.classList.contains("on"), "Cancel should close League Setup");
    } finally {
      w.eval(`firstRun = ${oldFirstRun ? "true" : "false"}`);
      mask.classList.remove("on");
    }
  });

  test("First-run league setup clearly leads with the two required draft-order settings", ()=>{
    const oldFirstRun = w.eval("firstRun");
    try{
      w.eval("firstRun = true");
      w.openSet();
      const intro = w.document.getElementById("s_intro");
      assert(intro && intro.style.display !== "none", "First-run setup intro should be visible");
      const text = intro.textContent.replace(/\s+/g," ").trim();
      assert(text.includes("First-time setup"), "Expected standalone first-time setup label");
      assert(text.includes("league size") && text.includes("draft slot"), "Expected league size and draft slot guidance");
      assert(text.includes("500-player 2026–27 projection pool"), "Expected bundled projection-pool guidance");
      assert(text.includes("replace it anytime"), "Expected custom-projection guidance");
      equal(w.document.getElementById("s_save").textContent, "Save and continue");
    } finally {
      w.eval(`firstRun = ${oldFirstRun ? "true" : "false"}`);
      w.document.getElementById("setmask").classList.remove("on");
    }
  });

  test("Quick start is standalone and accurately explains the bundled projection pool", ()=>{
    const text = w.document.getElementById("helpmask").textContent.replace(/\s+/g," ").trim();
    assert(!text.includes("Step 2 of 2"), "Quick start should not pretend to be a second step when reopened from the menu");
    assert(text.includes("500-player 2026–27 projection pool"), "Expected bundled projection-pool guidance");
    assert(text.includes("replace it anytime"), "Expected custom-projection guidance");
  });

  test("Quick start explains Total, Fit, and next-pick scarcity in simple language", ()=>{
    const text = w.document.getElementById("helpmask").textContent.replace(/\s+/g," ").trim();
    assert(text.includes("Total") && text.includes("Fit"), "Expected Total and Fit explanation");
    assert(text.includes("unlikely to make it back to your next pick"), "Expected next-pick scarcity explanation");
  });

  test("Team Profile is the user-facing name for the former Category Ledger", ()=>{
    const heading = w.document.getElementById("ledgerbody")?.previousElementSibling?.querySelector("h2");
    assert(heading, "Expected Team Profile heading");
    equal(heading.textContent.trim(), "Team Profile");
    const quick = w.document.getElementById("helpmask").textContent.replace(/\s+/g," ").trim();
    assert(quick.includes("Team Profile"), "Expected Quick start to use Team Profile terminology");
    assert(!quick.includes("Category Ledger"), "Old Category Ledger terminology should be removed from Quick start");
  });

  test("Quick start presents Yahoo + ESPN sync as optional automation", ()=>{
    const text = w.document.getElementById("helpmask").textContent.replace(/\s+/g," ").trim();
    assert(text.includes("Yahoo + ESPN sync is optional"), "Expected optional Yahoo + ESPN sync guidance");
    assert(text.includes("Yahoo or ESPN draft picks"), "Expected both supported draft providers");
    assert(text.includes("Chrome extension"), "Expected Chrome extension explanation");
    assert(text.includes("Manual drafting works normally without the extension"), "Expected manual-draft fallback guidance");
  });

  test("Draft Sync store links use the public Chrome Web Store listing", ()=>{
    const expected = "https://chromewebstore.google.com/detail/ninecat-draft-sync/eigbepgkcbocjpoogdklpckigealbjkc";
    const menuLink = w.document.getElementById("ext_store_link");
    const quickLink = w.document.getElementById("quickstart_ext_link");
    assert(menuLink, "Expected Draft Sync link in the Settings menu");
    assert(quickLink, "Expected install link in Quick start");
    equal(menuLink.href, expected, "Settings menu extension link should use the canonical store URL");
    equal(quickLink.href, expected, "Quick start extension link should use the canonical store URL");
    equal(menuLink.target, "_blank", "Settings link should open in a new tab");
    equal(quickLink.target, "_blank", "Quick start link should open in a new tab");
  });

  test("Quick start Start drafting control closes the onboarding modal", ()=>{
    const mask = w.document.getElementById("helpmask");
    const btn = w.document.getElementById("help_close");
    equal(btn.textContent.trim(), "Start drafting");
    mask.classList.add("on");
    btn.click();
    assert(!mask.classList.contains("on"), "Start drafting should close Quick start");
  });

  test("Completed drafts grade projected matchup wins, not category margin", ()=>{
    const old = {teams:w.eval("cfg.teams"), size:w.eval("cfg.size"), slot:w.eval("cfg.slot")};
    w.__shareOldPicks = w.eval("picks");
    w.__shareOldLocks = w.eval("locks");
    try{
      w.eval(`cfg.teams=4; cfg.size=5; cfg.slot=1;
        picks=pool.slice(0,20).map((p,i)=>({playerId:p.id,teamIdx:teamOnClock(i),overall:i}));
        locks={fg:"punt"};`);
      const s = w.ninecatDraftShareSummary();
      assert(/^(S\+|S|[A-F][+-]?)$/.test(s.grade), "Expected S+/S or a letter draft grade");
      assert(Number.isFinite(s.winRate), "Expected a projected matchup win rate");
      equal(s.opponents, 3, "A 4-team league should grade against three opponents");
      equal(s.categories.length, 9, "Standard 9-cat should report all nine categories");
      equal(s.roster.length, 5, "Share card should include the full drafted roster");
      assert(s.punted.some(c=>c.label==="FG%"), "Expected manual punts on the share card");
      const copy = w.ninecatDraftShareText(s);
      assert(copy.includes("projected to beat"), "Expected field win-rate language in share copy");
      assert(copy.includes("Think you can beat it?"), "Expected challenge language in share copy");
      assert(copy.includes("/s/?d="), "Expected a self-contained fallback share URL");
      const shortCopy = w.ninecatDraftShareText(s, "https://9cat.fyi/s/3d6b8504");
      assert(shortCopy.includes("https://9cat.fyi/s/3d6b8504"), "Expected short share URL support");
    } finally {
      w.eval(`cfg.teams=${old.teams}; cfg.size=${old.size}; cfg.slot=${old.slot}; picks=window.__shareOldPicks; locks=window.__shareOldLocks`);
      delete w.__shareOldPicks; delete w.__shareOldLocks;
    }
  });

  test("Share grading uses the configured overall win-rate scale", ()=>{
    equal(w.ninecatDraftGrade(100), "S+", "100% should be S+");
    equal(w.ninecatDraftGrade(99.9), "S", "Anything below 100% should fall below S+");
    equal(w.ninecatDraftGrade(90), "S", "90% should be S");
    equal(w.ninecatDraftGrade(80), "A+", "80% should be A+");
    equal(w.ninecatDraftGrade(70), "A", "70% should be A");
    equal(w.ninecatDraftGrade(60), "B", "60% should be B");
    equal(w.ninecatDraftGrade(50), "C", "50% should be C");
    equal(w.ninecatDraftGrade(40), "D", "40% should be D");
    equal(w.ninecatDraftGrade(39.9), "F", "Below 40% should be F");
  });

  test("Draft share popup includes win rate, full roster, share link, download, and close controls", ()=>{
    const mask = w.document.getElementById("sharemask");
    assert(mask, "Expected end-of-draft share modal");
    assert(w.document.getElementById("share_card"), "Expected share-card preview");
    assert(w.document.getElementById("share_winrate"), "Expected projected win rate on the card");
    assert(w.document.getElementById("share_roster"), "Expected full roster on the card");
    equal(w.document.getElementById("share_download").textContent.trim(), "Download card");
    equal(w.document.getElementById("share_copy").textContent.trim(), "Copy share");
    assert(w.document.getElementById("share_close"), "Expected explicit share-card close control");
    equal(w.document.getElementById("share_close_reset").textContent.trim(), "Close and reset draft");
  });

  test("Draft share popup ignores backdrop clicks and Escape", ()=>{
    const mask = w.document.getElementById("sharemask");
    const close = w.document.getElementById("share_close");
    mask.classList.add("on");
    mask.dispatchEvent(new w.MouseEvent("click", {bubbles:true, cancelable:true}));
    assert(mask.classList.contains("on"), "Backdrop click should not close Draft Share");
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", {key:"Escape", bubbles:true, cancelable:true}));
    assert(mask.classList.contains("on"), "Escape should not close Draft Share");
    close.click();
    assert(!mask.classList.contains("on"), "Explicit close button should close Draft Share");
  });

  test("Close and reset draft clears picks and closes the share popup", ()=>{
    const mask = w.document.getElementById("sharemask");
    const old = {
      teams:w.eval("cfg.teams"),
      size:w.eval("cfg.size"),
      slot:w.eval("cfg.slot"),
      picks:w.eval("picks")
    };
    w.__shareResetOldPicks = old.picks;
    try{
      w.eval(`cfg.teams=4; cfg.size=5; cfg.slot=1; picks=pool.slice(0,20).map((p,i)=>({playerId:p.id,teamIdx:teamOnClock(i),overall:i}));`);
      mask.classList.add("on");
      assert(typeof w.ninecatCloseAndResetDraftShare === "function", "Expected reset action to be exported");
      w.document.getElementById("share_close_reset").click();
      equal(w.eval("picks.length"), 0, "Expected Close and reset draft to clear all picks");
      assert(!mask.classList.contains("on"), "Expected Close and reset draft to close the popup");
    } finally {
      w.eval(`cfg.teams=${old.teams}; cfg.size=${old.size}; cfg.slot=${old.slot}; picks=window.__shareResetOldPicks;`);
      delete w.__shareResetOldPicks;
      w.render();
    }
  });

  test("Draft share auto-opens once per completion cycle", async ()=>{
    const mask = w.document.getElementById("sharemask");
    const old = {teams:w.eval("cfg.teams"), size:w.eval("cfg.size"), slot:w.eval("cfg.slot")};
    w.__shareCycleOldPicks = w.eval("picks");
    try{
      mask.classList.remove("on");
      w.eval(`cfg.teams=4; cfg.size=5; cfg.slot=1; picks=pool.slice(0,19).map((p,i)=>({playerId:p.id,teamIdx:teamOnClock(i),overall:i}));`);
      w.ninecatMaybeShowDraftShare();
      await new Promise(r=>setTimeout(r,110));
      assert(!mask.classList.contains("on"), "Incomplete draft should not auto-open share");

      w.eval(`picks=pool.slice(0,20).map((p,i)=>({playerId:p.id,teamIdx:teamOnClock(i),overall:i}));`);
      w.ninecatMaybeShowDraftShare();
      await new Promise(r=>setTimeout(r,110));
      assert(mask.classList.contains("on"), "Completing the draft should auto-open share");

      w.document.getElementById("share_close").click();
      w.ninecatMaybeShowDraftShare();
      await new Promise(r=>setTimeout(r,110));
      assert(!mask.classList.contains("on"), "Share should not reopen repeatedly while the same draft remains complete");

      // Dropping below complete starts a new completion cycle, even if the exact
      // same picks are later restored. This is the mock/re-draft regression.
      w.eval(`picks=pool.slice(0,19).map((p,i)=>({playerId:p.id,teamIdx:teamOnClock(i),overall:i}));`);
      w.ninecatMaybeShowDraftShare();
      w.eval(`picks=pool.slice(0,20).map((p,i)=>({playerId:p.id,teamIdx:teamOnClock(i),overall:i}));`);
      w.ninecatMaybeShowDraftShare();
      await new Promise(r=>setTimeout(r,110));
      assert(mask.classList.contains("on"), "A new completion cycle should auto-open even for an identical final roster");
    } finally {
      mask.classList.remove("on");
      w.eval(`cfg.teams=${old.teams}; cfg.size=${old.size}; cfg.slot=${old.slot}; picks=window.__shareCycleOldPicks`);
      delete w.__shareCycleOldPicks;
      // Re-arm the production completion detector for the restored test state.
      w.ninecatMaybeShowDraftShare();
    }
  });

  test("Run-risk dots persist when the board is sorted by another column", ()=>{
    const oldQ = w.document.getElementById("q").value;
    const oldPos = w.eval("posFilter");
    const oldSort = w.eval("sortKey");
    const oldDir = w.eval("sortDir");
    const oldCfg = {
      teams:w.eval("cfg.teams"),
      size:w.eval("cfg.size"),
      slot:w.eval("cfg.slot")
    };
    w.__riskDotOldPicks = w.eval("picks");
    try{
      w.document.getElementById("q").value = "";
      w.eval('posFilter = "ALL"; sortKey = "adp"; sortDir = 1; cfg.teams=4; cfg.size=5; cfg.slot=1; picks=[];');
      const result = w.eval(`(()=>{
        const base = pool[0];
        const mock = Array.from({length:20}, (_,i)=>({
          ...base,
          id:910000+i,
          name:"Risk Sort Test "+i,
          fitAdj:20-i,
          fitDisplay:20-i,
          total:20-i,
          valRank:i+1,
          adp:i+1,
          rosterFit:true,
          risk:i<3 ? 0.9 : 0
        }));
        renderBoard({avail:mock});
        return {
          dots:document.querySelectorAll("#board .risk-dot").length,
          ids:[...document.querySelectorAll("#board tr[data-id] .risk-dot")].map(dot=>+dot.closest("tr").dataset.id)
        };
      })()`);
      equal(result.dots, 3, "Expected the same three risk warnings after sorting by ADP");
      assert(result.ids.includes(910000) && result.ids.includes(910001) && result.ids.includes(910002),
        "Expected risk dots to stay attached to the Fit-eligible players");
    } finally {
      w.document.getElementById("q").value = oldQ;
      w.eval(`posFilter=${JSON.stringify(oldPos)}; sortKey=${JSON.stringify(oldSort)}; sortDir=${oldDir};
        cfg.teams=${oldCfg.teams}; cfg.size=${oldCfg.size}; cfg.slot=${oldCfg.slot}; picks=window.__riskDotOldPicks;`);
      delete w.__riskDotOldPicks;
      w.render();
    }
  });

  test("Player board is not capped at 80 available players", ()=>{
    const oldQ = w.document.getElementById("q").value;
    const oldPos = w.eval("posFilter");
    try{
      w.document.getElementById("q").value = "";
      w.eval('posFilter = "ALL"');
      const count = w.eval(`(()=>{
        const base = pool[0];
        const mock = Array.from({length:120}, (_,i)=>({
          ...base, id:900000+i, name:"Board Test "+i, fitAdj:120-i,
          total:120-i, valRank:i+1, rosterFit:true, risk:0
        }));
        renderBoard({avail:mock});
        return document.querySelectorAll("#board tr[data-id]").length;
      })()`);
      equal(count, 120, "Expected all 120 available players to render; board is still capped");
    } finally {
      w.document.getElementById("q").value = oldQ;
      w.eval(`posFilter = ${JSON.stringify(oldPos)}`);
      w.render();
    }
  });

}

async function run(){
  if(testRunInProgress) return;
  testRunInProgress = true;
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
  testRunInProgress = false;
}

frame.addEventListener("load",()=>setTimeout(run,150));
rerun.addEventListener("click",run);

// Attach the load listener before navigating the iframe. On a fast/cached
// Netlify preview the old harness could miss the iframe's load event and sit
// forever on "Loading nineCat…".
frame.src = "../index.html?v=share-autopopup-fix-1";

// Fallback in case a browser restores the frame unusually quickly.
setTimeout(()=>{
  if(summaryEl.textContent === "Loading nineCat…"){
    try{
      if(frame.contentDocument && frame.contentDocument.readyState === "complete") run();
    }catch(_e){}
  }
}, 1200);
