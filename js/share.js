"use strict";

/* ============================================================
   DRAFT SHARE CARD — v1

   A completed draft gets one automatic share prompt. The user can reopen it
   from the completed-draft clock at any time. Everything is generated in the
   browser: no roster or league data is uploaded anywhere.
   ============================================================ */

const SHARE_SHOWN_KEY = "ninecat.sharecard.lastShown.v1";
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

function draftGrade(score){
  if(score >= 90) return "A+";
  if(score >= 82) return "A";
  if(score >= 75) return "A-";
  if(score >= 68) return "B+";
  if(score >= 61) return "B";
  if(score >= 55) return "B-";
  if(score >= 49) return "C+";
  if(score >= 43) return "C";
  if(score >= 37) return "C-";
  if(score >= 31) return "D+";
  if(score >= 25) return "D";
  return "F";
}

function draftShareSummary(){
  const rosters = allRosters();
  const mine = myTeamIdx();
  const myZ = teamZ(rosters[mine] || []);
  const activeCats = CATS.filter(c=>cw(c.k) > 0.05);
  const teams = Math.max(1, cfg.teams);
  const quartile = Math.max(1, Math.ceil(teams / 4));

  const mineSize = Math.max(1, (rosters[mine] || []).length);
  const categories = activeCats.map(c=>{
    const rank = 1 + rosters.reduce((n,r,i)=>{
      if(i === mine) return n;
      return n + (teamZ(r)[c.k] > myZ[c.k] ? 1 : 0);
    }, 0);
    const percentile = teams > 1 ? 100 * (teams - rank) / (teams - 1) : 50;
    const profile = myZ[c.k] / mineSize;
    return {k:c.k, label:c.label, rank, percentile, profile, punted:locks[c.k] === "punt"};
  });

  const score = categories.length
    ? categories.reduce((s,c)=>s + c.percentile, 0) / categories.length
    : 50;

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
    grade:draftGrade(score),
    score,
    teams,
    rounds:cfg.size,
    strong,
    weak,
    punted,
    categories
  };
}

function shareRankText(c){ return `${c.label} #${c.rank}`; }

function draftShareText(summary=draftShareSummary()){
  const strong = summary.strong.length ? summary.strong.map(shareRankText).join(", ") : "None";
  const weak = summary.weak.length ? summary.weak.map(shareRankText).join(", ") : "None";
  const punted = summary.punted.length ? summary.punted.map(c=>c.label).join(", ") : "None";
  return [
    `My nineCat Draft Grade: ${summary.grade}`,
    `Strong: ${strong}`,
    `Weak: ${weak}`,
    `Punt: ${punted}`,
    "",
    "9cat.fyi"
  ].join("\n");
}

function sharePills(items, kind, emptyText){
  if(!items.length) return `<span class="share-empty">${emptyText}</span>`;
  return items.map(c=>`<span class="share-pill ${kind}"><b>${c.label}</b>${kind === "punt" ? "" : `<span>#${c.rank}</span>`}</span>`).join("");
}

function paintDraftShare(){
  const s = draftShareSummary();
  const grade = document.getElementById("share_grade");
  if(!grade) return s;
  grade.textContent = s.grade;
  document.getElementById("share_meta").textContent = `${s.teams}-team league · ${s.rounds} rounds`;
  document.getElementById("share_strong").innerHTML = sharePills(s.strong, "strong", "No standout strengths");
  document.getElementById("share_weak").innerHTML = sharePills(s.weak, "weak", "No major weaknesses");
  document.getElementById("share_punts").innerHTML = sharePills(s.punted, "punt", "No punts");
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
  // Let the final render settle before placing the modal over it.
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

function drawDraftShareCard(summary=draftShareSummary()){
  const canvas = document.createElement("canvas");
  canvas.width = 1200; canvas.height = 630;
  const ctx = canvas.getContext("2d");
  const C = {bg:"#171D26", panel:"#202834", line:"#36434F", chalk:"#EEF3F9", dim:"#A6B3C3", wood:"#D4A059", ok:"#5CC489", hot:"#FF8DA1"};

  ctx.fillStyle = C.bg; ctx.fillRect(0,0,1200,630);
  ctx.fillStyle = C.wood; ctx.fillRect(0,0,1200,8);

  ctx.fillStyle = C.wood;
  ctx.font = '700 28px "Saira Condensed", Arial Narrow, sans-serif';
  ctx.fillText("NINECAT", 72, 78);
  ctx.fillStyle = C.chalk;
  ctx.font = '900 54px "Saira Condensed", Arial Narrow, sans-serif';
  ctx.fillText("MY DRAFT", 72, 132);
  ctx.fillStyle = C.dim;
  ctx.font = '500 22px "IBM Plex Sans", Arial, sans-serif';
  ctx.fillText(`${summary.teams}-team league · ${summary.rounds} rounds`, 74, 171);

  // Grade block
  roundRect(ctx,72,210,300,300,12); ctx.fillStyle=C.panel; ctx.fill();
  ctx.strokeStyle=C.line; ctx.lineWidth=2; ctx.stroke();
  ctx.fillStyle=C.dim; ctx.font='600 22px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("DRAFT GRADE",108,260);
  ctx.fillStyle=C.wood; ctx.font='900 150px "Saira Condensed", Arial Narrow, sans-serif'; ctx.fillText(summary.grade,104,408);
  ctx.fillStyle=C.dim; ctx.font='500 18px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("Based on projected category ranks",108,466);

  const sections = [
    {title:"STRONG", items:summary.strong, color:C.ok, x:420, rank:true, empty:"No standout strengths"},
    {title:"WEAK", items:summary.weak, color:C.hot, x:680, rank:true, empty:"No major weaknesses"},
    {title:"PUNT", items:summary.punted, color:C.wood, x:940, rank:false, empty:"No punts"}
  ];
  sections.forEach(sec=>{
    ctx.fillStyle=sec.color; ctx.font='700 20px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(sec.title,sec.x,238);
    if(!sec.items.length){
      ctx.fillStyle=C.dim; ctx.font='500 18px "IBM Plex Sans", Arial, sans-serif';
      const words=sec.empty.split(" "); let line="", yy=286;
      words.forEach(word=>{ const next=line?line+" "+word:word; if(ctx.measureText(next).width>190){ctx.fillText(line,sec.x,yy); yy+=27; line=word;} else line=next; });
      if(line) ctx.fillText(line,sec.x,yy);
      return;
    }
    sec.items.slice(0,3).forEach((item,i)=>{
      const y=270+i*72;
      roundRect(ctx,sec.x,y,200,52,8); ctx.fillStyle=C.panel; ctx.fill(); ctx.strokeStyle=C.line; ctx.lineWidth=2; ctx.stroke();
      ctx.fillStyle=sec.color; ctx.font='700 23px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText(item.label,sec.x+16,y+34);
      if(sec.rank){ ctx.textAlign="right"; ctx.fillStyle=C.chalk; ctx.fillText(`#${item.rank}`,sec.x+182,y+34); ctx.textAlign="left"; }
    });
  });

  ctx.fillStyle=C.line; ctx.fillRect(72,554,1056,1);
  ctx.fillStyle=C.dim; ctx.font='500 20px "IBM Plex Sans", Arial, sans-serif'; ctx.fillText("Built with nineCat",72,594);
  ctx.textAlign="right"; ctx.fillStyle=C.wood; ctx.font='700 24px "Saira Condensed", Arial Narrow, sans-serif'; ctx.fillText("9cat.fyi",1128,594); ctx.textAlign="left";
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
    window.ninecatTrack?.("draft_share_downloaded", {grade:s.grade});
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
