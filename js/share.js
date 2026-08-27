"use strict";

/* ============================================================
   DRAFT SHARE CARD — v2

   The grade is based on projected head-to-head matchup win rate against the
   rest of the league. A 5-4 matchup win and an 8-1 matchup win both count as
   one win. Share links prefer a short Netlify-backed URL. If the share
   service is unavailable, nineCat falls back to the self-contained URL.
   ============================================================ */

let sharePendingSig = null;
let shareAutoShownForCompletion = false;

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

function draftShareText(summary=draftShareSummary(), url=draftShareUrl(summary)){
  return [
    `I just drafted ${gradeArticle(summary.grade)} ${summary.grade} team on nineCat — projected to beat ${roundedWinRate(summary)}% of the field. Think you can beat it?`,
    url
  ].join("\n");
}

async function createShortDraftShare(summary=draftShareSummary()){
  const fallback = draftShareUrl(summary);
  try{
    const response = await fetch("/api/share", {
      method:"POST",
      headers:{"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify(sharePayload(summary))
    });
    if(!response.ok) throw new Error(`Share service returned ${response.status}`);
    const data = await response.json();
    if(!data || !/^[a-f0-9]{8}$/i.test(String(data.id || ""))) throw new Error("Invalid share id");
    const origin = (location && location.origin && location.origin !== "null") ? location.origin : "https://9cat.fyi";
    return {url:`${origin}/s/${String(data.id).toLowerCase()}`, short:true};
  }catch(e){
    console.warn("nineCat short share unavailable; using self-contained link", e);
    return {url:fallback, short:false};
  }
}

function sharePills(items, kind, emptyText){
  if(!items.length) return `<span class="share-empty">${emptyText}</span>`;
  return items.map(c=>`<span class="share-pill ${kind}"><b>${c.label}</b>${kind === "punt" ? "" : `<span>#${c.rank}</span>`}</span>`).join("");
}

function shareRosterRows(roster){
  if(!roster.length) return `<span class="share-empty">No roster found</span>`;
  const split = Math.ceil(roster.length / 2);
  const col = (players, offset)=>`<div class="share-roster-col">${players.map((p,i)=>`<span class="share-roster-player"><i>${String(i+1+offset).padStart(2,"0")}</i><b>${p.name}</b><small>${[p.pos,p.team].filter(Boolean).join(" · ")}</small></span>`).join("")}</div>`;
  return col(roster.slice(0,split),0) + col(roster.slice(split),split);
}

function paintDraftShare(){
  const s = draftShareSummary();
  const grade = document.getElementById("share_grade");
  if(!grade) return s;
  grade.textContent = s.grade;
  document.getElementById("share_meta").textContent = `${s.teams}-team league · ${s.rounds} rounds`;
  const winRate = roundedWinRate(s);
  const winRateEl = document.getElementById("share_winrate");
  winRateEl.textContent = `${winRate}%`;
  winRateEl.classList.remove("win-good", "win-mid", "win-bad");
  winRateEl.classList.add(
    winRate >= 75 ? "win-good" :
    winRate >= 50 ? "win-mid" :
    "win-bad"
  );
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
  window.ninecatTrack?.("draft_share_opened", {source:opts.auto ? "completion" : "manual"});
  return true;
}

function closeDraftShare(){
  document.getElementById("sharemask")?.classList.remove("on");
}

/* Auto-open once per completion cycle, not once per roster signature forever.
   The old localStorage signature meant repeating the same mock draft (or restoring
   an identical completed draft) could silently suppress the popup. Resetting or
   undoing below the completion threshold arms it again. */
function maybeShowDraftShare(){
  const target = cfg.teams * cfg.size;
  const complete = picks.length >= target;

  if(!complete){
    shareAutoShownForCompletion = false;
    sharePendingSig = null;
    return;
  }
  if(shareAutoShownForCompletion || sharePendingSig) return;

  const sig = draftShareSignature();
  sharePendingSig = sig;
  setTimeout(()=>{
    const stillComplete = picks.length >= cfg.teams * cfg.size;
    const sameDraft = draftShareSignature() === sig;
    sharePendingSig = null;
    if(!stillComplete || !sameDraft || shareAutoShownForCompletion) return;
    shareAutoShownForCompletion = true;
    openDraftShare({auto:true});
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
  const C = {bg:"#171D26", panel:"#202834", panel2:"#141B24", line:"#36434F", line2:"#2E3946", chalk:"#EEF3F9", dim:"#A6B3C3", dim2:"#7E8C9E", wood:"#D4A059", ok:"#5CC489", hot:"#FF8DA1"};

  ctx.fillStyle=C.bg; ctx.fillRect(0,0,1200,630);
  ctx.fillStyle=C.wood; ctx.fillRect(0,0,1200,8);

  // Header.
  ctx.fillStyle=C.wood; ctx.font='700 25px "Saira Condensed", Arial Narrow, sans-serif'; ctx.fillText("NINECAT",64,62);
  ctx.fillStyle=C.chalk; ctx.font='900 48px "Saira Condensed", Arial Narrow, sans-serif'; ctx.fillText("MY DRAFT",64,108);
  ctx.textAlign="right"; ctx.fillStyle=C.dim2; ctx.font='500 17px "IBM Plex Mono", monospace';
  ctx.fillText(`${summary.teams}-team league · ${summary.rounds} rounds`,1136,82); ctx.textAlign="left";

  // Grade.
  roundRect(ctx,64,142,208,158,10); ctx.fillStyle=C.panel; ctx.fill(); ctx.strokeStyle=C.line; ctx.lineWidth=1.5; ctx.stroke();
  ctx.fillStyle=C.dim; ctx.font='700 15px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("DRAFT GRADE",84,175);
  ctx.fillStyle=C.wood; const gs=fitText(ctx,summary.grade,160,100,72,900,'"Saira Condensed", Arial Narrow, sans-serif');
  ctx.font=`900 ${gs}px "Saira Condensed", Arial Narrow, sans-serif`; ctx.fillText(summary.grade,82,270);

  // Win rate.
  roundRect(ctx,288,142,250,158,10); ctx.fillStyle=C.panel; ctx.fill(); ctx.strokeStyle=C.line; ctx.stroke();
  ctx.fillStyle=C.dim; ctx.font='700 15px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("PROJECTED WIN RATE",310,175);
  const imageWinRate = roundedWinRate(summary);
  ctx.fillStyle = imageWinRate >= 75 ? C.ok : imageWinRate >= 50 ? C.wood : C.hot;
  ctx.font='900 62px "Saira Condensed", Arial Narrow, sans-serif';
  ctx.fillText(`${imageWinRate}%`,308,240);
  ctx.fillStyle=C.dim2; ctx.font='500 17px "IBM Plex Mono", monospace'; ctx.fillText(fieldRecordText(summary),310,271);

  // Category summary cards.
  const sections=[
    {title:"STRONG",items:summary.strong,color:C.ok,empty:"No standout strengths"},
    {title:"WEAK",items:summary.weak,color:C.hot,empty:"No major weaknesses"},
    {title:"PUNT",items:summary.punted,color:C.wood,empty:"No punts"}
  ];
  const secX=[556,754,952];
  sections.forEach((sec,si)=>{
    const x=secX[si], w=184;
    roundRect(ctx,x,142,w,158,10); ctx.fillStyle=C.panel2; ctx.fill(); ctx.strokeStyle=C.line2; ctx.stroke();
    ctx.fillStyle=sec.color; ctx.font='700 14px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(sec.title,x+15,171);
    if(!sec.items.length){
      ctx.fillStyle=C.dim2; ctx.font='500 13px "IBM Plex Sans", Arial, sans-serif';
      const words=sec.empty.split(" "); let line="", y=205;
      for(const word of words){ const test=(line?line+" ":"")+word; if(ctx.measureText(test).width>150){ctx.fillText(line,x+15,y);line=word;y+=19}else line=test; }
      if(line) ctx.fillText(line,x+15,y);
    }else{
      sec.items.slice(0,3).forEach((item,i)=>{
        const y=193+i*31;
        ctx.fillStyle=sec.color; ctx.font='700 15px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(item.label,x+15,y);
        if(si<2){ctx.textAlign="right";ctx.fillStyle=C.chalk;ctx.font='600 13px "IBM Plex Mono", monospace';ctx.fillText(`#${item.rank}`,x+w-15,y);ctx.textAlign="left";}
      });
    }
  });

  // Roster.
  ctx.fillStyle=C.chalk; ctx.font='800 18px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("YOUR ROSTER",64,342);
  ctx.fillStyle=C.line2; ctx.fillRect(64,354,1072,1);
  const roster=summary.roster||[]; const split=Math.ceil(roster.length/2); const cols=[roster.slice(0,split),roster.slice(split)];
  cols.forEach((players,ci)=>{
    const x=ci?610:64; const nameX=x+34; const metaX=x+500;
    players.forEach((p,i)=>{
      const n=i+1+(ci?split:0), y=390+i*28;
      ctx.fillStyle=C.dim2; ctx.font='500 12px "IBM Plex Mono", monospace'; ctx.fillText(String(n).padStart(2,"0"),x,y);
      const nameSize=fitText(ctx,p.name,315,16,12,700,'"IBM Plex Sans", Arial, sans-serif');
      ctx.font=`700 ${nameSize}px "IBM Plex Sans", Arial, sans-serif`; ctx.fillStyle=C.chalk; ctx.fillText(p.name,nameX,y);
      ctx.textAlign="right"; ctx.fillStyle=C.dim2; ctx.font='500 12px "IBM Plex Sans", Arial, sans-serif';
      ctx.fillText([p.pos,p.team].filter(Boolean).join(" · "),metaX,y); ctx.textAlign="left";
    });
  });

  ctx.fillStyle=C.line; ctx.fillRect(64,568,1072,1);
  ctx.fillStyle=C.dim; ctx.font='600 16px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("Think you can draft better?",64,603);
  ctx.textAlign="right"; ctx.fillStyle=C.wood; ctx.font='700 23px "Saira Condensed", Arial Narrow, sans-serif'; ctx.fillText("9cat.fyi",1136,603); ctx.textAlign="left";
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
  const btn=document.getElementById("share_copy");
  const oldLabel=btn?.textContent || "Copy share";
  if(btn){ btn.disabled=true; btn.textContent="Creating link…"; }
  const summary = draftShareSummary();
  const link = await createShortDraftShare(summary);
  const text = draftShareText(summary, link.url);
  let ok = false;
  try{ await navigator.clipboard.writeText(text); ok=true; }catch(e){}
  if(!ok){
    const ta=document.createElement("textarea"); ta.value=text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    try{ ok=document.execCommand("copy"); }catch(e){}
    ta.remove();
  }
  if(btn){
    btn.textContent=ok?"Copied!":"Copy failed";
    setTimeout(()=>{btn.disabled=false; btn.textContent=oldLabel;},1200);
  }
  if(ok) window.ninecatTrack?.("draft_share_copied", {grade:summary.grade, link_type:link.short?"short":"fallback"});
}

window.ninecatMaybeShowDraftShare = maybeShowDraftShare;
window.ninecatOpenDraftShare = openDraftShare;
window.ninecatDraftShareSummary = draftShareSummary;
window.ninecatDraftShareText = draftShareText;
window.ninecatDraftShareUrl = draftShareUrl;
window.ninecatCreateShortDraftShare = createShortDraftShare;
window.ninecatDraftGrade = draftGrade;
window.ninecatDraftFieldRecord = draftFieldRecord;

const shareMask = document.getElementById("sharemask");
if(shareMask){
  // Draft Share is intentionally non-dismissible from the backdrop. Users must
  // use one of the explicit close controls so the end-of-draft report is not
  // accidentally lost with a stray click.
  shareMask.addEventListener("click", e=>{
    if(e.target !== shareMask) return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);
  document.getElementById("share_close")?.addEventListener("click", closeDraftShare);
  document.getElementById("share_download")?.addEventListener("click", downloadDraftShare);
  document.getElementById("share_copy")?.addEventListener("click", copyDraftShare);
}
document.addEventListener("keydown", e=>{
  if(e.key !== "Escape" || !shareMask?.classList.contains("on")) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);
