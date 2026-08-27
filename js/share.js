"use strict";

/* ============================================================
   DRAFT SHARE CARD — v2

   The grade is based on projected head-to-head matchup win rate against the
   rest of the league. A 5-4 matchup win and an 8-1 matchup win both count as
   one win. Share links are self-contained in the URL; no draft data is sent
   to or stored by nineCat.
   ============================================================ */

const SHARE_SHOWN_KEY = "ninecat.sharecard.lastShown.v2";
let sharePendingSig = null;

function draftShareSignature(){
  let h = 2166136261;
  const parts = [cfg.teams, cfg.size, cfg.slot]
    .concat(picks.map(pk=>`${pk.overall}:${pk.teamIdx}:${pk.playerId ?? pk.unknownName ?? "?"}`));
  const s = parts.join("|");
  for(let i=0;i<s.length;i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `${cfg.teams}-${cfg.size}-${(h>>>0).toString(36)}`;
}

function draftGrade(winRate){
  if(winRate >= 100) return "S+";
  if(winRate >= 90) return "S";
  if(winRate >= 80) return "A+";
  if(winRate >= 70) return "A";
  if(winRate >= 60) return "B";
  if(winRate >= 50) return "C";
  if(winRate >= 40) return "D";
  return "F";
}

function draftFieldRecord(rosters, mine){
  const myRoster = rosters[mine] || [];
  let wins = 0, losses = 0, ties = 0;
  const matchups = [];

  rosters.forEach((roster,i)=>{
    if(i === mine) return;
    const m = compareTeams(myRoster, roster || [], CATS, cw);
    if(m.verdict === "win") wins++;
    else if(m.verdict === "lose") losses++;
    else ties++;
    matchups.push({teamIdx:i, won:m.won, lost:m.lost, tied:m.tied, verdict:m.verdict});
  });

  const opponents = matchups.length;
  const winRate = opponents ? 100 * (wins + ties * 0.5) / opponents : 50;
  return {wins, losses, ties, opponents, winRate, matchups};
}

function draftShareSummary(){
  const rosters = allRosters();
  const mine = myTeamIdx();
  const mineRoster = rosters[mine] || [];
  const myZ = teamZ(mineRoster);
  const activeCats = CATS.filter(c=>cw(c.k) > 0.05);
  const teams = Math.max(1, cfg.teams);
  const quartile = Math.max(1, Math.ceil(teams / 4));
  const field = draftFieldRecord(rosters, mine);

  const mineSize = Math.max(1, mineRoster.length);
  const categories = activeCats.map(c=>{
    const rank = 1 + rosters.reduce((n,r,i)=>{
      if(i === mine) return n;
      return n + (teamZ(r)[c.k] > myZ[c.k] ? 1 : 0);
    }, 0);
    const percentile = teams > 1 ? 100 * (teams - rank) / (teams - 1) : 50;
    const profile = myZ[c.k] / mineSize;
    return {k:c.k, label:c.label, rank, percentile, profile, punted:locks[c.k] === "punt"};
  });

  const strong = categories
    .filter(c=>!c.punted && c.rank <= quartile && c.profile >= 0.35)
    .sort((a,b)=>a.rank-b.rank || b.percentile-a.percentile)
    .slice(0,3);
  const weak = categories
    .filter(c=>!c.punted && c.rank > teams - quartile && c.profile <= -0.35)
    .sort((a,b)=>b.rank-a.rank || a.percentile-b.percentile)
    .slice(0,3);
  const punted = categories.filter(c=>c.punted).sort((a,b)=>a.rank-b.rank);

  return {
    grade:draftGrade(field.winRate),
    winRate:field.winRate,
    wins:field.wins,
    losses:field.losses,
    ties:field.ties,
    opponents:field.opponents,
    matchups:field.matchups,
    teams,
    rounds:cfg.size,
    strong,
    weak,
    punted,
    categories,
    roster:mineRoster.map(p=>({name:p.name, team:p.team || "", pos:Array.isArray(p.pos) ? p.pos.join("/") : String(p.pos || "")}))
  };
}

function shareRankText(c){ return `${c.label} #${c.rank}`; }
function roundedWinRate(s){ return Math.round(s.winRate); }
function fieldRecordText(s){
  if(!s.opponents) return "No opponents";
  if(s.ties) return `${s.wins}-${s.losses}-${s.ties} vs field`;
  return `${s.wins}-${s.losses} vs field`;
}

function sharePayload(summary=draftShareSummary()){
  return {
    v:2,
    g:summary.grade,
    wr:Math.round(summary.winRate * 10) / 10,
    w:summary.wins,
    l:summary.losses,
    t:summary.ties,
    tm:summary.teams,
    r:summary.rounds,
    s:summary.strong.map(c=>[c.label,c.rank]),
    wk:summary.weak.map(c=>[c.label,c.rank]),
    p:summary.punted.map(c=>c.label),
    ro:summary.roster.map(p=>[p.name,p.team,p.pos])
  };
}

function encodeSharePayload(payload){
  const json = JSON.stringify(payload);
  const bytes = new TextEncoder().encode(json);
  let binary = "";
  for(let i=0;i<bytes.length;i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");
}

function draftShareUrl(summary=draftShareSummary()){
  const origin = (location && location.origin && location.origin !== "null") ? location.origin : "https://9cat.fyi";
  return `${origin}/s/?d=${encodeSharePayload(sharePayload(summary))}`;
}

function gradeArticle(grade){ return /^[AFS]/.test(String(grade)) ? "an" : "a"; }

function draftShareText(summary=draftShareSummary()){
  return [
    `I just drafted ${gradeArticle(summary.grade)} ${summary.grade} team on nineCat — projected to beat ${roundedWinRate(summary)}% of the field. Think you can beat it?`,
    draftShareUrl(summary)
  ].join("\n");
}

function sharePills(items, kind, emptyText){
  if(!items.length) return `<span class="share-empty">${emptyText}</span>`;
  return items.map(c=>`<span class="share-pill ${kind}"><b>${c.label}</b>${kind === "punt" ? "" : `<span>#${c.rank}</span>`}</span>`).join("");
}

function shareRosterRows(roster){
  if(!roster.length) return `<span class="share-empty">No roster found</span>`;
  return roster.map((p,i)=>`<span class="share-roster-player"><i>${i+1}</i><b>${p.name}</b><small>${[p.pos,p.team].filter(Boolean).join(" · ")}</small></span>`).join("");
}

function paintDraftShare(){
  const s = draftShareSummary();
  const grade = document.getElementById("share_grade");
  if(!grade) return s;
  grade.textContent = s.grade;
  document.getElementById("share_meta").textContent = `${s.teams}-team league · ${s.rounds} rounds`;
  document.getElementById("share_winrate").textContent = `${roundedWinRate(s)}%`;
  document.getElementById("share_record").textContent = fieldRecordText(s);
  document.getElementById("share_strong").innerHTML = sharePills(s.strong, "strong", "No standout strengths");
  document.getElementById("share_weak").innerHTML = sharePills(s.weak, "weak", "No major weaknesses");
  document.getElementById("share_punts").innerHTML = sharePills(s.punted, "punt", "No punts");
  document.getElementById("share_roster").innerHTML = shareRosterRows(s.roster);
  return s;
}

function openDraftShare(opts={}){
  if(picks.length < cfg.teams * cfg.size) return false;
  paintDraftShare();
  const mask = document.getElementById("sharemask");
  if(!mask) return false;
  mask.classList.add("on");
  if(opts.auto){
    try{ localStorage.setItem(SHARE_SHOWN_KEY, draftShareSignature()); }catch(e){}
  }
  window.ninecatTrack?.("draft_share_opened", {source:opts.auto ? "completion" : "manual"});
  return true;
}

function closeDraftShare(){
  document.getElementById("sharemask")?.classList.remove("on");
}

function maybeShowDraftShare(){
  if(picks.length !== cfg.teams * cfg.size) return;
  const sig = draftShareSignature();
  let shown = "";
  try{ shown = localStorage.getItem(SHARE_SHOWN_KEY) || ""; }catch(e){}
  if(shown === sig || sharePendingSig === sig) return;
  sharePendingSig = sig;
  setTimeout(()=>{
    const stillComplete = picks.length === cfg.teams * cfg.size;
    const sameDraft = draftShareSignature() === sig;
    sharePendingSig = null;
    if(stillComplete && sameDraft) openDraftShare({auto:true});
  }, 80);
}

function roundRect(ctx,x,y,w,h,r){
  const rr = Math.min(r,w/2,h/2);
  ctx.beginPath();
  ctx.moveTo(x+rr,y); ctx.arcTo(x+w,y,x+w,y+h,rr); ctx.arcTo(x+w,y+h,x,y+h,rr);
  ctx.arcTo(x,y+h,x,y,rr); ctx.arcTo(x,y,x+w,y,rr); ctx.closePath();
}

function fitText(ctx, text, maxWidth, maxSize, minSize, weight, family){
  let size = maxSize;
  while(size > minSize){
    ctx.font = `${weight} ${size}px ${family}`;
    if(ctx.measureText(text).width <= maxWidth) break;
    size--;
  }
  return size;
}

function drawDraftShareCard(summary=draftShareSummary()){
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext("2d");
  const C = {bg:"#171D26", panel:"#202834", line:"#36434F", chalk:"#EEF3F9", dim:"#A6B3C3", dim2:"#7E8C9E", wood:"#D4A059", ok:"#5CC489", hot:"#FF8DA1"};

  ctx.fillStyle = C.bg; ctx.fillRect(0,0,1200,630);
  ctx.fillStyle = C.wood; ctx.fillRect(0,0,1200,8);

  ctx.fillStyle = C.wood;
  ctx.font = '700 27px "Saira Condensed", Arial Narrow, sans-serif';
  ctx.fillText("NINECAT", 64, 67);
  ctx.fillStyle = C.chalk;
  ctx.font = '900 50px "Saira Condensed", Arial Narrow, sans-serif';
  ctx.fillText("MY DRAFT", 64, 117);
  ctx.textAlign="right"; ctx.fillStyle=C.dim; ctx.font='500 19px "IBM Plex Sans", Arial, sans-serif';
  ctx.fillText(`${summary.teams}-team league · ${summary.rounds} rounds`,1136,88); ctx.textAlign="left";

  // Grade / field-win block.
  roundRect(ctx,64,158,280,370,12); ctx.fillStyle=C.panel; ctx.fill(); ctx.strokeStyle=C.line; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle=C.dim; ctx.font='600 20px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("DRAFT GRADE",94,204);
  ctx.fillStyle=C.wood;
  const gSize = fitText(ctx, summary.grade, 210, 150, 105, 900, '"Saira Condensed", Arial Narrow, sans-serif');
  ctx.font=`900 ${gSize}px "Saira Condensed", Arial Narrow, sans-serif`; ctx.fillText(summary.grade,92,346);
  ctx.fillStyle=C.chalk; ctx.font='800 37px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(`${roundedWinRate(summary)}%`,94,413);
  ctx.fillStyle=C.dim; ctx.font='500 17px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("PROJECTED WIN RATE",94,440);
  ctx.fillStyle=C.dim2; ctx.font='500 17px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(fieldRecordText(summary),94,474);
  ctx.font='500 14px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("5-4 and 8-1 wins count the same",94,503);

  // Strength / weakness / punt summary.
  const sections = [
    {title:"STRONG", items:summary.strong, color:C.ok, x:390, rank:true, empty:"No standout strengths"},
    {title:"WEAK", items:summary.weak, color:C.hot, x:620, rank:true, empty:"No major weaknesses"},
    {title:"PUNT", items:summary.punted, color:C.wood, x:850, rank:false, empty:"No punts"}
  ];
  sections.forEach(sec=>{
    ctx.fillStyle=sec.color; ctx.font='700 17px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(sec.title,sec.x,180);
    if(!sec.items.length){
      ctx.fillStyle=C.dim2; ctx.font='500 14px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(sec.empty,sec.x,211); return;
    }
    sec.items.slice(0,3).forEach((item,i)=>{
      const y=195+i*42;
      roundRect(ctx,sec.x,y,190,32,6); ctx.fillStyle=C.panel; ctx.fill(); ctx.strokeStyle=C.line; ctx.lineWidth=1.5; ctx.stroke();
      ctx.fillStyle=sec.color; ctx.font='700 16px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(item.label,sec.x+11,y+22);
      if(sec.rank){ ctx.textAlign="right"; ctx.fillStyle=C.chalk; ctx.fillText(`#${item.rank}`,sec.x+178,y+22); ctx.textAlign="left"; }
    });
  });

  // Full roster, two columns.
  ctx.fillStyle=C.chalk; ctx.font='800 18px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("YOUR ROSTER",390,348);
  const roster = summary.roster || [];
  const split = Math.ceil(roster.length/2);
  const cols = [roster.slice(0,split), roster.slice(split)];
  cols.forEach((players,ci)=>{
    const x = ci ? 775 : 390;
    players.forEach((p,i)=>{
      const y = 380 + i*26;
      ctx.fillStyle=C.dim2; ctx.font='500 13px "IBM Plex Mono", monospace'; ctx.fillText(String(i + 1 + (ci?split:0)).padStart(2,"0"),x,y);
      ctx.fillStyle=C.chalk;
      fitText(ctx,p.name,300,16,12,700,'"IBM Plex Sans", Arial, sans-serif');
      ctx.fillText(p.name,x+32,y);
    });
  });

  ctx.fillStyle=C.line; ctx.fillRect(64,558,1072,1);
  ctx.fillStyle=C.dim2; ctx.font='500 17px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("Built with nineCat",64,595);
  ctx.textAlign="right"; ctx.fillStyle=C.wood; ctx.font='700 22px "Saira Condensed", Arial Narrow, sans-serif'; ctx.fillText("9cat.fyi",1136,595); ctx.textAlign="left";
  return canvas;
}

async function downloadDraftShare(){
  const btn = document.getElementById("share_download");
  const old = btn?.textContent;
  if(btn){ btn.disabled=true; btn.textContent="Creating…"; }
  try{
    if(document.fonts?.ready) await document.fonts.ready;
    const s = draftShareSummary();
    const canvas = drawDraftShareCard(s);
    const blob = await new Promise(resolve=>canvas.toBlob(resolve,"image/png"));
    if(!blob) throw new Error("Could not create image");
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href=url; a.download=`ninecat-draft-${s.grade.replace("+","plus")}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    window.ninecatTrack?.("draft_share_downloaded", {grade:s.grade, win_rate:Math.round(s.winRate)});
  } finally {
    if(btn){ btn.disabled=false; btn.textContent=old || "Download card"; }
  }
}

async function copyDraftShare(){
  const text = draftShareText();
  let ok = false;
  try{ await navigator.clipboard.writeText(text); ok=true; }catch(e){}
  if(!ok){
    const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    try{ ok=document.execCommand("copy"); }catch(e){}
    ta.remove();
  }
  const btn=document.getElementById("share_copy");
  if(btn){ const old=btn.textContent; btn.textContent=ok?"Copied!":"Copy failed"; setTimeout(()=>btn.textContent=old,1200); }
  if(ok) window.ninecatTrack?.("draft_share_copied", {grade:draftShareSummary().grade});
}

window.ninecatMaybeShowDraftShare = maybeShowDraftShare;
window.ninecatOpenDraftShare = openDraftShare;
window.ninecatDraftShareSummary = draftShareSummary;
window.ninecatDraftShareText = draftShareText;
window.ninecatDraftShareUrl = draftShareUrl;
window.ninecatDraftGrade = draftGrade;
window.ninecatDraftFieldRecord = draftFieldRecord;

const shareMask = document.getElementById("sharemask");
if(shareMask){
  shareMask.addEventListener("click", e=>{ if(e.target===shareMask) closeDraftShare(); });
  document.getElementById("share_close")?.addEventListener("click", closeDraftShare);
  document.getElementById("share_download")?.addEventListener("click", downloadDraftShare);
  document.getElementById("share_copy")?.addEventListener("click", copyDraftShare);
}
document.addEventListener("keydown", e=>{
  if(e.key === "Escape" && shareMask?.classList.contains("on")) closeDraftShare();
});
