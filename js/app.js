/* ============================================================
   NOTION-STYLE UI EXTENSIONS
   - sidebar nav (replaces .tab)
   - theme toggle (light/dark)
   - view mode toggle (table/cards) for By Customer
   - inline-editable cells in table view (with Supabase sync)
   ============================================================ */

/* page title strings per tab */
var TAB_TITLES = {
  today: "Today",
  custbase: "Customer Base",
  groups: "Project Groups",
  tracker: "Project Tracker",
  po: "Purchase Orders",
  pricing: "Pricing Calculator",
  model: "Model Comparison",
  buying: "Buying Prices",
  spares: "Spare Parts / Accessories",
  others: "Notes"
};

/* Override setTab to drive sidebar instead of top tabs.
   navTo is the single navigation entry point — sidebar clicks and URL
   (hash) routing both land here. sel is a sub-page within the tab:
   a tracker project id or a project-group name. */
function setTab(btn){ navTo(btn.dataset.tab, null); }

function navTo(tab, sel){
  document.querySelectorAll(".nav-item[data-tab]").forEach(function(b){
    b.classList.toggle("active", b.dataset.tab === tab);
  });
  /* Project Groups was folded into Customer Base: a group page
     (#groups/<name>) opens there, and plain #groups shows the customer list */
  var isGroup = tab === "groups";
  if(isGroup){ tab = "custbase"; document.querySelectorAll(".nav-item[data-tab]").forEach(function(b){ b.classList.toggle("active", b.dataset.tab === tab); }); }
  currentTab = tab;
  MD_GROUP_SEL = (isGroup && sel) ? sel : null;
  /* Re-clicking the tracker tab returns to its list view; leaving it
     restores the customer stat row the tracker replaced. */
  if(typeof TRK_SEL !== "undefined") TRK_SEL = (tab === "tracker" && sel) ? sel : null;
  if(typeof CB_SEL !== "undefined") CB_SEL = (tab === "custbase" && sel && !isGroup) ? sel : "";
  if(currentTab !== "tracker" && currentTab !== "po" && currentTab !== "pricing" && currentTab !== "custbase" && currentTab !== "today" && typeof renderStats === "function") renderStats();
  /* restore the toolbar add button's label/visibility when leaving tracker */
  if(typeof trkSyncToolbar === "function") trkSyncToolbar();
  var title = document.getElementById("page-title");
  if(title) title.textContent = TAB_TITLES[currentTab] || "";


  // Close mobile sidebar after selection
  closeMobileSidebar();

  renderContent();
}

/* ===== THEME ===== */
/* white or black only (the navy theme and the sidebar toggle were retired) */
function applyTheme(t){
  document.documentElement.setAttribute("data-theme", t);
  document.body.setAttribute("data-theme", t);
  try { localStorage.setItem("cpd_theme", t); } catch(e){}
  document.querySelectorAll(".theme-swatch").forEach(function(el){
    el.classList.toggle("active", el.dataset.themeChoice === t);
  });
  if(typeof applyAccent==="function")applyAccent();
}
function setThemeChoice(t){ applyTheme(t); }

/* ===== APP COLOUR =====
   One accent colour for buttons, links, highlights and tints, picked
   from three palettes (saved per browser, like the theme). The --accent
   tokens are derived from the swatch for the current background: in
   light it is darkened just enough for white button text to stay
   readable (pastels keep their softness in the tints), on dark it
   is lightened until it stands out. "Original" = the stylesheet teal. */
var ACCENT_SETS = [
  {name:"Classic", colors:[["Original","#0e7c86"],["Viridian","#2a6457"],["Harbor","#3a6585"],["Midnight","#283a6b"],["Terracotta","#b85a37"],["Aubergine","#5a3264"],["Stone","#7d6b55"]]},
  {name:"Bright",  colors:[["Green","#2fa52a"],["Teal","#12a3a3"],["Violet","#6d48d8"],["Pink","#e0406a"],["Plum","#8e2e8a"],["Graphite","#444c63"]]},
  {name:"Pastel",  colors:[["Mint","#8ee0bd"],["Sage","#a9cb97"],["Lavender","#ad9ff0"],["Lilac","#d5a6ec"],["Blush","#f5b0c8"],["Peach","#f9c09b"]]}
];
var ACCENT_PROPS = ["--accent","--accent-hover","--accent-soft","--accent-text","--bg-accent-soft"];
function accentRgb(h){h=h.replace("#","");return [0,2,4].map(function(i){return parseInt(h.substr(i,2),16);});}
function accentHex(c){return "#"+c.map(function(v){return ("0"+Math.round(Math.max(0,Math.min(255,v))).toString(16)).slice(-2);}).join("");}
function accentMix(a,b,t){return a.map(function(v,i){return v+(b[i]-v)*t;});}
function accentLum(c){
  var l=c.map(function(v){v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);});
  return 0.2126*l[0]+0.7152*l[1]+0.0722*l[2];
}
function accentContrast(a,b){var x=accentLum(a),y=accentLum(b);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);}
/* step the colour toward `to` until it reaches `min` contrast against `bg` */
function accentPush(c,to,bg,min){
  for(var i=0;i<40&&accentContrast(c,bg)<min;i++)c=accentMix(c,to,0.06);
  return c;
}
function accentTokens(hex,theme){
  var base=accentRgb(hex),W=[255,255,255],K=[0,0,0];
  if(theme==="light"){
    var acc=accentPush(base,K,W,3.4);
    return {"--accent":accentHex(acc),"--accent-hover":accentHex(accentMix(acc,K,0.14)),
      "--accent-text":accentHex(accentPush(acc,K,W,4.8)),
      "--accent-soft":accentHex(accentMix(base,W,0.86)),"--bg-accent-soft":accentHex(accentMix(base,W,0.82))};
  }
  var bg=accentRgb("#191919");
  var lit=accentPush(base,W,bg,5);
  return {"--accent":accentHex(lit),"--accent-hover":accentHex(accentMix(lit,W,0.18)),
    "--accent-text":accentHex(accentMix(lit,W,0.18)),
    "--accent-soft":accentHex(accentMix(base,bg,0.78)),"--bg-accent-soft":accentHex(accentMix(base,bg,0.72))};
}
function accentSaved(){try{return localStorage.getItem("cpd_accent")||"";}catch(e){return "";}}
function applyAccent(){
  var name=accentSaved(),hex="";
  ACCENT_SETS.forEach(function(g){g.colors.forEach(function(c){if(c[0]===name)hex=c[1];});});
  var st=document.documentElement.style;
  ACCENT_PROPS.forEach(function(p){st.removeProperty(p);});
  if(!hex||name==="Original")return;
  var tk=accentTokens(hex,document.documentElement.getAttribute("data-theme")||"light");
  Object.keys(tk).forEach(function(p){st.setProperty(p,tk[p]);});
}
function setAccent(name){
  try{localStorage.setItem("cpd_accent",name);}catch(e){}
  applyAccent();
  renderAccentPicker();
}
function renderAccentPicker(){
  var el=document.getElementById("accent-sets");
  if(!el)return;
  var cur=accentSaved()||"Original";
  el.innerHTML=ACCENT_SETS.map(function(g){
    return "<div class='accent-set-name'>"+g.name+"</div><div class='accent-grid'>"+g.colors.map(function(c){
      var on=c[0]===cur;
      return "<button type='button' class='accent-opt"+(on?" on":"")+"' onclick='setAccent(\""+c[0]+"\")' aria-pressed='"+on+"'>"+
        "<span class='accent-dot' style='background:"+c[1]+"'>"+(on?"<svg viewBox='0 0 24 24' fill='none' stroke='#fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'><polyline points='5 12 10 17 19 7'/></svg>":"")+"</span>"+
        "<span class='accent-name'>"+c[0]+"</span></button>";
    }).join("")+"</div>";
  }).join("");
}
function openAccentPicker(){
  renderAccentPicker();
  document.getElementById("modal-accent").classList.add("open");
  if(typeof closeMobileSidebar==="function")closeMobileSidebar();
}
(function initTheme(){
  // Always start light per user preference; if user toggled this session, respect it
  var saved = null;
  try { saved = localStorage.getItem("cpd_theme"); } catch(e){}
  applyTheme(saved === "dark" ? "dark" : "light");
})();
applyAccent();

/* ===== SIDEBAR ===== */
function toggleSidebar(){
  // On mobile: open the panel rather than collapse-mode
  if(window.matchMedia("(max-width: 900px)").matches){
    openMobileSidebar();
    return;
  }
  var sb = document.getElementById("sidebar");
  sb.classList.toggle("collapsed");
  try { localStorage.setItem("cpd_sidebar", sb.classList.contains("collapsed") ? "1" : "0"); } catch(e){}
}
/* ===== PHONE TAB BAR =====
   Four main pages plus "More" (the full sidebar; Pricing lives there). Icons are copied from
   the sidebar so the two never drift apart; tapping one clicks the
   matching sidebar item, so routing stays in one place. */
var BN_TABS=[["today","Today"],["tracker","Tracker"],["custbase","Customers"],["po","POs"]];
function buildBottomNav(){
  var nav=document.getElementById("bottom-nav");
  if(!nav)return;
  var icon=function(tab){var el=document.querySelector('.nav-item[data-tab="'+tab+'"] .nav-icon');return el?el.innerHTML:"";};
  nav.innerHTML=BN_TABS.map(function(t){
    return "<button class='bn-item' data-tab='"+t[0]+"' onclick='bnGo(\""+t[0]+"\")'><span class='bn-ico'>"+icon(t[0])+"</span><span class='bn-lbl'>"+t[1]+"</span></button>";
  }).join("")+
  "<button class='bn-item bn-more' onclick='openMobileSidebar()'><span class='bn-ico'><svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round'><circle cx='5' cy='12' r='1.2'/><circle cx='12' cy='12' r='1.2'/><circle cx='19' cy='12' r='1.2'/></svg></span><span class='bn-lbl'>More</span></button>";
  bnSync();
}
function bnGo(tab){
  var b=document.querySelector('.nav-item[data-tab="'+tab+'"]');
  if(b)b.click();
  window.scrollTo(0,0);
}
function bnSync(){
  var main=BN_TABS.some(function(t){return t[0]===currentTab;});
  document.querySelectorAll(".bn-item[data-tab]").forEach(function(b){b.classList.toggle("active",b.dataset.tab===currentTab);});
  var more=document.querySelector(".bn-more");if(more)more.classList.toggle("active",!main);
}
function openMobileSidebar(){
  document.getElementById("sidebar").classList.add("mobile-open");
  document.getElementById("mobile-overlay").classList.add("show");
}
function closeMobileSidebar(){
  var sb = document.getElementById("sidebar");
  if(sb) sb.classList.remove("mobile-open");
  var ov = document.getElementById("mobile-overlay");
  if(ov) ov.classList.remove("show");
}
/* Phone back button / swipe-back closes the open form or More sheet first,
   like an app, instead of leaving the page underneath. Each layer that
   opens pushes a history entry (same URL); closing it with Cancel / × pops
   that entry again, unless the form already navigated somewhere else. */
(function backClosesLayers(){
  var stack=[], skip=0;
  var isLayer=function(el){return el.id==="sidebar"||(el.classList&&el.classList.contains("modal-overlay"));};
  var isOpen=function(el){return el.id==="sidebar"?el.classList.contains("mobile-open"):el.classList.contains("open");};
  new MutationObserver(function(muts){
    muts.forEach(function(m){
      var el=m.target;
      if(!isLayer(el))return;
      var i=stack.indexOf(el);
      if(isOpen(el)&&i===-1){
        if(!window.matchMedia("(max-width:700px)").matches)return;
        stack.push(el);
        history.pushState({cpdLayer:stack.length},"",location.href);
      }else if(!isOpen(el)&&i>-1){
        stack.splice(i,1);
        if(history.state&&history.state.cpdLayer){skip++;history.back();}
      }
    });
  }).observe(document.body,{attributes:true,attributeFilter:["class"],subtree:true});
  window.addEventListener("popstate",function(){
    if(skip){skip--;return;}
    var el=stack.pop();
    if(!el)return;
    if(el.id==="sidebar")closeMobileSidebar();
    else el.classList.remove("open");
  });
})();
(function initSidebar(){
  try {
    if(localStorage.getItem("cpd_sidebar") === "1"){
      document.getElementById("sidebar").classList.add("collapsed");
    }
  } catch(e){}
})();

/* ============================================================
   URL ROUTING — #tab or #tab/<selection>
   Every view gets its own address (e.g. #tracker, #tracker/<project id>,
   #groups/<group name>) so the browser back/forward buttons walk
   between pages instead of leaving the dashboard, and views can be
   bookmarked or shared.
   ============================================================ */
var ROUTE_APPLYING = false;

/* the route the current app state corresponds to */
function routeState(){
  if(typeof MD_GROUP_SEL !== "undefined" && MD_GROUP_SEL) return { tab: "groups", sel: MD_GROUP_SEL };
  if(currentTab === "tracker" && typeof TRK_SEL !== "undefined" && TRK_SEL) return { tab: "tracker", sel: TRK_SEL };
  if(currentTab === "custbase" && typeof CB_SEL !== "undefined" && CB_SEL) return { tab: "custbase", sel: CB_SEL };
  return { tab: currentTab, sel: "" };
}

/* Decoded {tab, sel} from the URL. Some browsers return location.hash
   decoded and others raw, so comparisons always use decoded parts. */
function parseHash(){
  var raw = (location.hash || "").replace(/^#/, "");
  var i = raw.indexOf("/");
  var tab = i === -1 ? raw : raw.slice(0, i);
  var sel = i === -1 ? "" : raw.slice(i + 1);
  try { tab = decodeURIComponent(tab); } catch(e){}
  try { sel = decodeURIComponent(sel); } catch(e){}
  /* no page in the address (plain site link, home-screen icon) opens Today */
  /* By Customer was merged into Customer Base: old links land there */
  if(tab === "customers"){ tab = "custbase"; sel = sel && typeof cbKey === "function" ? cbKey(sel.split("__")[0]) : ""; }
  /* so was Project Groups: its list is now the customer list */
  if(tab === "groups" && !sel) tab = "custbase";
  if(!TAB_TITLES[tab]){ tab = "today"; sel = ""; }
  return { tab: tab, sel: sel };
}

/* After every render, reflect the app state in the URL (pushes a
   history entry whenever the view actually changed). */
function syncRoute(){
  if(ROUTE_APPLYING) return;
  var s = routeState(), p = parseHash();
  if(p.tab === s.tab && p.sel === (s.sel || "")) return;
  var h = "#" + s.tab + (s.sel ? "/" + encodeURIComponent(s.sel) : "");
  /* switching from one item straight to another on the same page
     (project → project) replaces the step, so Back returns to the
     list instead of walking through every item clicked */
  if(p.tab === s.tab && p.sel && s.sel){
    history.replaceState(null, "", location.pathname + location.search + h);
    return;
  }
  location.hash = h;
}

function applyRoute(){
  var p = parseHash(), s = routeState();
  if(p.tab === s.tab && p.sel === (s.sel || "")) return; /* echo of our own sync */
  ROUTE_APPLYING = true;
  try { navTo(p.tab, p.sel || null); } finally { ROUTE_APPLYING = false; }
}

/* sync the URL after every render, whatever triggered it */
var _routeRenderContent = renderContent;
renderContent = function(){ _routeRenderContent(); syncRoute(); bnSync(); };
var _routeRenderTracker = renderTracker;
renderTracker = function(){ _routeRenderTracker(); syncRoute(); };

window.addEventListener("hashchange", applyRoute);
function initRoute(){
  /* always go through navTo once, even when the address names the page
     the app starts on (a plain link opens Today), so the sidebar item and
     the toolbar match the page */
  var p = parseHash();
  ROUTE_APPLYING = true;
  try { navTo(p.tab, p.sel || null); } finally { ROUTE_APPLYING = false; }
  /* an old #customers link: show the Customer Base address instead */
  if(/^#customers|^#groups$/.test(location.hash)){
    var s = routeState();
    history.replaceState(null, "", location.pathname + location.search + "#" + s.tab + (s.sel ? "/" + encodeURIComponent(s.sel) : ""));
  }
}

/* start the app — straight away, or after sign-in once sign-in is required (js/auth.js) */
sbGate(function(){ initRoute(); loadFromDB(); });

/* phone tab bar */
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",buildBottomNav);else buildBottomNav();
