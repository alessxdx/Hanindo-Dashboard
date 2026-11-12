/* ============================================================
   MASTER–DETAIL view for "By Customer" (primary view).
   Left: compact searchable customer list (respects the filter
   dropdowns). Right: per-customer rollup (printers by model,
   revenue, quote pipeline) + full history of entries rendered
   with the exact same entry builder as the Cards view, so all
   edge cases (Bohol/Laguindingan combined toggles, dual
   pricing, Nanshan, overrides, TK180 TPH) look identical.
   ============================================================ */
var MD_SEL=null;    /* selected customer name (one entry per company, all countries) */
var MD_SEARCH="";
var MD_GROUP_SEL=null; /* selected project-group name, or null */

/* How many POs a record stands for: a summary record (e.g. a customer's
   2026 orders rolled into one) says "Summary of N POs" in its notes and
   counts as N; every other record counts as 1. */
function mdPoWeight(e){
  var n=(e.notes||[]).map(function(x){var m=/^Summary of (\d+) POs/.exec(String(x));return m?+m[1]:0;}).filter(Boolean)[0];
  return n||1;
}
function mdCountSt(list,st){return list.reduce(function(n,e){return n+(e.status===st?(st==="PO"?mdPoWeight(e):1):0);},0);}
function mdEscAttr(s){return String(s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/'/g,"&#39;").replace(/</g,"&lt;");}

/* Parse unit count out of a qty string.
   "234 units" -> 234 · "23 (T4) + 74 (T5) units" -> 97
   "30 units (ATB) + 24 units (BTP)" -> 54 · "TBD"/"Multiple"/"—" -> 0 */
function mdParseUnits(qty){
  if(!qty)return 0;
  var cleaned=String(qty).replace(/\([^)]*\)/g," ");
  var nums=(cleaned.match(/\d[\d,]*/g)||[]).map(function(s){return parseInt(s.replace(/,/g,""),10);}).filter(function(n){return !isNaN(n);});
  if(!nums.length)return 0;
  if(cleaned.indexOf("+")!==-1)return nums.reduce(function(a,b){return a+b;},0);
  return nums[0];
}
function mdIsCombined(tx){return !!(tx.projectGroup&&tx.model&&tx.model.indexOf("+")!==-1);}
function mdIsSplit(tx,txs){
  if(!tx.projectGroup||mdIsCombined(tx))return false;
  return txs.some(function(o){return o!==tx&&o.projectGroup===tx.projectGroup&&mdIsCombined(o);});
}

/* Per-customer rollup.
   - Unit counts by model use the individual (split) entries and skip
     combined "ATB + BTP" entries so nothing is double counted; consumables
     (noPrinterTotal, e.g. TK180 TPH) are excluded from printer counts.
   - Money uses the combined entries (source of truth for grouped project
     totals) and skips their split children. Value per entry:
     totalOverride, else unit price × parsed qty, else unit price. */
/* Override-aware total for a project (By Project entry). */
function mdProjTotal(p){
  if(p.totalOverride)return p.totalOverride;
  return LINE_ITEMS.filter(function(li){return li.projectId===p._id;})
    .reduce(function(s,li){return s+li.qty*li.unitPrice;},0);
}
/* Does a project pass the active By Customer filter dropdowns? */
function mdProjPassesFilters(p){
  var fc=document.getElementById("fc").value;
  var fs=document.getElementById("fs").value;
  var fm=document.getElementById("fm").value;
  if(fc&&p.country!==fc)return false;
  if(fs&&p.status!==fs)return false;
  if(fm&&!LINE_ITEMS.some(function(li){return li.projectId===p._id&&li.type==="printer"&&li.name===fm;}))return false;
  return true;
}
/* Does a transaction pass the active filter dropdowns? */
function mdTxPassesFilters(t){
  var fc=document.getElementById("fc").value,fm=document.getElementById("fm").value,fs=document.getElementById("fs").value;
  return (!fc||t.country===fc)&&(!fm||t.model===fm)&&(!fs||t.status===fs);
}
/* Resolved deals with the filter dropdowns applied. */
function mdFilteredResolved(){
  var R=resolveDeals();
  return {txs:R.txs.filter(mdTxPassesFilters),projs:R.projs.filter(mdProjPassesFilters)};
}
/* Per-customer rollup over transactions AND project-only deals.
   - Transactions: unit counts from split entries (skip combined) and
     money from combined entries (skip splits), as before.
   - Project-only deals: printer units come from their line items,
     money from the project total (override-aware). */
function mdAddPrice(m,cur,qty,unitPrice){
  if(!cur||!(qty>0))return;
  if(!m.priceByCur)m.priceByCur={};
  var p=m.priceByCur[cur]||(m.priceByCur[cur]={qty:0,cost:0});
  p.qty+=qty;p.cost+=qty*unitPrice;
}
/* Weighted-average unit price per currency, e.g. "808 SGD" or "808 SGD / 590 USD". */
function mdUnitPriceDisplay(m){
  if(!m.priceByCur)return "—";
  var curs=Object.keys(m.priceByCur);
  if(!curs.length)return "—";
  return curs.map(function(c){
    var pc=m.priceByCur[c],avg=pc.qty>0?pc.cost/pc.qty:0;
    avg=Math.round(avg*100)/100; /* cents shown in full: 1,174.40, not 1,174.4 */
    return avg.toLocaleString(undefined,{minimumFractionDigits:avg%1?2:0,maximumFractionDigits:2})+" "+c;
  }).join(" / ");
}
/* print heads, cutters and boards: shown in their own rows under the
   printers, never counted as printers */
var MD_SPARE_RE=/\bTPH\b|print ?head|cutter|main ?board/i;
function mdRollup(txs,projs){
  var models={},spares={},revenue={},pipeline={},approx=false;
  txs.forEach(function(tx){
    if(!mdIsCombined(tx)&&!tx.noPrinterTotal){
      var u=mdParseUnits(tx.qty);
      if(u>0){
        var m=models[tx.model]||(models[tx.model]={po:0,quote:0,lost:0});
        if(tx.status==="PO")m.po+=u;
        else if(tx.status==="Quotation")m.quote+=u;
        else m.lost+=u;
        mdAddPrice(m,tx.currency,u,tx.price);
      }
    }
    if(!mdIsSplit(tx,txs)){
      var u2=mdParseUnits(tx.qty);
      var val=tx.totalOverride?tx.totalOverride:(u2>0?tx.price*u2:tx.price);
      if(tx.status==="PO"){
        if(!tx.totalOverride&&u2===0)approx=true;
        revenue[tx.currency]=(revenue[tx.currency]||0)+val;
      }else if(tx.status==="Quotation"){
        pipeline[tx.currency]=(pipeline[tx.currency]||0)+val;
      }
    }
  });
  (projs||[]).forEach(function(p){
    LINE_ITEMS.filter(function(li){return li.projectId===p._id&&li.qty>0&&MD_SPARE_RE.test(li.name);}).forEach(function(li){
      var m=spares[li.name]||(spares[li.name]={po:0,quote:0,lost:0});
      if(p.status==="PO")m.po+=li.qty;
      else if(p.status==="Quotation")m.quote+=li.qty;
      else m.lost+=li.qty;
      mdAddPrice(m,p.currency,li.qty,li.unitPrice);
    });
    LINE_ITEMS.filter(function(li){return li.projectId===p._id&&li.type==="printer"&&li.qty>0&&!MD_SPARE_RE.test(li.name);}).forEach(function(li){
      var m=models[li.name]||(models[li.name]={po:0,quote:0,lost:0});
      if(p.status==="PO")m.po+=li.qty;
      else if(p.status==="Quotation")m.quote+=li.qty;
      else m.lost+=li.qty;
      mdAddPrice(m,p.currency,li.qty,li.unitPrice);
    });
    var val=mdProjTotal(p);
    if(p.status==="PO")revenue[p.currency]=(revenue[p.currency]||0)+val;
    else if(p.status==="Quotation")pipeline[p.currency]=(pipeline[p.currency]||0)+val;
  });
  return{models:models,spares:spares,revenue:revenue,pipeline:pipeline,approx:approx};
}

function mdMoneyLines(map){
  var curs=Object.keys(map);
  if(!curs.length)return "<div class='md-money-line md-money-none'>—</div>";
  var usdTotal=0,allConvertible=true;
  var html=curs.sort().map(function(c){
    var v=map[c],eq=fxUsdText(v,c);
    var usd=fxToUSD(v,c);
    if(usd===null)allConvertible=false;else usdTotal+=usd;
    return "<div class='md-money-line'><span class='md-money-val'>"+v.toLocaleString(undefined,{maximumFractionDigits:2})+" "+c+"</span>"+(eq?" <span class='fx-usd'>"+eq+"</span>":"")+"</div>";
  }).join("");
  if(curs.length>1&&allConvertible){
    html+="<div class='md-money-total'>All currencies ≈ "+fxFormatUSD(usdTotal)+" USD</div>";
  }
  return html;
}

/* Filtered + searched + sorted entries for the left list. Each entry is
   {key,name,country,txs,projs} where projs are project-only deals. */
function mdProjSearchText(p){
  var li=LINE_ITEMS.filter(function(x){return x.projectId===p._id;}).map(function(x){return x.name+" "+(x.pn||"");}).join(" ");
  return (p.customer+" "+p.country+" "+(p.project||"")+" "+(p.projectGroup||"")+" "+li).toLowerCase();
}
function mdComputeEntries(){
  var sortMode=document.getElementById("fsort").value;
  var R=mdFilteredResolved();
  /* one entry per company: the same customer in two countries (Daifuku
     Australia and New Zealand) is one entry carrying both countries */
  var map={};
  function ent(customer,country){
    var k=customer;
    if(!map[k])map[k]={key:k,name:customer,country:country,countries:[],txs:[],projs:[]};
    if(country&&map[k].countries.indexOf(country)===-1)map[k].countries.push(country);
    return map[k];
  }
  R.txs.forEach(function(t){ent(t.customer,t.country).txs.push(t);});
  R.projs.forEach(function(p){ent(p.customer,p.country).projs.push(p);});
  var entries=Object.keys(map).map(function(k){return map[k];});
  var q=MD_SEARCH.trim().toLowerCase();
  if(q){
    entries=entries.filter(function(e){
      return e.txs.some(function(t){return (t.customer+" "+t.country+" "+t.model+" "+(t.project||"")+" "+(t.projectGroup||"")+" "+(t.pn||"")).toLowerCase().indexOf(q)!==-1;})
        ||e.projs.some(function(p){return mdProjSearchText(p).indexOf(q)!==-1;});
    });
  }
  function poCount(e){return mdCountSt(e.txs,"PO")+mdCountSt(e.projs,"PO");}
  function recent(e){var ds=e.txs.map(function(t){return parseDV(t.date);}).concat(e.projs.map(function(p){return parseDV(p.date);}));return ds.length?Math.max.apply(null,ds):0;}
  if(sortMode==="name")entries.sort(function(a,b){return a.name.localeCompare(b.name);});
  else if(sortMode==="name-desc")entries.sort(function(a,b){return b.name.localeCompare(a.name);});
  else if(sortMode==="po-desc")entries.sort(function(a,b){return poCount(b)-poCount(a);});
  else if(sortMode==="recent")entries.sort(function(a,b){return recent(b)-recent(a);});
  else entries.sort(function(a,b){return a.name.localeCompare(b.name);});
  return entries;
}

/* Country headings with the companies inside. A company in several
   countries (Daifuku: Australia + New Zealand) is listed under each, with
   that country's own PO/quote counts and an "also in" note; any of its
   rows opens the same combined customer page. */
function buildMdList(entries){
  if(!entries.length)return "<div class='md-none'>No customers match.</div>";
  var fc=(document.getElementById("fc")||{}).value||"";
  var byCountry={};
  entries.forEach(function(e){
    (e.countries.length?e.countries:["Unknown"]).forEach(function(c){
      if(fc&&c!==fc)return;
      (byCountry[c]=byCountry[c]||[]).push(e);
    });
  });
  /* fixed market order; any country not listed follows A-Z */
  var first=["Singapore","Philippines","Indonesia","New Zealand","China"];
  var rank=function(c){var i=first.indexOf(c);return i===-1?first.length:i;};
  return Object.keys(byCountry).sort(function(a,b){return rank(a)-rank(b)||a.localeCompare(b);}).map(function(country){
    var items=byCountry[country].map(function(e){
      var here=function(x){return (x.country||"Unknown")===country;};
      var cnt=function(st){return mdCountSt(e.txs.filter(here),st)+mdCountSt(e.projs.filter(here),st);};
      var pos=cnt("PO"),qt=cnt("Quotation"),ls=cnt("Lose");
      var meta=(pos?"<span class='md-pill md-pill-po'>"+pos+" PO"+(pos!==1?"s":"")+"</span>":"")+
        (qt?"<span class='md-pill md-pill-qt'>"+qt+" quote"+(qt!==1?"s":"")+"</span>":"")+
        (ls?"<span class='md-pill md-pill-ls'>"+ls+" lost</span>":"")+
        (!pos&&!qt&&!ls?"<span class='md-pill'>no deals</span>":"");
      var others=e.countries.filter(function(c){return c!==country;}).sort();
      return "<div class='md-item"+(e.key===MD_SEL?" active":"")+"' data-key=\""+mdEscAttr(e.key)+"\" onclick='mdSelect(this.getAttribute(\"data-key\"))'>"+
        "<div class='md-item-main'>"+
          "<div class='md-item-name'>"+mdEscAttr(e.name)+"</div>"+
          (others.length?"<div class='md-item-cty'>also in "+others.map(mdEscAttr).join(", ")+"</div>":"")+
          "<div class='md-item-meta'>"+meta+"</div>"+
        "</div>"+
        "<div class='md-item-chev'>&rsaquo;</div>"+
      "</div>";
    }).join("");
    return "<div class='md-country'>"+flagImg(country,18)+"<b>"+mdEscAttr(country)+"</b><span>"+byCountry[country].length+"</span></div>"+items;
  }).join("");
}

/* ===== one customer's page: what they bought =====
   Totals, printers by model, a card per order and every document. */
/* Order notes fold away by default; "Show all notes" opens every card's
   notes at once and is remembered per browser. */
var MD_NOTES_OPEN=(function(){try{return localStorage.getItem("cpd_md_notes")==="1";}catch(e){return false;}})();
function mdToggleAllNotes(){
  MD_NOTES_OPEN=!MD_NOTES_OPEN;
  try{localStorage.setItem("cpd_md_notes",MD_NOTES_OPEN?"1":"0");}catch(e){}
  document.querySelectorAll(".od-notes-wrap").forEach(function(d){d.open=MD_NOTES_OPEN;});
  var b=document.getElementById("md-notes-all");if(b)b.textContent=MD_NOTES_OPEN?"Hide all notes":"Show all notes";
}
function mdOrderCard(d){
  var p=d.p,t=d.t,multi=d.multi;
  var esc=mdEscAttr;
  var cur,total,lines=[],atts,status,date,title,edit,notes,group,terms="";
  if(p){
    var lis=LINE_ITEMS.filter(function(li){return li.projectId===p._id;}).sort(function(a,b){
      var pa=a.type==="printer"?0:a.type==="discount"?2:1,pb=b.type==="printer"?0:b.type==="discount"?2:1;
      return pa-pb||a.sortOrder-b.sortOrder;
    });
    cur=p.currency;total=mdProjTotal(p);atts=p.attachments||[];status=p.status;date=p.displayDate||p.date;title=p.project;
    edit="editProject(\""+p._id+"\")";notes=p.notes||[];group=p.projectGroup;
    terms=(p.shippingTerms?bTerm(p.shippingTerms):"")+bWarranty(p.warranty);
    lines=lis.map(function(li){return {printer:li.type==="printer",name:li.displayModel||li.name,qty:li.qty,price:li.unitPrice,type:li.type};});
  }else{
    cur=t.currency;var u=mdParseUnits(t.qty)||1;total=t.totalOverride||t.price*u;atts=t.attachments||[];status=t.status;date=t.displayDate||t.date;
    title=t.project||t.displayModel||t.model;edit="editTx("+TX.indexOf(t)+",event)";notes=t.notes||[];group=t.projectGroup;
    terms=(t.terms||[]).map(bTerm).join("")+bWarranty(t.warranty);
    lines=[{printer:true,name:t.displayModel||t.model,qty:u,price:t.price,type:"printer"}];
  }
  /* round to the cent first: 25 x 1,174.40 is 58720.00000000001 in floating point */
  var num=function(v){v=Math.round(v*100)/100;return v.toLocaleString(undefined,{minimumFractionDigits:v%1?2:0,maximumFractionDigits:2});};
  var printers=lines.filter(function(l){return l.printer;}),others=lines.filter(function(l){return !l.printer;});
  /* a mini table: item | qty x unit price | amount, so the right-hand
     figure is always the line total and quantities never look like prices */
  var money=function(v){return (v<0?"&minus;":"")+num(Math.abs(v))+" <span class='trk-r-cur'>"+esc(cur)+"</span>";};
  var lineHtml=function(l){
    var sub=l.qty*l.price;
    return "<div class='od-line"+(l.printer?" od-printer":"")+"'>"+
      "<span class='od-name'>"+esc(l.name)+"</span>"+
      "<span class='od-calc'>"+(l.qty!==1?num(l.qty)+" &times; "+money(l.price):"")+"</span>"+
      "<span class='od-amt'>"+money(sub)+"</span>"+
    "</div>";
  };
  var lineHead="<div class='od-line od-line-head'><span>Item</span><span>Qty &times; unit price</span><span>Amount</span></div>";
  /* inside a project group the title is just this entry's part
     ("Installation"), with the group shown above it as a link */
  var short=title||"";
  if(group&&short.toLowerCase().indexOf(group.toLowerCase())===0){
    var rest=short.slice(group.length).replace(/^[\s\u2014\u2013\-:]+/,"").replace(/^\((.*)\)$/,"$1").trim();
    if(rest)short=rest;
  }
  var stCls=status==="PO"?"po":status==="Quotation"?"qt":status==="Lose"?"ls":"";
  var groupEsc=group?String(group).replace(/\\/g,"\\\\").replace(/'/g,"\\'"):"";
  var units=printers.reduce(function(n,l){return n+l.qty;},0);
  return "<div class='od-card"+(stCls?" od-st-"+stCls:"")+"'>"+
    "<div class='od-head'>"+
      "<div class='od-title'>"+(group?"<div class='od-group' onclick=\"openProjectGroup('"+groupEsc+"')\" title='Open the whole project group'>&#128279; "+esc(group)+" &rsaquo;</div>":"")+
        "<div class='od-name-main'>"+esc(short||"Untitled")+"</div>"+
        "<div class='od-meta'>"+(date?"<span>"+esc(date)+"</span>":"")+bStatus(status)+
          (multi&&(p||t).country?"<span class='od-cty'>"+flagImg((p||t).country,14)+esc((p||t).country)+"</span>":"")+
          (units?"<span class='od-units'>"+num(units)+" "+mdUnitWord(printers.map(function(l){return l.name;}),units)+"</span>":"")+terms+"</div></div>"+
      "<div class='od-total'>"+num(total)+" <span class='trk-r-cur'>"+esc(cur)+"</span>"+fxEqSpan(total,cur)+"</div>"+
    "</div>"+
    (lines.length?"<div class='od-lines'>"+lineHead+printers.map(lineHtml).join("")+
      (others.length?"<div class='od-others'>"+others.map(lineHtml).join("")+"</div>":"")+"</div>":"")+
    (notes.length?"<details class='od-notes-wrap'"+(MD_NOTES_OPEN?" open":"")+"><summary>Notes <span>"+notes.length+"</span></summary>"+
      "<ul class='od-notes'>"+notes.map(function(n){return "<li>"+esc(n)+"</li>";}).join("")+"</ul></details>":"")+
    "<div class='od-foot'><span class='od-docs'>"+attClipsHtml(atts)+"</span>"+
      "<button class='edit-btn' title='Edit' aria-label='Edit' onclick='"+edit+"'>"+EDIT_ICO+"</button></div>"+
  "</div>";
}
function mdDocsHtml(deals){
  var seen={},rows=[];
  deals.forEach(function(d){
    var e=d.p||d.t;
    /* a summary record lists its POs in the notes ("PO <no> · <date> · …");
       a file whose name carries one of those numbers is described by that
       PO's own date and units instead of the record's date range */
    var poNotes=(e.notes||[]).map(function(n){
      var m=/^PO\s+(\S+)\s+·\s+(\d{1,2}\s+\w{3}\s+\d{4})(.*)$/.exec(String(n));
      if(!m)return null;
      var units=/([\d,]+)\s+units/.exec(m[3]);
      return {key:m[1].replace(/[^a-z0-9]/gi,"").toLowerCase(),no:m[1],date:m[2],units:units?units[1]:""};
    }).filter(Boolean);
    (e.attachments||[]).forEach(function(a){
      if(!a.url||seen[a.url])return;seen[a.url]=1;
      var flat=String(a.name||"").replace(/[^a-z0-9]/gi,"").toLowerCase();
      var po=poNotes.filter(function(x){return x.key&&flat.indexOf(x.key)>-1;})[0];
      rows.push(po
        ?{a:a,date:po.date,when:parseDV(po.date),title:"PO "+po.no+(po.units?" · "+po.units+" units":""),poDate:true}
        :{a:a,date:e.displayDate||e.date||"",when:parseDV(e.date),title:e.project||e.model||""});
    });
  });
  if(!rows.length)return "<div class='md-money-none'>No documents attached yet.</div>";
  rows.sort(function(x,y){return y.when-x.when;});
  return "<div class='md-docs'>"+rows.map(function(r){
    var dt=r.a.doctype||(typeof guessDoctype==="function"?guessDoctype(r.a.name):"")||"Other";
    var full=mdEscAttr(r.a.name||"Document");
    return "<a class='md-doc' href='"+mdEscAttr(r.a.url)+"' target='_blank' rel='noopener' data-name=\""+full+"\" onclick='if(event.ctrlKey||event.metaKey||event.shiftKey)return true;return trkViewFile(this)'>"+
      "<span class='md-doc-type doc-"+dt.toLowerCase()+"'>"+mdEscAttr(dt)+"</span>"+
      "<span class='md-doc-main'><span class='md-doc-name'>"+full+"</span><span class='md-doc-sub'>"+(r.poDate?"PO date "+mdEscAttr(r.date)+" &middot; "+mdEscAttr(r.title):mdEscAttr(r.title)+(r.date?" &middot; "+mdEscAttr(r.date):""))+"</span></span>"+
      "<span class='md-doc-open'>Open &rsaquo;</span></a>";
  }).join("")+"</div>";
}

/* printers-by-model table for one customer's rollup (also used by Customer Base) */
function mdModelsTable(r){
  var modelKeys=Object.keys(r.models).sort();
  var spareKeys=Object.keys(r.spares||{}).sort();
  var anyLost=modelKeys.some(function(m){return r.models[m].lost>0;})||spareKeys.some(function(m){return r.spares[m].lost>0;});
  var totalPo=0,totalQt=0;
  var modelRows=modelKeys.map(function(m){
    var mm=r.models[m];totalPo+=mm.po;totalQt+=mm.quote;
    return "<tr><td>"+m+"</td><td class='num'>"+(mm.po||"—")+"</td><td class='num'>"+(mm.quote||"—")+"</td><td class='num'>"+mdUnitPriceDisplay(mm)+"</td>"+(anyLost?"<td class='num'>"+(mm.lost||"—")+"</td>":"")+"</tr>";
  }).join("");
  var spareRows=spareKeys.map(function(m){
    var mm=r.spares[m];
    return "<tr class='md-spare'><td>"+m+"</td><td class='num'>"+(mm.po||"—")+"</td><td class='num'>"+(mm.quote||"—")+"</td><td class='num'>"+mdUnitPriceDisplay(mm)+"</td>"+(anyLost?"<td class='num'>"+(mm.lost||"—")+"</td>":"")+"</tr>";
  }).join("");
  var cols=anyLost?5:4;
  var modelsTable=(modelKeys.length||spareKeys.length)?
    "<table class='md-models-table'><thead><tr><th>Model</th><th class='num'>PO units</th><th class='num'>Quoted</th><th class='num'>Unit price</th>"+(anyLost?"<th class='num'>Lost</th>":"")+"</tr></thead>"+
    (modelKeys.length?"<tbody>"+modelRows+"</tbody>"+
      "<tbody><tr class='md-total'><td>Total printers</td><td class='num'>"+totalPo+"</td><td class='num'>"+totalQt+"</td><td></td>"+(anyLost?"<td></td>":"")+"</tr></tbody>":"")+
    (spareKeys.length?"<tbody><tr class='md-spare-head'><td colspan='"+cols+"'>Print heads &amp; spare parts <span>not counted as printers</span></td></tr>"+spareRows+"</tbody>":"")+
    "</table>"
    :"<div class='md-money-none'>No printer quantities recorded.</div>";
  return {html:modelsTable,modelKeys:modelKeys,spareKeys:spareKeys,totalPo:totalPo,totalQt:totalQt};
}
/* opts.embedded: drawn inside the Customer Base panel, which has its own
   name header and close button */
function buildMdDetail(key,opts){
  var embedded=!!(opts&&opts.embedded),only=opts&&opts.country; /* only: one country's records */
  var R=resolveDeals();
  var txs=R.txs.filter(function(t){return t.customer===key&&(!only||t.country===only);});
  var projs=R.projs.filter(function(p){return p.customer===key&&(!only||p.country===only);});
  if(!txs.length&&!projs.length)return "<div class='md-empty'>No entries for this customer.</div>";
  var ref=txs[0]||projs[0];
  var name=ref.customer,country=ref.country;
  var countries=[];txs.concat(projs).forEach(function(e){if(e.country&&countries.indexOf(e.country)===-1)countries.push(e.country);});
  countries.sort();
  var r=mdRollup(txs,projs);
  var pos=mdCountSt(txs,"PO")+mdCountSt(projs,"PO");
  var qt=txs.filter(function(t){return t.status==="Quotation";}).length+projs.filter(function(p){return p.status==="Quotation";}).length;
  var ls=txs.filter(function(t){return t.status==="Lose";}).length+projs.filter(function(p){return p.status==="Lose";}).length;

  var mt=mdModelsTable(r),modelKeys=mt.modelKeys,spareKeys=mt.spareKeys,totalPo=mt.totalPo,totalQt=mt.totalQt,modelsTable=mt.html;

  var curs=[];txs.forEach(function(t){if(curs.indexOf(t.currency)===-1)curs.push(t.currency);});
  projs.forEach(function(p){if(curs.indexOf(p.currency)===-1)curs.push(p.currency);});
  var notes=fxNotesFor(curs);
  /* every order newest first, under year headings */
  var deals=projs.map(function(p){return {p:p,when:parseDV(p.date)};}).concat(txs.map(function(t){return {t:t,when:parseDV(t.date)};}))
    .sort(function(a,b){return b.when-a.when;});
  var multi=countries.length>1,lastYear=null;
  var ordersHtml=deals.map(function(d){
    d.multi=multi;
    var y=d.when?new Date(d.when).getFullYear():"No date";
    var head=y!==lastYear?"<div class='od-year'>"+y+"</div>":"";lastYear=y;
    return head+mdOrderCard(d);
  }).join("");
  var docsHtml=mdDocsHtml(deals);
  var docCount=(docsHtml.match(/class='md-doc'/g)||[]).length;
  var fxBlock=notes.length?"<div class='md-fx-notes'>"+notes.map(function(n){return "<div class='fx-note'>"+n+"</div>";}).join("")+(FX.live?"":"<div class='fx-note'>Live rates unavailable — using stored estimates.</div>")+"</div>":"";

  return ""+
    (embedded?"":"<button class='md-back' onclick='mdBack()'>&#8592; All customers</button>"+
    "<div class='md-head md-head-card'><div class='md-flags md-flags-lg'>"+countries.slice(0,3).map(function(c){return flagImg(c,countries.length>1?30:38);}).join("")+"</div>"+
      "<div><div class='md-head-name'>"+mdEscAttr(name)+"</div>"+
      "<div class='md-head-meta'><span>"+countries.map(mdEscAttr).join(" &middot; ")+"</span>"+
        (pos?"<span class='md-pill md-pill-po'>"+pos+" PO"+(pos!==1?"s":"")+"</span>":"")+
        (qt?"<span class='md-pill md-pill-qt'>"+qt+" open quote"+(qt!==1?"s":"")+"</span>":"")+
        (ls?"<span class='md-pill md-pill-ls'>"+ls+" lost</span>":"")+"</div></div>"+
    "</div>")+
    /* embedded: the Customer Base panel shows revenue and POs in its own boxes */
    (embedded?"":"<div class='md-kpis'>"+
      "<div class='md-kpi'><div class='md-kpi-l'>Revenue · confirmed POs"+(r.approx?" <span title='Some quantities unknown'>*</span>":"")+"</div>"+mdMoneyLines(r.revenue)+"</div>"+
      "<div class='md-kpi'><div class='md-kpi-l'>Open quotation pipeline</div>"+mdMoneyLines(r.pipeline)+"</div>"+
      "<div class='md-kpi'><div class='md-kpi-l'>Printers</div><div class='md-money-line'>"+totalPo.toLocaleString()+" <span class='md-kpi-u'>ordered</span></div>"+
        (totalQt?"<div class='md-kpi-s'>"+totalQt.toLocaleString()+" more quoted</div>":"")+"</div>"+
    "</div>")+
    /* embedded: the printer table only for Custom printer customers that
       have printer quantities (store equipment etc. has none) */
    (embedded&&(!opts.models||!(modelKeys.length||spareKeys.length))?"":
    "<div class='md-section'>"+
      "<div class='md-section-title'>Printers by model</div>"+
      modelsTable+
    "</div>")+
    fxBlock+
    "<div class='md-section md-orders'>"+
      "<div class='md-section-title md-orders-head'>Orders &amp; quotations <span class='nt-n'>"+deals.length+"</span>"+
        "<button class='md-notes-btn' id='md-notes-all' onclick='mdToggleAllNotes()'>"+(MD_NOTES_OPEN?"Hide all notes":"Show all notes")+"</button></div>"+
      ordersHtml+
    "</div>"+
    "<div class='md-section'>"+
      "<div class='md-section-title'>Documents <span class='nt-n'>"+docCount+"</span></div>"+
      docsHtml+
    "</div>";
}

function mdSelect(key){
  MD_SEL=key;
  renderCustomersDetail();
  if(window.matchMedia("(max-width: 980px)").matches){
    var d=document.querySelector(".md-detail");
    if(d)d.scrollIntoView({behavior:"smooth",block:"start"});
  }
}
function mdBack(){MD_SEL=null;renderCustomersDetail();}
function mdSearchInput(v){
  MD_SEARCH=v;
  var list=mdComputeEntries();
  var el=document.getElementById("md-list-items");
  if(el)el.innerHTML=buildMdList(list);
  var c=document.getElementById("md-count");if(c)c.textContent=list.length+" customer"+(list.length!==1?"s":"");
}

/* ============================================================
   CONSOLIDATED PROJECT GROUP view.
   Opened by clicking a "🔗 group name" tag (Bohol/Laguindingan-style
   combined+split transactions, or Singapore Pools/Airlines-style
   multi-project groups in the `projects` table). Pulls together every
   entry across the whole dataset that shares tx.projectGroup /
   p.projectGroup, regardless of which customer card it normally lives
   under, and renders it with the exact same entry builders as the
   customer detail (buildTxEntriesHtml / buildProjectBlock) so all edge
   cases and PDF chips look identical.
   ============================================================ */
function mdGroupTotals(txs,projs){
  var totals={};
  txs.forEach(function(t){
    if(mdIsSplit(t,txs))return;
    var v=txValueOf(t);
    totals[t.currency]=(totals[t.currency]||0)+v;
  });
  (projs||[]).forEach(function(p){
    var v=projTotalOf(p);
    totals[p.currency]=(totals[p.currency]||0)+v;
  });
  return totals;
}
function buildProjectGroupSection(name,country,txs,projs){
  var pos=txs.filter(function(t){return t.status==="PO";}).length+projs.filter(function(p){return p.status==="PO";}).length;
  var qt=txs.filter(function(t){return t.status==="Quotation";}).length+projs.filter(function(p){return p.status==="Quotation";}).length;
  var totals=mdGroupTotals(txs,projs);
  return "<div class='md-section' style='margin-bottom:14px'>"+
    "<div style='display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:8px'>"+flagImg(country,20)+
      "<div style='font-size:15px;font-weight:700;color:var(--text-strong)'>"+name+"</div>"+
      "<div style='font-size:11px;color:var(--text-muted)'>"+pos+" PO"+(pos!==1?"s":"")+" \xb7 "+qt+" quote"+(qt!==1?"s":"")+"</div>"+
    "</div>"+
    "<div style='margin-bottom:10px'>"+mdMoneyLines(totals)+"</div>"+
    "<div class='md-entries-body'>"+buildHistoryHtml(txs,projs,"pgc-"+name+"-"+country,{toolbar:false})+"</div>"+
  "</div>";
}
function buildProjectGroupView(){
  var group=MD_GROUP_SEL;
  var R=resolveDeals();
  var txs=R.txs.filter(function(t){return t.projectGroup===group;});
  var projs=R.projs.filter(function(p){return p.projectGroup===group;});
  if(!txs.length&&!projs.length){
    return "<div class='pg-view'><button class='md-back' onclick='closeProjectGroup()'>&#8592; Back</button>"+
      "<div class='md-empty'>No entries found for project group “"+mdEscAttr(group)+"”.</div></div>";
  }
  var byCustomer={},order=[];
  function ent(customer,country){
    var k=customer+"__"+country;
    if(!byCustomer[k]){byCustomer[k]={name:customer,country:country,txs:[],projs:[]};order.push(k);}
    return byCustomer[k];
  }
  txs.forEach(function(t){ent(t.customer,t.country).txs.push(t);});
  projs.forEach(function(p){ent(p.customer,p.country).projs.push(p);});
  var ref=txs[0]||projs[0];
  var overallTotals=mdGroupTotals(txs,projs);
  var totalPos=txs.filter(function(t){return t.status==="PO";}).length+projs.filter(function(p){return p.status==="PO";}).length;
  var totalQt=txs.filter(function(t){return t.status==="Quotation";}).length+projs.filter(function(p){return p.status==="Quotation";}).length;

  var body;
  if(order.length===1){
    var e=byCustomer[order[0]];
    body="<div class='md-section md-entries'>"+
      "<div class='md-section-title'>Projects in this group ("+hxOrderLabel(e.txs,e.projs)+")</div>"+
      "<div class='md-entries-body'>"+buildHistoryHtml(e.txs,e.projs,"pg-"+group)+"</div>"+
    "</div>";
  } else {
    body="<div class='md-section-title' style='margin:0 2px 8px'>By customer</div>"+
      order.map(function(k){var e=byCustomer[k];return buildProjectGroupSection(e.name,e.country,e.txs,e.projs);}).join("");
  }

  return "<div class='pg-view'>"+
    "<button class='md-back' onclick='closeProjectGroup()'>&#8592; Back</button>"+
    "<div class='md-head'>"+flagImg(ref.country,34)+
      "<div><div class='md-head-name'>&#128279; "+group+(function(){var u=pgUnits({txs:txs,projs:projs});return u?" <span class='pg-units'>("+u+")</span>":"";})()+"</div>"+
      "<div class='md-head-meta'>"+(order.length===1?byCustomer[order[0]].name+" \xb7 ":"")+ref.country+" \xb7 "+totalPos+" PO"+(totalPos!==1?"s":"")+" \xb7 "+totalQt+" open quote"+(totalQt!==1?"s":"")+"</div></div>"+
    "</div>"+
    "<div class='md-section'>"+
      "<div class='md-section-title'>Group total</div>"+
      mdMoneyLines(overallTotals)+
    "</div>"+
    body+
  "</div>";
}
function openProjectGroup(group){
  MD_GROUP_SEL=group;
  renderContent();
  window.scrollTo(0,0);
}
function closeProjectGroup(){
  MD_GROUP_SEL=null;
  renderContent();
}
/* The customer summary boxes don't describe groups, so this page drops
   them (renderStats fills them before every renderContent). */
function pgHideStats(){var st=document.getElementById("stats");if(st)st.innerHTML="";}
function renderProjectGroupView(){
  pgHideStats();
  document.getElementById("content").innerHTML=buildProjectGroupView();
}

/* ============================================================
   "Project Groups" workspace — a top-level tab listing every
   distinct project group across the whole dataset (spanning all
   customers), so groups can be discovered without having to find
   a 🔗 badge buried inside a customer's history first. Clicking a
   row opens the same buildProjectGroupView() consolidated page.
   ============================================================ */
var PG_SEARCH="";
function computeProjectGroups(){
  var R=resolveDeals();
  var map={},order=[];
  function ent(g){
    if(!map[g]){map[g]={name:g,customers:{},country:"",txs:[],projs:[]};order.push(g);}
    return map[g];
  }
  R.txs.forEach(function(t){if(!t.projectGroup)return;var e=ent(t.projectGroup);e.txs.push(t);e.customers[t.customer]=true;if(!e.country)e.country=t.country;});
  R.projs.forEach(function(p){if(!p.projectGroup)return;var e=ent(p.projectGroup);e.projs.push(p);e.customers[p.customer]=true;if(!e.country)e.country=p.country;});
  return order.map(function(g){return map[g];});
}
function pgTotalsCompact(totals){
  var curs=Object.keys(totals);
  if(!curs.length)return "<span class='trk-r-none'>&mdash;</span>";
  return curs.sort().map(function(c){
    return "<div class='pg-amt'>"+totals[c].toLocaleString(undefined,{maximumFractionDigits:0})+" <span class='trk-r-cur'>"+c+"</span></div>";
  }).join("");
}
/* A group is one of two things, told apart by its documents:
   - one PO split across locations: every entry carries the same PO file
     (SITA's PO 3165001907 for Bali and Surabaya); each part is named by
     the location before the dash ("Bali — PO 3165001907" -> Bali)
   - one project with several POs or quotes: each entry has its own
     document (Singapore Airlines lounge); each part is named by what the
     entry adds to the group name ("Singapore Pools - A4 Scanner" -> A4 Scanner) */
function pgKind(g){
  var all=g.txs.concat(g.projs);
  var doc=function(e){var a=(e.attachments||[])[0];return a?(a.name||a.url||""):"";};
  var first=doc(all[0]);
  var sharedPo=all.length>1&&first&&all.every(function(e){return doc(e)===first;});
  var uniq=function(a){return a.filter(function(x,i){return x&&a.indexOf(x)===i;});};
  if(sharedPo){
    var locs=uniq(all.map(function(e){return String(e.project||"").split(/\s[—–-]\s/)[0].trim();}));
    return {kind:"loc",label:"1 PO · "+locs.length+" location"+(locs.length!==1?"s":""),parts:locs};
  }
  var gl=g.name.toLowerCase();
  var parts=uniq(all.map(function(e){
    var n=String(e.project||"").trim();
    if(n.toLowerCase().indexOf(gl)===0){
      var rest=n.slice(g.name.length).replace(/^[\s—–\-:]+/,"").replace(/^\((.*)\)$/,"$1").trim();
      if(rest)n=rest;
    }
    return n;
  }));
  var pos=all.filter(function(e){return e.status==="PO";}).length;
  var qt=all.filter(function(e){return e.status==="Quotation";}).length;
  var docs=[pos?pos+" PO"+(pos!==1?"s":""):"",qt?qt+" quote"+(qt!==1?"s":""):""].filter(Boolean).join(", ")||all.length+" entries";
  return {kind:"proj",label:"1 project · "+docs,parts:parts};
}
/* the word for main-product units: "printers" only when they are printers
   (a known model or a printer-like name), "scanners" when all are scanners,
   otherwise "units" (wheel balancers, extinguishers, other businesses) */
function mdUnitWord(names,n){
  var models=(typeof getModelList==="function"?getModelList():[]).map(function(m){return String(m).toLowerCase();});
  var isPrinter=function(x){x=String(x||"").toLowerCase();return /printer|\b(tk|kpm|vkp|tg|kx|k)\d/.test(x)||models.some(function(m){return m&&x.indexOf(m)>-1;});};
  var w=names.length&&names.every(function(x){return /scanner/i.test(x);})?"scanner":names.some(isPrinter)?"printer":"unit";
  return w+(n!==1?"s":"");
}
/* Units in a group, so its size shows at a glance next to the name:
   printer line items only (warranty, SLA, installation and accessory
   lines are typed "other"), TPH consumables left out as elsewhere.
   Called "scanners" when every counted line is a scanner. */
function pgUnits(g){
  var n=0,names=[];
  g.projs.forEach(function(p){
    (typeof LINE_ITEMS!=="undefined"?LINE_ITEMS:[]).forEach(function(l){
      if(l.projectId!==p._id||l.type!=="printer")return;
      var nm=l.displayModel||l.name||"";
      if(/\bTPH\b/i.test(nm))return;
      n+=Number(l.qty)||0;names.push(nm);
    });
  });
  g.txs.forEach(function(t){
    var nm=t.displayModel||t.model||"";
    if(/\bTPH\b/i.test(nm))return;
    var q=parseInt(t.qty,10);if(q>0){n+=q;names.push(nm);}
  });
  if(!n)return "";
  return n.toLocaleString()+" "+mdUnitWord(names,n);
}
/* the PO number every entry of a one-PO group shares, from its name */
function pgSharedPo(g){
  var nums=g.txs.concat(g.projs).map(function(e){var m=String(e.project||"").match(/\bPO\s*#?\s*(\d{5,})/i);return m?m[1]:"";});
  return nums.length&&nums[0]&&nums.every(function(x){return x===nums[0];})?nums[0]:"";
}
/* typing re-renders only the rows, so the search box keeps focus */
function pgSearchInput(v){
  PG_SEARCH=v;
  var body=document.getElementById("pg-list-items");
  if(body)body.innerHTML=pgListBody();else renderProjectGroupsList();
}
function pgListBody(){
  var all=computeProjectGroups();
  var q=PG_SEARCH.trim().toLowerCase();
  var groups=all.filter(function(g){
    if(!q)return true;
    return g.name.toLowerCase().indexOf(q)!==-1||Object.keys(g.customers).some(function(c){return c.toLowerCase().indexOf(q)!==-1;});
  });
  groups.sort(function(a,b){return a.name.localeCompare(b.name);});
  if(!groups.length)return "<div class='empty'>No project groups match your search.</div>";
  var rows=groups.map(function(g){
    var totals=mdGroupTotals(g.txs,g.projs);
    var k=pgKind(g),units=pgUnits(g),po=k.kind==="loc"?pgSharedPo(g):"";
    var custNames=Object.keys(g.customers).sort().join(", ");
    var esc=String(g.name).replace(/\\/g,"\\\\").replace(/'/g,"\\'");
    return "<tr class='trk-row pg-row' onclick=\"openProjectGroup('"+esc+"')\">"+
      "<td class='pg-c-name'><div class='trk-r-name'>"+mdEscAttr(g.name)+(units?" <span class='pg-units'>("+units+")</span>":"")+"</div>"+
        "<div class='trk-r-sub'>"+flagImg(g.country,14)+" "+mdEscAttr(custNames)+(g.country?" &middot; "+mdEscAttr(g.country):"")+(po?" &middot; PO "+po:"")+"</div></td>"+
      "<td class='pg-c-kind'><span class='pg-kind pg-kind-"+k.kind+"'>"+(k.kind==="loc"?"&#128205; ":"&#128196; ")+k.label+"</span></td>"+
      "<td class='pg-c-parts'>"+k.parts.map(function(x){return "<span class='pg-part'>"+mdEscAttr(x)+"</span>";}).join("")+"</td>"+
      "<td class='num pg-c-tot'>"+pgTotalsCompact(totals)+"</td>"+
      "<td class='pg-c-go' aria-hidden='true'>&#8250;</td>"+
    "</tr>";
  }).join("");
  return "<div class='po-table-wrap'><table class='po-table pg-list'><thead><tr>"+
    "<th>Project group</th><th class='pg-c-kind'>Type</th><th class='pg-c-parts'>Covers</th><th class='num'>Total</th><th class='pg-c-go'></th>"+
    "</tr></thead><tbody>"+rows+"</tbody></table></div>";
}
function renderProjectGroupsList(){
  pgHideStats();
  var all=computeProjectGroups();
  if(!all.length){
    document.getElementById("content").innerHTML="<div class='empty'>No project groups yet. Set a “project group” on an entry (Add/Edit) to link related projects together and see them here.</div>";
    return;
  }
  var entries=all.reduce(function(n,g){return n+g.txs.length+g.projs.length;},0);
  document.getElementById("content").innerHTML=
    "<div class='trk-bar'>"+
      "<div class='trk-search'><span class='trk-search-ico'>&#128269;</span>"+
        "<input id='pg-search' type='search' placeholder='Search project groups or customers&hellip;' value=\""+mdEscAttr(PG_SEARCH)+"\" oninput='pgSearchInput(this.value)' autocomplete='off'></div>"+
      "<span class='pg-summary'>"+all.length+" group"+(all.length!==1?"s":"")+" &middot; "+entries+" entries</span>"+
    "</div>"+
    "<div id='pg-list-items'>"+pgListBody()+"</div>";
}

/* One toolbar: search first, then country / model / status / sort menus.
   The menus write to the hidden #fc/#fm/#fs/#fsort selects that the
   filtering code already reads, then re-render. */
function mdSetSel(id,v){var el=document.getElementById(id);if(el)el.value=v;renderCustomers();}
function mdPickCountry(v){mdSetSel("fc",v);}
function mdPickModel(v){mdSetSel("fm",v);}
function mdPickStatus(v){mdSetSel("fs",v);}
function mdPickSort(v){mdSetSel("fsort",v);}
function mdToolbar(n){
  var opts=function(id){
    var el=document.getElementById(id);
    return el?[].map.call(el.options,function(o){return {value:o.value,label:o.textContent.replace(/^Sort:\s*/,"")};}):[];
  };
  var cur=function(id){var el=document.getElementById(id);return el?el.value:"";};
  var countries=opts("fc").map(function(o){return o.value?{value:o.value,label:o.label,color:typeof trkCountryColor==="function"?trkCountryColor(o.value):""}:o;});
  return "<div class='trk-bar md-bar'>"+
    "<div class='trk-search'><span class='trk-search-ico'>&#128269;</span><input id='md-search' type='search' placeholder='Search customers, models, projects&hellip;' value=\""+mdEscAttr(MD_SEARCH)+"\" oninput='mdSearchInput(this.value)' autocomplete='off'></div>"+
    uiDropdown({key:"md-country",onPick:"mdPickCountry",cur:cur("fc"),opts:countries})+
    uiDropdown({key:"md-model",onPick:"mdPickModel",cur:cur("fm"),opts:opts("fm")})+
    uiDropdown({key:"md-status",onPick:"mdPickStatus",cur:cur("fs"),opts:opts("fs")})+
    uiDropdown({key:"md-sort",onPick:"mdPickSort",cur:cur("fsort"),opts:opts("fsort")})+
    "<span class='pg-summary' id='md-count'>"+n+" customer"+(n!==1?"s":"")+"</span>"+
  "</div>";
}
function renderCustomersDetail(){
  if(MD_SEL&&MD_SEL.indexOf("__")>-1)MD_SEL=MD_SEL.split("__")[0];
  var entries=mdComputeEntries();
  if(!entries.length&&!MD_SEARCH){
    document.getElementById("content").innerHTML=mdToolbar(0)+'<div class="empty">No customers match these filters.</div>';
    return;
  }
  var keys=entries.map(function(e){return e.key;});
  if(MD_SEL&&keys.indexOf(MD_SEL)===-1)MD_SEL=null;
  if(!MD_SEL&&keys.length&&!window.matchMedia("(max-width: 980px)").matches)MD_SEL=keys[0];

  document.getElementById("content").innerHTML=mdToolbar(entries.length)+
    "<div class='md-layout"+(MD_SEL?" md-has-sel":"")+"'>"+
      "<div class='md-list'>"+
        "<div id='md-list-items'>"+buildMdList(entries)+"</div>"+
      "</div>"+
      "<div class='md-detail'>"+
        (MD_SEL?buildMdDetail(MD_SEL):"<div class='md-empty'>Select a customer to see rollup and full history.</div>")+
      "</div>"+
    "</div>";
}
