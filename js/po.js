/* ============================================================
   PURCHASE ORDERS — record of every PO our offices send to the
   manufacturer (CUSTOM S.p.A.). No lifecycle tracking: this is a
   register for analytics — units bought per model per year, and
   unit-price changes over time. Line items are stored but rarely
   typed: the ⚡ parser fills them from the PO PDF (the offices'
   PO template is very consistent).
   Tables: purchase_orders + po_lines (cascade delete), lazy-loaded.
   ============================================================ */

var PO_LIST=[],PO_LINES=[];
var PO_LOADED=false,PO_MISSING=false;
var PO_VIEW="list";          /* "list" | "models" */
var PO_SEL="";               /* PO open in the side panel */
var PO_FOFFICE="",PO_FYEAR="",PO_SEARCH="";
var PO_ATT=[];               /* modal attachment staging */
var PO_OFFICES=["China","Indonesia","Singapore"];
function poOfficeSlug(o){return String(o||"").toLowerCase().replace(/\s/g,"");}

/* ===== converters ===== */
function dbToPo(r){return{_id:r.id,poNumber:r.po_number||"",office:r.office||"",date:r.po_date||"",vendor:r.vendor||"CUSTOM S.p.A.",currency:r.currency||"USD",total:(r.total===null||r.total===undefined)?null:Number(r.total),notes:r.notes||"",invoiceNo:r.invoice_no||"",paidDate:r.paid_date||"",receivedDate:r.received_date||"",attachments:Array.isArray(r.attachments)?r.attachments:[],createdAt:r.created_at||""};}
function poToDb(p){return{po_number:p.poNumber,office:p.office||null,po_date:p.date||null,vendor:p.vendor||"CUSTOM S.p.A.",currency:p.currency||"USD",total:(p.total===null||isNaN(p.total))?null:p.total,notes:p.notes||null,invoice_no:p.invoiceNo||null,paid_date:p.paidDate||null,received_date:p.receivedDate||null,attachments:p.attachments||[]};}
function dbToPoLine(r){return{_id:r.id,poId:r.po_id,pn:r.pn||"",description:r.description||"",qty:Number(r.qty)||0,unit:r.unit||"pcs",unitPrice:(r.unit_price===null||r.unit_price===undefined)?null:Number(r.unit_price),sortOrder:Number(r.sort_order)||0};}
function poLineToDb(l){return{po_id:l.poId,pn:l.pn||null,description:l.description||null,qty:l.qty||0,unit:l.unit||"pcs",unit_price:(l.unitPrice===null||isNaN(l.unitPrice))?null:l.unitPrice,sort_order:l.sortOrder||0};}

/* ===== load ===== */
async function poLoad(force){
  if(PO_LOADED&&!force)return true;
  var res=await Promise.all([sbGet("purchase_orders"),sbGet("po_lines")]);
  if(!res[0]||!res[1]){PO_MISSING=true;return false;}
  PO_MISSING=false;
  PO_LIST=res[0].map(dbToPo);
  PO_LINES=res[1].map(dbToPoLine);
  PO_LOADED=true;
  return true;
}
function poLinesFor(id){
  return PO_LINES.filter(function(l){return l.poId===id;})
    .sort(function(a,b){return a.sortOrder-b.sortOrder;});
}
function poYear(p){return p.date?String(p.date).slice(0,4):"";}
function poUsd(v,cur){
  if(v===null||isNaN(v))return null;
  return (typeof fxToUSD==="function")?fxToUSD(v,cur):(cur==="USD"?v:null);
}
var PO_CUR_SYM={USD:"$",EUR:"€",RMB:"¥",CNY:"¥",SGD:"S$",IDR:"Rp "};
function poFmtMoney(v,cur){
  if(v===null||v===undefined||isNaN(v))return "—";
  var n=v.toLocaleString(undefined,{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2});
  var sym=PO_CUR_SYM[cur];
  return sym?sym+n:n+" "+cur;
}

/* Debounced search — re-rendering replaces the input, so refocus it */
var PO_SEARCH_T=null;
function poSearchInput(v){
  PO_SEARCH=v;
  clearTimeout(PO_SEARCH_T);
  PO_SEARCH_T=setTimeout(function(){
    renderPOs();
    var el=document.getElementById("po-search");
    if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}
  },250);
}

/* ===== filtering ===== */
function poFiltered(){
  var q=PO_SEARCH.trim().toLowerCase();
  return PO_LIST.filter(function(p){
    if(PO_FOFFICE&&p.office!==PO_FOFFICE)return false;
    if(PO_FYEAR&&poYear(p)!==PO_FYEAR)return false;
    if(q){
      var hay=(p.poNumber+" "+p.office+" "+p.notes+" "+p.invoiceNo+" "+
        poLinesFor(p._id).map(function(l){return l.pn+" "+l.description;}).join(" ")).toLowerCase();
      if(hay.indexOf(q)===-1)return false;
    }
    return true;
  }).sort(function(a,b){
    var d=(b.date||"").localeCompare(a.date||"");
    return d!==0?d:(b.createdAt||"").localeCompare(a.createdAt||"");
  });
}

/* ===== toolbar / stats ===== */
function poSyncToolbar(){
  var btn=document.querySelector("#toolbar .btn-add");
  if(!btn||currentTab!=="po")return;
  if(typeof TRK_BTN_HTML!=="undefined"&&TRK_BTN_HTML===null)TRK_BTN_HTML=btn.innerHTML;
  btn.style.display="";
  if(typeof TRK_BTN_HTML==="string")btn.innerHTML=TRK_BTN_HTML.replace("Add entry","Add PO");
}
function poRenderStats(list){
  var el=document.getElementById("stats");
  if(!el)return;
  var spend=0,units=0,models={};
  list.forEach(function(p){
    var u=poUsd(p.total,p.currency);
    if(u!==null)spend+=u;
    poLinesFor(p._id).forEach(function(l){
      units+=l.qty;
      var k=(l.pn||l.description||"").toLowerCase();
      if(k)models[k]=1;
    });
  });
  var scope=PO_FYEAR?PO_FYEAR:"all years";
  el.innerHTML=
    "<div class='stat'><div class='stat-label'>Purchase orders</div><div class='stat-value'>"+list.length+"</div><div class='stat-sub'>"+scope+(PO_FOFFICE?" · "+PO_FOFFICE:"")+"</div></div>"+
    "<div class='stat'><div class='stat-label'>Total spend</div><div class='stat-value'>"+(typeof fxFormatUSD==="function"?fxFormatUSD(spend):"$"+spend.toLocaleString())+"</div><div class='stat-sub'>USD equivalent</div></div>"+
    "<div class='stat'><div class='stat-label'>Units ordered</div><div class='stat-value'>"+units.toLocaleString()+"</div><div class='stat-sub'>all line items</div></div>"+
    "<div class='stat'><div class='stat-label'>Distinct items</div><div class='stat-value'>"+Object.keys(models).length+"</div><div class='stat-sub'>models / part numbers</div></div>";
}

/* ===== main render ===== */
function renderPOs(){
  var content=document.getElementById("content");
  poSyncToolbar();
  if(!PO_LOADED){
    content.innerHTML="<div class='empty'>Loading purchase orders&hellip;</div>";
    poLoad().then(function(ok){
      if(currentTab!=="po")return;
      if(!ok){
        var st=document.getElementById("stats");if(st)st.innerHTML="";
        content.innerHTML="<div class='empty'>The PO tables don't exist in Supabase yet (purchase_orders / po_lines).<br>Run the setup SQL once in the Supabase SQL editor, then reload.</div>";
        return;
      }
      renderPOs();
    });
    return;
  }
  var list=poFiltered();
  poRenderStats(list);

  var years=[];
  PO_LIST.forEach(function(p){var y=poYear(p);if(y&&years.indexOf(y)===-1)years.push(y);});
  years.sort().reverse();

  /* One toolbar: view switch, a search box that also holds the active
     filters as removable pills, then the office and year pickers */
  var seg=[["list","List"],["models","By model"]].map(function(v){
    return "<button class='po-seg-btn"+(PO_VIEW===v[0]?" active":"")+"' onclick='PO_VIEW=\""+v[0]+"\";renderPOs()'>"+v[1]+"</button>";
  }).join("");
  var pills=(PO_FOFFICE?"<span class='trk-badge po-of-"+poOfficeSlug(PO_FOFFICE)+" po-pill'>"+trkEsc(PO_FOFFICE)+"<button aria-label='Clear office filter' onclick='PO_FOFFICE=\"\";renderPOs()'>&times;</button></span>":"")+
    (PO_FYEAR?"<span class='trk-badge po-pill po-pill-year'>"+PO_FYEAR+"<button aria-label='Clear year filter' onclick='PO_FYEAR=\"\";renderPOs()'>&times;</button></span>":"");
  var toolbar=
    "<div class='po-bar'>"+
      "<div class='po-seg'>"+seg+"</div>"+
      "<label class='po-searchbox'>"+pills+
        "<input id='po-search' placeholder='Search PO no. / model / PN&hellip;' value='"+trkEsc(PO_SEARCH)+"' oninput='poSearchInput(this.value)'>"+
      "</label>"+
      uiDropdown({key:"po-office",onPick:"poPickOffice",cur:PO_FOFFICE,opts:[{value:"",label:"All offices",count:PO_LIST.length}].concat(PO_OFFICES.map(function(o){
        return {value:o,label:o,dot:poOfficeSlug(o),count:PO_LIST.filter(function(p){return p.office===o;}).length};
      }))})+
      uiDropdown({key:"po-year",onPick:"poPickYear",cur:PO_FYEAR,opts:[{value:"",label:"All years",count:PO_LIST.length}].concat(years.map(function(y){
        return {value:y,label:y,count:PO_LIST.filter(function(p){return poYear(p)===y;}).length};
      }))})+
    "</div>";

  if(PO_SEL&&!list.some(function(p){return p._id===PO_SEL;}))PO_SEL="";
  content.innerHTML=toolbar+(PO_VIEW==="models"?poModelsHtml(list):poTableHtml(list));
}

function poPickOffice(v){PO_FOFFICE=v;renderPOs();}
function poPickYear(v){PO_FYEAR=v;renderPOs();}

/* ===== filter menus — styled replacements for <select>, whose open list
   the browser draws and can't be themed. Shared by the PO page and the
   tracker. cfg: {key, opts:[{value,label,count,dot}], cur (a value, or an
   array when multi), onPick: name of a global fn called with the value,
   multi: keep the menu open and tick several, label: button text override,
   foot: [{value,label}] extra actions under a divider} ===== */
var UI_DD_OPEN="";
function uiDropdown(cfg){
  var multi=!!cfg.multi,cur=cfg.cur;
  var isOn=function(v){return multi?cur.indexOf(v)>-1:v===cur;};
  var sel=multi?null:(cfg.opts.filter(function(o){return o.value===cur;})[0]||cfg.opts[0]||{value:"",label:"—"}); /* no options yet: data still loading */
  var dot=function(o){return o.dot?"<span class='po-dd-dot po-of-"+o.dot+"'></span>":(o.color?"<span class='po-dd-dot' style='background:"+o.color+"'></span>":"");};
  /* single-choice menus close on a pick; multi-select ones stay open */
  var pick=function(v,close){return "onclick='"+(close||!multi?"UI_DD_OPEN=\"\";":"")+cfg.onPick+"(\""+trkEsc(v)+"\")'";};
  var btnLabel=cfg.label!==undefined?cfg.label:sel.label;
  var btnCount=cfg.count!==undefined?cfg.count:(sel?sel.count:undefined);
  return "<div class='po-dd"+(UI_DD_OPEN===cfg.key?" open":"")+"' data-dd='"+cfg.key+"'>"+
    "<button class='po-dd-btn' aria-haspopup='listbox' onclick='uiDdToggle(event,\""+cfg.key+"\")'>"+
      (sel?dot(sel):"")+"<span class='po-dd-txt'>"+trkEsc(btnLabel)+"</span>"+(btnCount!==undefined?"<span class='po-dd-n'>"+btnCount+"</span>":"")+
      "<svg class='po-dd-chev' viewBox='0 0 16 16' aria-hidden='true'><path d='M4 6l4 4 4-4' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/></svg>"+
    "</button>"+
    "<div class='po-dd-menu' role='listbox'"+(multi?" aria-multiselectable='true'":"")+">"+cfg.opts.map(function(o){
      var on=isOn(o.value);
      return "<button class='po-dd-item"+(on?" active":"")+(o.sep?" po-dd-sep":"")+"' role='option' aria-selected='"+on+"' "+pick(o.value)+">"+
        "<span class='po-dd-check'>"+(on?"&#10003;":"")+"</span>"+dot(o)+"<span class='po-dd-lbl'>"+trkEsc(o.label)+"</span>"+(o.count!==undefined?"<span class='po-dd-n'>"+o.count+"</span>":"")+"</button>";
    }).join("")+
    ((cfg.foot&&cfg.foot.length)?"<div class='po-dd-foot'>"+cfg.foot.map(function(f){return "<button "+pick(f.value,true)+">"+trkEsc(f.label)+"</button>";}).join("")+"</div>":"")+
    "</div>"+
  "</div>";
}
function uiDdToggle(e,key){
  e.stopPropagation();
  UI_DD_OPEN=UI_DD_OPEN===key?"":key;
  document.querySelectorAll(".po-dd").forEach(function(el){el.classList.toggle("open",el.dataset.dd===UI_DD_OPEN);});
}
function uiDdClose(){
  if(!UI_DD_OPEN)return;
  UI_DD_OPEN="";
  document.querySelectorAll(".po-dd.open").forEach(function(el){el.classList.remove("open");});
}
/* A pick re-renders the page, so by the time this runs the clicked item
   may be detached: only a click on something still in the page and
   outside every menu closes it (multi-select menus then stay open). */
document.addEventListener("click",function(e){
  var t=e.target;
  if(!t||!document.contains(t))return;
  if(!(t.closest&&t.closest(".po-dd")))uiDdClose();
});
document.addEventListener("keydown",function(e){if(e.key==="Escape")uiDdClose();});

/* ===== list view: one row per PO, month groups with subtotals, and a
   side panel for the selected PO (full screen on phones) ===== */
function poUsdSum(list){
  var t=0;list.forEach(function(p){var u=poUsd(p.total,p.currency);if(u!==null)t+=u;});
  return typeof fxFormatUSD==="function"?fxFormatUSD(t):"$"+Math.round(t).toLocaleString();
}
function poTableHtml(list){
  if(!list.length)return poEmptyHtml();
  var groups=[],byLabel={};
  list.forEach(function(p){
    var ml=poMonthLabel(p);
    if(!byLabel[ml]){byLabel[ml]=[];groups.push(ml);}
    byLabel[ml].push(p);
  });
  var rows=groups.map(function(ml){
    var g=byLabel[ml];
    return "<tr class='po-grp'><td colspan='4'><span class='po-grp-name'>"+ml+"</span><span class='po-grp-n'>"+g.length+" PO"+(g.length===1?"":"s")+"</span></td>"+
      "<td class='num'><span class='po-grp-lbl'>Subtotal</span><span class='po-grp-sum'>"+poUsdSum(g)+"</span></td><td></td></tr>"+
      g.map(function(p){
        var n=poLinesFor(p._id).length,att=(p.attachments||[]).length;
        return "<tr class='po-row"+(PO_SEL===p._id?" sel":"")+"' onclick='poSelect(\""+p._id+"\")'>"+
          "<td class='po-no'>"+(p.office?"<span class='trk-badge po-dot po-of-"+poOfficeSlug(p.office)+"' title='"+trkEsc(p.office)+"'></span>":"")+trkEsc(p.poNumber)+(p.notes?" <span class='po-has-note' title='Has a note'>&#9998;</span>":"")+(p.invoiceNo&&!p.paidDate?" <span class='po-unpaid' title='Invoiced, not yet paid'>Unpaid</span>":"")+"</td>"+
          "<td>"+(p.office?"<span class='trk-badge po-of-"+poOfficeSlug(p.office)+"'>"+trkEsc(p.office)+"</span>":"")+"</td>"+
          "<td class='po-dim'>"+(p.date?trkFmtDate(p.date):"&mdash;")+"</td>"+
          "<td class='po-dim num'>"+n+"</td>"+
          "<td class='num po-amt'>"+poFmtMoney(p.total,p.currency)+"</td>"+
          "<td class='po-dim num'>"+(att?trkFileIcon(p.attachments[0].name)+(att>1?" "+att:""):"")+"</td>"+
        "</tr>";
      }).join("");
  }).join("");
  var sel=PO_SEL?PO_LIST.filter(function(p){return p._id===PO_SEL;})[0]:null;
  return "<div class='po-split"+(sel?" has-sel":"")+"'>"+
    "<div class='po-table-wrap'><table class='po-table po-list'>"+
      "<thead><tr><th>PO</th><th>Office</th><th>Date</th><th class='num'>Lines</th><th class='num'>Amount</th><th class='num'>Files</th></tr></thead>"+
      "<tbody>"+rows+"</tbody></table></div>"+
    (sel?poPanelHtml(sel):"")+
  "</div>";
}
function poPanelHtml(p){
  var lines=poLinesFor(p._id);
  var lineRows=lines.map(function(l){
    var sub=(l.unitPrice!==null)?l.qty*l.unitPrice:null;
    return "<div class='po-pl'>"+
      "<div class='po-pl-main'><div class='po-pl-desc'>"+trkEsc(l.description||l.pn||"—")+"</div>"+
        (l.pn&&l.description?"<div class='po-line-pn'>"+trkEsc(l.pn)+"</div>":"")+
        "<div class='po-dim'>"+l.qty.toLocaleString()+" "+trkEsc(l.unit)+(l.unitPrice!==null?" &times; "+poFmtMoney(l.unitPrice,p.currency):"")+"</div></div>"+
      "<div class='po-pl-sub'>"+(sub!==null?poFmtMoney(sub,p.currency):"")+"</div>"+
    "</div>";
  }).join("");
  var atts=(p.attachments||[]).map(function(a){
    return "<a class='trk-att' href='"+trkEsc(a.url)+"' data-name='"+trkEsc(a.name)+"' onclick='return trkViewFile(this)'>"+trkFileIcon(a.name)+" "+trkEsc(a.name)+"</a>";
  }).join(" ");
  return "<aside class='po-panel'>"+
    "<div class='po-panel-head'><span class='po-panel-no'>"+trkEsc(p.poNumber)+"</span>"+
      "<button class='po-panel-x' aria-label='Close' onclick='poSelect(\"\")'>&times;</button></div>"+
    "<div class='po-panel-meta'>"+(p.office?"<span class='trk-badge po-of-"+poOfficeSlug(p.office)+"'>"+trkEsc(p.office)+" office</span>":"")+
      (p.date?"<span>"+trkFmtDate(p.date)+"</span>":"")+"</div>"+
    "<div class='po-panel-total'>"+poFmtMoney(p.total,p.currency)+
      ((p.currency!=="USD"&&typeof fxUsdText==="function"&&p.total!==null)?" <span class='trk-value-usd'>"+fxUsdText(p.total,p.currency)+"</span>":"")+"</div>"+
    poPanelStatusHtml(p)+
    (lines.length?"<div class='po-panel-sec'>"+lines.length+" line"+(lines.length===1?"":"s")+"</div>"+lineRows:"")+
    (atts?"<div class='po-panel-sec'>Files</div><div class='trk-tl-atts'>"+atts+"</div>":"")+
    (p.notes?"<div class='po-panel-sec'>Note</div><div class='po-panel-note'>"+trkEsc(p.notes)+"</div>":"")+
    "<div class='po-panel-acts'><button class='btn-save' onclick='poEdit(\""+p._id+"\")'>Edit PO</button></div>"+
  "</aside>";
}
/* invoice / payment / receipt — filled for the offices that track them */
function poPanelStatusHtml(p){
  if(!p.invoiceNo&&!p.paidDate&&!p.receivedDate)return "";
  function row(k,v){return "<div class='po-st-row'><span>"+k+"</span><span>"+v+"</span></div>";}
  return "<div class='po-panel-sec'>Invoice &amp; delivery</div>"+
    (p.invoiceNo?row("Invoice","<span class='po-line-pn'>"+trkEsc(p.invoiceNo)+"</span>"):"")+
    row("Paid",p.paidDate?trkFmtDate(p.paidDate):"<span class='po-unpaid'>Not yet</span>")+
    row("Received",p.receivedDate?trkFmtDate(p.receivedDate):"<span class='po-dim'>&mdash;</span>");
}
function poSelect(id){PO_SEL=(id&&PO_SEL!==id)?id:"";renderPOs();}
/* Esc closes the panel; up/down step through the visible POs */
document.addEventListener("keydown",function(e){
  if(typeof currentTab==="undefined"||currentTab!=="po"||PO_VIEW!=="list"||!PO_SEL)return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||""))return;
  if(document.querySelector(".modal-overlay.open"))return;
  if(e.key==="Escape"){PO_SEL="";renderPOs();return;}
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    var ids=poFiltered().map(function(p){return p._id;}),at=ids.indexOf(PO_SEL);
    var nx=ids[at+(e.key==="ArrowDown"?1:-1)];
    if(nx){e.preventDefault();PO_SEL=nx;renderPOs();var r=document.querySelector(".po-row.sel");if(r)r.scrollIntoView({block:"nearest"});}
  }
});

var PO_MONTHS_FULL=["January","February","March","April","May","June","July","August","September","October","November","December"];
function poMonthLabel(p){
  if(!p.date)return "No date";
  var d=String(p.date);
  var mi=parseInt(d.slice(5,7),10)-1;
  return (PO_MONTHS_FULL[mi]||"")+" "+d.slice(0,4);
}
function poEmptyHtml(){
  return "<div class='empty'>"+(PO_LIST.length?"No purchase orders match this filter.":"No purchase orders yet. Click <strong>+ Add PO</strong> and drop the PO PDF — the form fills itself.")+"</div>";
}

/* ===== "By model" rollup — units and price history per part number ===== */
function poModelsHtml(list){
  var ids={};list.forEach(function(p){ids[p._id]=p;});
  var groups={};
  PO_LINES.forEach(function(l){
    var p=ids[l.poId];
    if(!p)return;
    var key=(l.pn||l.description||"?").toLowerCase();
    var g=groups[key];
    if(!g){g={pn:l.pn,desc:l.description,units:0,pos:{},spend:0,prices:[]};groups[key]=g;}
    if((l.description||"").length>(g.desc||"").length)g.desc=l.description;
    g.units+=l.qty;
    g.pos[l.poId]=1;
    if(l.unitPrice!==null){
      var usd=poUsd(l.unitPrice,p.currency);
      var sub=poUsd(l.qty*l.unitPrice,p.currency);
      if(sub!==null)g.spend+=sub;
      g.prices.push({date:p.date||"",price:l.unitPrice,cur:p.currency,usd:usd});
    }
  });
  var rows=Object.keys(groups).map(function(k){return groups[k];})
    .sort(function(a,b){return b.units-a.units;});
  if(!rows.length)return "<div class='empty'>No line items in the selected range.</div>";

  var html=rows.map(function(g){
    g.prices.sort(function(a,b){return (a.date||"").localeCompare(b.date||"");});
    var first=g.prices[0],last=g.prices[g.prices.length-1];
    var uniq=[];g.prices.forEach(function(pr){if(uniq.indexOf(pr.price)===-1)uniq.push(pr.price);});
    var changed=uniq.length>1;
    var trend="";
    if(changed&&first&&last&&first.price!==last.price){
      var up=last.price>first.price;
      trend=" <span class='"+(up?"po-up":"po-down")+"'>"+(up?"&#9650;":"&#9660;")+" "+
        poFmtMoney(first.price,first.cur)+" &rarr; "+poFmtMoney(last.price,last.cur)+"</span>";
    }
    return "<tr>"+
      "<td><div class='po-m-desc'>"+trkEsc(g.desc||"—")+"</div>"+(g.pn?"<div class='po-m-pn'>"+trkEsc(g.pn)+"</div>":"")+"</td>"+
      "<td class='num' data-label='Units'><strong>"+g.units.toLocaleString()+"</strong></td>"+
      "<td class='num' data-label='POs'>"+Object.keys(g.pos).length+"</td>"+
      "<td class='num' data-label='Spend (USD)'>"+(typeof fxFormatUSD==="function"?fxFormatUSD(g.spend):"$"+g.spend.toLocaleString())+"</td>"+
      "<td class='num' data-label='Last price'>"+(last?poFmtMoney(last.price,last.cur):"—")+(last&&last.date?" <span class='trk-value-usd'>("+trkFmtDate(last.date)+")</span>":"")+trend+"</td>"+
    "</tr>";
  }).join("");
  return "<div class='po-table-wrap'><table class='po-table po-models'>"+
    "<thead><tr><th>Model / part</th><th class='num'>Units</th><th class='num'>POs</th><th class='num'>Spend (USD)</th><th class='num'>Last price</th></tr></thead>"+
    "<tbody>"+html+"</tbody></table></div>"+
    "<div class='empty' style='padding:14px;text-align:left'>&#9650;/&#9660; shows a unit-price change between the first and latest PO in the selected range.</div>";
}

/* ===== modal ===== */
function poRenderAttList(){
  var el=document.getElementById("po-att-list");
  if(!el)return;
  el.innerHTML=PO_ATT.map(function(a,i){
    var name=a.url?"<a href='"+trkEsc(a.url)+"' target='_blank' rel='noopener'>"+trkEsc(a.name)+"</a>":trkEsc(a.name)+" <em>(uploads on save)</em>";
    return "<span class='att-item"+(a.url?"":" att-pending")+"'>"+trkFileIcon(a.name)+" "+name+
      " <a href='#' class='att-remove' title='Remove' onclick='poRemoveAtt(event,"+i+")'>&#10005;</a></span>";
  }).join("")||"<span class='att-empty'>No PDF yet. Add or drop the PO — then hit &#9889; to fill the form from it.</span>";
}
function poAddFiles(){
  var input=document.getElementById("po-files");
  var files=input&&input.files?Array.prototype.slice.call(input.files):[];
  files.forEach(function(f){PO_ATT.push({name:f.name||"file",file:f});});
  if(input)input.value="";
  poRenderAttList();
  poAfterFilesAdded();
}
function poPdfAtts(){return PO_ATT.filter(function(a){return /\.pdf$/i.test(a.name);});}
/* Auto-run the parser: one PDF fills the empty form immediately;
   several announce the one-PO-per-PDF import. */
function poAfterFilesAdded(){
  var m=document.getElementById("modal-po");
  if(m.getAttribute("data-edit-id"))return;
  var pdfs=poPdfAtts();
  if(pdfs.length===1&&!document.getElementById("po-number").value.trim())poFillFromPdf();
  else if(pdfs.length>1)poStatus(pdfs.length+" PDFs staged — ⚡ creates one PO per PDF.");
}
function poRemoveAtt(e,i){if(e)e.preventDefault();PO_ATT.splice(i,1);poRenderAttList();}

function polRowHtml(l){
  l=l||{};
  return "<div class='pol-row'>"+
    "<input class='pol-qty' type='number' step='any' placeholder='Qty' value='"+(l.qty!==undefined&&l.qty!==null?l.qty:"")+"' oninput='poRecalc()'>"+
    "<input class='pol-unit' placeholder='pcs' value='"+trkEsc(l.unit||"")+"'>"+
    "<input class='pol-pn' placeholder='Part number' value='"+trkEsc(l.pn||"")+"' style=\"font-family:'DM Mono',monospace\">"+
    "<input class='pol-desc' placeholder='Description / model' value='"+trkEsc(l.description||"")+"'>"+
    "<input class='pol-price' type='number' step='any' placeholder='Unit price' value='"+(l.unitPrice!==undefined&&l.unitPrice!==null?l.unitPrice:"")+"' oninput='poRecalc()'>"+
    "<button type='button' class='pol-del' title='Remove line' onclick='this.parentElement.remove();poRecalc()'>&#10005;</button>"+
  "</div>";
}
function polAddRow(l){
  document.getElementById("pol-rows").insertAdjacentHTML("beforeend",polRowHtml(l));
}
function polReadRows(){
  return [...document.querySelectorAll("#pol-rows .pol-row")].map(function(row,i){
    return {
      qty:parseFloat(row.querySelector(".pol-qty").value)||0,
      unit:row.querySelector(".pol-unit").value.trim()||"pcs",
      pn:row.querySelector(".pol-pn").value.trim(),
      description:row.querySelector(".pol-desc").value.trim(),
      unitPrice:row.querySelector(".pol-price").value===""?null:parseFloat(row.querySelector(".pol-price").value),
      sortOrder:i
    };
  }).filter(function(l){return l.qty||l.pn||l.description;});
}
function poRecalc(){
  var sum=0,any=false;
  polReadRows().forEach(function(l){
    if(l.unitPrice!==null&&!isNaN(l.unitPrice)){sum+=l.qty*l.unitPrice;any=true;}
  });
  if(any)document.getElementById("po-total").value=Math.round(sum*100)/100;
}
function poOpenModal(){
  var m=document.getElementById("modal-po");
  m.removeAttribute("data-edit-id");
  document.getElementById("po-modal-title").textContent="Add purchase order";
  document.getElementById("btn-delete-po").style.display="none";
  m.querySelectorAll("input,textarea").forEach(function(el){el.value="";});
  document.getElementById("po-office").value="";
  document.getElementById("po-currency").value="USD";
  document.getElementById("pol-rows").innerHTML="";
  document.getElementById("po-parse-status").textContent="";
  PO_ATT=[];poRenderAttList();
  m.classList.add("open");
}
function poEdit(id){
  var p=PO_LIST.find(function(x){return x._id===id;});
  if(!p)return;
  var m=document.getElementById("modal-po");
  m.setAttribute("data-edit-id",id);
  document.getElementById("po-modal-title").textContent="Edit purchase order";
  document.getElementById("btn-delete-po").style.display="inline-flex";
  document.getElementById("po-number").value=p.poNumber;
  document.getElementById("po-office").value=p.office||"";
  document.getElementById("po-date").value=p.date?String(p.date).slice(0,10):"";
  document.getElementById("po-currency").value=p.currency||"USD";
  document.getElementById("po-total").value=p.total===null?"":p.total;
  document.getElementById("po-notes").value=p.notes;
  document.getElementById("po-invoice").value=p.invoiceNo||"";
  document.getElementById("po-paid").value=p.paidDate?String(p.paidDate).slice(0,10):"";
  document.getElementById("po-received").value=p.receivedDate?String(p.receivedDate).slice(0,10):"";
  document.getElementById("po-parse-status").textContent="";
  var rows=document.getElementById("pol-rows");
  rows.innerHTML="";
  poLinesFor(id).forEach(function(l){polAddRow(l);});
  var fi=document.getElementById("po-files");if(fi)fi.value="";
  PO_ATT=(p.attachments||[]).map(function(a){return{name:a.name,url:a.url};});
  poRenderAttList();
  m.classList.add("open");
}
async function poSave(){
  var num=document.getElementById("po-number").value.trim();
  if(!num){alert("Please enter the PO number.");return;}
  /* forgot-I-already-entered-it guard */
  var dup=poFindByNumber(num,document.getElementById("modal-po").getAttribute("data-edit-id"));
  if(dup&&!confirm("PO "+num+" is already recorded ("+(dup.date?trkFmtDate(dup.date):"no date")+", "+(dup.office||"?")+" office).\nSave anyway as a duplicate?"))return;
  /* upload staged files (same bucket, po/ prefix) */
  try{
    var pending=PO_ATT.filter(function(a){return a.file&&!a.url;});
    for(var i=0;i<pending.length;i++){
      showLoad("Uploading file "+(i+1)+" of "+pending.length+"...");
      await poUploadAtt(pending[i]);
    }
  }catch(err){hideLoad();alert("File upload failed: "+err.message+"\nPO was not saved — please try again.");return;}
  var totRaw=document.getElementById("po-total").value;
  var p={
    poNumber:num,
    office:document.getElementById("po-office").value,
    date:document.getElementById("po-date").value,
    currency:document.getElementById("po-currency").value,
    total:totRaw===""?null:parseFloat(totRaw),
    notes:document.getElementById("po-notes").value.trim(),
    invoiceNo:document.getElementById("po-invoice").value.trim(),
    paidDate:document.getElementById("po-paid").value,
    receivedDate:document.getElementById("po-received").value,
    attachments:PO_ATT.map(function(a){return{name:a.name,url:a.url};})
  };
  var lines=polReadRows();
  var m=document.getElementById("modal-po");
  var editId=m.getAttribute("data-edit-id");
  showLoad("Saving...");
  try{
    var poId;
    if(editId){
      var r1=await fetch(SB_URL+"/rest/v1/purchase_orders?id=eq."+editId,{method:"PATCH",headers:sbH(),body:JSON.stringify(poToDb(p))});
      if(!r1.ok)throw new Error("HTTP "+r1.status+" — "+(await r1.text()).slice(0,200));
      poId=editId;
      /* replace the lines wholesale — simplest and safe (they're small) */
      await fetch(SB_URL+"/rest/v1/po_lines?po_id=eq."+editId,{method:"DELETE",headers:sbH()});
      var idx=PO_LIST.findIndex(function(x){return x._id===editId;});
      if(idx>-1){p._id=editId;p.createdAt=PO_LIST[idx].createdAt;PO_LIST[idx]=p;}
      PO_LINES=PO_LINES.filter(function(l){return l.poId!==editId;});
    }else{
      var r=await trkInsert("purchase_orders",poToDb(p));
      if(!r||!r[0])throw new Error("insert failed");
      p._id=r[0].id;p.createdAt=r[0].created_at;poId=p._id;
      PO_LIST.push(p);
    }
    for(var j=0;j<lines.length;j++){
      lines[j].poId=poId;
      var rl=await trkInsert("po_lines",poLineToDb(lines[j]));
      if(rl&&rl[0])lines[j]._id=rl[0].id;
      PO_LINES.push(lines[j]);
    }
  }catch(err){hideLoad();alert("Save failed: "+err.message);return;}
  hideLoad();
  closeModal("modal-po");
  renderPOs();
}
async function poDelete(){
  var m=document.getElementById("modal-po");
  var editId=m.getAttribute("data-edit-id");
  if(!editId)return;
  var p=PO_LIST.find(function(x){return x._id===editId;});
  if(!confirm("Delete PO "+(p?p.poNumber:"")+" and its lines permanently?"))return;
  showLoad("Deleting...");
  await sbDelete("purchase_orders",editId); /* lines cascade */
  PO_LIST=PO_LIST.filter(function(x){return x._id!==editId;});
  PO_LINES=PO_LINES.filter(function(l){return l.poId!==editId;});
  hideLoad();
  closeModal("modal-po");
  renderPOs();
}

/* ===== drag & drop on the PO modal ===== */
(function poInitDrop(){
  var zone=document.getElementById("modal-po");
  var box=document.getElementById("po-drop");
  if(!zone)return;
  ["dragenter","dragover"].forEach(function(ev){
    zone.addEventListener(ev,function(e){
      if(!zone.classList.contains("open"))return;
      e.preventDefault();e.stopPropagation();
      if(box)box.classList.add("trk-dragover");
    });
  });
  zone.addEventListener("dragleave",function(e){
    if(!zone.classList.contains("open"))return;
    e.preventDefault();
    if(box&&(!e.relatedTarget||!zone.contains(e.relatedTarget)))box.classList.remove("trk-dragover");
  });
  zone.addEventListener("drop",function(e){
    if(!zone.classList.contains("open"))return;
    e.preventDefault();e.stopPropagation();
    if(box)box.classList.remove("trk-dragover");
    var files=(e.dataTransfer&&e.dataTransfer.files)?Array.prototype.slice.call(e.dataTransfer.files):[];
    files.forEach(function(f){PO_ATT.push({name:f.name||"file",file:f});});
    if(files.length){poRenderAttList();poAfterFilesAdded();}
  });
})();

/* ===== ⚡ fill the form from the attached PO PDF =====
   The offices' template is consistent:
     "PO NO : CUSTOM013-0925" / "DATE : September 25, 2025"
     item rows: "1 40 Units 915DW011200300 VKP80II-RX $189.00 $7,560.00"
     "TOTAL PRICE $26,382.00" / "TOTAL $ 23,613.00"                     */
function poStatus(msg){var el=document.getElementById("po-parse-status");if(el)el.textContent=msg;}
function poFindByNumber(num,exceptId){
  num=String(num||"").trim().toLowerCase();
  if(!num)return null;
  return PO_LIST.find(function(p){return p.poNumber.toLowerCase()===num&&p._id!==exceptId;})||null;
}
async function poUploadAtt(a){
  if(a.url||!a.file)return a;
  var safe=(a.file.name||"file").replace(/[^a-zA-Z0-9._-]/g,"_");
  var path="po/"+Date.now()+"-"+safe;
  var r=await fetch(SB_URL+"/storage/v1/object/documents/"+path,{
    method:"POST",
    headers:{"apikey":SB_KEY,"Authorization":"Bearer "+sbToken(),"Content-Type":a.file.type||"application/octet-stream"},
    body:a.file
  });
  if(!r.ok)throw new Error("upload failed (HTTP "+r.status+")");
  a.url=SB_URL+"/storage/v1/object/public/documents/"+path;
  delete a.file;
  return a;
}
/* Parse one PO PDF into plain data (no DOM). */
async function poParseFile(a){
  var lines;
  if(a.file)lines=await pdfFileToLines(a.file);
  else lines=await pdfFileToLines(await(await fetch(a.url)).blob());
  var all=lines.join("\n");
  var out={poNumber:"",date:"",office:"",total:null,currency:/€/.test(all)?"EUR":"USD",lines:[]};
  var m;
  if((m=all.match(/PO\s*NO\s*[:.]?\s*([A-Z0-9#][A-Z0-9#-]+)/i)))out.poNumber=m[1];
  else if((m=String(a.name).match(/([A-Z]{2,}\d{2,}-\d{2,})/)))out.poNumber=m[1];
  if((m=all.match(/DATE\s*:\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/))){
    var d=new Date(m[1].replace(",",", "));
    if(!isNaN(d))out.date=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
  }
  if(/SHANGHAI/i.test(all))out.office="China";
  else if(/GRALESSANDO|SINGAPORE/i.test(all))out.office="Singapore";
  else if(/JAKARTA|INDONESIA/i.test(all))out.office="Indonesia";
  lines.forEach(function(ln){
    /* the trailing group tolerates remark text wrapped onto the item row
       (e.g. a delivery-schedule note after the subtotal) */
    var lm=ln.match(/^(\d{1,2})\s+([\d.,]+)\s+(units?|pcs?\.?|sets?|lots?|rolls?|boxes?)\s+([0-9][0-9A-Za-z]{8,})\s+(.+?)\s+\$?\s*([\d,]+\.\d{2})\s+\$?\s*([\d,]+\.\d{2})(?:\s+\S.*)?$/i);
    if(!lm)return;
    out.lines.push({
      qty:parseFloat(lm[2].replace(/,/g,"")),
      unit:lm[3].replace(/\.$/,""),
      pn:lm[4],
      description:lm[5].trim(),
      unitPrice:parseFloat(lm[6].replace(/,/g,"")),
      sortOrder:out.lines.length
    });
  });
  if((m=all.match(/TOTAL(?:\s+PRICE)?\s+\$?\s*([\d,]+\.\d{2})/i)))out.total=parseFloat(m[1].replace(/,/g,""));
  else if(out.lines.length)out.total=Math.round(out.lines.reduce(function(s,l){return s+l.qty*(l.unitPrice||0);},0)*100)/100;
  return out;
}
async function poFillFromPdf(){
  var pdfs=poPdfAtts();
  if(!pdfs.length){alert("Add the PO PDF first (drop it on the form).");return;}
  var m=document.getElementById("modal-po");
  var editing=!!m.getAttribute("data-edit-id");
  if(pdfs.length>1&&!editing){await poBulkImport(pdfs);return;}
  poStatus("Reading PDF…");
  try{
    var d=await poParseFile(pdfs[0]);
    if(d.poNumber)document.getElementById("po-number").value=d.poNumber;
    if(d.date)document.getElementById("po-date").value=d.date;
    if(d.office)document.getElementById("po-office").value=d.office;
    document.getElementById("po-currency").value=d.currency;
    if(d.lines.length){
      var rows=document.getElementById("pol-rows");
      rows.innerHTML="";
      d.lines.forEach(function(l){polAddRow(l);});
    }
    if(d.total!==null)document.getElementById("po-total").value=d.total;
    var msg=d.lines.length?("Filled: "+d.lines.length+" line"+(d.lines.length===1?"":"s")+" — check, then save."):"Read the header, but no line items matched — enter lines manually or check the PDF.";
    var dup=poFindByNumber(d.poNumber,m.getAttribute("data-edit-id"));
    if(dup)msg="⚠ "+d.poNumber+" is ALREADY recorded ("+(dup.date?trkFmtDate(dup.date):"no date")+", "+(dup.office||"?")+" office) — saving would create a duplicate. "+msg;
    poStatus(msg);
  }catch(err){
    poStatus("Could not read the PDF: "+err.message);
  }
}
/* Several PDFs dropped at once → one PO record per PDF, saved directly:
   parse, upload, insert PO + lines. POs whose number is already recorded
   are skipped, so re-dropping a folder of PDFs is safe. */
async function poBulkImport(pdfs){
  if(!confirm("Create "+pdfs.length+" separate POs — one per PDF?"))return;
  var made=0,skipped=[],failed=[];
  for(var i=0;i<pdfs.length;i++){
    var a=pdfs[i];
    showLoad("Importing "+(i+1)+" of "+pdfs.length+": "+a.name);
    try{
      var d=await poParseFile(a);
      if(!d.poNumber)throw new Error("no PO number found");
      if(PO_LIST.some(function(p){return p.poNumber.toLowerCase()===d.poNumber.toLowerCase();})){
        skipped.push(d.poNumber);
        continue;
      }
      await poUploadAtt(a);
      var p={poNumber:d.poNumber,office:d.office,date:d.date,currency:d.currency,total:d.total,notes:"",attachments:[{name:a.name,url:a.url}]};
      var r=await trkInsert("purchase_orders",poToDb(p));
      if(!r||!r[0])throw new Error("insert failed");
      p._id=r[0].id;p.createdAt=r[0].created_at;
      PO_LIST.push(p);
      for(var j=0;j<d.lines.length;j++){
        d.lines[j].poId=p._id;
        var rl=await trkInsert("po_lines",poLineToDb(d.lines[j]));
        if(rl&&rl[0])d.lines[j]._id=rl[0].id;
        PO_LINES.push(d.lines[j]);
      }
      made++;
    }catch(err){failed.push(a.name+" — "+err.message);}
  }
  hideLoad();
  closeModal("modal-po");
  renderPOs();
  var msg="Imported "+made+" PO"+(made===1?"":"s")+".";
  if(skipped.length)msg+="\nAlready recorded (skipped): "+skipped.join(", ");
  if(failed.length)msg+="\nFailed: "+failed.join("; ");
  alert(msg);
}
