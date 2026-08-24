"use strict";

/* ============================================================
   PROJECTION + PLAYER DATA LOGIC

   The bundled current-season projection sample and 2025–26 historical
   actuals now live under /data. A user-pasted projection pool still
   overrides the bundled sample exactly as before.

   Historical actuals source: BoxScore Lab (CC BY 4.0).
   Data through August 9, 2026.
   ============================================================ */
/* ============================================================
   DATASETS

   Bundled projection and historical datasets now live in /data so
   seasonal data can be updated independently from parser logic.
   They are loaded before this file and expose the existing RAW and
   RAW_LAST bindings, preserving current app behavior.
   ============================================================ */

/* ============================================================
   CONFIG
   ============================================================ */
const CATS = [
  {k:"fg",  label:"FG%", pct:true},
  {k:"ft",  label:"FT%", pct:true},
  {k:"tpm", label:"3PM"},
  {k:"pts", label:"PTS"},
  {k:"reb", label:"REB"},
  {k:"ast", label:"AST"},
  {k:"stl", label:"STL"},
  {k:"blk", label:"BLK"},
  {k:"to",  label:"TO",  neg:true}
];

/* ============================================================
   PROJECTION PARSING + PLAYER MATCHING
   ============================================================ */
/*  Header-driven column mapping. Reads whatever header row the source gives
    us and maps it by name, so ESPN (PTS last, FGM/FGA combined), Hashtag
    (paren percentage cells) and plain CSV all land in the same shape.
    Falls back to anchor detection when there's no usable header.          */
const HDR = {
  rank:["r#","rk","rank","#","no","pos rank"],
  name:["player","name","players","player name"],
  adp:["adp","avg pick","average pick"],
  pos: ["pos","position","positions"],
  team:["team","tm"],
  gp:  ["gp","g","games","games played"],
  fg:  ["fg%","fg","fgm/fga","fg made/att","fgm/a","fgm-fga"],
  fgm: ["fgm","fg made"], fga:["fga","fg att"],
  ft:  ["ft%","ft","ftm/fta","ft made/att","ftm/a","ftm-fta"],
  ftm: ["ftm","ft made"], fta:["fta","ft att"],
  tpm: ["3pm","3ptm","3s","threes","3p","3pm/3pa","3pt","3ptm/3pta","3pm-3pa"],
  pts: ["pts","points","pt"],
  reb: ["reb","treb","rebs","rebounds","tr","trb"],
  ast: ["ast","asts","assists"],
  stl: ["stl","steals","st"],
  blk: ["blk","blocks","bs"],
  to:  ["to","tov","turnovers","turnover","tos"],
  pid: ["player-additional","player_additional","playeradditional","player id","slug"]
};

const PAREN = /^([\d.]+)\s*%?\s*\(\s*([\d.]+)\s*[\/\-]\s*([\d.]+)\s*\)$/;
const MADEATT = /^([\d.]+)\s*[\/\-]\s*([\d.]+)$/;
const POSRE = /^(PG|SG|SF|PF|C|G|F)([\/,\-](PG|SG|SF|PF|C|G|F))*$/i;

const norm = s => String(s).toLowerCase().trim().replace(/\*+$/,"").replace(/\s+/g," ");

/*  Accent folding. NFD splits most accented letters into base + combining mark,
    which we then drop — but a handful of letters have no decomposition and must
    be mapped by hand, or they vanish and the name never matches.
    Jokić -> jokic, Dončić -> doncic, Šengün -> sengun, Đoković -> dokovic.     */
const FOLD = {"đ":"d","ø":"o","ł":"l","ß":"ss","æ":"ae","œ":"oe","ı":"i","ð":"d","þ":"th","ħ":"h","ŋ":"n"};
function fold(s){
  return String(s).normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[đøłßæœıðþħŋ]/g, ch => FOLD[ch] || ch);
}

// Tokens with punctuation and generational suffixes removed.
function nameParts(s){
  return fold(s)
    .replace(/[^a-z ]/g, " ")
    .replace(/\b(jr|sr|ii|iii|iv)\b/g, " ")
    .replace(/\s+/g, " ").trim()
    .split(" ").filter(Boolean);
}
const nameKey = s => nameParts(s).join("");
// Fallback key: surname + first initial, for Nic/Nicolas, Cam/Cameron, Herb/Herbert.
function lastKey(s){
  const t = nameParts(s);
  return t.length > 1 ? t[t.length-1] + "|" + t[0][0] : (t[0] || "");
}

/*  Sites render a full name and an abbreviated one in the same cell, and ESPN
    tacks team + position on the end. Strip both, but never to nothing.      */
/*  Team abbreviations differ by source (NO/NOP, PHO/PHX, GS/GSW...). Matching a
    real list rather than "any 2-3 capitals" matters: the naive version turns
    "Trey Murphy IIINO SG/SF" into "Trey Murphy II" by eating an I.            */
const TEAMS = ["ATL","BKN","BRK","BOS","CHA","CHO","CHI","CLE","DAL","DEN","DET","GS","GSW",
  "HOU","IND","LAC","LAL","MEM","MIA","MIL","MIN","NO","NOP","NOH","NY","NYK","OKC","ORL",
  "PHI","PHO","PHX","POR","SA","SAS","SAC","TOR","UTA","UTAH","WAS","WSH"]
  .sort((a,b)=>b.length-a.length);
const POSALT = "(?:PG|SG|SF|PF|C)";
const TEAMPOS = new RegExp(
  `\\s*(?:${TEAMS.join("|")})\\s+${POSALT}(?:\\s*[,\\/]\\s*${POSALT})*\\s*$`);

function cleanName(s){
  let n = String(s).trim();
  const noTeam = n.replace(TEAMPOS, "").trim();
  if(noTeam.length >= 3) n = noTeam;
  const noAbbrev = n.replace(/\s*[A-Z]\.[A-Za-z'’\-. ]+$/, "").trim();
  if(noAbbrev.length >= 3) n = noAbbrev;
  return n.trim();
}

function splitRow(line){
  let l = line.trim().replace(/^\|/,"").replace(/\|$/,"");
  if(l.includes("\t"))  return l.split("\t").map(s=>s.trim());
  if(l.includes("|"))   return l.split("|").map(s=>s.trim());

  // Quoted CSV: honour quotes, and don't split inside "(10.5/18.3)".
  if(l.includes('"')){
    const out = []; let cur = "", q = false;
    for(let i = 0; i < l.length; i++){
      const ch = l[i];
      if(ch === '"'){
        if(q && l[i+1] === '"'){ cur += '"'; i++; }
        else q = !q;
      }
      else if(ch === "," && !q){ out.push(cur.trim()); cur = ""; }
      else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  if(/\s{2,}/.test(l)) return l.split(/\s{2,}/).map(s=>s.trim());
  return l.split(/,(?![^(]*\))/).map(s=>s.trim());
}

function mapHeader(cells){
  const map = {};
  cells.forEach((cell,i)=>{
    const n = norm(cell);
    for(const key in HDR){
      if(map[key] !== undefined) continue;
      if(HDR[key].includes(n)){ map[key] = i; break; }
    }
  });

  /*  Basketball Reference calls the makes column plain "FG" / "FT" and puts
      attempts in "FGA" / "FTA". Elsewhere "FG" means a rate or a combined
      cell. If attempts have their own column, "FG" must be makes.          */
  ["fg","ft"].forEach(k=>{
    const att = k + "a", made = k + "m";
    if(map[att] !== undefined && map[made] === undefined && map[k] !== undefined){
      map[made] = map[k];
      delete map[k];
    }
  });

  const usable = map.name !== undefined &&
                 (map.pts !== undefined || map.reb !== undefined || map.ast !== undefined);
  return usable ? map : null;
}

/*  Traded players appear once per team plus a combined "2TM"/"3TM" row.
    The combined row has the most games, so keeping max-GP per name gives
    the full-season line rather than a partial stint.                      */
function dedupe(rows){
  const best = new Map();
  rows.forEach(r=>{
    const k = nameKey(r.name);
    const prev = best.get(k);
    if(!prev || (r.gp||0) > (prev.gp||0)) best.set(k, r);
  });
  const out = [...best.values()];
  out.forEach((r,i)=> r.id = i);
  return out;
}

function num(s){
  const v = parseFloat(String(s).replace(/[^\d.\-]/g,""));
  return isNaN(v) ? 0 : v;
}

// Pull made/attempted out of a cell in any of the three shapes we see.
function volume(cell){
  if(cell === undefined) return null;
  const s = String(cell).trim();
  let m = s.match(PAREN);   if(m) return {made:num(m[2]), att:num(m[3])};
  m = s.match(MADEATT);     if(m) return {made:num(m[1]), att:num(m[2])};
  return null;
}

function parsePool(text){
  const lines = String(text).trim().split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const out = [], skipped = [];
  let map = null;

  for(const line of lines){
    if(/^[-|\s:]+$/.test(line)) continue;
    const c = splitRow(line).filter((x,i,arr)=> !(x === "" && i === arr.length-1));
    if(c.length < 6) continue;

    // Header rows repeat every dozen lines on some sites — re-read, never parse.
    const asHeader = mapHeader(c);
    if(asHeader){ map = asHeader; continue; }

    let rec = null;

    /* ---- mapped columns ---- */
    if(map){
      const at = k => map[k] !== undefined ? c[map[k]] : undefined;
      const fgv = volume(at("fg")) || (map.fgm !== undefined
                    ? {made:num(at("fgm")), att:num(at("fga"))} : null);
      const ftv = volume(at("ft")) || (map.ftm !== undefined
                    ? {made:num(at("ftm")), att:num(at("fta"))} : null);
      if(!fgv || !fgv.att) { skipped.push(line); continue; }

      const posCell = at("pos");
      rec = {
        name: cleanName(at("name") || ""),
        pos:  posCell && POSRE.test(posCell) ? posCell.toUpperCase().split(/[\/,\-]/) : ["UTIL"],
        team: at("team") || "—",
        gp:   map.gp !== undefined ? Math.round(num(at("gp"))) : null,
        adp:  map.adp !== undefined ? num(at("adp")) : null,
        srcRank: map.rank !== undefined ? num(at("rank")) : null,
        fgm:fgv.made, fga:fgv.att,
        ftm:ftv?ftv.made:0, fta:ftv?ftv.att:0,
        tpm:num(volume(at("tpm"))?volume(at("tpm")).made:at("tpm")),
        pts:num(at("pts")), reb:num(at("reb")), ast:num(at("ast")),
        stl:num(at("stl")), blk:num(at("blk")), to:num(at("to")),
        pid:  map.pid !== undefined ? String(at("pid")||"").trim() : ""
      };
    }

    /* ---- no header: anchor on paren percentage cells ---- */
    else {
      const pIdx = c.map((x,i)=>PAREN.test(x)?i:-1).filter(i=>i>=0);
      if(pIdx.length >= 2){
        const fg = c[pIdx[0]].match(PAREN), ft = c[pIdx[1]].match(PAREN);
        const tail = c.slice(pIdx[1]+1).filter(x=>/^-?[\d.]+$/.test(x)).map(num);
        if(tail.length < 7){ skipped.push(line); continue; }
        const posI = c.findIndex((x,i)=> i < pIdx[0] && POSRE.test(x));
        const head = c.slice(0, pIdx[0]);
        const mid  = c.slice(posI+1, pIdx[0]).filter(x=>/^[\d.]+$/.test(x)).map(num);
        const nums = head.filter(x=>/^[\d.]+$/.test(x)).map(num);
        rec = {
          name: cleanName(head.find(x=>/[A-Za-z]{3,}/.test(x) && !POSRE.test(x)) || ""),
          pos:  posI>=0 ? c[posI].toUpperCase().split(/[\/,\-]/) : ["UTIL"],
          team: posI>=0 ? (c[posI+1]||"—") : "—",
          gp:   mid.length ? Math.round(mid[0]) : null,
          srcRank: nums.length ? nums[0] : null,
          adp:  nums.length > 1 ? nums[1] : null,
          fgm:num(fg[2]), fga:num(fg[3]), ftm:num(ft[2]), fta:num(ft[3]),
          tpm:tail[0], pts:tail[1], reb:tail[2], ast:tail[3],
          stl:tail[4], blk:tail[5], to:tail[6]
        };
      }
      /* ---- plain positional fallback ---- */
      else if(c.length >= 14 && /^[\d.]+$/.test(c[3])){
        rec = {
          name:cleanName(c[0]), pos:c[1].toUpperCase().split(/[\/,]/), team:c[2],
          fgm:num(c[3]), fga:num(c[4]), ftm:num(c[5]), fta:num(c[6]),
          tpm:num(c[7]), pts:num(c[8]), reb:num(c[9]), ast:num(c[10]),
          stl:num(c[11]), blk:num(c[12]), to:num(c[13]),
          adp: c[14]!==undefined?num(c[14]):null,
          gp:  c[15]!==undefined?Math.round(num(c[15])):null,
          srcRank:null
        };
      }
      else { skipped.push(line); continue; }
    }

    if(!rec || !rec.name || rec.name.length < 2 || rec.fga <= 0){ skipped.push(line); continue; }
    rec.pos = rec.pos.map(s=>s.trim()).filter(Boolean);
    if(!rec.pos.length) rec.pos = ["UTIL"];
    rec.id = out.length;
    out.push(rec);
  }

  parsePool.skipped = skipped;
  return out;
}

/*  Match an imported set onto the pool. Two tiers: exact folded name, then
    surname + first initial — but only when that key is unique on BOTH sides,
    so "Keon Johnson" never silently absorbs "Kevin Johnson".               */
function attachLast(rows){
  const exact = new Map(), loose = new Map(), dupSrc = new Set();
  rows.forEach(r=>{
    exact.set(nameKey(r.name), r);
    const lk = lastKey(r.name);
    if(loose.has(lk)) dupSrc.add(lk); else loose.set(lk, r);
  });

  const poolCount = new Map();
  pool.forEach(p=>{ const lk = lastKey(p.name); poolCount.set(lk, (poolCount.get(lk)||0)+1); });

  let hit = 0, fuzzy = 0; const missed = [];
  pool.forEach(p=>{
    let m = exact.get(nameKey(p.name));
    if(!m){
      const lk = lastKey(p.name);
      if(!dupSrc.has(lk) && poolCount.get(lk) === 1){
        const candidate = loose.get(lk);
        if(candidate){
          const a = nameParts(p.name)[0] || "";
          const b = nameParts(candidate.name)[0] || "";
          if(a.startsWith(b) || b.startsWith(a)){
            m = candidate;
            fuzzy++;
          }
        }
      }
    }
    p.last = m || null;
    if(m && m.pid && !p.pid) p.pid = m.pid;   // photo id rides along with the actuals
    if(m) hit++; else missed.push(p.name);
  });

  attachLast.fuzzy = fuzzy;
  attachLast.missed = missed;

  /*  Score the matched actuals as their own population. Colouring last season's
      numbers by this season's projected z would be a lie — a player whose role
      changed would show the wrong sign. Only matched rows are scored, so the
      comparison population is the same 190-odd players either way.           */
  const used = pool.map(p=>p.last).filter(Boolean);
  if(used.length) scoreBoth(used);

  return hit;
}
