"use strict";

/* ============================================================
   MINIMAL ANALYTICS
   Production-only GA4 instrumentation for nineCat.

   Deliberately does not send player names, draft contents, Yahoo ids,
   league names, email addresses, or other user-entered text.
   Deploy previews / localhost are excluded so testing does not pollute data.
   ============================================================ */
(function(){
  const MEASUREMENT_ID = "G-MZ157ENM5F";
  const PROD_HOSTS = new Set(["9cat.fyi", "www.9cat.fyi"]);
  const enabled = PROD_HOSTS.has(String(location.hostname || "").toLowerCase());

  const ACTIVE_DRAFT_KEY = "ninecat.analytics.activeDraft.v1";
  const COMPLETE_DRAFT_KEY = "ninecat.analytics.completeDraft.v1";
  const PENDING_EVENT_KEY = "ninecat.analytics.pendingEvent.v1";

  function safeSessionGet(key){
    try{ return sessionStorage.getItem(key); }catch(e){ return null; }
  }
  function safeSessionSet(key, value){
    try{ sessionStorage.setItem(key, value); }catch(e){}
  }
  function safeSessionRemove(key){
    try{ sessionStorage.removeItem(key); }catch(e){}
  }

  // Always expose no-throw helpers so an ad blocker or failed analytics request
  // can never affect drafting.
  window.ninecatTrack = function(name, params={}){
    if(!enabled || typeof window.gtag !== "function") return;
    const clean = {};
    Object.entries(params || {}).forEach(([k,v])=>{
      if(["string","number","boolean"].includes(typeof v)) clean[k] = v;
    });
    window.gtag("event", name, clean);
  };

  window.ninecatTrackOnceSession = function(key, name, params={}){
    const storageKey = `ninecat.analytics.once.${key}`;
    if(safeSessionGet(storageKey)) return;
    safeSessionSet(storageKey, "1");
    window.ninecatTrack(name, params);
  };

  window.ninecatTrackAfterReload = function(name, params={}){
    try{ safeSessionSet(PENDING_EVENT_KEY, JSON.stringify({name, params})); }catch(e){}
  };

  window.ninecatTrackDraftProgress = function(draftSource, pickCount, totalPicks){
    const n = Math.max(0, Number(pickCount) || 0);
    const total = Math.max(0, Number(totalPicks) || 0);
    if(n > 0 && !safeSessionGet(ACTIVE_DRAFT_KEY)){
      safeSessionSet(ACTIVE_DRAFT_KEY, "1");
      window.ninecatTrack("draft_started", {
        draft_source: draftSource === "yahoo" ? "yahoo" : "manual",
        team_count: (typeof cfg !== "undefined" && cfg) ? Number(cfg.teams) || 0 : 0,
        roster_size: (typeof cfg !== "undefined" && cfg) ? Number(cfg.size) || 0 : 0
      });
    }
    if(total > 0 && n >= total && !safeSessionGet(COMPLETE_DRAFT_KEY)){
      safeSessionSet(COMPLETE_DRAFT_KEY, "1");
      window.ninecatTrack("draft_completed", {
        draft_source: draftSource === "yahoo" ? "yahoo" : "manual",
        team_count: (typeof cfg !== "undefined" && cfg) ? Number(cfg.teams) || 0 : 0,
        roster_size: (typeof cfg !== "undefined" && cfg) ? Number(cfg.size) || 0 : 0,
        total_picks: total
      });
    }
  };

  // Call only for an intentional fresh-start action. The automatic Yahoo-tab
  // close reset deliberately does NOT clear this, preventing a same-draft
  // reopen from being counted as a second draft start.
  window.ninecatResetDraftAnalytics = function(){
    safeSessionRemove(ACTIVE_DRAFT_KEY);
    safeSessionRemove(COMPLETE_DRAFT_KEY);
  };

  if(!enabled) return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function(){ window.dataLayer.push(arguments); };
  window.gtag("js", new Date());
  window.gtag("config", MEASUREMENT_ID, {
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
    send_page_view: true
  });

  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(MEASUREMENT_ID)}`;
  document.head.appendChild(script);

  // Send an event that needed to survive a reload (currently projection import).
  const pending = safeSessionGet(PENDING_EVENT_KEY);
  if(pending){
    safeSessionRemove(PENDING_EVENT_KEY);
    try{
      const evt = JSON.parse(pending);
      if(evt && evt.name) setTimeout(()=>window.ninecatTrack(evt.name, evt.params || {}), 0);
    }catch(e){}
  }

  // Store-link clicks are useful even when the user leaves nineCat immediately.
  const bindExtensionLink = (id, locationLabel)=>{
    const el = document.getElementById(id);
    if(!el) return;
    el.addEventListener("click", ()=>window.ninecatTrack("extension_link_clicked", {
      link_location: locationLabel
    }));
  };
  bindExtensionLink("ext_store_link", "menu");
  bindExtensionLink("quickstart_ext_link", "quick_start");
})();
