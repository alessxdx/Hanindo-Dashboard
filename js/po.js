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
var PO_YEARS={};             /* year picked on each tab (see poApplyYear) */
/* paid / unpaid on the CUSTOM POs: off for now (2026-11-25). The dates stay
   saved; true brings back the Unpaid box, Status, Paid row and Paid on field */
var PO_SHOW_PAY=false;
if(PO_SHOW_PAY)document.documentElement.classList.add("po-show-pay");
var PO_FPAY=false;           /* only unpaid POs */
var PO_MODEL="";             /* model open in the By model side panel */
var PO_ATT=[];               /* modal attachment staging */
var PO_OFFICES=["China","Indonesia","Singapore"];
/* Sections share the page, one tab each: printer POs to CUSTOM (section
   empty), Automotive (same kind of orders) and Fire fighting expense sheets
   (amounts in IDR, lines carry category / group / supplier / price paid
   incl. VAT). */
var PO_FIRE="Fire fighting",PO_AUTO="Automotive";
/* value, name, logo (icons/co/). Fire Fighting is a department of Hanindo Citra */
var PO_SECS=[["","CUSTOM","custom"],[PO_AUTO,"Automotive","automotive"],[PO_FIRE,"Fire Fighting","citra"]];
/* the company that buys from CUSTOM in each office: logo, name */
var PO_COS={China:["shanghai","Hanindo Shanghai"],Singapore:["gralessando","Gralessando"],Indonesia:["automation","Hanindo Automation Solutions"]};
function poLogo(k,alt){return "<span class='po-logo'><img src='icons/co/"+k+".png' alt='"+trkEsc(alt)+"'></span>";}
var PO_SECTION="";try{PO_SECTION=localStorage.getItem("cpd_po_section")||"";}catch(e){}
if(!PO_SECS.some(function(s){return s[0]===PO_SECTION;}))PO_SECTION="";
function poInSec(p){return (p.section||"")===PO_SECTION;}
function poIsFire(){return PO_SECTION===PO_FIRE;}
function poSaveSec(v){PO_SECTION=v;try{localStorage.setItem("cpd_po_section",v);}catch(e){}}
function poGo(sec){
  if(sec!==PO_SECTION){poSaveSec(sec);PO_FOFFICE="";PO_SEARCH="";}
  poSetView("list");
}
function poSetView(v){
  PO_VIEW=v;PO_SEL="";PO_MODEL="";PO_FPAY=false;
  renderPOs();
}
function poThisYear(){return String(new Date().getFullYear());}
/* Orders opens on this year; By model and Fire Fighting on all years. A year
   picked in one place stays there. */
function poYearKey(){return PO_SECTION+"|"+PO_VIEW;}
function poApplyYear(){
  var k=poYearKey();
  PO_FYEAR=PO_YEARS[k]!==undefined?PO_YEARS[k]:
    !poIsFire()&&PO_VIEW==="list"&&PO_LIST.some(function(p){return poInSec(p)&&poYear(p)===poThisYear();})?poThisYear():"";
}
function poUnpaid(p){return PO_SHOW_PAY&&!!p.invoiceNo&&!p.paidDate;}
function poNum(v){return (v===null||v===undefined||v==="")?null:Number(v);}
function poOfficeSlug(o){return String(o||"").toLowerCase().replace(/\s/g,"");}

/* ===== converters ===== */
function dbToPo(r){return{_id:r.id,poNumber:r.po_number||"",office:r.office||"",date:r.po_date||"",vendor:r.vendor||"CUSTOM S.p.A.",currency:r.currency||"USD",total:(r.total===null||r.total===undefined)?null:Number(r.total),notes:r.notes||"",invoiceNo:r.invoice_no||"",paidDate:r.paid_date||"",receivedDate:r.received_date||"",attachments:Array.isArray(r.attachments)?r.attachments:[],section:r.section||"",projectId:r.project_id||"",createdAt:r.created_at||""};}
function poToDb(p){return{po_number:p.poNumber,office:p.office||null,po_date:p.date||null,vendor:p.vendor||(p.section===PO_AUTO?null:"CUSTOM S.p.A."),currency:p.currency||"USD",total:(p.total===null||isNaN(p.total))?null:p.total,notes:p.notes||null,invoice_no:p.invoiceNo||null,paid_date:p.paidDate||null,received_date:p.receivedDate||null,attachments:p.attachments||[],section:p.section||null,project_id:p.projectId||null};}
function dbToPoLine(r){return{_id:r.id,poId:r.po_id,pn:r.pn||"",description:r.description||"",qty:Number(r.qty)||0,unit:r.unit||"pcs",unitPrice:(r.unit_price===null||r.unit_price===undefined)?null:Number(r.unit_price),sortOrder:Number(r.sort_order)||0,category:r.category||"",itemGroup:r.item_group||"",supplier:r.supplier||"",actualTotal:poNum(r.actual_total),delivery:poNum(r.delivery),note:r.note||""};}
function poLineToDb(l){return{po_id:l.poId,pn:l.pn||null,description:l.description||null,qty:l.qty||0,unit:l.unit||"pcs",unit_price:(l.unitPrice===null||isNaN(l.unitPrice))?null:l.unitPrice,sort_order:l.sortOrder||0,category:l.category||null,item_group:l.itemGroup||null,supplier:l.supplier||null,actual_total:(l.actualTotal===null||l.actualTotal===undefined||isNaN(l.actualTotal))?null:l.actualTotal,delivery:(l.delivery===null||l.delivery===undefined||isNaN(l.delivery))?null:l.delivery,note:l.note||null};}

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
/* o.year: another year than the picked one; o.anyPay: paid ones too */
function poFiltered(o){
  o=o||{};
  var q=PO_SEARCH.trim().toLowerCase();
  var fire=poIsFire(),year=o.year!==undefined?o.year:PO_FYEAR;
  return PO_LIST.filter(function(p){
    if(!poInSec(p))return false;
    if(PO_FOFFICE&&p.office!==PO_FOFFICE)return false;
    if(year&&poYear(p)!==year)return false;
    if(PO_FPAY&&!fire&&!o.anyPay&&!poUnpaid(p))return false;
    if(q){
      var hay=(p.poNumber+" "+p.office+" "+p.notes+" "+p.invoiceNo+" "+
        poLinesFor(p._id).map(function(l){return l.pn+" "+l.description+" "+l.supplier+" "+l.itemGroup+" "+l.category;}).join(" ")).toLowerCase();
      if(hay.indexOf(q)===-1)return false;
    }
    return true;
  }).sort(function(a,b){
    var d=(b.date||"").localeCompare(a.date||"");
    return d!==0?d:(b.createdAt||"").localeCompare(a.createdAt||"");
  });
}

/* ===== where the search matched =====
   The list shows the matching item under the PO number; everywhere the
   matched text is marked, and an opened PO scrolls to its first match. */
function poQuery(){return PO_SEARCH.trim().toLowerCase();}
function poHas(s){var q=poQuery();return !!q&&String(s||"").toLowerCase().indexOf(q)>-1;}
function poLineHit(l){return poHas(l.pn)||poHas(l.description)||poHas(l.supplier)||poHas(l.itemGroup)||poHas(l.category);}
function poHitHtml(p){
  if(!poQuery()||poHas(p.poNumber)||poHas(p.office))return "";
  var hits=poLinesFor(p._id).filter(poLineHit),out=hits.slice(0,2).map(function(l){
    return "<div class='po-hit'>"+["<span class='po-q'>"+trkEsc(l.description||l.pn||"")+"</span>",
      l.pn&&l.description?"<span class='po-q'>"+trkEsc(l.pn)+"</span>":"",
      !poHas(l.pn)&&!poHas(l.description)?"<span class='po-q'>"+trkEsc([l.supplier,l.itemGroup,l.category].filter(poHas)[0]||"")+"</span>":"",
      l.qty.toLocaleString()+" "+trkEsc(l.unit)].filter(Boolean).join(" &middot; ")+"</div>";
  });
  if(hits.length>2)out.push("<div class='po-hit'>+"+(hits.length-2)+" more</div>");
  if(!out.length&&poHas(p.invoiceNo))out.push("<div class='po-hit'>Invoice <span class='po-q'>"+trkEsc(p.invoiceNo)+"</span></div>");
  if(!out.length&&poHas(p.notes)){
    var n=String(p.notes).replace(/\s+/g," "),i=Math.max(0,n.toLowerCase().indexOf(poQuery())-25);
    out.push("<div class='po-hit'>Note: <span class='po-q'>"+(i?"&hellip;":"")+trkEsc(n.slice(i,i+80))+(n.length>i+80?"&hellip;":"")+"</span></div>");
  }
  return out.join("");
}
function poMarkHits(){
  var q=poQuery(),root=document.getElementById("content");
  if(!q||!root)return;
  ntMark(root,[q],".po-q,.po-c-of,.po-panel-no,.po-pl-desc,.po-line-pn,.po-panel-note,.po-m-desc,.po-m-pn,.po-fl-name,.po-fl-sup,.po-fsup2-head span:first-child");
  [].forEach.call(root.querySelectorAll(".po-pl mark,.po-fl mark"),function(m){m.closest(".po-pl,.po-fl").classList.add("po-pl-hit");});
  /* bring the first match of the opened PO into view */
  var panel=root.querySelector(".po-panel"),m=panel&&panel.querySelector("mark");
  if(!m)return;
  var row=m.closest(".po-pl,.po-fl,.po-panel-note")||m;
  if(PO_FULL){if(!m.closest(".po-panel-no"))row.scrollIntoView({block:"center"});return;}
  var pr=panel.getBoundingClientRect(),r=row.getBoundingClientRect();
  var h=Math.min(panel.clientHeight,window.innerHeight-pr.top); // the part of the panel on screen
  if(r.bottom>pr.top+h)panel.scrollTop+=r.top-pr.top-Math.max(60,h/3);
}

/* ===== toolbar / stats ===== */
function poSyncToolbar(){
  var btn=document.querySelector("#toolbar .btn-add");
  if(!btn||currentTab!=="po")return;
  if(typeof TRK_BTN_HTML!=="undefined"&&TRK_BTN_HTML===null)TRK_BTN_HTML=btn.innerHTML;
  btn.style.display="";
  if(typeof TRK_BTN_HTML==="string")btn.innerHTML=TRK_BTN_HTML.replace("Add entry",poIsFire()?"Add expenses":"Add PO");
}
/* spend, printers (not parts) and how many printer models in a set of POs */
function poSums(list){
  var r={spend:0,printers:0,models:{}},all=PO_SECTION===PO_AUTO;
  list.forEach(function(p){
    var u=poUsd(p.total,p.currency);
    if(u!==null)r.spend+=u;
    poLinesFor(p._id).forEach(function(l){
      if(all||poIsPrinter(l.pn)){r.printers+=l.qty;r.models[poModelKey(l)]=1;}
    });
  });
  return r;
}
function poUsdTxt(v){return typeof fxFormatUSD==="function"?fxFormatUSD(v):"$"+Math.round(v).toLocaleString();}
/* Boxes that follow the year, office and search. The current year is
   compared with last year up to the same date; older years are complete, so
   they just show their count. */
function poRenderStats(){
  var el=document.getElementById("stats");
  if(!el)return;
  if(poIsFire()){poFireStats(el,poFiltered());return;}
  var all=poFiltered({anyPay:true}),s=poSums(all);
  var ny=poThisYear(),prev=null;
  if(PO_FYEAR===ny){
    var d=new Date(),md=("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
    prev=poSums(poFiltered({anyPay:true,year:String(ny-1)}).filter(function(p){return p.date.slice(5)<=md;}));
  }
  function vs(now,was,plain){
    if(!prev||!was)return plain;
    var pc=Math.round((now-was)/was*100);
    return "<b>"+(pc>0?"&#9650; "+pc+"%":pc<0?"&#9660; "+(-pc)+"%":"same")+"</b> vs same date "+(ny-1);
  }
  var nModels=Object.keys(s.models).length;
  var un=all.filter(poUnpaid),unUsd=0;
  un.forEach(function(p){unUsd+=poUsd(p.total,p.currency)||0;});
  var can=un.length||PO_FPAY;
  el.innerHTML=
    "<div class='stat po-stat cb-stat-rev'><div class='stat-label'>"+(PO_FYEAR?"Spend in "+PO_FYEAR:"Total spend")+"</div><div class='stat-value'>"+poUsdTxt(s.spend)+"</div><div class='stat-sub'>"+vs(s.spend,prev&&prev.spend,all.length+" PO"+(all.length===1?"":"s"))+"</div></div>"+
    "<div class='stat po-stat'><div class='stat-label'>"+(PO_SECTION===PO_AUTO?"Units":"Printers")+" ordered</div><div class='stat-value'>"+s.printers.toLocaleString()+"</div><div class='stat-sub'>"+vs(s.printers,prev&&prev.printers,nModels+(PO_SECTION===PO_AUTO?" item":" model")+(nModels===1?"":"s"))+"</div></div>"+
    (!PO_SHOW_PAY?"":"<div class='stat po-stat"+(can?" po-stat-btn":"")+(PO_FPAY?" on":"")+"'"+(can?" role='button' tabindex='0' aria-pressed='"+PO_FPAY+"' onclick='poToggleUnpaid()' onkeydown='if(event.key===\"Enter\"||event.key===\" \"){event.preventDefault();poToggleUnpaid();}'":"")+">"+
      "<div class='stat-label'>Unpaid</div><div class='stat-value'>"+(un.length?un.length+" PO"+(un.length===1?"":"s"):"None")+"</div>"+
      "<div class='stat-sub'>"+(PO_FPAY?"Showing only these &middot; <u>show all</u>":un.length?poUsdTxt(unUsd)+" of POs &middot; <u>show them</u>":"of those with an invoice recorded")+"</div></div>");
}
/* the Unpaid box lists the unpaid POs; a second click shows all again */
function poToggleUnpaid(){
  PO_FPAY=!PO_FPAY;
  if(PO_FPAY&&PO_VIEW!=="list"){var y=PO_FYEAR;PO_VIEW="list";PO_YEARS[poYearKey()]=y;PO_MODEL="";}
  poDropSel();
  renderPOs();
}
/* a filter was changed on purpose: the open PO closes if it is filtered out
   (a PO opened from a link instead brings its own year into view) */
function poDropSel(){
  if(PO_SEL&&!poFiltered().some(function(p){return p._id===PO_SEL;}))PO_SEL="";
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
  /* an item opened from the address or another page: show where it is */
  if(PO_SEL){
    var rec=PO_LIST.filter(function(p){return p._id===PO_SEL;})[0];
    if(rec){
      if(!poInSec(rec)){poSaveSec(rec.section||"");PO_FOFFICE="";PO_SEARCH="";}
      PO_VIEW="list";
      poApplyYear();
      if(PO_FYEAR&&poYear(rec)!==PO_FYEAR)PO_YEARS[poYearKey()]=poYear(rec);
      if(PO_FPAY&&!poUnpaid(rec))PO_FPAY=false;
    }
  }
  poApplyYear();
  var list=poFiltered();
  poRenderStats();

  var years=[];
  PO_LIST.filter(poInSec).forEach(function(p){var y=poYear(p);if(y&&years.indexOf(y)===-1)years.push(y);});
  years.sort().reverse();

  /* sections as logos, under CUSTOM its three companies, then view, search
     and year with the add button */
  var fire=poIsFire();
  var tabs="<div class='po-secs'>"+PO_SECS.map(function(s){
    var on=PO_SECTION===s[0];
    return "<button class='po-co"+(on?" on":"")+"'"+(on?" aria-current='page'":"")+" onclick='poGo(\""+s[0]+"\")'>"+poLogo(s[2],"")+"<span class='po-co-n'>"+s[1]+"</span></button>";
  }).join("")+"</div>"+
    (PO_SECTION?"":"<div class='po-cos' role='group' aria-label='Company'>"+
      "<button class='po-co po-co-all"+(PO_FOFFICE?"":" on")+"' aria-pressed='"+!PO_FOFFICE+"' onclick='poPickOffice(\"\")'>All offices</button>"+
      ["China","Singapore","Indonesia"].map(function(o){
        var on=PO_FOFFICE===o,c=PO_COS[o];
        return "<button class='po-co"+(on?" on":"")+"' title='"+c[1]+", "+o+"' aria-pressed='"+on+"' onclick='poPickOffice(\""+(on?"":o)+"\")'>"+poLogo(c[0],c[1]+", "+o)+"</button>";
      }).join("")+"</div>");
  var add="<button class='btn-add po-add' onclick='openModal()'><svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' style='width:13px;height:13px'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg> "+(fire?"Add expenses":"Add PO")+"</button>";
  var seg="<div class='po-seg'>"+[["list",fire?"List":"Orders"],["models",fire?"By group":"By model"]].map(function(v){
    return "<button class='po-seg-btn"+(PO_VIEW===v[0]?" active":"")+"' onclick='poSetView(\""+v[0]+"\")'>"+v[1]+"</button>";
  }).join("")+"</div>";
  var more=0;
  if(PO_SEARCH.trim()&&PO_FYEAR)more=poFiltered({year:""}).length-list.length;
  var toolbar=
    "<div class='po-bar'>"+seg+
      "<div class='po-filt'><label class='po-searchbox'>"+
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' aria-hidden='true'><circle cx='11' cy='11' r='7'/><path d='M20 20l-4-4'/></svg>"+
        "<input id='po-search' placeholder='"+(fire?"Search item or supplier":"Search PO no., model or P/N")+"' value='"+trkEsc(PO_SEARCH)+"' oninput='poSearchInput(this.value)'>"+
      "</label>"+
      uiDropdown({key:"po-year",onPick:"poPickYear",cur:PO_FYEAR,opts:[{value:"",label:"All years"}].concat(years.map(function(y){
        return {value:y,label:y};
      }))})+
    "</div>"+add+"</div>"+
    /* the page opens on this year: a search says when older years match too */
    (more>0?"<button class='po-more' onclick='poPickYear(\"\")'>"+more+" more in other years &middot; <u>search all years</u></button>":"");

  if(PO_SEL&&!list.some(function(p){return p._id===PO_SEL;}))PO_SEL="";
  if(!PO_SEL)PO_FULL=false;
  if(PO_FULL){
    var fp=PO_LIST.filter(function(p){return p._id===PO_SEL;})[0];
    content.innerHTML="<button class='trk-back' onclick='poToggleFull()'>&larr; All "+(fire?"expense sheets":"purchase orders")+"</button>"+
      (fp.section===PO_FIRE?poFirePanelHtml(fp):poPanelHtml(fp));
    poMarkHits();
    return;
  }
  content.innerHTML=tabs+toolbar+(fire?"":poGapHtml())+(fire?(PO_VIEW==="models"?poFireGroupsHtml(list):poTableHtml(list)):(PO_VIEW==="models"?poModelsHtml(list):poTableHtml(list)));
  poMarkHits();
}

/* a PO whose items don't add up to its total: usually a line the PDF reader
   skipped (two part numbers in one row). Returns total minus items, 0 when
   they match. Fire fighting sheets have their own totals. */
function poGapOf(total,lines){
  if(total===null||total===undefined||isNaN(total))return 0;
  var d=Math.round((total-lines.reduce(function(t,l){return t+l.qty*(l.unitPrice||0);},0))*100)/100;
  return Math.abs(d)>0.05?d:0;
}
function poGap(p){return p.section===PO_FIRE?0:poGapOf(p.total,poLinesFor(p._id));}
function poGapTxt(d,cur){return poFmtMoney(Math.abs(d),cur)+(d>0?" missing":" too much");}
/* one line above the list, only when there is a gap; looks at every year */
function poGapHtml(){
  var gaps=PO_LIST.filter(function(p){return poInSec(p)&&poGap(p);})
    .sort(function(a,b){return (b.date||"").localeCompare(a.date||"");});
  if(!gaps.length)return "";
  return "<div class='po-gap' role='status'><b>Items don't add up to the PO total</b>"+gaps.map(function(p){
    return "<button class='po-gap-po' onclick='poOpenGap(\""+p._id+"\")'><u>"+trkEsc(p.poNumber)+"</u> "+poGapTxt(poGap(p),p.currency)+"</button>";
  }).join("")+"</div>";
}
function poOpenGap(id){PO_FOFFICE="";poOpenFromModel(id);}

function poPickOffice(v){PO_FOFFICE=v;poDropSel();renderPOs();}
function poPickYear(v){PO_YEARS[poYearKey()]=v;PO_FYEAR=v;poDropSel();renderPOs();}

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
  var fire=poIsFire();
  var groups=[],byLabel={};
  list.forEach(function(p){
    var ml=poMonthLabel(p);
    if(!byLabel[ml]){byLabel[ml]=[];groups.push(ml);}
    byLabel[ml].push(p);
  });
  /* simple list: month heading with its total, then one row per PO */
  var pay=PO_SHOW_PAY&&!fire,cols=fire?3:pay?5:4;
  var rows=groups.map(function(ml){
    var g=byLabel[ml];
    return "<tr class='po-grp2'><td colspan='"+(cols-1)+"'>"+ml+"</td>"+
      "<td class='num'>"+(fire?poFmtMoney(g.reduce(function(t,p){return t+(p.total||0);},0),"IDR"):poUsdSum(g))+"</td></tr>"+
      g.map(function(p){
        return "<tr class='po-row"+(PO_SEL===p._id?" sel":"")+"' onclick='poSelect(\""+p._id+"\")'>"+
          "<td class='po-c-no'><span class='po-q'>"+trkEsc(p.poNumber)+"</span>"+poHitHtml(p)+"</td>"+
          (fire?"":"<td class='po-c-of po-oftxt-"+poOfficeSlug(p.office)+"'>"+trkEsc(p.office||"")+"</td>")+
          "<td class='po-c-date'>"+(p.date?trkFmtDate(p.date):"&mdash;")+"</td>"+
          (!pay?"":"<td class='po-c-st'>"+(p.paidDate?"<span class='po-paid'>Paid</span>":poUnpaid(p)?"<span class='po-unpaid' title='Invoiced, not yet paid'>Unpaid</span>":"")+"</td>")+
          "<td class='num po-c-amt'>"+poFmtMoney(p.total,p.currency)+"</td>"+
        "</tr>";
      }).join("");
  }).join("");
  var sel=PO_SEL?PO_LIST.filter(function(p){return p._id===PO_SEL;})[0]:null;
  return "<div class='po-split"+(sel?" has-sel":"")+"'>"+
    "<div class='po-table-wrap'><table class='po-table po-list po-simple'>"+
      "<thead><tr><th>"+(fire?"Expense sheet":"PO")+"</th>"+(fire?"":"<th>Office</th>")+"<th>Date</th>"+(pay?"<th>Status</th>":"")+"<th class='num'>Amount</th></tr></thead>"+
      "<tbody>"+rows+"</tbody></table></div>"+
    (sel?(sel.section===PO_FIRE?poFirePanelHtml(sel):poPanelHtml(sel)):"")+
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
  var atts=(p.attachments||[]).map(trkAttHtml).join(" ");
  return "<aside class='po-panel"+(PO_FULL?" po-full":"")+"'>"+
    "<div class='po-panel-head'><span class='po-panel-no'>"+trkEsc(p.poNumber)+"</span>"+
      (PO_FULL?"":"<button class='trk-pn-expand' title='Open full page' aria-label='Open full page' onclick='poToggleFull()'>&#x2922;</button><button class='po-panel-x' aria-label='Close' onclick='poSelect(\"\")'>&times;</button>")+"</div>"+
    (PO_COS[p.office]&&!p.section?"<div class='po-panel-co'>"+poLogo(PO_COS[p.office][0],PO_COS[p.office][1])+"</div>":"")+
    "<div class='po-panel-meta'>"+(p.office?"<span class='trk-badge po-of-"+poOfficeSlug(p.office)+"'>"+trkEsc(p.office)+" office</span>":"")+
      (p.date?"<span>"+trkFmtDate(p.date)+"</span>":"")+"</div>"+
    "<div class='po-panel-total'>"+poFmtMoney(p.total,p.currency)+
      ((p.currency!=="USD"&&typeof fxUsdText==="function"&&p.total!==null)?" <span class='trk-value-usd'>"+fxUsdText(p.total,p.currency)+"</span>":"")+"</div>"+
    (poGap(p)?"<div class='po-gap po-gap-in'>Items listed add up to "+poFmtMoney(p.total-poGap(p),p.currency)+": <b>"+poGapTxt(poGap(p),p.currency)+"</b>. Check the PDF.</div>":"")+
    poPanelStatusHtml(p)+
    (lines.length?"<div class='po-panel-sec'>"+lines.length+" line"+(lines.length===1?"":"s")+"</div>"+lineRows:"")+
    (atts?"<div class='po-panel-sec'>Files</div><div class='trk-tl-atts'>"+atts+"</div>":"")+
    (p.notes?"<div class='po-panel-sec'>Note</div><div class='po-panel-note'>"+trkEsc(p.notes)+"</div>":"")+
    "<div class='po-panel-acts'><button class='btn-save' onclick='poEdit(\""+p._id+"\")'>Edit PO</button></div>"+
  "</aside>";
}
/* invoice / payment / receipt — filled for the offices that track them */
function poPanelStatusHtml(p){
  if(!p.invoiceNo&&!(PO_SHOW_PAY&&p.paidDate)&&!p.receivedDate)return "";
  function row(k,v){return "<div class='po-st-row'><span>"+k+"</span><span>"+v+"</span></div>";}
  return "<div class='po-panel-sec'>Invoice &amp; delivery</div>"+
    (p.invoiceNo?row("Invoice","<span class='po-line-pn'>"+trkEsc(p.invoiceNo)+"</span>"):"")+
    (!PO_SHOW_PAY?"":row("Paid",p.paidDate?trkFmtDate(p.paidDate):"<span class='po-unpaid'>Not yet</span>"))+
    row("Received",p.receivedDate?trkFmtDate(p.receivedDate):"<span class='po-dim'>&mdash;</span>");
}
var PO_FULL=false;
/* a row click opens the side panel; clicking the open one again expands
   it to the full page (as in the tracker and Customer Base) */
function poSelect(id){
  if(id&&id===PO_SEL){PO_FULL=true;renderPOs();window.scrollTo(0,0);return;}
  PO_SEL=id||"";PO_FULL=false;renderPOs();
}
function poToggleFull(){PO_FULL=!PO_FULL;renderPOs();window.scrollTo(0,0);}
/* Esc closes the panel; up/down step through the visible POs */
document.addEventListener("keydown",function(e){
  if(typeof currentTab==="undefined"||currentTab!=="po")return;
  if(e.key==="Escape"&&PO_VIEW==="models"&&PO_MODEL&&!/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||"")&&!document.querySelector(".modal-overlay.open")){poPickModel("");return;}
  if(PO_VIEW!=="list"||!PO_SEL)return;
  if(PO_FULL&&e.key!=="Escape")return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||""))return;
  if(document.querySelector(".modal-overlay.open"))return;
  if(e.key==="Escape"){if(PO_FULL)PO_FULL=false;else PO_SEL="";renderPOs();return;}
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
  if(poIsFire())return "<div class='empty'>"+(PO_SEARCH||PO_FYEAR?"No expense sheets match this filter.":"No fire fighting expenses yet. Click <strong>+ Add expenses</strong>.")+"</div>";
  return "<div class='empty'>"+(PO_LIST.some(poInSec)?"No purchase orders match this filter.":"No "+(PO_SECTION===PO_AUTO?"Automotive ":"")+"purchase orders yet. Click <strong>+ Add PO</strong> and drop the PO PDF — the form fills itself.")+"</div>";
}

/* ===== "By model" — what was bought of each model, and at what price =====
   PO_SAME joins part numbers that are the same model (old P/N -> new P/N),
   so a model whose P/N changed over the years is one row. Display only: the
   lines keep their own P/N, and every joined P/N is listed with its units.
   Not joined: TK180 plastic SITA (911HL0206) / AEA (911HL0209) and the two
   K80 P/Ns, which CUSTOM lists as separate products. */
var PO_SAME={
  "915DW011000300":"915DW011200300", /* VKP80II SX -> RX */
  "915DX010700300":"915DX011700300", /* VKP80III rear connector, RX63 -> RX65 */
  "915CG040200300":"915CG060100300","915CG040200300 or 915CG060100300":"915CG060100300", /* TG2460HIII */
  "915CH020100300":"915CH030100300", /* TG2480HIII */
  "2C160000000312":"2C160000000024"  /* VKP80II thermal head */
};
function poModelKey(l){var k=l.pn||l.description||"?";return String(PO_SAME[k]||k).toLowerCase();}
/* 911 / 915 part numbers are printers; everything else is a part or accessory */
function poIsPrinter(pn){return /^91[15]/.test(pn||"");}
/* the printer a part is for, read from its description; the first one named
   wins ("Mechanism K80/TG2480" is under K80) */
var PO_PRINTERS=[
  ["VKP80III",/VKP\s?(?:80)?\s?III/i],["VKP80II",/VKP\s?(?:80)?\s?II(?!I)/i],["VKP60",/VKP\s?60/i],
  ["KPM150H",/KPM150/i],["KPM180H",/KPM180/i],["KPM216H",/KP?M216/i],
  ["TG2460H",/TG2460/i],["TG2480H",/TG2480/i],
  ["TK180",/TK180/i],["TK202III",/TK202/i],["TK302III",/TK302/i],["TL60III",/TL60/i],["TL80III",/TL80/i],
  ["MODUS3",/MODUS\s?3/i],["PLUS2",/PLUS2/i],["PLUS4",/PLUS4/i],["PM2",/\bPM2\b/i],
  ["P3L",/\bP3L\b/i],["P3",/\bP3\b/i],["MY3",/\bMY3\b/i],["KX80S",/KX80/i],["K80",/\bK80\b/i],["SPPL scanner",/SPPL/i]
];
var PO_OTHERS="Others";
function poPrinterIn(text){
  var best="",at=1e9;
  PO_PRINTERS.forEach(function(x){
    var i=String(text||"").search(x[1]);
    if(i>-1&&i<at){at=i;best=x[0];}
  });
  return best;
}
/* bought under several descriptions: the printer named for most units */
function poPartFor(g){
  var n={},best=PO_OTHERS;
  g.buys.forEach(function(b){var m=poPrinterIn(b.l.description);if(m)n[m]=(n[m]||0)+b.l.qty;});
  Object.keys(n).forEach(function(m){if(best===PO_OTHERS||n[m]>n[best])best=m;});
  return best;
}
/* one way of writing a model, so A to Z works: "PRINTER KPM180H" -> "KPM180H" */
function poModelName(g){
  var d=(g.desc||g.pns[0]||"—").replace(/\s+/g," ").trim().replace(/VKP 80/gi,"VKP80").replace(/([A-Z])u(?=[A-Z])/g,"$1U").replace(/uSB/g,"USB");
  return g.printer?d.replace(/^(PRINTER|PROP)\s+/i,""):d;
}
function poAz(a,b){return String(a).localeCompare(String(b),"en",{numeric:true,sensitivity:"base"});}
function poModelGroups(list){
  var ids={},groups={};
  list.forEach(function(p){ids[p._id]=p;});
  PO_LINES.forEach(function(l){
    var p=ids[l.poId];
    if(!p)return;
    var key=poModelKey(l),g=groups[key];
    if(!g)g=groups[key]={key:key,pns:[],desc:"",printer:PO_SECTION!==PO_AUTO&&poIsPrinter(l.pn),units:0,spend:0,priced:0,buys:[],hit:0,byPn:{}};
    if(l.pn&&g.pns.indexOf(l.pn)===-1)g.pns.push(l.pn);
    if((l.description||"").length>g.desc.length)g.desc=l.description;
    if(poLineHit(l))g.hit=1;
    g.units+=l.qty;
    if(l.pn)g.byPn[l.pn]=(g.byPn[l.pn]||0)+l.qty;
    var usd=l.unitPrice===null?null:poUsd(l.unitPrice*l.qty,p.currency);
    if(usd!==null){g.spend+=usd;g.priced+=l.qty;}
    g.buys.push({p:p,l:l,usd:usd});
  });
  return Object.keys(groups).map(function(k){
    var g=groups[k];
    g.buys.sort(function(a,b){return (a.p.date||"").localeCompare(b.p.date||"");});
    g.name=poModelName(g);
    g.sub=g.printer||PO_SECTION===PO_AUTO?"":poPartFor(g);
    return g;
  }).sort(function(a,b){return poAz(a.name,b.name)||poAz(a.pns[0],b.pns[0]);});
}
/* the latest price, and the one before it at the same office (offices can
   pay different prices, so comparing across them would look like a change) */
function poLastPrice(g){
  var b=g.buys.filter(function(x){return x.l.unitPrice!==null;}),last=b[b.length-1];
  if(!last)return "&mdash;";
  var was=b.filter(function(x){return x.p.office===last.p.office&&x.p.currency===last.p.currency&&x.l.unitPrice!==last.l.unitPrice;}).pop();
  return poFmtMoney(last.l.unitPrice,last.p.currency)+
    (was?"<div class='po-m-trend "+(last.l.unitPrice>was.l.unitPrice?"po-up'>&#9650;":"po-down'>&#9660;")+" was "+poFmtMoney(was.l.unitPrice,was.p.currency)+"</div>":"");
}
/* every part number of the model; with its units when there are several */
function poPnsHtml(g){
  return g.pns.map(function(pn){
    return "<div class='po-m-pn'>"+trkEsc(pn)+(g.pns.length>1?" &middot; "+g.byPn[pn].toLocaleString()+" units":"")+"</div>";
  }).join("");
}
function poModelsHtml(list){
  var groups=poModelGroups(list);
  if(poQuery()&&groups.some(function(g){return g.hit;}))groups=groups.filter(function(g){return g.hit;});
  if(!groups.length)return poEmptyHtml();
  function head(cls,title,gs){
    var u=0,t=0;
    gs.forEach(function(g){u+=g.units;t+=g.spend;});
    return "<tr class='"+cls+"'><td>"+trkEsc(title)+"</td><td class='num' data-label='Units'>"+u.toLocaleString()+"</td><td class='num' data-label='Total spent'>"+poUsdTxt(t)+"</td><td></td></tr>";
  }
  function row(g){
    return "<tr class='po-row"+(PO_MODEL===g.key?" sel":"")+"' data-k='"+trkEsc(g.key)+"' onclick='poPickModel(this.getAttribute(\"data-k\"))'>"+
      "<td><div class='po-m-desc'>"+trkEsc(g.name)+"</div>"+poPnsHtml(g)+"</td>"+
      "<td class='num po-m-units' data-label='Units'>"+g.units.toLocaleString()+"</td>"+
      "<td class='num po-m-spend' data-label='Total spent'>"+poUsdTxt(g.spend)+"</td>"+
      "<td class='num po-m-last' data-label='Last price'>"+poLastPrice(g)+"</td>"+
    "</tr>";
  }
  function rows(title,gs){
    if(!gs.length)return "";
    return head("po-grp2",title,gs)+gs.map(row).join("");
  }
  /* parts: one subheading per printer, A to Z, Others last */
  function partRows(gs){
    var subs={};
    gs.forEach(function(g){(subs[g.sub]=subs[g.sub]||[]).push(g);});
    return gs.length?head("po-grp2","Parts and accessories",gs)+Object.keys(subs).sort(function(a,b){
      return (a===PO_OTHERS?1:0)-(b===PO_OTHERS?1:0)||poAz(a,b);
    }).map(function(k){return head("po-sub",k,subs[k])+subs[k].map(row).join("");}).join(""):"";
  }
  var sel=PO_MODEL?poModelPanelHtml():"";
  return "<div class='po-split"+(sel?" has-sel":"")+"'><div class='po-table-wrap'><table class='po-table po-models'>"+
    "<thead><tr><th>Model</th><th class='num'>Units</th><th class='num'>Total spent</th><th class='num'>Last price</th></tr></thead>"+
    "<tbody>"+(PO_SECTION===PO_AUTO?rows("Items",groups):rows("Printers",groups.filter(function(g){return g.printer;}))+partRows(groups.filter(function(g){return !g.printer;})))+"</tbody></table></div>"+sel+"</div>";
}
function poPickModel(k){PO_MODEL=PO_MODEL===k?"":(k||"");renderPOs();}
/* one model: every year, every office, every order (the office menu applies,
   the year menu does not, so the price history is always complete) */
function poModelPanelHtml(){
  var g=poModelGroups(PO_LIST.filter(function(p){return poInSec(p)&&(!PO_FOFFICE||p.office===PO_FOFFICE);}))
    .filter(function(x){return x.key===PO_MODEL;})[0];
  if(!g){PO_MODEL="";return "";}
  function table(title,keyOf,order){
    var m={};
    g.buys.forEach(function(b){
      var k=keyOf(b)||"—",r=m[k]=m[k]||{u:0,s:0,last:null,p:{}};
      r.u+=b.l.qty;
      if(b.usd!==null){r.s+=b.usd;r.last=b;r.p[b.l.unitPrice]=1;}
    });
    return "<div class='po-panel-sec'>"+title+"</div><table class='po-mt'><thead><tr><th></th><th>Units</th><th>Last price</th><th>Total</th></tr></thead><tbody>"+
      Object.keys(m).sort(order).map(function(k){
        var r=m[k],ps=Object.keys(r.p).map(Number),lo=Math.min.apply(null,ps),hi=Math.max.apply(null,ps);
        return "<tr><td>"+trkEsc(k)+"</td><td>"+r.u.toLocaleString()+"</td><td>"+(r.last?poFmtMoney(r.last.l.unitPrice,r.last.p.currency):"&mdash;")+
          (ps.length>1?"<div class='po-dim'>"+poFmtMoney(lo,"USD")+" to "+poFmtMoney(hi,"USD")+"</div>":"")+
          "</td><td>"+poUsdTxt(r.s)+"</td></tr>";
      }).join("")+"</tbody></table>";
  }
  var miss=g.units-g.priced;
  return "<aside class='po-panel po-model-panel'>"+
    "<div class='po-panel-head'><span class='po-panel-no'>"+trkEsc(g.name)+"</span>"+
      "<button class='po-panel-x' aria-label='Close' onclick='poPickModel(\"\")'>&times;</button></div>"+
    "<div class='po-panel-meta'><span>"+(g.pns.length>1?g.pns.length+" part numbers":trkEsc(g.pns[0]||""))+(PO_FOFFICE?" &middot; "+trkEsc(PO_FOFFICE)+" only":"")+"</span></div>"+
    "<div class='po-panel-total'>"+poUsdTxt(g.spend)+"<span class='po-mt-u'>"+g.units.toLocaleString()+" units</span></div>"+
    (miss>0?"<div class='po-dim'>"+miss.toLocaleString()+" units have no price recorded</div>":"")+
    (g.pns.length>1?table("By part number",function(b){return b.l.pn;}):"")+
    table("By year",function(b){return poYear(b.p);},function(a,b){return b.localeCompare(a);})+
    (PO_FOFFICE?"":table("By office",function(b){return b.p.office;}))+
    "<div class='po-panel-sec'>"+g.buys.length+" order line"+(g.buys.length===1?"":"s")+"</div>"+
    g.buys.slice().reverse().map(function(b){
      return "<button class='po-pl po-mb' onclick='poOpenFromModel(\""+b.p._id+"\")'>"+
        "<span class='po-pl-main'><span class='po-pl-desc'>"+trkEsc(b.p.poNumber)+"</span>"+
          "<span class='po-dim'>"+[trkEsc(b.p.office||""),b.p.date?trkFmtDate(b.p.date):""].filter(Boolean).join(" &middot; ")+"</span></span>"+
        "<span class='po-mb-r'><span class='po-pl-sub'>"+b.l.qty.toLocaleString()+(b.l.unitPrice!==null?" &times; "+poFmtMoney(b.l.unitPrice,b.p.currency):"")+"</span>"+
          (g.pns.length>1?"<span class='po-dim'>"+trkEsc(b.l.pn)+"</span>":"")+"</span>"+
      "</button>";
    }).join("")+
  "</aside>";
}
function poOpenFromModel(id){
  PO_VIEW="list";PO_SEL=id;PO_FULL=false;PO_MODEL="";PO_SEARCH="";
  renderPOs();
  var r=document.querySelector(".po-row.sel");
  if(r)r.scrollIntoView({block:"center"});
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
    "<div class='pol-x'>"+
      "<input class='pol-cat' placeholder='Category' list='pol-cat-list' value='"+trkEsc(l.category||"")+"'>"+
      "<input class='pol-grp' placeholder='Group (e.g. Welding electrodes)' list='pol-grp-list' value='"+trkEsc(l.itemGroup||"")+"'>"+
      "<input class='pol-sup' placeholder='Supplier' value='"+trkEsc(l.supplier||"")+"'>"+
      "<input class='pol-act' type='number' step='any' placeholder='Paid incl. VAT' value='"+(l.actualTotal!==undefined&&l.actualTotal!==null?l.actualTotal:"")+"' oninput='poRecalc()'>"+
      "<input class='pol-dlv' type='number' step='any' placeholder='Delivery' value='"+(l.delivery!==undefined&&l.delivery!==null?l.delivery:"")+"' oninput='poRecalc()'>"+
      "<input class='pol-note' placeholder='Note' value='"+trkEsc(l.note||"")+"'>"+
    "</div>"+
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
      sortOrder:i,
      category:row.querySelector(".pol-cat").value.trim(),
      itemGroup:row.querySelector(".pol-grp").value.trim(),
      supplier:row.querySelector(".pol-sup").value.trim(),
      actualTotal:row.querySelector(".pol-act").value===""?null:parseFloat(row.querySelector(".pol-act").value),
      delivery:row.querySelector(".pol-dlv").value===""?null:parseFloat(row.querySelector(".pol-dlv").value),
      note:row.querySelector(".pol-note").value.trim()
    };
  }).filter(function(l){return l.qty||l.pn||l.description;});
}
function poRecalc(){
  var sum=0,any=false;
  var fire=document.getElementById("modal-po").classList.contains("po-fire");
  polReadRows().forEach(function(l){
    if(fire){var t=poFireLinePaid(l);if(t!==null){sum+=t;any=true;}if(l.delivery)sum+=l.delivery;return;}
    if(l.unitPrice!==null&&!isNaN(l.unitPrice)){sum+=l.qty*l.unitPrice;any=true;}
  });
  if(any)document.getElementById("po-total").value=Math.round(sum*100)/100;
}
function poOpenModal(){
  var m=document.getElementById("modal-po");
  m.removeAttribute("data-edit-id");
  PO_EDIT_SEC=PO_SECTION;
  poModalMode(poIsFire());
  document.getElementById("po-modal-title").textContent=poIsFire()?"Add fire fighting expenses":"Add purchase order";
  document.getElementById("btn-delete-po").style.display="none";
  m.querySelectorAll("input,textarea").forEach(function(el){el.value="";});
  document.getElementById("po-office").value="";
  document.getElementById("po-currency").value=poIsFire()?"IDR":"USD";
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
  PO_EDIT_SEC=p.section||"";
  poModalMode(p.section===PO_FIRE);
  document.getElementById("po-modal-title").textContent=p.section===PO_FIRE?"Edit fire fighting expenses":"Edit purchase order";
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
  document.getElementById("po-project").value=p.projectId||"";
  document.getElementById("po-parse-status").textContent="";
  var rows=document.getElementById("pol-rows");
  rows.innerHTML="";
  poLinesFor(id).forEach(function(l){polAddRow(l);});
  var fi=document.getElementById("po-files");if(fi)fi.value="";
  PO_ATT=(p.attachments||[]).map(function(a){return{name:a.name,url:a.url};});
  poRenderAttList();
  m.classList.add("open");
}
var PO_EDIT_SEC="";            /* section of the PO in the form */
async function poSave(){
  var num=document.getElementById("po-number").value.trim();
  var fireM=document.getElementById("modal-po").classList.contains("po-fire");
  if(!num){alert(fireM?"Please enter a name for this expense sheet.":"Please enter the PO number.");return;}
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
    attachments:PO_ATT.map(function(a){return{name:a.name,url:a.url};}),
    section:PO_EDIT_SEC,
    projectId:fireM?document.getElementById("po-project").value:""
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
    var gap=poGapOf(d.total,d.lines);
    if(gap&&d.lines.length)msg="⚠ The items read don't add up to the PO total: "+poGapTxt(gap,d.currency)+". A line may have been skipped, check the PDF. "+msg;
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
  var made=0,skipped=[],failed=[],gaps=[];
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
      var p={poNumber:d.poNumber,office:d.office,date:d.date,currency:d.currency,total:d.total,notes:"",section:PO_EDIT_SEC,attachments:[{name:a.name,url:a.url}]};
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
      if(poGap(p))gaps.push(p.poNumber+" ("+poGapTxt(poGap(p),p.currency)+")");
    }catch(err){failed.push(a.name+" — "+err.message);}
  }
  hideLoad();
  closeModal("modal-po");
  renderPOs();
  var msg="Imported "+made+" PO"+(made===1?"":"s")+".";
  if(skipped.length)msg+="\nAlready recorded (skipped): "+skipped.join(", ");
  if(failed.length)msg+="\nFailed: "+failed.join("; ");
  if(gaps.length)msg+="\n\n⚠ Items don't add up to the PO total, a line may have been skipped: "+gaps.join(", ");
  alert(msg);
}


/* ===== Fire fighting expenses ===== */
var PO_FIRE_CATS=["Office equipment (HC)","Project supplies"];
/* what a line actually cost: price paid incl. VAT, else qty x unit price */
function poFireLinePaid(l){
  if(l.actualTotal!==null&&l.actualTotal!==undefined&&!isNaN(l.actualTotal))return l.actualTotal;
  if(l.unitPrice!==null&&l.unitPrice!==undefined&&!isNaN(l.unitPrice)){
    /* a line paid together with the one above it has no own amount */
    return l.note&&/paid together/i.test(l.note)?0:l.qty*l.unitPrice;
  }
  return null;
}
/* category -> group -> lines, in a fixed category order */
function poFireTree(lines){
  var cats=[],byCat={};
  lines.forEach(function(l){
    var c=l.category||"Other",g=l.itemGroup||"Other";
    if(!byCat[c]){byCat[c]={name:c,groups:[],byG:{}};cats.push(c);}
    var C=byCat[c];
    if(!C.byG[g]){C.byG[g]={name:g,lines:[]};C.groups.push(g);}
    C.byG[g].lines.push(l);
  });
  cats.sort(function(a,b){
    var ia=PO_FIRE_CATS.indexOf(a),ib=PO_FIRE_CATS.indexOf(b);
    return (ia<0?99:ia)-(ib<0?99:ib)||a.localeCompare(b);
  });
  return cats.map(function(c){
    var C=byCat[c];
    return {name:c,groups:C.groups.slice().sort().map(function(g){return C.byG[g];})};
  });
}
function poSumPaid(lines){return lines.reduce(function(t,l){return t+(poFireLinePaid(l)||0);},0);}
function poSumDlv(lines){return lines.reduce(function(t,l){return t+(l.delivery||0);},0);}
function poFireStats(el,list){
  var total=0,items=0,sup={},vat=0,dlv=0;
  list.forEach(function(p){
    total+=p.total||0;
    poLinesFor(p._id).forEach(function(l){items++;if(l.supplier)sup[l.supplier.toLowerCase()]=1;vat+=poFireLinePaid(l)||0;dlv+=l.delivery||0;});
  });
  var scope=PO_FYEAR?PO_FYEAR:"all years";
  el.innerHTML=
    "<div class='stat'><div class='stat-label'>Expense sheets</div><div class='stat-value'>"+list.length+"</div><div class='stat-sub'>"+scope+"</div></div>"+
    "<div class='stat'><div class='stat-label'>Total spent</div><div class='stat-value'>"+poFmtMoney(total,"IDR")+"</div><div class='stat-sub'>"+(typeof fxUsdText==="function"&&total?fxUsdText(total,"IDR"):"incl. VAT and delivery")+"</div></div>"+
    "<div class='stat'><div class='stat-label'>Items bought</div><div class='stat-value'>"+items+"</div><div class='stat-sub'>delivery "+poFmtMoney(dlv,"IDR")+"</div></div>"+
    "<div class='stat'><div class='stat-label'>Suppliers</div><div class='stat-value'>"+Object.keys(sup).length+"</div><div class='stat-sub'>across all sheets</div></div>";
}
var PO_ICO_SHOP="<svg viewBox='0 0 24 24' width='12' height='12' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M3 9l1.5-5h15L21 9'/><path d='M4 9v11h16V9'/><path d='M3 9h18'/><path d='M9 20v-6h6v6'/></svg>";
var PO_ICO_TRUCK="<svg viewBox='0 0 24 24' width='12' height='12' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M1 4h14v12H1z'/><path d='M15 8h4l4 4v4h-8'/><circle cx='6' cy='18' r='2'/><circle cx='18' cy='18' r='2'/></svg>";
/* category colour: office equipment indigo, project supplies fire red */
function poCatColor(cat){
  if(poIsSharedCat(cat))return "#4f46e5";
  if(/project/i.test(cat||""))return "#d92d20";
  return "#0e9384";
}
function poFireLineHtml(l,cur,o){
  o=o||{};
  var paid=poFireLinePaid(l);
  return "<div class='po-fl'>"+
    "<div class='po-fl-main'>"+
      "<div class='po-fl-name'>"+trkEsc(l.description||"—")+(l.pn&&!o.bySupplier?" <span class='po-fl-brand'>"+trkEsc(l.pn)+"</span>":"")+"</div>"+
      "<div class='po-fl-facts'>"+
        "<span class='po-fl-qty'>"+(l.pn&&o.bySupplier?"<span class='po-q'>"+trkEsc(l.pn)+"</span> &middot; ":"")+l.qty.toLocaleString()+" "+trkEsc(l.unit)+"</span>"+
        (l.supplier&&!o.bySupplier?"<span class='po-fl-sup' title='Supplier'>"+PO_ICO_SHOP+trkEsc(l.supplier)+"</span>":"")+
        (l.delivery&&!o.bySupplier?"<span class='po-fl-dlv' title='Delivery cost'>"+PO_ICO_TRUCK+poFmtMoney(l.delivery,cur)+"</span>":"")+
      "</div>"+
      (l.note?"<div class='po-fire-note'>"+trkEsc(l.note)+"</div>":"")+
    "</div>"+
    "<div class='po-fl-amt'>"+(l.actualTotal!==null?poFmtMoney(l.actualTotal,cur):(paid?poFmtMoney(paid,cur):"<span class='po-fl-incl'>incl. above</span>"))+
    "</div>"+
  "</div>";
}
function poFirePanelHtml(p){
  var lines=poLinesFor(p._id),cur=p.currency||"IDR";
  var listT=lines.reduce(function(t,l){return t+(l.unitPrice!==null?l.qty*l.unitPrice:0);},0);
  var paid=poSumPaid(lines),dlv=poSumDlv(lines);
  var body=poFireBodyHtml(p);
  var atts=(p.attachments||[]).map(trkAttHtml).join(" ");
  function row(k,v,b){return "<div class='po-st-row"+(b?" po-st-b":"")+"'><span>"+k+"</span><span>"+v+"</span></div>";}
  return "<aside class='po-panel po-fire-panel"+(PO_FULL?" po-full":"")+"'>"+
    "<div class='po-panel-head'><span class='po-panel-no'>"+trkEsc(p.poNumber)+"</span>"+
      (PO_FULL?"":"<button class='trk-pn-expand' title='Open full page' aria-label='Open full page' onclick='poToggleFull()'>&#x2922;</button><button class='po-panel-x' aria-label='Close' onclick='poSelect(\"\")'>&times;</button>")+"</div>"+
    "<div class='po-panel-meta'><span class='po-fire-tag'>Fire fighting</span>"+(p.date?"<span>"+trkFmtDate(p.date)+"</span>":"")+"</div>"+
    "<div class='exp-stats po-fire-stats'>"+poBigStat("Total spent",paid+dlv,cur)+poBigStat("Paid incl. VAT (PPN)",paid,cur)+poBigStat("Delivery",dlv,cur)+"</div>"+
    poProjectRowHtml(p)+
    poFireChartsHtml(lines,cur)+
    (lines.length?"<div class='exp-sec'>"+lines.length+" item"+(lines.length===1?"":"s")+"</div>"+body:"")+
    (atts?"<div class='po-panel-sec'>Files</div><div class='trk-tl-atts'>"+atts+"</div>":"")+
    (p.notes?"<div class='po-panel-sec'>Note</div><div class='po-panel-note'>"+trkEsc(p.notes)+"</div>":"")+
    "<div class='po-panel-acts'><button class='btn-save' onclick='poEdit(\""+p._id+"\")'>Edit</button></div>"+
  "</aside>";
}
/* big total like the Expenses page: number, currency, USD underneath */
function poBigStat(label,v,cur){
  var u=(cur!=="USD"&&typeof fxUsdText==="function"&&v)?fxUsdText(v,cur):"";
  return "<div class='exp-stat'><div class='exp-stat-l'>"+label+"</div><div class='exp-stat-v'>"+Math.round(v||0).toLocaleString()+" <span>"+trkEsc(cur)+"</span></div>"+(u?"<div class='exp-stat-u'>"+u+"</div>":"")+"</div>";
}
/* bar list: biggest first, the rest folded into "Everything else" */
function poBarsHtml(title,map,total,color,max){
  var keys=Object.keys(map).filter(function(k){return map[k]>0;}).sort(function(a,b){return map[b]-map[a];});
  if(!keys.length)return "";
  if(keys.length>max){var rest=keys.slice(max-1).reduce(function(t,k){return t+map[k];},0);keys=keys.slice(0,max-1);map=Object.assign({},map,{"Everything else":rest});keys.push("Everything else");}
  var top=Math.max.apply(null,keys.map(function(k){return map[k];}));
  return "<div class='exp-sec'>"+title+"</div><div class='exp-bars'>"+keys.map(function(k){
    var v=map[k],pct=total?Math.round(v/total*100):0;
    return "<div class='exp-bar-row'><div class='exp-bar-l' title='"+trkEsc(k)+"'>"+trkEsc(k)+"</div>"+
      "<div class='exp-bar-t'><div class='exp-bar-f' style='width:"+Math.max(1.5,v/top*100).toFixed(1)+"%;background:"+color+"'></div></div>"+
      "<div class='exp-bar-v'><b>"+Math.round(v).toLocaleString()+"</b><span>"+(pct<1&&v?"<1":pct)+"%</span></div></div>";
  }).join("")+"</div>";
}
/* where the sheet's money went: by supplier (incl. delivery) */
function poFireChartsHtml(lines,cur){
  if(!lines.length)return "";
  var color=(typeof TRK_SOLUTION_COLORS!=="undefined"&&TRK_SOLUTION_COLORS["Fire fighting"])||"#dc2626";
  var sup={},tot=0;
  lines.forEach(function(l){
    var v=(poFireLinePaid(l)||0)+(l.delivery||0),s=l.supplier||"Unknown supplier";
    tot+=v;sup[s]=(sup[s]||0)+v;
  });
  return "<div class='po-fire-chart'>"+poBarsHtml("Where the money went",sup,tot,color,8)+"</div>";
}
/* "By group": one block per expense sheet (its date is the heading, so
   rows don't repeat it), then category > item group > items */
function poFireGroupsHtml(list){
  var sheets=list.filter(function(p){return poLinesFor(p._id).length;});
  if(!sheets.length)return poEmptyHtml();
  return "<div class='po-fg'>"+sheets.map(function(p){
    return "<div class='po-fg-sheet'>"+
      "<button class='po-fg-head' onclick='PO_VIEW=\"list\";PO_SEL=\""+p._id+"\";renderPOs()'>"+
        "<span><span class='po-fs-date'>"+(p.date?trkFmtDate(p.date):"No date")+"</span><span class='po-fs-name'>"+trkEsc(p.poNumber)+"</span></span>"+
        "<span class='po-fs-tot'>"+poFmtMoney(p.total,p.currency||"IDR")+"</span></button>"+
      poFireBodyHtml(p)+
    "</div>";
  }).join("")+"</div>";
}
/* category > supplier order > items, shared by the sheet panel and By group */
function poFireBodyHtml(p){
  var cur=p.currency||"IDR";
  return poFireTree(poLinesFor(p._id)).map(function(c){
    var cl=[];c.groups.forEach(function(g){cl=cl.concat(g.lines);});
    return "<div class='po-fcat' style='--cat:"+poCatColor(c.name)+"'><div class='po-fire-cat'><span>"+trkEsc(c.name)+poUseTag(p,c.name)+"</span><span>"+poFmtMoney(poSumPaid(cl)+poSumDlv(cl),cur)+"</span></div>"+
      poBySupplier(cl).map(function(g){
        var d=poSumDlv(g.lines);
        return "<div class='po-fsup2'>"+
          "<div class='po-fsup2-head'><span>"+trkEsc(g.name)+"</span><span>"+poFmtMoney(poSumPaid(g.lines)+d,cur)+"</span></div>"+
          g.lines.map(function(l){return poFireLineHtml(l,cur,{bySupplier:1});}).join("")+
          (d?"<div class='po-fsup2-dlv'><span>Delivery</span><span>"+poFmtMoney(d,cur)+"</span></div>":"")+
        "</div>";
      }).join("")+"</div>";
  }).join("");
}
/* switches the PO form between printer-PO and expense-sheet fields */
function poModalMode(fire){
  var m=document.getElementById("modal-po");
  m.classList.toggle("po-fire",!!fire);
  var lab=document.getElementById("po-number-label");if(lab)lab.textContent=fire?"Name *":"PO number *";
  var num=document.getElementById("po-number");if(num)num.placeholder=fire?"e.g. Expenses 13 Nov 2026":"e.g. CUSTOM013-0925";
  var dl=document.getElementById("po-date-label");if(dl)dl.textContent=fire?"Date":"PO date";
  var tl=document.getElementById("po-total-label");if(tl)tl.textContent=fire?"Total spent (incl. VAT + delivery)":"PO total";
  var sv=document.getElementById("btn-save-po");if(sv)sv.textContent=fire?"Save":"Save PO";
  poFillProjectSelect();
  var dv=document.getElementById("btn-delete-po");if(dv)dv.textContent=fire?"Delete":"Delete PO";
}

/* ===== expense sheet <-> tracker project link ===== */
function poProjectName(id){
  var p=(typeof TRK_PROJECTS!=="undefined")?TRK_PROJECTS.find(function(x){return x._id===id;}):null;
  return p?(p.name||p.customer||"Project"):"";
}
function poProjectRowHtml(p){
  if(!p.projectId)return "";
  if(typeof TRK_LOADED!=="undefined"&&!TRK_LOADED&&typeof trkLoad==="function"){
    trkLoad().then(function(){if(currentTab==="po")renderPOs();});
  }
  var nm=poProjectName(p.projectId);
  var sp=poSplitForProject(p);
  return "<div class='po-panel-sec'>Project</div>"+
    "<button class='po-proj-link' onclick='navTo(\"tracker\",\""+p.projectId+"\")'>"+
      "<span>"+(nm?trkEsc(nm):"Open project")+"</span><span class='po-proj-go'>Open in tracker &rarr;</span></button>"+
    (sp.shared?"<div class='po-proj-split'>"+
      "<div><span class='po-use po-use-proj'>For this project</span> "+sp.projNames.map(trkEsc).join(", ")+" &middot; <b>"+poFmtMoney(sp.proj,p.currency||"IDR")+"</b></div>"+
      "<div><span class='po-use po-use-shared'>Shared</span> "+sp.sharedNames.map(trkEsc).join(", ")+" &middot; <b>"+poFmtMoney(sp.shared,p.currency||"IDR")+"</b> &mdash; can be used on other projects too</div>"+
      "<div class='po-dim'>Amounts include VAT and delivery.</div>"+
    "</div>":"");
}
/* the form's project picker: fire fighting projects first */
function poFillProjectSelect(){
  var sel=document.getElementById("po-project");
  if(!sel)return;
  var cur=sel.value;
  if(typeof TRK_LOADED!=="undefined"&&!TRK_LOADED&&typeof trkLoad==="function"){
    trkLoad().then(function(){poFillProjectSelect();});
  }
  var list=(typeof TRK_PROJECTS!=="undefined"?TRK_PROJECTS:[]).filter(function(p){return p.status!=="Other";});
  function opt(p){return "<option value='"+p._id+"'>"+trkEsc(p.name||p.customer||"(no name)")+"</option>";}
  var fire=list.filter(function(p){return /fire/i.test(p.solution||"");}),rest=list.filter(function(p){return !/fire/i.test(p.solution||"");});
  function byName(a,b){return (a.name||"").localeCompare(b.name||"");}
  sel.innerHTML="<option value=''>&mdash; none &mdash;</option>"+
    (fire.length?"<optgroup label='Fire fighting'>"+fire.sort(byName).map(opt).join("")+"</optgroup>":"")+
    (rest.length?"<optgroup label='Other projects'>"+rest.sort(byName).map(opt).join("")+"</optgroup>":"");
  sel.value=cur;
}
function poSheetsForProject(id){
  if(typeof PO_LIST==="undefined")return [];
  return PO_LIST.filter(function(p){return p.projectId===id;})
    .sort(function(a,b){return (b.date||"").localeCompare(a.date||"");});
}
/* opens an expense sheet from elsewhere (tracker project) */
function poOpenSheet(id){
  var p=PO_LIST.find(function(x){return x._id===id;});
  if(!p)return;
  poSaveSec(p.section||"");
  PO_VIEW="list";PO_FOFFICE="";PO_YEARS={};PO_FPAY=false;PO_SEARCH="";
  navTo("po",id);
}
/* "Expenses" row on a tracker project: linked sheets with their totals */
function poProjectExpensesHtml(projId){
  if(typeof PO_LOADED==="undefined")return "";
  if(!PO_LOADED){
    poLoad().then(function(ok){
      if(ok&&currentTab==="tracker"&&poSheetsForProject(projId).length&&typeof renderTracker==="function")renderTracker();
    });
    return "";
  }
  var sh=poSheetsForProject(projId);
  if(!sh.length)return "";
  var sum=sh.reduce(function(t,p){return t+(p.total||0);},0);
  return sh.map(function(p){
    var sp=poSplitForProject(p);
    return "<button class='po-exp-link' onclick='poOpenSheet(\""+p._id+"\")'><span>"+trkEsc(p.poNumber)+
        (sp.shared?"<span class='po-exp-sub'>+ "+poFmtMoney(sp.shared,p.currency||"IDR")+" shared office equipment</span>":"")+"</span>"+
      "<b>"+poFmtMoney(sp.shared?sp.proj:p.total,p.currency||"IDR")+"</b></button>";
  }).join("")+(sh.length>1?"<div class='trk-value-usd'>Total "+poFmtMoney(sum,"IDR")+"</div>":"");
}

/* Office equipment on a sheet is shared stock that other projects can use
   too; everything else is for the sheet's linked project */
function poIsSharedCat(cat){return /^office equipment/i.test(cat||"");}
function poUseTag(p,cat){
  if(!p||!p.projectId)return "";
  if(poIsSharedCat(cat))return "<span class='po-use po-use-shared' title='Can be used on other projects too'>Shared</span>";
  var nm=poProjectName(p.projectId);
  return "<span class='po-use po-use-proj'>"+trkEsc(nm?nm.replace(/^PT\.?\s+/i,"").split(/\s+/)[0]:"Project")+"</span>";
}
function poSplitForProject(p){
  var lines=poLinesFor(p._id),proj=0,shared=0,pn={},sn={};
  lines.forEach(function(l){
    var v=(poFireLinePaid(l)||0)+(l.delivery||0);
    if(poIsSharedCat(l.category)){shared+=v;sn[l.category]=1;}else{proj+=v;pn[l.category||"Other"]=1;}
  });
  return {proj:proj,shared:shared,projNames:Object.keys(pn),sharedNames:Object.keys(sn)};
}

/* one block per supplier order, in the sheet's own order; the delivery
   charge belongs to the order, not to one item */
function poBySupplier(lines){
  var out=[],by={};
  lines.slice().sort(function(a,b){return a.sortOrder-b.sortOrder;}).forEach(function(l){
    var k=(l.supplier||"Unknown supplier").toLowerCase();
    if(!by[k]){by[k]={name:l.supplier||"Unknown supplier",lines:[]};out.push(by[k]);}
    by[k].lines.push(l);
  });
  return out;
}
