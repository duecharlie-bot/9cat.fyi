"use strict";
function decodePayload(raw){
  const s = raw.replace(/-/g,"+").replace(/_/g,"/");
  const padded = s + "=".repeat((4 - s.length % 4) % 4);
  const bin = atob(padded);
  const bytes = Uint8Array.from(bin, c=>c.charCodeAt(0));
  return JSON.parse(new TextDecoder().decode(bytes));
}
function esc(s){ return String(s ?? "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }
function renderCats(items, punt=false){
  if(!items || !items.length) return punt ? "No punts" : "None";
  return items.map(x=>punt ? esc(x) : `${esc(x[0])} #${esc(x[1])}`).join(" · ");
}
function validatePayload(p){
  if(!p || p.v !== 2 || !Array.isArray(p.ro)) throw new Error("unsupported payload");
  return p;
}
async function loadPayload(){
  // Legacy/self-contained links remain supported forever.
  const encoded = new URLSearchParams(location.search).get("d");
  if(encoded) return validatePayload(decodePayload(encoded));

  const match = location.pathname.match(/^\/s\/([a-f0-9]{8})\/?$/i);
  if(!match) throw new Error("missing share id");
  const response = await fetch(`/api/share?id=${encodeURIComponent(match[1].toLowerCase())}`, {
    headers:{"accept":"application/json"}
  });
  if(!response.ok) throw new Error(`share fetch failed: ${response.status}`);
  return validatePayload(await response.json());
}
function renderPayload(p){
  document.getElementById("grade2").textContent=p.g;
  const winRate = Math.round(p.wr);
  const winRateEl = document.getElementById("winrate2");
  winRateEl.textContent=`${winRate}%`;
  winRateEl.classList.add(winRate >= 75 ? "win-good" : winRate >= 50 ? "win-mid" : "win-bad");
  document.getElementById("record").textContent=p.t ? `${p.w}-${p.l}-${p.t} vs field` : `${p.w}-${p.l} vs field`;
  document.getElementById("meta").textContent=`${p.tm}-team league · ${p.r} rounds`;
  document.getElementById("strong").innerHTML=renderCats(p.s);
  document.getElementById("weak").innerHTML=renderCats(p.wk);
  document.getElementById("punt").innerHTML=renderCats(p.p,true);
  const split=Math.ceil(p.ro.length/2);
  const rosterCol=(arr,offset)=>`<ol class="roster-col">${arr.map((x,i)=>`<li><i>${String(i+1+offset).padStart(2,"0")}</i><b>${esc(x[0])}</b><small>${esc([x[2],x[1]].filter(Boolean).join(" · "))}</small></li>`).join("")}</ol>`;
  document.getElementById("roster").innerHTML=rosterCol(p.ro.slice(0,split),0)+rosterCol(p.ro.slice(split),split);
  document.title=`${p.g} nineCat Draft · ${Math.round(p.wr)}% projected win rate`;
  document.getElementById("result").hidden=false;
}
(async()=>{
  try{ renderPayload(await loadPayload()); }
  catch(e){
    console.warn("Could not load nineCat share", e);
    document.getElementById("invalid").hidden=false;
  }
})();
