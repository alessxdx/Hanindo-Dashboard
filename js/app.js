/* ============================================================
   NOTION-STYLE UI EXTENSIONS
   - sidebar nav (replaces .tab)
   - theme toggle (light/dark)
   - view mode toggle (table/cards) for By Customer
   - inline-editable cells in table view (with Supabase sync)
   ============================================================ */

/* page title strings per tab */
var TAB_TITLES = {
  customers: "By Customer",
  custbase: "Customer Base",
  groups: "Project Groups",
  tracker: "Project Tracker",
  po: "Purchase Orders",
  pricing: "Pricing Calculator",
  projects: "By Project",
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
  currentTab = tab;
  MD_GROUP_SEL = (tab === "groups" && sel) ? sel : null;
  /* Re-clicking the tracker tab returns to its list view; leaving it
     restores the customer stat row the tracker replaced. */
  if(typeof TRK_SEL !== "undefined") TRK_SEL = (tab === "tracker" && sel) ? sel : null;
  if(typeof CB_SEL !== "undefined") CB_SEL = (tab === "custbase" && sel) ? sel : "";
  if(typeof MD_SEL !== "undefined" && tab === "customers"){ MD_SEL = sel || null; MD_SEL_ROUTED = !!sel; }
  if(currentTab !== "tracker" && currentTab !== "po" && currentTab !== "pricing" && currentTab !== "custbase" && typeof renderStats === "function") renderStats();
  /* restore the toolbar add button's label/visibility when leaving tracker */
  if(typeof trkSyncToolbar === "function") trkSyncToolbar();
  var title = document.getElementById("page-title");
  if(title) title.textContent = TAB_TITLES[currentTab] || "";

  // Show filter bar & view toggle only on customers tab
  /* By Customer draws its own styled filter menus (they drive these hidden selects) */
  document.getElementById("filter-bar").style.display = "none";
  var vt = document.getElementById("view-toggle");
  if(vt) vt.style.display = currentTab === "customers" ? "inline-flex" : "none";

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
var BN_TABS=[["tracker","Tracker"],["customers","Customers"],["po","POs"],["buying","Buying"]];
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

/* ===== VIEW MODE (details / table / cards) =====
   "detail" (master–detail) is the primary view. Stored under a new
   key (cpd_view2) so everyone lands on the new view once, while
   later choices still persist. */
var VIEW_MODE = "detail";
try {
  var saved = localStorage.getItem("cpd_view2");
  if(saved === "cards" || saved === "table" || saved === "detail") VIEW_MODE = saved;
} catch(e){}

function setView(mode){
  VIEW_MODE = mode;
  try { localStorage.setItem("cpd_view2", mode); } catch(e){}
  document.querySelectorAll(".view-toggle-btn").forEach(function(b){
    b.classList.toggle("active", b.dataset.view === mode);
  });
  if(currentTab === "customers") renderCustomers();
}
(function initViewButtons(){
  // sync button active state with saved view
  document.querySelectorAll(".view-toggle-btn").forEach(function(b){
    b.classList.toggle("active", b.dataset.view === VIEW_MODE);
  });
  // the toggle starts hidden in the HTML; show it on load since the
  // initial tab is "customers"
  var vt = document.getElementById("view-toggle");
  if(vt && currentTab === "customers") vt.style.display = "inline-flex";
})();

/* ============================================================
   CUSTOMER VIEW DISPATCHER
   We rename the original renderCustomers -> renderCustomersCards
   and define a new renderCustomers that dispatches by VIEW_MODE.
   ============================================================ */
var renderCustomersCards = renderCustomers;
/* By Customer is the single unified master–detail view. (Table/Cards
   renderers kept as dead code in case a flat view is rebuilt later.) */
renderCustomers = function(){ renderCustomersDetail(); };

/* ============================================================
   TABLE VIEW for "By Customer"
   - All transactions in a flat table
   - Filters/sort from existing controls still work
   - Inline-edit on every editable cell
   ============================================================ */
function renderCustomersTable(){
  var data = getFiltered();
  var sortMode = document.getElementById("fsort").value;

  if(sortMode === "name") data = data.slice().sort(function(a,b){return a.customer.localeCompare(b.customer);});
  else if(sortMode === "name-desc") data = data.slice().sort(function(a,b){return b.customer.localeCompare(a.customer);});
  else if(sortMode === "po-desc") data = data.slice().sort(function(a,b){
    var sa = a.status === "PO" ? 0 : 1, sb = b.status === "PO" ? 0 : 1;
    if(sa !== sb) return sa - sb;
    return parseDV(b.date) - parseDV(a.date);
  });
  else if(sortMode === "recent") data = data.slice().sort(function(a,b){return parseDV(b.date) - parseDV(a.date);});
  else data = data.slice().sort(function(a,b){return a.customer.localeCompare(b.customer);});

  if(!data.length){
    document.getElementById("content").innerHTML = '<div class="empty">No transactions match your filters.</div>';
    return;
  }

  var rows = data.map(function(tx){
    var idx = TX.indexOf(tx);
    var margin = (tx.bp && tx.currency === "USD") ? (tx.price - tx.bp) : null;
    var mPct = margin !== null ? ((margin / tx.price) * 100).toFixed(1) : null;
    var flag = flagImg(tx.country, 16);
    var dateStr = dDisplay(tx) || "—";
    var priceCell;
    if(tx.dualPrice){
      priceCell = "<div style='line-height:1.4'>"+
        "<div>"+tx.price.toLocaleString()+" "+tx.currency+"</div>"+
        "<div style='font-size:11px;color:var(--text-muted)'>"+tx.dualPrice.toLocaleString()+" "+tx.currency+"</div>"+
      "</div>";
    } else {
      priceCell = "<span class='cell-edit cell-money' data-tx-idx='"+idx+"' data-field='price' data-type='number'>"+tx.price.toLocaleString()+"</span> "+tx.currency;
    }
    var notesPreview = (tx.notes && tx.notes.length) ? tx.notes[0] + (tx.notes.length > 1 ? " (+"+(tx.notes.length-1)+")" : "") : "";

    return "<tr class='tx-row' data-tx-idx='"+idx+"' onclick='toggleTableRow("+idx+",event)'>"+
      "<td class='cell-mut' style='white-space:nowrap'>"+
        "<span class='cell-edit' data-tx-idx='"+idx+"' data-field='date'>"+(dateStr === "—" ? "—" : dateStr)+"</span>"+
      "</td>"+
      "<td class='cell-cust' style='white-space:nowrap'>"+
        "<div style='display:flex;align-items:center;gap:8px'>"+flag+
        "<span class='cell-edit' data-tx-idx='"+idx+"' data-field='customer'>"+tx.customer+"</span></div>"+
      "</td>"+
      "<td class='cell-mut'>"+
        "<span class='cell-edit' data-tx-idx='"+idx+"' data-field='country'>"+tx.country+"</span>"+
      "</td>"+
      "<td>"+
        "<span class='cell-edit' data-tx-idx='"+idx+"' data-field='model'>"+tx.model+"</span>"+
      "</td>"+
      "<td class='cell-mut'>"+
        "<span class='cell-edit' data-tx-idx='"+idx+"' data-field='project'>"+(tx.project || "—")+"</span>"+
      "</td>"+
      "<td class='cell-mut'>"+
        "<span class='cell-edit' data-tx-idx='"+idx+"' data-field='qty'>"+(tx.qty || "—")+"</span>"+
      "</td>"+
      "<td>"+bStatus(tx.status)+"</td>"+
      "<td>"+(tx.terms && tx.terms.length ? tx.terms.map(bTerm).join("") : "")+bWarranty(tx.warranty)+"</td>"+
      "<td class='num cell-money'>"+priceCell+"</td>"+
      "<td class='num cell-margin'>"+(margin !== null ? "$"+margin.toFixed(0)+" ("+mPct+"%)" : "—")+"</td>"+
      "<td class='num'><div class='row-actions'>"+
        ((tx.attachments&&tx.attachments.length)?"<a class='pdf-clip' href='"+tx.attachments[0].url+"' target='_blank' rel='noopener' onclick='event.stopPropagation()' title='Open attached PDF in a new tab'>&#128206;"+(tx.attachments.length>1?"×"+tx.attachments.length:"")+"</a>":"")+
        "<button class='edit-btn' title='Edit' aria-label='Edit' onclick='event.stopPropagation();editTx("+idx+",event)'>"+EDIT_ICO+"</button>"+
      "</div></td>"+
    "</tr>"+
    "<tr class='exp-detail' id='trow-"+idx+"'>"+
      "<td colspan='11'>"+
        (tx.pn ? "<div><strong>PN:</strong> <span class='cell-edit cell-pn' data-tx-idx='"+idx+"' data-field='pn'>"+tx.pn+"</span></div>" : "")+
        (tx.projectGroup ? "<div style='margin-top:4px'>"+projGroupLinkHtml(tx.projectGroup)+"</div>" : "")+
        (tx.notes && tx.notes.length ? "<div style='margin-top:4px'>"+tx.notes.map(function(n){return "<div>• "+n+"</div>";}).join("")+"</div>" : "")+
      "</td>"+
    "</tr>";
  }).join("");

  document.getElementById("content").innerHTML =
    "<div class='tx-table-wrap'>"+
      "<div style='overflow-x:auto'>"+
        "<table class='tx-table'>"+
          "<thead><tr>"+
            "<th>Date</th>"+
            "<th>Customer</th>"+
            "<th>Country</th>"+
            "<th>Model</th>"+
            "<th>Project</th>"+
            "<th>Qty</th>"+
            "<th>Status</th>"+
            "<th>Terms</th>"+
            "<th class='num'>Unit price</th>"+
            "<th class='num'>Margin</th>"+
            "<th></th>"+
          "</tr></thead>"+
          "<tbody>"+rows+"</tbody>"+
        "</table>"+
      "</div>"+
    "</div>"+
    "<div style='font-size:11px;color:var(--text-faint);margin-top:10px;padding:0 4px'>"+
      data.length+" entries · Click any cell to edit · Click row to see details"+
    "</div>";

  // Wire up inline edit
  document.querySelectorAll(".cell-edit").forEach(function(el){
    el.addEventListener("click", function(e){
      e.stopPropagation();
      startInlineEdit(el);
    });
  });
}

function toggleTableRow(idx, e){
  // Don't toggle if user clicked an editable cell or a button
  if(e && e.target && (e.target.classList.contains("cell-edit") || e.target.closest(".cell-edit") || e.target.closest("button"))) return;
  var row = document.getElementById("trow-"+idx);
  if(row) row.classList.toggle("open");
}

/* ============================================================
   INLINE EDIT
   ============================================================ */
var INLINE_EDITING = null;

function startInlineEdit(el){
  if(INLINE_EDITING) return;
  var txIdx = parseInt(el.dataset.txIdx);
  var field = el.dataset.field;
  var type = el.dataset.type || "text";
  var tx = TX[txIdx];
  if(!tx) return;

  var current = tx[field];
  if(current === null || current === undefined) current = "";

  INLINE_EDITING = { el: el, txIdx: txIdx, field: field, original: el.textContent };

  el.classList.add("editing");
  el.setAttribute("contenteditable", "true");
  el.textContent = (type === "number" && typeof current === "number") ? String(current) : String(current);
  el.focus();

  // Select all text
  var sel = window.getSelection();
  var range = document.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);

  el.addEventListener("blur", finishInlineEdit, { once: true });
  el.addEventListener("keydown", function onKey(e){
    if(e.key === "Enter"){ e.preventDefault(); el.blur(); }
    else if(e.key === "Escape"){
      el.textContent = INLINE_EDITING ? INLINE_EDITING.original : "";
      INLINE_EDITING = null;
      el.removeAttribute("contenteditable");
      el.classList.remove("editing");
      el.removeEventListener("keydown", onKey);
    }
  });
}

async function finishInlineEdit(){
  if(!INLINE_EDITING) return;
  var info = INLINE_EDITING;
  INLINE_EDITING = null;
  var el = info.el;
  el.removeAttribute("contenteditable");
  el.classList.remove("editing");

  var newVal = el.textContent.trim();
  var tx = TX[info.txIdx];
  if(!tx) return;

  var field = info.field;
  var oldVal = tx[field];
  var oldStr = (oldVal === null || oldVal === undefined) ? "" : String(oldVal);

  // Coerce numeric fields
  if(field === "price" || field === "bp"){
    var cleaned = newVal.replace(/,/g, "");
    var num = parseFloat(cleaned);
    if(isNaN(num) || num <= 0){
      el.textContent = info.original;
      return;
    }
    if(num === oldVal){ el.textContent = info.original; return; }
    tx[field] = num;
    el.textContent = num.toLocaleString();
  } else {
    if(newVal === oldStr){ el.textContent = info.original; return; }
    if(!newVal && (field === "customer" || field === "country" || field === "model")){
      // required field — revert
      el.textContent = info.original;
      return;
    }
    tx[field] = newVal;
    el.textContent = newVal || "—";
  }

  // Persist to Supabase
  if(tx._id){
    try {
      showLoad("Saving...");
      await fetch(SB_URL + "/rest/v1/transactions?id=eq." + tx._id, {
        method: "PATCH", headers: sbH(),
        body: JSON.stringify(txToDb(tx))
      });
    } catch(err){
      console.error("Inline save failed:", err);
      alert("Save failed. Will retry on next edit.");
    }
    hideLoad();
  }

  // Refresh stats/filters since something might have changed
  refreshFilterOptions();
  renderStats();
  // If a critical sort field changed and we're sorted by it, re-render row order
  if(field === "customer" || field === "country" || field === "date" || field === "status"){
    renderCustomersTable();
  }
}

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
  if(currentTab === "customers" && typeof MD_SEL !== "undefined" && MD_SEL && MD_SEL_ROUTED) return { tab: "customers", sel: MD_SEL };
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
  /* no page in the address (plain site link, home-screen icon) opens the tracker */
  if(!TAB_TITLES[tab]){ tab = "tracker"; sel = ""; }
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

/* Customer selection is routed only when the user picked a customer —
   the desktop view auto-selects the first one on plain "#customers",
   and that auto-pick must not create history entries. */
var MD_SEL_ROUTED = false;
var _routeMdSelect = mdSelect;
mdSelect = function(key){ MD_SEL_ROUTED = true; _routeMdSelect(key); syncRoute(); };
var _routeMdBack = mdBack;
mdBack = function(){ MD_SEL_ROUTED = false; _routeMdBack(); syncRoute(); };

/* sync the URL after every render, whatever triggered it */
var _routeRenderContent = renderContent;
renderContent = function(){ _routeRenderContent(); syncRoute(); bnSync(); };
var _routeRenderTracker = renderTracker;
renderTracker = function(){ _routeRenderTracker(); syncRoute(); };

window.addEventListener("hashchange", applyRoute);
(function initRoute(){
  var p = parseHash();
  if(p.tab !== "customers" || p.sel) applyRoute();
  else history.replaceState(null, "", location.pathname + location.search + "#customers");
})();

loadFromDB();

/* phone tab bar */
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",buildBottomNav);else buildBottomNav();
