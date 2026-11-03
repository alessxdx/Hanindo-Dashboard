function parseDV(d){if(!d)return 0;const p=Date.parse(d);return isNaN(p)?0:p;}
function dDisplay(tx){return tx.displayDate||tx.date||"";}
function bStatus(s){
  if(s==="PO")return'<span class="badge b-po">&#10003; PO confirmed</span>';
  if(s==="Quotation")return'<span class="badge b-qt">&#9711; Quotation</span>';
  return'<span class="badge b-ls">&#10005; Lost quote</span>';
}
function bTerm(t){const m={DDP:"b-ddp",DAP:"b-dap",EXW:"b-exw"};return`<span class="badge ${m[t]||"b-exw"}">${t}</span>`;}
function bWarranty(w){if(!w)return"";const m={"5Y":"b-5y","3Y":"b-3y","2Y":"b-2y","1Y":"b-1y"};return`<span class="badge ${m[w]||"b-1y"}">${w} warranty</span>`;}

let currentTab="customers",expandedCards={},expandedRows={};
/* pencil used in place of the word "Edit" on row / entry edit buttons */
var EDIT_ICO='<svg class="edit-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>';

function setTab(btn){
  document.querySelectorAll(".tab").forEach(b=>b.classList.remove("active"));
  btn.classList.add("active");currentTab=btn.dataset.tab;
  document.getElementById("filter-bar").style.display="none";
  renderContent();
}
function getFiltered(){
  const fc=document.getElementById("fc").value;
  const fm=document.getElementById("fm").value;
  const fs=document.getElementById("fs").value;
  return TX.filter(t=>(!fc||t.country===fc)&&(!fm||t.model===fm)&&(!fs||t.status===fs));
}
/* Deals live in two tables and either one can be empty — a fully migrated DB
   has no transactions at all — so every option list unions both sources. */
function allDealCountries(){
  return [...new Set([...TX.map(t=>t.country),...PROJECTS.map(p=>p.country)].filter(Boolean))];
}
function allDealCustomers(){
  return [...new Set([...TX.map(t=>t.customer),...PROJECTS.map(p=>p.customer)].filter(Boolean))];
}
/* Models come from tx.model and from printer line items. */
function allDealModels(){
  var li=(typeof LINE_ITEMS!=="undefined"?LINE_ITEMS:[]).filter(l=>l.type==="printer").map(l=>l.name);
  return [...new Set([...TX.map(t=>t.model),...li].filter(Boolean))];
}
function allDealGroups(){
  return [...new Set([...TX.map(t=>t.projectGroup),...PROJECTS.map(p=>p.projectGroup)].filter(Boolean))];
}
function refreshFilterOptions(){
  const fc=document.getElementById("fc"),fm=document.getElementById("fm");
  const fcV=fc.value,fmV=fm.value;
  fc.innerHTML='<option value="">All countries</option>';
  fm.innerHTML='<option value="">All models</option>';
  allDealCountries().sort().forEach(c=>{const o=document.createElement("option");o.value=c;o.textContent=c;if(c===fcV)o.selected=true;fc.appendChild(o);});
  allDealModels().sort().forEach(m=>{const o=document.createElement("option");o.value=m;o.textContent=m;if(m===fmV)o.selected=true;fm.appendChild(o);});
  const cl=document.getElementById("customer-list"),ml=document.getElementById("model-list"),cntl=document.getElementById("country-list");
  if(cl)cl.innerHTML=allDealCustomers().sort().map(c=>`<option value="${c}">`).join("");
  if(ml){
    var stdModels=getModelList();
    var txModels=allDealModels().filter(function(m){return !m.includes("+");});
    var allModels=[...new Set([...stdModels,...txModels])].sort();
    var curVal=ml.tagName==="SELECT"?ml.value:"";
    if(ml.tagName==="SELECT"){
      ml.innerHTML="<option value=''>-- Select model --</option>"+allModels.map(function(m){return "<option value='"+m+"'"+(m===curVal?" selected":"")+">"+m+"</option>";}).join("");
    } else {
      ml.innerHTML=allModels.map(function(m){return "<option value='"+m+"'>";}).join("");
    }
  }
  if(cntl)cntl.innerHTML=allDealCountries().sort().map(c=>`<option value="${c}">`).join("");
  var pgl=document.getElementById("project-group-list");if(pgl)pgl.innerHTML=allDealGroups().sort().map(p=>`<option value="${p}">`).join("");
}
/* A deal is identified by customer+country+project. To give By Customer a
   complete, non-double-counted overview that also spans By-Project data,
   every deal is resolved to ONE representation:
   - only a project exists  -> use the project (e.g. BOHOL-PANGLAO)
   - only a transaction      -> use the transaction
   - both, totals match      -> use the project (richer: line items, PDFs)
   - both, totals differ     -> keep the transaction (authoritative; the
                                project migration was incomplete, e.g.
                                SITA "Philippines T4 & T5")
   resolveDeals() returns {txs,projs} — the entries to display and count. */
function dealKey(customer,country,project){return (customer||"").trim().toLowerCase()+"||"+(country||"").trim().toLowerCase()+"||"+(project||"").trim().toLowerCase();}
function projTotalOf(p){if(p.totalOverride)return p.totalOverride;return (typeof LINE_ITEMS!=="undefined"?LINE_ITEMS:[]).filter(function(li){return li.projectId===p._id;}).reduce(function(s,li){return s+li.qty*li.unitPrice;},0);}
function txValueOf(t){var u=(typeof mdParseUnits==="function")?mdParseUnits(t.qty):0;return t.totalOverride?t.totalOverride:(u>0?t.price*u:t.price);}
function resolveDeals(){
  var txByKey={},projByKey={},keys={};
  TX.forEach(function(t){var k=dealKey(t.customer,t.country,t.project);(txByKey[k]=txByKey[k]||[]).push(t);keys[k]=1;});
  (typeof PROJECTS!=="undefined"?PROJECTS:[]).forEach(function(p){var k=dealKey(p.customer,p.country,p.project);(projByKey[k]=projByKey[k]||[]).push(p);keys[k]=1;});
  var txs=[],projs=[];
  Object.keys(keys).forEach(function(k){
    var t=txByKey[k]||[],p=projByKey[k]||[];
    if(p.length&&!t.length){projs=projs.concat(p);return;}
    if(!p.length){txs=txs.concat(t);return;}
    var pt=p.reduce(function(s,x){return s+projTotalOf(x);},0);
    var tt=t.reduce(function(s,x){return s+txValueOf(x);},0);
    if(Math.abs(pt-tt)<1)projs=projs.concat(p);else txs=txs.concat(t);
  });
  return {txs:txs,projs:projs};
}
function renderStats(){
  const R=resolveDeals(),all=R.txs.concat(R.projs);
  const pos=typeof mdCountSt==="function"?mdCountSt(all,"PO"):all.filter(x=>x.status==="PO").length; /* summary records count as their POs */
  const qt=all.filter(x=>x.status==="Quotation").length;
  const ls=all.filter(x=>x.status==="Lose").length;
  /* companies, not company+country: matches the one-entry-per-company list */
  const custSet=new Set(),ctySet=new Set();all.forEach(x=>{custSet.add(x.customer);if(x.country)ctySet.add(x.country);});
  const cu=custSet.size;
  document.getElementById("stats").innerHTML=`
    <div class="stat"><div class="stat-label">Customers</div><div class="stat-value">${cu}</div><div class="stat-sub">across ${ctySet.size} countr${ctySet.size===1?"y":"ies"}</div></div>
    <div class="stat"><div class="stat-label">Confirmed POs</div><div class="stat-value">${pos}</div><div class="stat-sub">transactions</div></div>
    <div class="stat"><div class="stat-label">Open quotations</div><div class="stat-value">${qt}</div><div class="stat-sub">pending</div></div>
    <div class="stat"><div class="stat-label">Lost quotes</div><div class="stat-value">${ls}</div><div class="stat-sub">for reference</div></div>`;
}
function fxEqSpan(amount,currency){
  if(typeof fxUsdText!=="function")return "";
  const t=fxUsdText(amount,currency);
  return t?" <span class='fx-usd'>"+t+"</span>":"";
}
function projGroupLinkHtml(group){
  if(!group)return "";
  var esc=String(group).replace(/\\/g,"\\\\").replace(/'/g,"\\'");
  return "<span class='proj-group-tag clickable' onclick=\"event.stopPropagation();openProjectGroup('"+esc+"')\" title='View consolidated project group'>&#128279; "+group+" <span class='pgt-arrow'>&rarr;</span></span>";
}
function attShortName(n){
  var s=String(n||"PDF").replace(/\.pdf$/i,"");
  return s.length>18?s.slice(0,17)+"…":s;
}
const ATT_DOCTYPE_ORDER={Quotation:0,PO:1};
function attClipsHtml(list){
  if(!list||!list.length)return "";
  const sorted=[...list].sort(function(a,b){
    var da=a.doctype||(typeof guessDoctype==="function"?guessDoctype(a.name):"");
    var db=b.doctype||(typeof guessDoctype==="function"?guessDoctype(b.name):"");
    var ra=ATT_DOCTYPE_ORDER.hasOwnProperty(da)?ATT_DOCTYPE_ORDER[da]:2;
    var rb=ATT_DOCTYPE_ORDER.hasOwnProperty(db)?ATT_DOCTYPE_ORDER[db]:2;
    return ra-rb;
  });
  return sorted.map(function(a){
    var full=String(a.name||"PDF").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
    var dt=a.doctype||(typeof guessDoctype==="function"?guessDoctype(a.name):"");
    var useTag=dt&&dt!=="Other";
    var label=(useTag?dt:attShortName(a.name)).replace(/&/g,"&amp;").replace(/</g,"&lt;");
    var cls=useTag?" doc-"+dt.toLowerCase():"";
    /* plain click opens the in-app (zoomable) viewer; ctrl/cmd/shift-click still opens a new tab */
    return "<a class='pdf-clip"+cls+"' href='"+a.url+"' target='_blank' rel='noopener' data-name=\""+full+"\" onclick='event.stopPropagation();if(event.ctrlKey||event.metaKey||event.shiftKey)return true;return trkViewFile(this)' title=\""+full+"\">&#128206; "+label+"</a>";
  }).join(" ");
}
/* Which project groups still have a combined "ATB + BTP" summary entry?
   Split rows are only hidden behind that entry's toggle; if the combined
   entry was deleted, the orphaned splits must show on their own. */
function combinedGroupsOf(txs){
  const combinedGroups={};
  txs.forEach(function(t){if(t.projectGroup&&t.model&&t.model.includes("+"))combinedGroups[t.projectGroup]=true;});
  return combinedGroups;
}
function txEntrySort(a,b){
  const aCombined=a.projectGroup&&a.model&&a.model.includes("+");
  const bCombined=b.projectGroup&&b.model&&b.model.includes("+");
  if(a.projectGroup&&b.projectGroup&&a.projectGroup===b.projectGroup){
    if(aCombined&&!bCombined)return -1;
    if(!aCombined&&bCombined)return 1;
  }
  return parseDV(b.date)-parseDV(a.date);
}
function buildTxEntriesHtml(txs){
  const combinedGroups=combinedGroupsOf(txs);
  return [...txs].sort(txEntrySort).map(function(tx){
    const inner=buildTxEntryHtml(tx);
    const isSplit=tx.projectGroup&&tx.project&&(tx.project.includes("— ATB")||tx.project.includes("— BTP"));
    const grpId=tx.projectGroup?tx.projectGroup.replace(/[^a-zA-Z0-9]/g,"-"):"";
    return (isSplit&&combinedGroups[tx.projectGroup])
      ?"<div class='grp-entry' data-group='"+grpId+"' style='display:none'>"+inner+"</div>"
      :inner;
  }).join("");
}
/* One history entry, fully expanded. Returned bare (no grp-entry wrapper) so
   both the flat list and the collapsed-row list can place it themselves. */
function buildTxEntryHtml(tx){
  {
    const margin=tx.bp&&tx.currency==="USD"?tx.price-tx.bp:null;
    const mPct=margin?((margin/tx.price)*100).toFixed(1):null;
    const isCombined=tx.projectGroup&&tx.model&&tx.model.includes("+");
    const grpId=tx.projectGroup?tx.projectGroup.replace(/[^a-zA-Z0-9]/g,"-"):"";
    const groupTag=(()=>{
      if(!tx.projectGroup)return "";
      if(isCombined)return "<div style='margin-bottom:5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap'><button class='expand-btn' onclick='toggleGroup(\""+grpId+"\",this,event)'>\u25bc Show individual model entries</button>"+projGroupLinkHtml(tx.projectGroup)+"</div>";
      return "<div style='margin-bottom:5px'>"+projGroupLinkHtml(tx.projectGroup)+"</div>";
    })();
    const pdfClip=attClipsHtml(tx.attachments);
    const fxNoteLine=(tx.currency!=="USD"&&typeof fxNote==="function"&&fxNote(tx.currency))?"<div class='fx-note'>"+fxNote(tx.currency)+"</div>":"";
    const inner="<div class='tx'><div>"+
      groupTag+
      "<div class='tx-date'>"+(dDisplay(tx)?dDisplay(tx)+" \xb7 ":"")+bStatus(tx.status)+pdfClip+"</div>"+
      "<div class='tx-model'>"+tx.model+" &nbsp;&middot;&nbsp; "+tx.project+" &nbsp;&middot;&nbsp; "+tx.qty+"</div>"+
      (tx.pn?"<div class='tx-pn'>"+tx.pn+"</div>":"")+
      "<div class='tx-badges'>"+tx.terms.map(bTerm).join("")+bWarranty(tx.warranty)+"</div>"+
      (tx.notes.length?"<div class='tx-notes'>"+tx.notes.map(function(n){return "<div class='tx-note'>"+n+"</div>";}).join("")+"</div>":"")+
    "</div>"+
    "<div style='text-align:right;display:flex;flex-direction:column;min-height:100%'>"+
      (tx.dualPrice?
        "<div style='text-align:right;line-height:1.8'>"+
          "<span style='font-size:10px;color:var(--text-muted)'>Cutter ARINC</span><br>"+
          "<span style='font-weight:600;font-size:13px;color:var(--text-strong)'>"+tx.price.toLocaleString()+" "+tx.currency+"</span>"+fxEqSpan(tx.price,tx.currency)+"<br>"+
          "<span style='font-size:10px;color:var(--text-muted)'>Non Cutter ARINC</span><br>"+
          "<span style='font-weight:600;font-size:13px;color:var(--text-strong)'>"+tx.dualPrice.toLocaleString()+" "+tx.currency+"</span>"+fxEqSpan(tx.dualPrice,tx.currency)+
        "</div>"
      :
        "<div class='tx-price'>"+tx.price.toLocaleString()+" "+tx.currency+fxEqSpan(tx.price,tx.currency)+"</div>"
      )+
      (margin!==null?"<div class='tx-margin'>Margin: $"+margin.toFixed(0)+" ("+mPct+"%)</div>":"")+
      (()=>{
        const qm=(tx.qty||"").match(/[0-9]+/);const q=qm?parseInt(qm[0]):null;const printerTot=(q&&q>0)?tx.price*q:null;
        if(tx.totalOverride){
          const pTot=tx.printerTotalOverride||(printerTot&&!tx.noPrinterTotal?printerTot:null);
          if(pTot)return "<div style='font-size:11px;color:var(--accent-text);margin-top:6px;padding-top:5px;border-top:1px solid var(--border-strong)'>Printer Total: <strong>"+pTot.toLocaleString()+" "+tx.currency+"</strong></div><div style='font-size:11px;color:var(--accent-text);margin-top:3px'>Project Total: <strong>"+tx.totalOverride.toLocaleString()+" "+tx.currency+"</strong>"+fxEqSpan(tx.totalOverride,tx.currency)+"</div>";
          return "<div style='font-size:11px;color:var(--accent-text);margin-top:6px;padding-top:5px;border-top:1px solid var(--border-strong)'>Project Total: <strong>"+tx.totalOverride.toLocaleString()+" "+tx.currency+"</strong>"+fxEqSpan(tx.totalOverride,tx.currency)+"</div>";
        }
        if(!printerTot)return "";
        if(tx.noPrinterTotal)return "<div style='font-size:11px;color:var(--accent-text);margin-top:6px;padding-top:5px;border-top:1px solid var(--border-strong)'>Project Total: <strong>"+printerTot.toLocaleString()+" "+tx.currency+"</strong>"+fxEqSpan(printerTot,tx.currency)+"</div>";
        return "<div style='font-size:11px;color:var(--accent-text);margin-top:6px;padding-top:5px;border-top:1px solid var(--border-strong)'>Printer Total: <strong>"+printerTot.toLocaleString()+" "+tx.currency+"</strong></div><div style='font-size:11px;color:var(--accent-text);margin-top:3px'>Project Total: <strong>"+printerTot.toLocaleString()+" "+tx.currency+"</strong>"+fxEqSpan(printerTot,tx.currency)+"</div>";
      })()+
      fxNoteLine+
      "<div style='display:flex;justify-content:flex-end;padding-bottom:14px;margin-top:auto;padding-top:8px'>"+
        "<button class='edit-btn' title='Edit' aria-label='Edit' onclick='editTx("+TX.indexOf(tx)+",event)'>"+EDIT_ICO+"</button>"+
      "</div>"+
    "</div></div>";
    return inner;
  }
}
/* ============================================================
   HISTORY LIST — one collapsed line per entry, grouped by date /
   model / project / status. A row expands into the exact block the
   history used to render inline (buildTxEntryHtml / buildProjectBlock),
   so every edge case — combined ATB+BTP toggles, dual pricing,
   overrides, PDF chips — looks identical once opened. Groups carry a
   per-currency subtotal, and entries sharing a PO number nest under a
   single parent row so a multi-line PO reads as the one order it is.
   ============================================================ */
var HX_OPEN={};        /* rowId -> true when its detail block is open */
var HX_YEAR_CLOSED={}; /* "groupScope|key" -> true when the group is collapsed */
var HX_YEAR_INIT={};   /* groupScope -> true once the open/closed defaults were applied */
var HX_MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var HX_AUTO_OPEN_ROWS=12; /* open groups top-down until this many rows show */
var HX_MODES=[{k:"date",label:"Date"},{k:"model",label:"Model"},{k:"project",label:"Project"},{k:"status",label:"Status"}];
var HX_MODE=(function(){try{return localStorage.getItem("cpd_hxgroup")||"date";}catch(e){return "date";}})();
var HX_STATUS_RANK={PO:0,Quotation:1,Lose:2};

function hxSafe(s){return String(s==null?"":s).replace(/[^a-zA-Z0-9]/g,"-");}
function hxAttr(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");}
/* Grouping by date puts the year in the group header, so the rows leave it
   out. Every other grouping has no year anywhere — carry it on the row. */
function hxShowYear(){return HX_MODE!=="date";}
function hxShortDate(ts){
  if(!ts)return "—";
  var d=new Date(ts);
  return d.getDate()+" "+HX_MONTHS[d.getMonth()]+(hxShowYear()?" "+d.getFullYear():"");
}
function hxYearOf(ts){return ts?String(new Date(ts).getFullYear()):"Undated";}
/* Status as plain coloured text, not a filled pill — on a list where most
   rows share a status, six saturated badges are noise, not information. */
function hxMiniStatus(s){
  if(s==="PO")return "<span class='hx-st hx-st-po' title='PO confirmed'>PO</span>";
  if(s==="Quotation")return "<span class='hx-st hx-st-qt' title='Open quotation'>Quote</span>";
  if(s==="Mixed")return "<span class='hx-st hx-st-mix' title='Mixed statuses'>Mixed</span>";
  return "<span class='hx-st hx-st-ls' title='Lost quote'>Lost</span>";
}
/* PO numbers aren't a column — they live in a "PO 3165001907 - …" note.
   Require a digit so prose like "PO confirmed by email" isn't mistaken
   for an order number. */
function hxPoNumber(notes){
  for(var i=0;i<(notes||[]).length;i++){
    var m=/^PO[\s#:]*([A-Za-z0-9][A-Za-z0-9\/_-]*)/i.exec(String(notes[i]).trim());
    if(m&&/\d/.test(m[1]))return m[1].replace(/[.,;-]+$/,"");
  }
  return null;
}
/* Now that a PO is one project per site, the PO number lives in the project
   name ("Bali — PO 3165001907"). Inside a nest that already announces the PO,
   the suffix is noise. */
function hxStripPo(name,po){
  if(!po)return name;
  return String(name).replace(new RegExp("\\s*[—-]\\s*PO\\s*"+po+"\\s*$","i"),"")||name;
}
/* What's actually in a project, aggregated by item name so a PO with two
   lines of the same model reads as one figure. */
function hxProjSummary(pid){
  var order=[],byName={};
  (typeof LINE_ITEMS!=="undefined"?LINE_ITEMS:[])
    .filter(function(li){return li.projectId===pid&&li.type!=="discount";})
    /* Printers lead — they're what the deal is about; accessories follow. */
    .sort(function(a,b){
      var pa=a.type==="printer"?0:1,pb=b.type==="printer"?0:1;
      return pa-pb||a.sortOrder-b.sortOrder;
    })
    .forEach(function(li){
      if(!byName[li.name]){byName[li.name]={qty:0,prices:[]};order.push(li.name);}
      var e=byName[li.name];
      e.qty+=li.qty;
      if(e.prices.indexOf(li.unitPrice)===-1)e.prices.push(li.unitPrice);
    });
  if(!order.length)return {html:"—",text:"—"};
  /* One product, and the qty/price kept in a non-shrinking span so a long
     model name clips instead of the number the row exists to show. A product
     bought at two price points shows the range. */
  var n=order[0],e=byName[n],p=e.prices.slice().sort(function(a,b){return a-b;});
  var price=p.length===1?hxNum(p[0]):hxNum(p[0])+"–"+hxNum(p[p.length-1]);
  var tail="\xd7"+e.qty+" @ "+price+(order.length>1?" \xb7 +"+(order.length-1)+" more":"");
  return {
    html:"<span class='hx-sub-name'>"+n+"</span><span class='hx-sub-price'>"+tail+"</span>",
    text:n+" "+tail
  };
}
function hxNum(v){return Number(v).toLocaleString(undefined,{maximumFractionDigits:2});}
/* A project has no single model field — derive one from its printer lines. */
function hxProjModel(pid){
  var names=[];
  (typeof LINE_ITEMS!=="undefined"?LINE_ITEMS:[]).forEach(function(li){
    if(li.projectId===pid&&li.type==="printer"&&names.indexOf(li.name)===-1)names.push(li.name);
  });
  if(!names.length)return "Other";
  return names.length===1?names[0]:"Multiple models";
}
function hxUsd(v,cur){
  if(typeof fxToUSD!=="function")return 0;
  var u=fxToUSD(v,cur);
  return u===null||isNaN(u)?0:u;
}
/* Digits carry the weight; the currency code rides along dimmed so a column
   of amounts reads as numbers rather than as numbers-plus-noise. */
function hxAmount(v,cur){
  if(!v)return "<span class='hx-cur'>—</span>";
  return v.toLocaleString(undefined,{maximumFractionDigits:0})+"<span class='hx-cur'>"+cur+"</span>";
}
function hxTotals(map){
  var curs=Object.keys(map).sort();
  if(!curs.length)return "";
  return curs.map(function(c){return hxAmount(map[c],c);}).join(" \xb7 ");
}

/* Flatten transactions + project-only deals into one sortable row model. */
function hxItems(txs,projs){
  var combined=combinedGroupsOf(txs);
  var items=txs.map(function(tx){
    var isCombined=!!(tx.projectGroup&&tx.model&&tx.model.indexOf("+")!==-1);
    var isSplit=!!(tx.projectGroup&&tx.project&&(tx.project.indexOf("— ATB")!==-1||tx.project.indexOf("— BTP")!==-1));
    return {
      id:"t"+TX.indexOf(tx),ts:parseDV(tx.date),status:tx.status,
      title:tx.model,sub:[tx.project,tx.qty].filter(Boolean).join(" \xb7 "),
      value:txValueOf(tx),currency:tx.currency,
      atts:tx.attachments,group:tx.projectGroup,
      model:tx.model,project:tx.project,po:hxPoNumber(tx.notes),
      cust:tx.customer+"__"+tx.country,
      combined:isCombined,hidden:isSplit&&!!combined[tx.projectGroup],
      /* Built lazily: the block renders differently depending on what the row
         above it already says, which isn't known until nesting is resolved. */
      body:function(){return buildTxEntryHtml(tx);}
    };
  });
  (projs||[]).forEach(function(p){
    var sum=hxProjSummary(p._id);
    items.push({
      id:"p"+hxSafe(p._id),ts:parseDV(p.date),status:p.status,
      title:p.project,sub:sum.html,subText:sum.text,lineCount:(typeof LINE_ITEMS!=="undefined"?LINE_ITEMS:[]).filter(function(l){return l.projectId===p._id;}).length,
      value:projTotalOf(p),currency:p.currency,
      atts:p.attachments,group:p.projectGroup,
      model:hxProjModel(p._id),project:p.project,po:hxPoNumber(p.notes),
      cust:p.customer+"__"+p.country,
      combined:false,hidden:false,
      body:function(o){return buildProjectBlock(p,{compact:true,hideGroupTag:!!(o&&o.hideGroupTag)});}
    });
  });
  /* Newest first, but a combined entry always sits directly above the split
     rows it hides, so revealing them keeps them next to their parent. */
  items.sort(function(a,b){
    if(a.group&&b.group&&a.group===b.group){
      if(a.combined&&!b.combined)return -1;
      if(!a.combined&&b.combined)return 1;
    }
    return b.ts-a.ts;
  });
  return items;
}

/* The paperclip is a real link to the document, not a passive marker. Prefers
   the PO over a quotation when a deal carries both. stopPropagation keeps the
   click from toggling the row open underneath it. */
function hxAttLink(atts){
  if(!atts||!atts.length)return "";
  var pick=atts.filter(function(a){return (a.doctype||"")==="PO";})[0]||atts[0];
  var label=atts.length>1?"&#128206;<sup>"+atts.length+"</sup>":"&#128206;";
  return "<a class='hx-ico hx-att' href='"+pick.url+"' target='_blank' rel='noopener'"+
    " onclick='event.stopPropagation()' title=\"Open "+hxAttr(pick.name)+"\">"+label+"</a>";
}
function hxRowHtml(it,sc,parentPo,groupNamed){
  var rid=sc+"-"+it.id,open=!!HX_OPEN[rid];
  var title=parentPo?hxStripPo(it.title,parentPo):it.title;
  var icons=hxAttLink(it.atts);
  if(it.group)icons+="<span class='hx-ico' title=\"Project group: "+hxAttr(it.group)+"\">&#128279;</span>";
  var row="<div class='hx-row"+(open?" open":"")+"' onclick=\"hxToggleRow('"+rid+"')\">"+
      "<span class='hx-date'>"+hxShortDate(it.ts)+"</span>"+
      hxMiniStatus(it.status)+
      "<span class='hx-title' title=\""+hxAttr(title)+"\">"+title+"</span>"+
      "<span class='hx-sub' title=\""+hxAttr(it.subText||it.sub)+"\">"+it.sub+"</span>"+
      "<span class='hx-icons'>"+icons+"</span>"+
      "<span class='hx-val'>"+hxAmount(it.value,it.currency)+"</span>"+
      "<span class='hx-chev"+(open?" open":"")+"' id='hx-c-"+rid+"'>▾</span>"+
    "</div>"+
    "<div class='hx-body' id='hx-b-"+rid+"'"+(open?"":" style='display:none'")+">"+
      it.body({hideGroupTag:!!parentPo||!!groupNamed})+
    "</div>";
  return it.hidden
    ?"<div class='hx-item grp-entry' data-group='"+hxSafe(it.group)+"' style='display:none'>"+row+"</div>"
    :"<div class='hx-item'>"+row+"</div>";
}

/* Which bucket an entry falls into under the active grouping mode. */
function hxGroupLabel(it,mode){
  if(mode==="model")return it.model||"Other";
  if(mode==="project")return it.group||it.project||"Other";
  if(mode==="status")return it.status==="PO"?"Confirmed POs":(it.status==="Quotation"?"Open quotations":"Lost quotes");
  return hxYearOf(it.ts);
}
/* Collapse entries that share a PO number into one parent row. Only worth it
   at 2+ lines; hidden split rows stay in the flat flow (they're display:none
   until their combined parent reveals them). */
function hxNest(items){
  var counts={};
  items.forEach(function(it){if(it.po&&!it.hidden)counts[it.po]=(counts[it.po]||0)+1;});
  var out=[],seen={};
  items.forEach(function(it){
    if(!it.po||it.hidden||counts[it.po]<2){out.push(it);return;}
    if(seen[it.po])return;
    seen[it.po]=true;
    out.push({nest:true,po:it.po,children:items.filter(function(o){return o.po===it.po&&!o.hidden;})});
  });
  return out;
}
function hxNestHtml(n,sc){
  var nid=sc+"-po-"+hxSafe(n.po),open=!!HX_OPEN[nid];
  var totals={},firstAtts=null,ts=0,status=null,mixed=false,sites=[],lines=0;
  n.children.forEach(function(c){
    if(c.currency&&c.value)totals[c.currency]=(totals[c.currency]||0)+c.value;
    /* The lines of one PO share one document — link it once, not per line. */
    if(!firstAtts&&(c.atts||[]).length)firstAtts=c.atts;
    if(c.ts>ts)ts=c.ts;
    if(status===null)status=c.status;else if(status!==c.status)mixed=true;
    lines+=c.lineCount||1;
    var site=hxStripPo(c.project||"",n.po);
    if(site&&sites.indexOf(site)===-1)sites.push(site);
  });
  var icons=hxAttLink(firstAtts);
  var sub=lines+" line"+(lines!==1?"s":"")+(sites.length?" \xb7 "+sites.join(", "):"");
  return "<div class='hx-item hx-nest"+(open?" open":"")+"'>"+
    "<div class='hx-row hx-nest-head"+(open?" open":"")+"' onclick=\"hxToggleRow('"+nid+"')\">"+
      "<span class='hx-date'>"+hxShortDate(ts)+"</span>"+
      hxMiniStatus(mixed?"Mixed":status)+
      "<span class='hx-title'>PO "+n.po+"</span>"+
      "<span class='hx-sub'>"+sub+"</span>"+
      "<span class='hx-icons'>"+icons+"</span>"+
      "<span class='hx-val'>"+hxTotals(totals)+"</span>"+
      "<span class='hx-chev"+(open?" open":"")+"' id='hx-c-"+nid+"'>▾</span>"+
    "</div>"+
    "<div class='hx-nest-body' id='hx-b-"+nid+"'"+(open?"":" style='display:none'")+">"+
      n.children.map(function(c){return hxRowHtml(c,sc,n.po);}).join("")+
    "</div>"+
  "</div>";
}
/* Count orders, not records. A PO split across two sites is one order, so
   "3 POs" is the honest headline where "4 entries" counted rows. */
function hxCountLabel(rows,entryCount){
  var n=rows.length,st=null,mixed=false;
  rows.forEach(function(r){
    (r.nest?r.children:[r]).forEach(function(c){
      if(st===null)st=c.status;else if(st!==c.status)mixed=true;
    });
  });
  var noun=mixed?(n===1?"order":"orders"):
    (st==="PO"?(n===1?"PO":"POs"):
     st==="Quotation"?(n===1?"quotation":"quotations"):
     (n===1?"lost quote":"lost quotes"));
  return n+" "+noun+(entryCount>n?" \xb7 "+entryCount+" records":"");
}
function hxOrderLabel(txs,projs){
  var n=hxOrderCount(txs,projs);
  return n+" order"+(n!==1?"s":"");
}
/* Same unit as hxCountLabel, but cheap — no entry bodies built. */
function hxOrderCount(txs,projs){
  var combined=combinedGroupsOf(txs||[]),seen={},n=0;
  function add(po,hidden){
    if(hidden)return;
    if(po){if(seen[po])return;seen[po]=true;}
    n++;
  }
  (txs||[]).forEach(function(t){
    var isSplit=!!(t.projectGroup&&t.project&&(t.project.indexOf("— ATB")!==-1||t.project.indexOf("— BTP")!==-1));
    add(hxPoNumber(t.notes),isSplit&&!!combined[t.projectGroup]);
  });
  (projs||[]).forEach(function(p){add(hxPoNumber(p.notes),false);});
  return n;
}
/* True when a group holds one row whose own title already says what the group
   header says — e.g. group "Bali — PO 3165001891" over a row of the same name,
   or group "PO 3165001907" over the nest for that PO. */
function hxGroupRestatesRow(g){
  if(g.rows.length!==1)return false;
  var r=g.rows[0];
  var title=r.nest?("PO "+r.po):(r.title||"");
  return String(g.label).trim().toLowerCase()===String(title).trim().toLowerCase();
}
/* Customers carrying this project group who aren't represented in the rows
   on screen. Empty means the consolidated view would show nothing new. */
function hxGroupElsewhere(g){
  var here={},names={};
  g.items.forEach(function(it){if(it.cust)here[it.cust]=1;});
  function scan(list){
    (list||[]).forEach(function(r){
      if(r.projectGroup!==g.label)return;
      var k=r.customer+"__"+r.country;
      if(!here[k])names[k]=r.customer;
    });
  }
  scan(typeof PROJECTS!=="undefined"?PROJECTS:[]);
  scan(typeof TX!=="undefined"?TX:[]);
  return Object.keys(names).map(function(k){return names[k];});
}
function hxToolbar(){
  return "<div class='hx-bar'><span class='hx-bar-lbl'>Group by</span>"+
    HX_MODES.map(function(m){
      return "<button class='hx-chip"+(HX_MODE===m.k?" active":"")+"' onclick=\"hxSetMode('"+m.k+"')\">"+m.label+"</button>";
    }).join("")+
  "</div>";
}
function hxSetMode(m){
  if(HX_MODE===m)return;
  HX_MODE=m;
  try{localStorage.setItem("cpd_hxgroup",m);}catch(e){}
  renderContent();
}

function buildHistoryHtml(txs,projs,scope,opts){
  var showBar=!opts||opts.toolbar!==false;
  var items=hxItems(txs,projs);
  if(!items.length)return (showBar?hxToolbar():"")+"<div class='hx-none'>No entries.</div>";
  /* Row state is keyed without the mode so expanded rows survive a regroup;
     group state is keyed with it, since the buckets themselves change. */
  var sc=hxSafe(scope||"hx"),gsc=sc+"--"+HX_MODE;
  var keys=[],byKey={};
  items.forEach(function(it){
    var label=hxGroupLabel(it,HX_MODE);
    if(!byKey[label]){byKey[label]={label:label,items:[],count:0,pos:0,totals:{},usd:0,ts:0};keys.push(label);}
    var g=byKey[label];
    g.items.push(it);
    if(it.hidden)return; /* split rows would double-count their combined parent */
    g.count++;
    if(it.status==="PO")g.pos++;
    if(it.ts>g.ts)g.ts=it.ts;
    if(it.currency&&it.value){
      g.totals[it.currency]=(g.totals[it.currency]||0)+it.value;
      g.usd+=hxUsd(it.value,it.currency);
    }
  });
  /* Nest before measuring: an order is the unit a group counts, and the
     auto-open budget is spent in rows, not records. */
  keys.forEach(function(k){var g=byKey[k];g.rows=hxNest(g.items);g.orders=g.rows.length;});
  /* Date keeps the newest-first order the items already have; status uses a
     fixed pipeline order; model/project lead with the biggest money. */
  if(HX_MODE==="status"){
    keys.sort(function(a,b){
      function rank(l){return l==="Confirmed POs"?0:(l==="Open quotations"?1:2);}
      return rank(a)-rank(b);
    });
  }else if(HX_MODE==="model"||HX_MODE==="project"){
    keys.sort(function(a,b){
      var d=byKey[b].usd-byKey[a].usd;
      if(d)return d;
      d=byKey[b].count-byKey[a].count;
      return d||a.localeCompare(b);
    });
  }
  if(!HX_YEAR_INIT[gsc]){
    HX_YEAR_INIT[gsc]=true;
    var shown=0,closing=false;
    keys.forEach(function(k){
      var n=byKey[k].orders;
      if(closing||(shown>0&&shown+n>HX_AUTO_OPEN_ROWS)){closing=true;HX_YEAR_CLOSED[gsc+"|"+hxSafe(k)]=true;}
      else shown+=n;
    });
  }
  var groupsHtml=keys.map(function(k,i){
    var g=byKey[k],gk=hxSafe(k)+"-"+i;
    var closed=!!HX_YEAR_CLOSED[gsc+"|"+hxSafe(k)],gid="hx-g-"+gsc+"-"+gk;
    var meta=hxCountLabel(g.rows,g.count);
    /* A header that just restates its only row is a wasted line — grouping by
       project makes almost every group a group of one. Drop the header and let
       the row speak; the year/status/model headers never match, so they stay. */
    if(hxGroupRestatesRow(g)){
      return "<div class='hx-group hx-group-bare'>"+
        g.rows.map(function(row){return row.nest?hxNestHtml(row,sc):hxRowHtml(row,sc);}).join("")+
      "</div>";
    }
    /* When this header IS the project group, the deals under it shouldn't each
       repeat it as a 🔗 tag. */
    var isGroupHeader=HX_MODE==="project"&&g.items.some(function(it){return it.group===g.label;});
    /* The jump only earns its place when the group reaches customers that
       aren't already on screen — otherwise the consolidated view shows exactly
       these same rows. Naming who else is in it makes that concrete. */
    var elsewhere=isGroupHeader?hxGroupElsewhere(g):[];
    var jump=(isGroupHeader&&elsewhere.length&&!(typeof MD_GROUP_SEL!=="undefined"&&MD_GROUP_SEL))
      ?"<span class='hx-glink' title='Also covers "+hxAttr(elsewhere.join(", "))+"' onclick=\"event.stopPropagation();openProjectGroup('"+
         String(g.label).replace(/\\/g,"\\\\").replace(/'/g,"\\'")+"')\">&#128279; also at "+
         elsewhere[0]+(elsewhere.length>1?" +"+(elsewhere.length-1):"")+" &rarr;</span>"
      :"";
    return "<div class='hx-group'>"+
      "<div class='hx-ghead' onclick=\"hxToggleYear('"+gsc+"','"+hxSafe(k)+"','"+gk+"')\">"+
        "<span class='hx-gchev"+(closed?"":" open")+"' id='"+gid+"-chev'>▸</span>"+
        "<span class='hx-gyear'>"+g.label+"</span>"+
        "<span class='hx-gmeta'>"+meta+"</span>"+
        jump+
        "<span class='hx-gtot'>"+hxTotals(g.totals)+"</span>"+
      "</div>"+
      "<div class='hx-gbody' id='"+gid+"'"+(closed?" style='display:none'":"")+">"+
        g.rows.map(function(row){return row.nest?hxNestHtml(row,sc):hxRowHtml(row,sc,null,isGroupHeader);}).join("")+
      "</div>"+
    "</div>";
  }).join("");
  return (showBar?hxToolbar():"")+groupsHtml;
}

function hxToggleRow(rid){
  HX_OPEN[rid]=!HX_OPEN[rid];
  var b=document.getElementById("hx-b-"+rid);
  if(b){
    b.style.display=HX_OPEN[rid]?"":"none";
    if(b.parentNode&&b.parentNode.classList.contains("hx-nest"))b.parentNode.classList.toggle("open",HX_OPEN[rid]);
  }
  var c=document.getElementById("hx-c-"+rid);
  if(c){
    c.classList.toggle("open",HX_OPEN[rid]);
    if(c.parentNode)c.parentNode.classList.toggle("open",HX_OPEN[rid]);
  }
}
function hxToggleYear(gsc,key,gk){
  var k=gsc+"|"+key;
  HX_YEAR_CLOSED[k]=!HX_YEAR_CLOSED[k];
  var b=document.getElementById("hx-g-"+gsc+"-"+gk);
  if(b)b.style.display=HX_YEAR_CLOSED[k]?"none":"";
  var c=document.getElementById("hx-g-"+gsc+"-"+gk+"-chev");
  if(c)c.classList.toggle("open",!HX_YEAR_CLOSED[k]);
}

function buildCustomerCard(name,txs){
  const country=txs[0].country,flagIcon=FLAGS[country]||"\u{1F310}";
  const cardKey=name+"__"+country,isOpen=expandedCards[cardKey];
  const pos=txs.filter(t=>t.status==="PO").length,qt=txs.filter(t=>t.status!=="PO").length;
  const rows=buildTxEntriesHtml(txs);
  const sid=cardKey.replace(/[^a-zA-Z0-9]/g,"-");
  const escapedKey=cardKey.replace(/'/g,"\\'");
  return`<div class="card">
    <div class="card-header" onclick="toggleCard('${escapedKey}','${sid}')">
      <div class="flag-icon">${flagIcon}</div>
      <div style="flex:1"><div class="cname">${name}</div>
      <div class="cmeta">${country} \xb7 ${pos} PO${pos!==1?"s":""} \xb7 ${qt} quote${qt!==1?"s":""}</div></div>
      <div class="chevron ${isOpen?"open":""}" id="chev-${sid}">\u25be</div>
    </div>
    <div class="card-body ${isOpen?"open":""}" id="body-${sid}">${rows}</div>
  </div>`;
}
function renderCustomers(){
  const data=getFiltered(),sortMode=document.getElementById("fsort").value,groupMode="country";
  const byC={};
  data.forEach(t=>{const key=t.customer+"__"+t.country;if(!byC[key])byC[key]=[];byC[key].push(t);});
  if(!Object.keys(byC).length){document.getElementById("content").innerHTML='<div class="empty">No transactions match your filters.</div>';return;}
  let entries=Object.entries(byC).map(([key,txs])=>[txs[0].customer,txs,key]);
  if(sortMode==="name")entries.sort((a,b)=>a[0].localeCompare(b[0]));
  else if(sortMode==="name-desc")entries.sort((a,b)=>b[0].localeCompare(a[0]));
  else if(sortMode==="po-desc")entries.sort((a,b)=>b[1].filter(t=>t.status==="PO").length-a[1].filter(t=>t.status==="PO").length);
  else if(sortMode==="recent")entries.sort((a,b)=>Math.max(...b[1].map(t=>parseDV(t.date)))-Math.max(...a[1].map(t=>parseDV(t.date))));
  let html="";
  if(groupMode==="country"){
    const byCountry={};
    entries.forEach(([name,txs,key])=>{const c=txs[0].country||"Unknown";if(!byCountry[c])byCountry[c]=[];byCountry[c].push([name,txs,key]);});
    Object.entries(byCountry).sort((a,b)=>a[0].localeCompare(b[0])).forEach(([country,list])=>{
      const f=flagImg(country,18);
      html+=`<div class="country-group-label">${f} ${country} <span class="country-count">${list.length} customer${list.length!==1?"s":""}</span></div>`;
      list.forEach(([name,txs])=>{html+=buildCustomerCard(name,txs);});
    });
  } else {
    entries.forEach(([name,txs])=>{html+=buildCustomerCard(name,txs);});
  }
  document.getElementById("content").innerHTML=html;
}
function toggleGroup(grp,btn,e){
  e.stopPropagation();
  const entries=document.querySelectorAll(".grp-entry[data-group=\""+grp+"\"]");
  const isHidden=entries.length>0&&entries[0].style.display==="none";
  entries.forEach(function(el){el.style.display=isHidden?"block":"none";});
  btn.innerHTML=isHidden?"&#9650; Hide individual model entries":"&#9660; Show individual model entries";
}
function toggleCard(key,sid){
  expandedCards[key]=!expandedCards[key];
  document.getElementById("body-"+sid).classList.toggle("open",expandedCards[key]);
  document.getElementById("chev-"+sid).classList.toggle("open",expandedCards[key]);
}
/* The dropdown lists model families, not every variant: casing, cutter,
   ATB/BTP, ARINC, AEA and warranty wording all fold into their family.
   Every ARINC metal variant (ATB and BTP) sits under Metal Cutter.
   Anything unrecognised keeps its own name. */
function cmpFamily(m){
  const s=String(m||"").toLowerCase();
  if(/^kpm180/.test(s))return "KPM180"; /* KPM180H included */
  if(/^tk180/.test(s)&&!/tph/.test(s)){
    if(/plastic/.test(s))return "TK180 Plastic";
    if(/metal/.test(s))return /non.?cutter/.test(s)&&!/arinc/.test(s)?"TK180 Metal Non Cutter":"TK180 Metal Cutter";
  }
  return m;
}
function renderModel(){
  pgHideStats(); /* the customer summary boxes don't describe this page */
  /* Comparable rows come from both tables: a flat transaction is one row, and
     so is each printer line item on a project. Without this the tab empties
     out the moment a customer is migrated off `transactions`. */
  const projRows=(typeof LINE_ITEMS!=="undefined"?LINE_ITEMS:[]).filter(li=>li.type==="printer").map(function(li){
    const p=PROJECTS.filter(x=>x._id===li.projectId)[0];
    if(!p)return null;
    return {displayModel:li.displayModel||li.name,model:li.name,customer:p.customer,country:p.country,
      date:p.date,displayDate:p.displayDate,status:p.status,project:p.project,pn:li.pn||"",
      qty:li.qty+" unit"+(li.qty!==1?"s":""),price:li.unitPrice,currency:p.currency,
      terms:p.shippingTerms?[p.shippingTerms]:[],warranty:p.warranty||"",bp:li.buyingPrice||null,
      /* a summary record's PO list ("PO numbers: …" / one "PO <no> · …" line
         per order) is for search and the customer page, not this strip */
      notes:(p.notes||[]).filter(function(n){return !/^PO numbers:/.test(n)&&!/^PO \S+ · /.test(n);})};
  }).filter(Boolean);
  const cmpAll=TX.concat(projRows);
  const models=[...new Set(cmpAll.map(t=>cmpFamily(t.displayModel||t.model)))].sort();
  const current=models.includes(window._cmpModel)?window._cmpModel:models[0];
  /* Free-text search overrides the dropdown: every word must appear in the
     model name, so "tk180" pulls in plastic, metal, every warranty variant */
  const srchEl=document.getElementById("model-search"),srch=srchEl?srchEl.value:(window._cmpSearch||"");
  window._cmpSearch=srch;
  const words=srch.toLowerCase().split(/\s+/).filter(Boolean);
  const searching=words.length>0;
  const matches=t=>searching
    ?words.every(w=>((t.displayModel||"")+" "+t.model).toLowerCase().includes(w))
    :cmpFamily(t.displayModel||t.model)===current;
  const txs=cmpAll.filter(t=>matches(t)&&t.model!=="TK180 Metal Cutter ARINC (ATB) + TK180 Metal Non Cutter ARINC (BTP)").sort((a,b)=>parseDV(b.date)-parseDV(a.date));
  if(srch!==window._cmpLastSearch){expandedRows={};window._cmpLastSearch=srch;}
  /* the Model column only earns its place when the rows span several variants */
  const showModel=searching||new Set(txs.map(t=>t.displayModel||t.model)).size>1;
  const nCols=showModel?8:7;
  /* Same customer and price is one row, even across models (ATB/BTP pairs): the latest one is kept (txs is
     newest first) and the others only show up as extra projects in its detail */
  const uniq=[],seen={};
  txs.forEach(tx=>{
    const k=[tx.customer,tx.price,tx.currency].join("|");
    if(seen[k]){seen[k].dupes.push(tx);return;}
    seen[k]={tx:tx,dupes:[]};uniq.push(seen[k]);
  });
  const byCust={};
  uniq.forEach(u=>{(byCust[u.tx.customer]=byCust[u.tx.customer]||[]).push(u);});
  const custs=Object.keys(byCust).sort((a,b)=>a.localeCompare(b));
  let rows="",i=0;
  custs.forEach(c=>{
    const list=byCust[c];
    rows+=`<tr class="trk-band cmp-band"><td colspan="${nCols}"><span class="po-grp-name">${c}</span><span class="po-grp-n">${list.length} price${list.length!==1?"s":""}</span></td></tr>`;
    list.forEach(u=>{
      const tx=u.tx,all=[tx].concat(u.dupes);
      const margin=tx.bp&&tx.currency==="USD"?(tx.price-tx.bp).toFixed(0):null;
      const mPct=margin?((margin/tx.price)*100).toFixed(1):null;
      const projects=[...new Set(all.map(t=>t.project).filter(Boolean))],more=projects.length-1;
      const mdls=[...new Set(all.map(t=>t.displayModel||t.model))];
      rows+=`<tr class="trk-row cmp-row${expandedRows[i]?" open":""}" onclick="toggleRow(${i})">
        <td class="cmp-c-date">${dDisplay(tx)||"—"}</td>
        ${showModel?`<td class="cmp-c-model">${mdls.map(m=>`<div>${m}</div>`).join("")}</td>`:""}
        <td class="cmp-c-proj">${tx.project||"—"}${more>0?`<span class="cmp-more">+${more} more</span>`:""}</td>
        <td class="cmp-c-cty"><span class="cmp-country">${flagImg(tx.country,16)}${tx.country}</span></td>
        <td class="cmp-c-st">${bStatus(tx.status)}</td>
        <td class="cmp-c-terms">${tx.terms.map(bTerm).join("")}${bWarranty(tx.warranty)}</td>
        <td class="num cmp-c-price">${tx.price.toLocaleString()} <span class="trk-r-cur">${tx.currency}</span></td>
        <td class="num cmp-c-margin">${margin?`$${margin}<span>${mPct}%</span>`:"<span class='trk-r-none'>—</span>"}</td>
      </tr><tr class="cmp-detail${expandedRows[i]?" open":""}" id="erow-${i}">
        <td colspan="${nCols}"><span><b>Project${projects.length>1?"s":""}</b> ${projects.join(", ")||"—"}</span><span><b>Qty</b> ${tx.qty}</span><span><b>PN</b> ${tx.pn||"—"}</span>${tx.notes.length?`<span>${tx.notes.join(" \xb7 ")}</span>`:""}</td>
      </tr>`;
      i++;
    });
  });
  const hidden=txs.length-uniq.length;
  /* price summary for what's on screen, compared in USD so mixed currencies rank fairly */
  const usd=t=>typeof fxToUSD==="function"?fxToUSD(t.price,t.currency):(t.currency==="USD"?t.price:null);
  const ranked=uniq.map(u=>u.tx).filter(t=>usd(t)!==null).sort((a,b)=>usd(a)-usd(b));
  const fmt=t=>t?`${t.price.toLocaleString()} <span class="trk-r-cur">${t.currency}</span>`:"—";
  const sub=t=>t?`${t.customer}${dDisplay(t)?" \xb7 "+dDisplay(t):""}`:"";
  const latest=uniq.length?uniq[0].tx:null;
  const stat=(lbl,val,note)=>`<div class="cmp-stat"><div class="cmp-stat-l">${lbl}</div><div class="cmp-stat-v">${val}</div><div class="cmp-stat-s">${note||"&nbsp;"}</div></div>`;
  const summary=uniq.length?`<div class="cmp-stats">
    ${stat("Lowest price",fmt(ranked[0]),sub(ranked[0]))}
    ${stat("Highest price",fmt(ranked[ranked.length-1]),sub(ranked[ranked.length-1]))}
    ${stat("Latest price",fmt(latest),sub(latest))}
    ${stat("Customers",custs.length,uniq.length+" price"+(uniq.length!==1?"s":"")+(hidden?" \xb7 "+hidden+" duplicate"+(hidden!==1?"s":"")+" hidden":""))}
  </div>`:"";
  const famCount=m=>cmpAll.filter(t=>cmpFamily(t.displayModel||t.model)===m).length;
  const menu=uiDropdown({key:"cmp-model",onPick:"cmpPickModel",cur:current,opts:models.map(m=>({value:m,label:m,count:famCount(m)}))});
  document.getElementById("content").innerHTML=`<div class="trk-bar cmp-bar">
      <div class="trk-search"><span class="trk-search-ico">&#128269;</span><input id="model-search" type="search" placeholder="Search any model, e.g. tk180 metal" oninput="renderModel()" value="${srch.replace(/"/g,"&quot;")}" autocomplete="off"></div>
      <div class="cmp-menu${searching?" cmp-off":""}" title="${searching?"Clear the search to pick a model":""}">${menu}</div>
    </div>
    ${searching?`<div class="trk-search-count">${uniq.length} price${uniq.length!==1?"s":""} across ${new Set(txs.map(t=>t.displayModel||t.model)).size} models match <strong>${srch.replace(/</g,"&lt;")}</strong></div>`:""}
    ${summary}
    <div class="po-table-wrap cmp-table"><table class="po-table cmp-list">
    <thead><tr><th>Date</th>${showModel?"<th>Model</th>":""}<th>Project</th><th>Country</th><th>Status</th><th>Terms</th><th class="num">Price</th><th class="num">Margin</th></tr></thead>
    <tbody>${rows||`<tr><td colspan="${nCols}" class="empty">${searching?"No models match “"+srch.replace(/</g,"&lt;")+"”.":"No data."}</td></tr>`}</tbody>
  </table></div>`;
  /* the whole tab re-renders on each keystroke, so put the caret back */
  if(srchEl&&document.activeElement===document.body){const inp=document.getElementById("model-search");inp.focus();inp.setSelectionRange(srch.length,srch.length);}
}
/* picking a model clears the search, which would otherwise override it */
function cmpPickModel(m){
  window._cmpModel=m;window._cmpSearch="";
  const el=document.getElementById("model-search");if(el)el.value="";
  renderModel();
}
function toggleRow(i){
  expandedRows[i]=!expandedRows[i];
  const el=document.getElementById("erow-"+i);if(el)el.classList.toggle("open",expandedRows[i]);
  const row=el&&el.previousElementSibling;if(row)row.classList.toggle("open",expandedRows[i]);
}
/* Buying prices: one toolbar (search, sort menu, count), then a table with
   the ungrouped items first and each group under its own band. Typing only
   swaps the table body, so the search box keeps focus. */
function buyPickSort(v){window._buySort=v;renderBuying();}
function buySearchInput(){renderBuying(true);}
function renderBuying(bodyOnly){
  pgHideStats(); /* the customer summary boxes don't describe this page */
  var sortBuy=window._buySort||"model";
  var searchVal=document.getElementById("buy-search")?document.getElementById("buy-search").value:"";
  var sorted=BUYING.map(function(b,i){return {model:b.model,pn:b.pn,price:b.price,currency:b.currency,specialPrice:b.specialPrice,specialCustomer:b.specialCustomer,group:b.group,_i:i};});
  /* every word must appear in the model, part number or group, in any order */
  var words=searchVal.toLowerCase().split(/\s+/).filter(Boolean);
  if(words.length) sorted=sorted.filter(function(b){
    var hay=[b.model,b.pn,b.group].join(" ").toLowerCase();
    return words.every(function(w){return hay.indexOf(w)!==-1;});
  });
  if(sortBuy==="price-asc")sorted.sort(function(a,b){return a.price-b.price;});
  else if(sortBuy==="price-desc")sorted.sort(function(a,b){return b.price-a.price;});
  else sorted.sort(function(a,b){return a.model.localeCompare(b.model);});

  var groups={},noGroup=[];
  sorted.forEach(function(b){
    if(b.group){(groups[b.group]=groups[b.group]||[]).push(b);}
    else noGroup.push(b);
  });
  var money=function(v,cur){return (typeof poFmtMoney==="function"?poFmtMoney(v,cur):v.toFixed(2))+" <span class='trk-r-cur'>"+cur+"</span>";};
  var ico=function(kind,title,fn){
    var path=kind==="edit"?'<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>':'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
    return "<button class='nt-ico"+(kind==="edit"?"":" nt-ico-del")+"' title='"+title+"' aria-label='"+title+"' onclick='"+fn+"'><svg viewBox='0 0 24 24' aria-hidden='true'>"+path+"</svg></button>";
  };
  function makeRow(b){
    return "<tr class='buy-row'>"+
      "<td class='buy-c-model'>"+trkEsc(b.model)+"</td>"+
      "<td class='buy-c-pn'>"+(b.pn?trkEsc(b.pn):"<span class='trk-r-none'>&mdash;</span>")+"</td>"+
      "<td class='num buy-c-price'>"+money(b.price,b.currency)+"</td>"+
      "<td class='num buy-c-sp'>"+(b.specialPrice?"<div class='buy-sp'>"+money(b.specialPrice,b.currency)+"</div><div class='buy-sp-who'>"+trkEsc(b.specialCustomer||"Special")+"</div>":"<span class='trk-r-none'>&mdash;</span>")+"</td>"+
      "<td class='buy-c-acts'><div class='nt-acts'>"+ico("edit","Edit","editBuying("+b._i+")")+ico("trash","Remove","sbDeleteBuying("+b._i+")")+"</div></td>"+
    "</tr>";
  }
  var band=function(name,n){return "<tr class='trk-band buy-band'><td colspan='5'><span class='po-grp-name'>"+trkEsc(name)+"</span><span class='po-grp-n'>"+n+"</span></td></tr>";};
  var grpNames=Object.keys(groups).sort();
  var rows="";
  if(noGroup.length)rows+=(grpNames.length?band("General",noGroup.length):"")+noGroup.map(makeRow).join("");
  grpNames.forEach(function(g){rows+=band(g,groups[g].length)+groups[g].map(makeRow).join("");});
  if(!rows)rows="<tr><td colspan='5' class='empty'>"+(words.length?"Nothing matches that search.":"No buying prices yet.")+"</td></tr>";

  var bgl=document.getElementById("b-group-list");
  if(bgl){var grps=[...new Set(BUYING.map(function(b){return b.group;}).filter(Boolean))].sort();bgl.innerHTML=grps.map(function(g){return "<option value='"+g+"'>";}).join("");}
  var count=(words.length?sorted.length+" of ":"")+BUYING.length+" item"+(BUYING.length!==1?"s":"");
  var tbody=document.getElementById("buy-tbody");
  if(bodyOnly&&tbody){
    tbody.innerHTML=rows;
    var c=document.getElementById("buy-count");if(c)c.textContent=count;
    return;
  }
  var sortMenu=uiDropdown({key:"buy-sort",onPick:"buyPickSort",cur:sortBuy,opts:[
    {value:"model",label:"Model A–Z"},{value:"price-asc",label:"Price: low to high"},{value:"price-desc",label:"Price: high to low"}]});
  document.getElementById("content").innerHTML=
    "<div class='trk-bar buy-bar'>"+
      "<div class='trk-search'><span class='trk-search-ico'>&#128269;</span><input id='buy-search' type='search' placeholder='Search model, part number or group&hellip;' oninput='buySearchInput()' value='"+searchVal.replace(/'/g,"&#39;")+"' autocomplete='off'></div>"+
      sortMenu+
      "<span id='buy-count' class='pg-summary'>"+count+"</span>"+
    "</div>"+
    "<div class='po-table-wrap buy-table'><table class='po-table buy-list'><thead><tr><th>Model</th><th>Part number</th><th class='num'>Buying price</th><th class='num'>Special price</th><th></th></tr></thead>"+
    "<tbody id='buy-tbody'>"+rows+"</tbody></table></div>";
  var inp=document.getElementById("buy-search");
  /* not on touch screens: focusing would pop the keyboard up on every visit */
  if(inp&&!matchMedia("(pointer:coarse)").matches){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);}
}

/* Notes are split by what they are: quick updates (no value), records with
   an amount, and the shipping-term reference cards. Newest first in the
   first two; the terms are A-Z and folded away since they rarely change. */
function renderOthers(){
  pgHideStats();
  const esc=s=>String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;");
  const all=OTHERS.map((o,i)=>({o:o,i:i}));
  const newest=(a,b)=>(b.o.created||"").localeCompare(a.o.created||"")||b.i-a.i;
  const isTerm=x=>x.o.value==="Shipping term";
  /* a lone dash was the old way round the required value field */
  const hasVal=x=>!/^[\s\-–—]*$/.test(x.o.value||"");
  const updates=all.filter(x=>!hasVal(x)).sort(newest);
  const records=all.filter(x=>hasVal(x)&&!isTerm(x)).sort(newest);
  const terms=all.filter(isTerm).sort((a,b)=>a.o.desc.localeCompare(b.o.desc));
  const ico={
    edit:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/></svg>',
    del:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    trash:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
  };
  const btn=(kind,title,fn)=>`<button class="nt-ico${kind==="edit"?"":" nt-ico-del"}" title="${title}" aria-label="${title}" onclick="${fn}">${ico[kind]}</button>`;
  /* "12 Oct 2026" becomes a day/month block; anything else (a range like
     "Sep–Oct 2025", or no date) falls back to the plain text */
  const dateBlock=d=>{
    const m=/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(String(d||"").trim());
    return m?`<div class="nt-day"><b>${m[1]}</b><span>${m[2]}</span><i>${m[3]}</i></div>`:`<div class="nt-day nt-day-txt">${esc(d||"")}</div>`;
  };
  const update=x=>{const o=x.o,i=x.i;return `<div class="nt-upd">${dateBlock(o.date)}
    <div class="nt-body"><div class="nt-text">${fmtInline(esc(o.desc))}</div>${o.sub?`<div class="nt-sub">${esc(o.sub)}</div>`:""}</div>
    <div class="nt-acts">${btn("edit","Edit",`editOther(${i})`)}${btn("del","Delete",`deleteOtherQuick(${i})`)}</div></div>`;};
  const record=x=>{const o=x.o,i=x.i;return `<div class="nt-rec">
    <div class="nt-body"><div class="nt-title">${fmtInline(esc(o.desc))}${o.date?`<span class="nt-when">${esc(o.date)}</span>`:""}</div>${o.sub?`<div class="nt-sub">${esc(o.sub)}</div>`:""}</div>
    <div class="nt-amt">${esc(o.value)}</div>
    <div class="nt-acts">${btn("edit","Edit",`editOther(${i})`)}${btn("trash","Remove",`deleteOther(${i})`)}</div></div>`;};
  const term=x=>{const o=x.o,i=x.i,parts=String(o.desc).split(/\s+[—–-]\s+/);return `<div class="nt-term">
    <div class="nt-term-h"><span class="nt-code">${esc(parts[0])}</span><span class="nt-term-name">${esc(parts.slice(1).join(" — "))}</span>${btn("edit","Edit",`editOther(${i})`)}</div>
    ${o.sub?`<div class="nt-sub">${esc(o.sub)}</div>`:""}</div>`;};
  const head=(title,n,hint)=>`<div class="nt-head"><span class="nt-h">${title}</span><span class="nt-n">${n}</span>${hint?`<span class="nt-hint">${hint}</span>`:""}</div>`;
  document.getElementById("content").innerHTML=`<div class="nt-page">
    <div class="nt-card nt-compose">
      <textarea id="others-quick" rows="6" placeholder="Write an update… start a line with - or 1. for a list" onkeydown="if(event.key==='Enter'&&(event.ctrlKey||event.metaKey)){event.preventDefault();postOtherQuick();}else listKeys(event)" oninput="listInput(event)"></textarea>
      <div class="nt-compose-foot">
        <div class="nt-tools">${FMT_TOOLS('others-quick')}<button type="button" class="nt-tool" title="Bulleted list" onmousedown="event.preventDefault()" onclick="toggleList('others-quick','•')">• List</button><button type="button" class="nt-tool" title="Numbered list" onmousedown="event.preventDefault()" onclick="toggleList('others-quick','1.')">1. List</button>
        <span class="nt-hint">Enter new line · Tab indent · Ctrl+B/I/U · Ctrl+Enter to post</span></div>
        <button class="btn-save" onclick="postOtherQuick()">Post update</button></div>
    </div>
    <div class="nt-card">${head("Updates",updates.length,"newest first")}
      ${updates.length?updates.map(update).join(""):`<div class="nt-empty">No updates yet. Anything you post above lands here and can be deleted with one click.</div>`}</div>
    ${records.length?`<div class="nt-card">${head("Records",records.length,"amounts and breakdowns")}${records.map(record).join("")}</div>`:""}
    ${terms.length?`<details class="nt-card nt-terms"><summary>${head("Shipping terms",terms.length,"Incoterms reference")}</summary><div class="nt-term-grid">${terms.map(term).join("")}</div></details>`:""}
  </div>`;
}
async function postOtherQuick(){
  const el=document.getElementById("others-quick"),text=el.value.trim();
  if(!text)return;
  const d=new Date(),no={date:d.getDate()+" "+d.toLocaleString("en-GB",{month:"short"})+" "+d.getFullYear(),desc:text,value:"",sub:"",created:d.toISOString()};
  el.value="";
  const r=await sbInsert("others",oToDb(no));if(r&&r[0]){no._id=r[0].id;no.created=r[0].created_at||no.created;}
  OTHERS.push(no);renderContent();
  const again=document.getElementById("others-quick");if(again)again.focus();
}
/* Plain-text list editing for note textareas: Enter continues a "•" or
   "1." line (Enter on an empty item ends the list), Tab / Shift+Tab
   indent and outdent. listInput turns "- " or "* " at a line start into "• ". */
const LIST_RE=/^(\s*)(•|\d+[.)])\s(.*)$/;
// Any list-looking line ("a.", "b)", "iv.", "-", "1.", "•") shifts as a whole on Tab, wherever the cursor is
const MARK_RE=/^\s*(•|[-*]|\d+[.)]|[a-z][.)]|[ivx]+[.)])\s/i;
function editText(ta,from,to,text){
  ta.focus();ta.setSelectionRange(from,to);
  if(from===to&&!text)return;
  // execCommand keeps Ctrl+Z working; "insertText" with "" is a no-op, so deletes use "delete"
  if(!document.execCommand(text?"insertText":"delete",false,text))ta.setRangeText(text,from,to,"end");
}
function listKeys(e){
  const ta=e.target,v=ta.value,s=ta.selectionStart,end=ta.selectionEnd;
  const ls=v.lastIndexOf("\n",s-1)+1;
  const fk=(e.ctrlKey||e.metaKey)&&!e.altKey&&!e.shiftKey&&FMT_KEYS[e.key.toLowerCase()];
  if(fk){e.preventDefault();toggleWrap(ta,fk);return;}
  if(e.key==="Enter"&&!e.shiftKey&&s===end){
    const m=LIST_RE.exec(v.slice(ls,(v.indexOf("\n",s)+1||v.length+1)-1));
    if(!m)return;
    e.preventDefault();
    if(!m[3].trim()){editText(ta,ls,ls+m[0].length,"");return;}
    const n=/^\d+/.exec(m[2]);
    editText(ta,s,s,"\n"+m[1]+(n?(+n[0]+1)+m[2].slice(n[0].length):"•")+" ");
  }else if(e.key==="Tab"){
    e.preventDefault();
    const multi=v.slice(s,end).includes("\n");
    if(!e.shiftKey&&!multi&&!MARK_RE.test(v.slice(ls).split("\n")[0])){editText(ta,s,end,"    ");return;}
    const le=(v.indexOf("\n",end)+1||v.length+1)-1,lines=v.slice(ls,le).split("\n");
    const out=lines.map(l=>e.shiftKey?l.replace(/^ {1,4}|^\t/,""):"    "+l).join("\n");
    editText(ta,ls,le,out);
    if(s===end){const c=Math.max(ls,s+out.length-(le-ls));ta.setSelectionRange(c,c);}
    else ta.setSelectionRange(ls,ls+out.length);
  }
}
/* Bold / italic / underline are stored as **x**, *x* and __x__ in the
   plain text (Ctrl+B / I / U or the B I U buttons), and fmtInline shows
   them formatted. Toggling again on already-wrapped text takes the marks off. */
const FMT_KEYS={b:"**",i:"*",u:"__"};
function toggleWrap(ta,mk){
  if(typeof ta==="string")ta=document.getElementById(ta);
  if(!ta)return;
  const v=ta.value,s=ta.selectionStart,end=ta.selectionEnd,n=mk.length;
  // a lone "*" must not count half of a "**" bold mark
  const has=(a,b)=>v.slice(a,b)===mk&&(mk!=="*"||(v[a-1]!=="*"&&v[b]!=="*"));
  if(s>=n&&has(s-n,s)&&has(end,end+n)){
    editText(ta,s-n,end+n,v.slice(s,end));ta.setSelectionRange(s-n,end-n);return;
  }
  const sel=v.slice(s,end);
  if(sel.length>2*n&&sel.startsWith(mk)&&sel.endsWith(mk)){
    editText(ta,s,end,sel.slice(n,-n));ta.setSelectionRange(s,end-2*n);return;
  }
  editText(ta,s,end,mk+sel+mk);ta.setSelectionRange(s+n,end+n);
}
/* Takes already-escaped text and turns the marks into tags */
function fmtInline(h){
  return String(h)
    .replace(/\*\*(\S(?:[^\n]*?\S)?)\*\*/g,"<strong>$1</strong>")
    .replace(/__(\S(?:[^\n]*?\S)?)__/g,"<u>$1</u>")
    .replace(/\*(\S(?:[^*\n]*?\S)?)\*/g,"<em>$1</em>");
}
const FMT_TOOLS=id=>`<span class="fmt-tools"><button type="button" class="nt-tool fmt-b" title="Bold (Ctrl+B)" onmousedown="event.preventDefault()" onclick="toggleWrap('${id}','**')">B</button><button type="button" class="nt-tool fmt-i" title="Italic (Ctrl+I)" onmousedown="event.preventDefault()" onclick="toggleWrap('${id}','*')">I</button><button type="button" class="nt-tool fmt-u" title="Underline (Ctrl+U)" onmousedown="event.preventDefault()" onclick="toggleWrap('${id}','__')">U</button></span>`;
/* Runs on input rather than keydown so phone keyboards (no key names) get it too */
function listInput(e){
  const ta=e.target,s=ta.selectionStart;
  if(e.data!==" "||s!==ta.selectionEnd)return;
  const ls=ta.value.lastIndexOf("\n",s-1)+1;
  if(/^\s*[-*] $/.test(ta.value.slice(ls,s)))editText(ta,s-2,s,"• ");
}
/* Toolbar: turn the selected lines into a list, or back to plain lines if
   they already are one */
function toggleList(id,kind){
  const ta=document.getElementById(id);if(!ta)return;
  const v=ta.value,s=ta.selectionStart,end=ta.selectionEnd;
  const ls=v.lastIndexOf("\n",s-1)+1,le=(v.indexOf("\n",end)+1||v.length+1)-1;
  const lines=v.slice(ls,le).split("\n"),same=m=>m&&(m[2]==="•")===(kind==="•");
  const isList=lines.every(l=>!l.trim()||same(LIST_RE.exec(l)));
  let k=0;
  const out=lines.map(l=>{
    const m=LIST_RE.exec(l);
    if(isList)return m?m[1]+m[3]:l;
    if(!l.trim()&&lines.length>1)return l;
    const ind=m?m[1]:/^\s*/.exec(l)[0];
    return ind+(kind==="•"?"•":(++k)+".")+" "+(m?m[3]:l.slice(ind.length));
  }).join("\n");
  editText(ta,ls,le,out);
}
/* One click, no confirm box: the toast's Undo puts it straight back */
async function deleteOtherQuick(i){
  const item=OTHERS[i];if(!item)return;
  OTHERS.splice(i,1);renderContent();
  if(item._id)await sbDelete("others",item._id);
  showUndoToast("Update deleted",async function(){
    const back=Object.assign({},item);delete back._id;
    const r=await sbInsert("others",oToDb(back));if(r&&r[0])back._id=r[0].id;
    OTHERS.push(back);renderContent();
  });
}
function showUndoToast(msg,onUndo){
  let t=document.getElementById("undo-toast");if(t)t.remove();
  t=document.createElement("div");t.id="undo-toast";t.className="undo-toast";
  t.innerHTML=`<span>${msg}</span><button>Undo</button>`;
  t.querySelector("button").onclick=function(){t.remove();onUndo();};
  document.body.appendChild(t);
  setTimeout(function(){if(t.parentNode)t.remove();},6000);
}
let SPARES=[
  {name:"TK180 TPH",pn:"43000000045700",price:118,currency:"USD",customer:"Philippines Airlines",terms:"DDP",note:"Quotation 17 Apr 2026"},
  {name:"TK180 TPH",pn:"43000000045700",price:108.80,currency:"USD",customer:"Arinc",terms:"EXW",note:"Standard price"},
  {name:"TK180 TPH",pn:"43000000045700",price:1788000,currency:"IDR",customer:"SITA Indonesia",terms:"DDP",note:"PO 3 Feb 2026 — 50 units"},
  {name:"Roll Holder (TK180)",pn:"974HL020000004",price:108,currency:"SGD",customer:"Singapore Airlines",terms:"",note:"Changi Airport TK180 project"},
  {name:"Roll Holder",pn:"974HL010000009",price:128,currency:"SGD",customer:"Singapore Cruise Center",terms:"",note:"Harborfront Cruise"},
  {name:"Roll Holder",pn:"974HL010000009",price:98,currency:"USD",customer:"Aboitiz",terms:"",note:"Cebu, Bohol & Laguindingan"},
  {name:"Roll Holder (Daifuku)",pn:"",price:78,currency:"USD",customer:"Daifuku",terms:"",note:"Gold Coast quotation"},
  {name:"Vertical Tray TK302 Metal Case",pn:"974BB060000003",price:78,currency:"SGD",customer:"Singapore Airlines",terms:"",note:"Changi Airport TK302 project"},
  {name:"Ticket Tray Metal",pn:"976HL010000007",price:98,currency:"USD",customer:"Aboitiz",terms:"",note:"Bohol & Laguindingan"},
  {name:"1.8M USB Cable",pn:"2650000000003566",price:10.80,currency:"USD",customer:"Aboitiz",terms:"",note:"Bohol & Laguindingan"},
  {name:"USA Plug Power Cable",pn:"2610000000031",price:17.80,currency:"USD",customer:"Aboitiz",terms:"",note:"Bohol & Laguindingan"},
  {name:"Paper Roll",pn:"",price:580000,currency:"IDR",customer:"SITA Indonesia",terms:"",note:"DPS Bali & SUB Surabaya"},
  {name:"On-site installation",pn:"",price:42,currency:"SGD",customer:"Singapore Airlines",terms:"",note:"Per unit — Changi Airport"},
  {name:"Annual maintenance + consumables",pn:"",price:240,currency:"SGD",customer:"Singapore Airlines",terms:"",note:"Per printer per year — Changi Airport"},
];

SPARES_SEED=SPARES.map(function(s){return Object.assign({},s);});
MODELS_SEED=["TK180 Plastic","TK180 Plastic AEA","TK180 Metal Cutter","TK180 Metal Cutter AEA","TK180 Metal Cutter NON AEA","TK180 Metal Cutter ARINC","TK180 Metal Non Cutter","TK180 Metal Non Cutter ARINC","TK180 TPH","TK302 Metal Triple Feeder","KPM180 Cutter NON AEA","KPM180 with AEA","KPM180H-LL","KPM180 NON AEA","KPM180 TPH","TK202 Plastic","TK202 with AEA","TG2460HIII","TG2480HIII","VKP80II","VKP80II-RX","VKP80III","VKP80III Rear Connector","K80","KX80S"];

/* Spare parts are quoted per customer, so the default view puts each
   customer's parts under its band (the Customer column then hides). By
   part is a plain A-Z list: the same part from different customers sits
   together, so their prices line up. Price sorts are flat too. */
function spPickSort(v){window._spSort=v;renderSpares();}
function spSearchInput(){renderSpares(true);}
function renderSpares(bodyOnly){
  pgHideStats(); /* the customer summary boxes don't describe this page */
  var searchVal=document.getElementById("sp-search")?document.getElementById("sp-search").value:"";
  var sortVal=window._spSort||"customer";
  var filtered=SPARES.map(function(x,i){return Object.assign({},x,{_i:i});});
  /* every word must appear somewhere in the row, in any order, so
     "tk180 cutter" finds every cutter part for any TK180 variant */
  var words=searchVal.toLowerCase().split(/\s+/).filter(Boolean);
  if(words.length)filtered=filtered.filter(function(x){
    var hay=[x.name,x.pn,x.customer,x.note].join(" ").toLowerCase();
    return words.every(function(w){return hay.indexOf(w)!==-1;});
  });
  var byName=function(a,b){return a.name.localeCompare(b.name)||(a.customer||"").localeCompare(b.customer||"");};
  if(sortVal==="price-asc")filtered.sort(function(a,b){return a.price-b.price;});
  else if(sortVal==="price-desc")filtered.sort(function(a,b){return b.price-a.price;});
  else if(sortVal==="customer")filtered.sort(function(a,b){return (a.customer||"").localeCompare(b.customer||"")||a.name.localeCompare(b.name);});
  else filtered.sort(byName);

  var money=function(v,cur){return (typeof poFmtMoney==="function"?poFmtMoney(v,cur):v.toLocaleString())+" <span class='trk-r-cur'>"+trkEsc(cur)+"</span>";};
  var ico=function(kind,title,fn){
    var path=kind==="edit"?'<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>':'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
    return "<button class='nt-ico"+(kind==="edit"?"":" nt-ico-del")+"' title='"+title+"' aria-label='"+title+"' onclick='"+fn+"'><svg viewBox='0 0 24 24' aria-hidden='true'>"+path+"</svg></button>";
  };
  function row(x){
    return "<tr class='buy-row sp-row'>"+
      "<td class='sp-c-name'><div class='buy-c-model'>"+trkEsc(x.name)+"</div>"+(x.pn?"<div class='buy-c-pn'>"+trkEsc(x.pn)+"</div>":"")+"</td>"+
      "<td class='sp-c-cust'>"+(x.customer?trkEsc(x.customer):"<span class='trk-r-none'>&mdash;</span>")+"</td>"+
      "<td class='num buy-c-price'>"+money(x.price,x.currency)+"</td>"+
      "<td class='sp-c-terms"+(x.terms?"":" sp-empty")+"'>"+(x.terms?"<span class='badge "+({DDP:"b-ddp",DAP:"b-dap",EXW:"b-exw"}[x.terms]||"b-exw")+"'>"+trkEsc(x.terms)+"</span>":"<span class='trk-r-none'>&mdash;</span>")+"</td>"+
      "<td class='sp-c-note'>"+(x.note?trkEsc(x.note):"")+"</td>"+
      "<td class='buy-c-acts'><div class='nt-acts'>"+ico("edit","Edit","editSpare("+x._i+")")+ico("trash","Remove","deleteSpare("+x._i+")")+"</div></td>"+
    "</tr>";
  }
  var band=function(name,n,unit){return "<tr class='trk-band buy-band'><td colspan='6'><span class='po-grp-name'>"+trkEsc(name||"No customer")+"</span><span class='po-grp-n'>"+n+" "+unit+(n!==1?"s":"")+"</span></td></tr>";};
  var rows="";
  if(sortVal==="customer"){
    var order=[],grp={};
    filtered.forEach(function(x){var k=x.customer||"";if(!grp[k]){grp[k]=[];order.push(k);}grp[k].push(x);});
    order.forEach(function(k){rows+=band(k,grp[k].length,"part")+grp[k].map(row).join("");});
  }else rows=filtered.map(row).join("");
  if(!rows)rows="<tr><td colspan='6' class='empty'>"+(words.length?"Nothing matches that search.":"No spare parts yet.")+"</td></tr>";

  var count=(words.length?filtered.length+" of ":"")+SPARES.length+" item"+(SPARES.length!==1?"s":"");
  var tbody=document.getElementById("sp-tbody");
  if(bodyOnly&&tbody){
    tbody.innerHTML=rows;
    var c=document.getElementById("sp-count");if(c)c.textContent=count;
    return;
  }
  var sortMenu=uiDropdown({key:"sp-sort",onPick:"spPickSort",cur:sortVal,opts:[
    {value:"customer",label:"By customer"},{value:"name",label:"By part (A–Z)"},
    {value:"price-asc",label:"Price: low to high"},{value:"price-desc",label:"Price: high to low"}]});
  document.getElementById("content").innerHTML=
    "<div class='trk-bar buy-bar'>"+
      "<div class='trk-search'><span class='trk-search-ico'>&#128269;</span><input id='sp-search' type='search' placeholder='Search part, part number, customer or note&hellip;' oninput='spSearchInput()' value='"+searchVal.replace(/'/g,"&#39;")+"' autocomplete='off'></div>"+
      sortMenu+
      "<span id='sp-count' class='pg-summary'>"+count+"</span>"+
    "</div>"+
    "<div class='po-table-wrap buy-table'><table class='po-table buy-list sp-list"+(sortVal==="customer"?" sp-by-cust":"")+"'><thead><tr><th>Part</th><th class='sp-c-cust'>Customer</th><th class='num'>Unit price</th><th>Terms</th><th>Note</th><th></th></tr></thead>"+
    "<tbody id='sp-tbody'>"+rows+"</tbody></table></div>";
  var inp=document.getElementById("sp-search");
  /* not on touch screens: focusing would pop the keyboard up on every visit */
  if(inp&&!matchMedia("(pointer:coarse)").matches){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);}
}

function editSpare(i){
  var s=SPARES[i];
  document.getElementById("modal-spares").setAttribute("data-edit-idx",i);
  document.getElementById("spare-modal-title").textContent="Edit spare part / accessory";
  document.getElementById("sp-name").value=s.name||"";
  document.getElementById("sp-pn").value=s.pn||"";
  document.getElementById("sp-price").value=s.price||"";
  document.getElementById("sp-currency").value=s.currency||"USD";
  document.getElementById("sp-customer").value=s.customer||"";
  document.getElementById("sp-terms").value=s.terms||"";
  document.getElementById("sp-note").value=s.note||"";
  var delBtn=document.getElementById("btn-delete-spare");if(delBtn)delBtn.style.display="inline-flex";
  var saveBtn=document.getElementById("btn-save-spare");
  if(saveBtn){saveBtn.textContent="Update entry";saveBtn.onclick=function(){saveSpare(i);};}
  document.getElementById("modal-spares").classList.add("open");
}

async function saveSpare(i){
  var name=document.getElementById("sp-name").value.trim();
  var price=parseFloat(document.getElementById("sp-price").value);
  if(!name||isNaN(price)){alert("Please fill in Part name and Price.");return;}
  var updated={name:name,pn:document.getElementById("sp-pn").value.trim(),price:price,currency:document.getElementById("sp-currency").value,customer:document.getElementById("sp-customer").value.trim(),terms:document.getElementById("sp-terms").value.trim(),note:document.getElementById("sp-note").value.trim()};
  showLoad("Saving...");
  if(i===undefined||i===null){
    var r=await sbInsert("spares",sToDb(updated));
    if(r&&r[0])updated._id=r[0].id;
    SPARES.push(updated);
  } else {
    var existing=SPARES[i];
    if(existing&&existing._id){
      await fetch(SB_URL+"/rest/v1/spares?id=eq."+existing._id,{method:"PATCH",headers:sbH(),body:JSON.stringify(sToDb(updated))});
      updated._id=existing._id;
    }
    SPARES[i]=updated;
  }
  hideLoad();
  closeSpareModal();
  renderContent();
}

async function deleteSpare(i){
  if(!confirm("Remove this entry?"))return;
  var item=SPARES[i];
  showLoad("Deleting...");
  if(item&&item._id)await sbDelete("spares",item._id);
  SPARES.splice(i,1);
  hideLoad();
  renderContent();
}

async function deleteSpareFromModal(){
  var i=parseInt(document.getElementById("modal-spares").getAttribute("data-edit-idx"));
  if(isNaN(i))return;
  if(!confirm("Delete this entry permanently?"))return;
  var item=SPARES[i];
  showLoad("Deleting...");
  if(item&&item._id)await sbDelete("spares",item._id);
  SPARES.splice(i,1);
  hideLoad();
  closeSpareModal();
  renderContent();
}

function closeSpareModal(){
  document.getElementById("modal-spares").removeAttribute("data-edit-idx");
  document.getElementById("spare-modal-title").textContent="Add spare part / accessory";
  var delBtn=document.getElementById("btn-delete-spare");if(delBtn)delBtn.style.display="none";
  var saveBtn=document.getElementById("btn-save-spare");
  if(saveBtn){saveBtn.textContent="Save entry";saveBtn.onclick=function(){saveSpare();};}
  document.getElementById("modal-spares").querySelectorAll("input,textarea").forEach(function(el){el.value="";});
  document.getElementById("sp-terms").value="";
  document.getElementById("sp-currency").value="USD";
  closeModal("modal-spares");
}

function renderContent(){
  if(typeof MD_GROUP_SEL!=="undefined"&&MD_GROUP_SEL){renderProjectGroupView();return;}
  if(currentTab==="customers")renderCustomers();
  else if(currentTab==="groups")renderProjectGroupsList();
  else if(currentTab==="projects")renderProjects();
  else if(currentTab==="tracker")renderTracker();
  else if(currentTab==="po")renderPOs();
  else if(currentTab==="pricing")renderPricing();
  else if(currentTab==="model")renderModel();
  else if(currentTab==="buying")renderBuying();
  else if(currentTab==="spares")renderSpares();
  else renderOthers();
}

// ============================================================
// NEW (Stage 2): renderProjects — read-only project + line item view
// ============================================================
let expandedProjects={};
let expandedProjectItems={}; /* per-project line-item expand state (default collapsed) */
function projectTotal(projId){
  return LINE_ITEMS.filter(function(li){return li.projectId===projId;})
    .reduce(function(sum,li){return sum+(li.qty*li.unitPrice);},0);
}
function projectPrinterTotal(projId){
  return LINE_ITEMS.filter(function(li){return li.projectId===projId&&li.type==="printer";})
    .reduce(function(sum,li){return sum+(li.qty*li.unitPrice);},0);
}
function projectPrinterQty(projId){
  return LINE_ITEMS.filter(function(li){return li.projectId===projId&&li.type==="printer"&&!/\bTPH\b/i.test(li.name);})
    .reduce(function(sum,li){return sum+li.qty;},0);
}
/* opts.compact: rendered underneath a history row that already shows the date,
   status, title and total — so drop that header and lead with the line items,
   which are the only thing the click was for. */
function buildProjectBlock(p,opts){
    var compact=!!(opts&&opts.compact);
    var lis=LINE_ITEMS.filter(function(li){return li.projectId===p._id;})
      .sort(function(a,b){return a.sortOrder-b.sortOrder;});
    var totalCalc=projectTotal(p._id);
    var printerTot=projectPrinterTotal(p._id);
    var printerQty=projectPrinterQty(p._id);
    var displayTotal=p.totalOverride||totalCalc;

    var lineHtml=lis.map(function(li){
      var subtotal=li.qty*li.unitPrice;
      var typeColor=li.type==="printer"?"#1a3a4a":li.type==="other"?"#856404":"#5a7a8a";
      var typeBg=li.type==="printer"?"#e8f0f4":li.type==="other"?"#fff3cd":"#f5f5f5";
      var qtyDisplay=li.qty===1&&li.type!=="printer"?"":li.qty+" \xd7 ";
      var subtotalDisplay=subtotal.toLocaleString(undefined,{minimumFractionDigits:subtotal%1?2:0,maximumFractionDigits:2});
      var marginInfo="";
      if(li.type==="printer"&&li.buyingPrice&&p.currency==="USD"){
        var m=li.unitPrice-li.buyingPrice;
        var mPct=(m/li.unitPrice*100).toFixed(1);
        marginInfo="<span style='font-size:10px;color:var(--text-muted);margin-left:8px'>(margin $"+m.toFixed(0)+", "+mPct+"%)</span>";
      }
      return "<div style='display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px dashed var(--divider)'>"+
        "<div style='flex:1'>"+
          "<span style='font-size:10px;font-weight:600;text-transform:uppercase;background:"+typeBg+";color:"+typeColor+";padding:2px 6px;border-radius:3px;margin-right:8px'>"+li.type+"</span>"+
          "<span style='font-size:13px;color:var(--text);font-weight:500'>"+li.name+"</span>"+
          (li.pn?"<span style='font-size:10px;color:var(--text-muted);font-family:monospace;margin-left:8px'>"+li.pn+"</span>":"")+
          marginInfo+
        "</div>"+
        "<div style='text-align:right;white-space:nowrap;font-size:13px'>"+
          "<span style='color:var(--text-muted)'>"+qtyDisplay+(li.unitPrice<0?"(":"")+li.unitPrice.toLocaleString()+(li.unitPrice<0?")":"")+" "+p.currency+"</span>"+
          "<span style='font-weight:600;color:var(--text-strong);margin-left:12px;display:inline-block;min-width:90px;text-align:right'>"+(subtotal<0?"\u2212":"")+subtotalDisplay+" "+p.currency+"</span>"+
        "</div>"+
      "</div>";
    }).join("");

    /* Line items are the payload: open by default, and only collapsible in the
       standalone card where the header above them carries the summary. */
    var itemsOpen=compact?expandedProjectItems[p._id]!==false:!!expandedProjectItems[p._id];

    var header=compact
      ? "<div class='pj-compact-head'>"+
          /* The nest header above already names the PO — don't say it twice. */
          (p.projectGroup&&!(opts&&opts.hideGroupTag)?projGroupLinkHtml(p.projectGroup):"")+
          (p.shippingTerms?bTerm(p.shippingTerms):"")+bWarranty(p.warranty)+
          "<span class='pj-compact-tot'>"+
            (printerTot!==totalCalc&&printerTot>0?"<span class='pj-compact-sub'>Printers "+printerTot.toLocaleString()+" "+p.currency+"</span>":"")+
            "Total <strong>"+displayTotal.toLocaleString()+" "+p.currency+"</strong>"+fxEqSpan(displayTotal,p.currency)+
          "</span>"+
        "</div>"
      : "<div onclick='toggleProjItems(\""+p._id+"\")' style='display:flex;justify-content:space-between;align-items:start;margin-bottom:10px;cursor:pointer'>"+
          "<div style='display:flex;gap:10px;align-items:flex-start'>"+
            "<span class='pchev"+(itemsOpen?" open":"")+"' id='pchev-"+p._id+"'>\u25be</span>"+
            "<div>"+
            "<div style='font-size:11px;color:var(--text-muted);margin-bottom:4px'>"+(p.displayDate||p.date||"")+" \xb7 "+bStatus(p.status)+(printerQty?" \xb7 "+printerQty+" printer"+(printerQty!==1?"s":""):"")+"</div>"+
            "<div style='font-size:14px;font-weight:600;color:var(--text-strong)'>"+p.project+"</div>"+
            (p.projectGroup?"<div style='margin-top:4px'>"+projGroupLinkHtml(p.projectGroup)+"</div>":"")+
            "<div style='margin-top:6px'>"+
              (p.shippingTerms?bTerm(p.shippingTerms):"")+
              bWarranty(p.warranty)+
            "</div>"+
            "</div>"+
          "</div>"+
          "<div style='text-align:right'>"+
            (printerTot!==totalCalc&&printerTot>0?"<div style='font-size:11px;color:var(--text-muted)'>Printer subtotal: "+printerTot.toLocaleString()+" "+p.currency+fxEqSpan(printerTot,p.currency)+"</div>":"")+
            "<div style='font-size:15px;font-weight:600;color:var(--accent-text);margin-top:3px'>Project Total: "+displayTotal.toLocaleString()+" "+p.currency+fxEqSpan(displayTotal,p.currency)+"</div>"+
            (p.currency!=="USD"&&typeof fxNote==="function"&&fxNote(p.currency)?"<div class='fx-note'>"+fxNote(p.currency)+"</div>":"")+
          "</div>"+
        "</div>";

    return "<div class='"+(compact?"pj-block pj-compact":"pj-block")+"'>"+
      header+
      "<div id='pitems-"+p._id+"' style='"+(itemsOpen?"":"display:none;")+"'>"+
        (lineHtml?"<div class='pj-items'>"+lineHtml+"</div>":"<div style='font-size:12px;color:#aaa;font-style:italic;padding:8px 0'>No line items</div>")+
        (p.notes&&p.notes.length?"<div style='margin-top:10px;font-size:12px;color:var(--text-muted);line-height:1.6'>"+p.notes.map(function(n){return "<div>\u2022 "+n+"</div>";}).join("")+"</div>":"")+
      "</div>"+
      "<div style='display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:10px'>"+
        attClipsHtml(p.attachments)+
        "<button class='edit-btn' title='Edit' aria-label='Edit' onclick='editProject(\""+p._id+"\")'>"+EDIT_ICO+"</button>"+
      "</div>"+
    "</div>";
}
function buildProjectCard(name,projects){
  var country=projects[0].country;
  var flag=FLAGS[country]||"";
  var poCount=projects.filter(function(p){return p.status==="PO";}).length;
  var qtCount=projects.filter(function(p){return p.status!=="PO";}).length;
  var sorted=projects.slice().sort(function(a,b){return parseDV(b.date)-parseDV(a.date);});
  var cardKey="proj__"+name+"__"+country;
  var sid=cardKey.replace(/[^a-zA-Z0-9]/g,"-");
  var isOpen=expandedProjects[cardKey];
  var bodyHtml=sorted.map(buildProjectBlock).join("");

  return "<div class='card'>"+
    "<div class='card-header' onclick='toggleProjectCard(\""+cardKey.replace(/'/g,"\\'")+"\",\""+sid+"\")'>"+
      "<div class='flag-icon'>"+flag+"</div>"+
      "<div style='flex:1'>"+
        "<div class='cname'>"+name+"</div>"+
        "<div class='cmeta'>"+country+" \xb7 "+poCount+" PO"+(poCount!==1?"s":"")+" \xb7 "+qtCount+" quote"+(qtCount!==1?"s":"")+" \xb7 "+projects.length+" project"+(projects.length!==1?"s":"")+"</div>"+
      "</div>"+
      "<div class='chevron "+(isOpen?"open":"")+"' id='chev-"+sid+"'>\u25be</div>"+
    "</div>"+
    "<div class='card-body "+(isOpen?"open":"")+"' id='body-"+sid+"'>"+bodyHtml+"</div>"+
  "</div>";
}
function toggleProjItems(pid){
  expandedProjectItems[pid]=!expandedProjectItems[pid];
  var el=document.getElementById("pitems-"+pid);
  if(el)el.style.display=expandedProjectItems[pid]?"":"none";
  var chev=document.getElementById("pchev-"+pid);
  if(chev)chev.classList.toggle("open",expandedProjectItems[pid]);
}
function toggleProjectCard(key,sid){
  expandedProjects[key]=!expandedProjects[key];
  document.getElementById("body-"+sid).classList.toggle("open",expandedProjects[key]);
  document.getElementById("chev-"+sid).classList.toggle("open",expandedProjects[key]);
}
function renderProjects(){
  if(!PROJECTS.length){
    document.getElementById("content").innerHTML='<div class="empty">No projects found. The new <code>projects</code> table is empty \u2014 did you run Stage 1B migration?</div>';
    return;
  }
  // Group by customer + country
  var byC={};
  PROJECTS.forEach(function(p){
    var k=p.customer+"__"+p.country;
    if(!byC[k])byC[k]=[];
    byC[k].push(p);
  });
  // Group customers by country
  var byCountry={};
  Object.entries(byC).forEach(function(entry){
    var name=entry[0].split("__")[0];
    var projs=entry[1];
    var c=projs[0].country||"Unknown";
    if(!byCountry[c])byCountry[c]=[];
    byCountry[c].push([name,projs]);
  });
  var html="<div style='background:var(--accent-soft);color:var(--accent-text);padding:10px 14px;border-radius:8px;margin-bottom:16px;font-size:12px;border:1px solid var(--border-strong)'>"+
    "Quotations with <strong>multiple models / line items</strong> live here \u2014 use <strong>+ Add entry</strong> to create one (printers, accessories, discounts per row, with an attached PDF), or <strong>Edit</strong> on any project below."+
  "</div>";
  Object.entries(byCountry).sort(function(a,b){return a[0].localeCompare(b[0]);}).forEach(function(entry){
    var country=entry[0],list=entry[1];
    list.sort(function(a,b){return a[0].localeCompare(b[0]);});
    var f=flagImg(country,18);
    html+="<div class='country-group-label'>"+f+" "+country+" <span class='country-count'>"+list.length+" customer"+(list.length!==1?"s":"")+"</span></div>";
    list.forEach(function(item){html+=buildProjectCard(item[0],item[1]);});
  });
  document.getElementById("content").innerHTML=html;
}
// ============================================================
// END NEW (Stage 2)
// ============================================================

var SPARE_PARTS=["Autocutter KPM180H 85MM Kyoujin","Cutter Ejector Module KPM180H CN","PCBA CPU KPM180 E12 R2 ST101_DP007 VN UL","New Metal Roll Holder for Bag Tag and GPP Paper (TK180 Plastic)","Roll Holder Kit for TK180 Metal","KPM180 TPH (Thermal Print Head)","TK180 TPH","Roll Holder","Ticket Tray Metal","1.8M USB Cable","USA Plug Power Cable","Paper Roll","On-site installation","Annual maintenance + consumables","Vertical Tray TK302 Metal Case","VKP80II Paper Roll Holder"];

function populateModelSelect(){
  var sel=document.getElementById("f-model");
  if(!sel||sel.tagName!=="SELECT")return;
  var models=getModelList().sort();
  sel.innerHTML="<option value=''>-- Select model --</option>"+models.map(function(m){
    return "<option value='"+m+"'>"+m+"</option>";
  }).join("");
}
function openModal(){
  if(currentTab==="customers"||currentTab==="projects"||currentTab==="groups"){
    // New entries are created as projects (line items + PDF parsing).
    // The transaction modal is still used when editing legacy transactions.
    openProjectModal();
    // Inside a project group: pre-fill the group and its customer
    if(currentTab==="groups"&&typeof MD_GROUP_SEL!=="undefined"&&MD_GROUP_SEL){
      document.getElementById("p-group").value=MD_GROUP_SEL;
      var gp=PROJECTS.find(function(p){return p.projectGroup===MD_GROUP_SEL;});
      if(gp){
        document.getElementById("p-customer").value=gp.customer||"";
        document.getElementById("p-country").value=gp.country||"";
      }
    }
  }
  else if(currentTab==="buying"){
    document.getElementById("modal-buying").removeAttribute("data-edit-idx");
    document.getElementById("buying-modal-title").textContent="Add buying price";
    var delBtnB=document.getElementById("btn-delete-buying");if(delBtnB)delBtnB.style.display="none";
    var saveBB=document.getElementById("btn-save-buying");if(saveBB){saveBB.textContent="Save entry";saveBB.onclick=sbSaveBuying;}
    document.getElementById("modal-buying").querySelectorAll("input").forEach(function(el){el.value="";});
    document.getElementById("modal-buying").classList.add("open");
  }
  else if(currentTab==="spares"){
    closeSpareModal();
    // populate customer datalist
    var spcl=document.getElementById("sp-customer-list");
    if(spcl)spcl.innerHTML=[...new Set(SPARES.map(function(s){return s.customer;}).filter(Boolean))].sort().map(function(c){return "<option value='"+c+"'>";}).join("");
    document.getElementById("modal-spares").classList.add("open");
  }
  else if(currentTab==="tracker"){
    /* list view → new tracker project; detail view → new timeline entry */
    trkOpenAdd();
  }
  else if(currentTab==="po"){
    poOpenModal();
  }
  else if(currentTab==="others"){
    closeOtherModal();
    document.getElementById("modal-others").classList.add("open");
  }
}
function closeModal(id){document.getElementById(id).classList.remove("open");}
document.querySelectorAll(".modal-overlay").forEach(el=>{
  let downOnOverlay=false;
  el.addEventListener("mousedown",e=>{downOnOverlay=(e.target===el);});
  el.addEventListener("click",e=>{if(downOnOverlay&&e.target===el)el.classList.remove("open");});
});
