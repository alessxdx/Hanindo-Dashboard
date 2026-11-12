/* ============================================================
   CUSTOMER BASE — every customer in the Project Tracker with the
   outcome of their projects: ongoing, won (still in progress), done,
   lost. Built from tracker_projects / tracker_entries (no tables of
   its own). List + side panel like the PO page; a project in the
   panel opens in the tracker.
   ============================================================ */
var CB_SEL="";      /* selected customer key (lower-cased name) */
var CB_Q="";        /* search box */
var CB_FILTER="";   /* "", "ongoing", "won", "lost" */
var CB_Q_T=null;
var CB_SOL="";      /* solution chip: "" = all */
var CB_COUNTRY="";  /* country chip: "" = all */

/* outcome buckets, in the order the panel lists them */
var CB_CATS=[
  {k:"ongoing",label:"Ongoing",sub:"enquiry / quoted"},
  {k:"won",label:"Won &middot; in progress",sub:"delivery or payment still open"},
  {k:"done",label:"Done",sub:"finished"},
  {k:"lost",label:"Lost",sub:"did not go ahead"}
];
function cbCat(p){
  if(p.status==="Lost")return "lost";
  if(trkIsDone(p))return "done";
  if(p.status==="Won")return "won";
  return "ongoing";
}
/* one key per company, so "PT. Festo" (tracker) and "PT Festo" (sales) meet */
function cbKey(name){
  return String(name||"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/^pt /,"");
}
function cbUSD(p){
  if(p.estValue===null||isNaN(p.estValue))return null;
  return (typeof fxToUSD==="function")?fxToUSD(p.estValue,p.currency):(p.currency==="USD"?p.estValue:null);
}
function cbMoney(v){return typeof fxFormatUSD==="function"?fxFormatUSD(v):"$"+Math.round(v).toLocaleString();}

/* sales records (the By Customer data: POs, quotations, order line items) */
function cbSales(){
  if(typeof resolveDeals!=="function"||typeof TX==="undefined")return {txs:[],projs:[]};
  try{return resolveDeals();}catch(e){return {txs:[],projs:[]};}
}
/* The sales records have no solution field. They are all Custom printer
   sales (confirmed by the user for every sales customer, 12 Nov 2026). */
function cbSalesIsCustom(c){return true;}
function cbIso(ms){if(!ms)return "";var d=new Date(ms);return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");}

/* one record per customer, from the tracker and the sales records together */
function cbCustomers(){
  var act=trkLastActivityMap(),by={},out=[];
  function rec(k,name){
    var c=by[k];
    if(!c){c=by[k]={key:k,name:String(name).trim(),countries:{},offices:{},solutions:{},projects:[],n:{ongoing:0,won:0,done:0,lost:0},wonUSD:0,openUSD:0,last:"",
      sales:{name:"",txs:[],projs:[]},pos:0,quotes:0,revUSD:0};out.push(c);}
    return c;
  }
  TRK_PROJECTS.forEach(function(p){
    var k=cbKey(p.customer);
    if(!k||p.status==="Other")return; /* "Other" projects sit outside the sales pipeline */
    var c=rec(k,p.customer);
    c.projects.push(p);
    var cat=cbCat(p);c.n[cat]++;
    if(p.country)c.countries[p.country]=1;
    if(p.office)c.offices[p.office]=1;
    if(p.solution)c.solutions[p.solution]=1;
    var u=cbUSD(p);
    if(u!==null){if(cat==="won"||cat==="done")c.wonUSD+=u;else if(cat==="ongoing")c.openUSD+=u;}
    var d=(act[p._id]&&act[p._id].d)||String(p.createdAt||"").slice(0,10);
    p._cbLast=d;
    if(d>c.last)c.last=d;
  });
  /* sales records join the same company; the first sales name is what
     buildMdDetail looks the history up by */
  var S=cbSales(),salesCty={},allSales=S.txs.concat(S.projs);
  /* a sales-only company bought in several countries (SITA: Indonesia and
     Philippines) is listed once per country, as "SITA Indonesia" etc. */
  var spread={};
  allSales.forEach(function(e){var k=cbKey(e.customer);if(k&&e.country)(spread[k]=spread[k]||{})[e.country]=1;});
  function addSale(e,kind){
    var k=cbKey(e.customer);if(!k)return;
    var split=!by[k]&&spread[k]&&Object.keys(spread[k]).length>1;
    if(split&&e.country)k=k+" "+cbKey(e.country);
    var c=rec(k,split&&e.country?e.customer+" "+e.country:e.customer);
    if(split&&e.country)c.sales.country=e.country;
    if(!c.sales.name)c.sales.name=e.customer;
    if(e.customer!==c.sales.name)return; /* a second spelling: its history stays on By Customer */
    c.sales[kind].push(e);
    if(e.country){(salesCty[k]=salesCty[k]||{})[e.country]=1;}
    var d=cbIso(parseDV(e.date));
    if(d>c.last)c.last=d;
  }
  S.txs.forEach(function(t){addSale(t,"txs");});
  S.projs.forEach(function(p){addSale(p,"projs");});
  out.forEach(function(c){
    c.projects.sort(function(a,b){return (b._cbLast||"").localeCompare(a._cbLast||"");});
    var closed=c.n.won+c.n.done+c.n.lost;
    c.winRate=closed?Math.round((c.n.won+c.n.done)/closed*100):null;
    /* the tracker's country leads; sales countries are added after it */
    Object.keys(salesCty[c.key]||{}).forEach(function(k){c.countries[k]=1;});
    c.country=Object.keys(c.countries)[0]||"";
    var sx=c.sales;
    if((sx.txs.length||sx.projs.length)&&cbSalesIsCustom(c))c.solutions.Custom=1;
    if(sx.txs.length||sx.projs.length){
      c.pos=mdCountSt(sx.txs,"PO")+mdCountSt(sx.projs,"PO");
      c.quotes=sx.txs.concat(sx.projs).filter(function(e){return e.status==="Quotation";}).length;
      var rv=mdRollup(sx.txs,sx.projs).revenue;
      Object.keys(rv).forEach(function(cur){var u=fxToUSD(rv[cur],cur);if(u!==null)c.revUSD+=u;});
    }
    /* revenue: the confirmed POs in the sales records; a customer with none
       there yet falls back to the tracker's won value (the two often describe
       the same deal, so they are not added together) */
    c.revenue=c.revUSD||c.wonUSD;
  });
  out.sort(function(a,b){return b.last.localeCompare(a.last)||a.name.localeCompare(b.name);});
  return out;
}
function cbMatches(c,skip){
  if(skip!=="sol"&&CB_SOL&&!c.solutions[CB_SOL])return false;
  if(skip!=="country"&&CB_COUNTRY&&(c.country||"")!==CB_COUNTRY)return false;
  if(CB_FILTER==="ongoing"&&!c.n.ongoing)return false;
  if(CB_FILTER==="won"&&!(c.n.won+c.n.done+c.pos))return false;
  if(CB_FILTER==="lost"&&!(c.n.lost&&!c.n.ongoing&&!c.n.won&&!c.n.done&&!c.pos))return false;
  var q=CB_Q.trim().toLowerCase();
  if(!q)return true;
  var hay=[c.name,Object.keys(c.countries).join(" "),Object.keys(c.offices).join(" "),Object.keys(c.solutions).join(" ")]
    .concat(c.projects.map(function(p){return p.name+" "+(p.products||[]).join(" ")+" "+trkAllContacts(p).map(function(x){return x.name;}).join(" ");}))
    .concat(c.sales.txs.map(function(t){return (t.project||"")+" "+(t.model||"")+" "+(t.projectGroup||"");}))
    .concat(c.sales.projs.map(function(p){return typeof mdProjSearchText==="function"?mdProjSearchText(p):(p.project||"");}))
    .join(" ").toLowerCase();
  return q.split(/\s+/).every(function(w){return hay.indexOf(w)>-1;});
}

function renderCustBase(){
  var content=document.getElementById("content");
  if(!TRK_LOADED){
    content.innerHTML="<div class='empty'>Loading customers&hellip;</div>";
    trkLoad().then(function(ok){
      if(currentTab!=="custbase")return;
      if(!ok){content.innerHTML="<div class='empty'>The tracker tables don't exist in Supabase yet.</div>";return;}
      renderCustBase();
    });
    return;
  }
  trkReconcileStatus();
  var all=cbCustomers();
  cbRenderStats(all);
  var list=all.filter(cbMatches);
  if(CB_SEL&&!all.some(function(c){return c.key===CB_SEL;}))CB_SEL="";
  var cnt=function(f){return all.filter(f).length;};
  var toolbar=
    "<div class='po-bar'>"+
      "<label class='po-searchbox'><input id='cb-search' placeholder='Search customer, country, product, contact&hellip;' value='"+trkEsc(CB_Q)+"' oninput='cbSearchInput(this.value)'></label>"+
      uiDropdown({key:"cb-filter",onPick:"cbPickFilter",cur:CB_FILTER,opts:[
        {value:"",label:"All customers",count:all.length},
        {value:"ongoing",label:"With ongoing projects",count:cnt(function(c){return c.n.ongoing;})},
        {value:"won",label:"Have bought (won / PO)",count:cnt(function(c){return c.n.won+c.n.done+c.pos;})},
        {value:"lost",label:"Only lost",count:cnt(function(c){return c.n.lost&&!c.n.ongoing&&!c.n.won&&!c.n.done&&!c.pos;})}
      ]})+
    "</div>";
  /* chip rows: one tap narrows to a solution / country, tapping it again
     clears it. Counts follow the other filters, so they add up to the list. */
  var solN={},ctyN={};
  all.forEach(function(c){
    if(cbMatches(c,"sol"))Object.keys(c.solutions).forEach(function(s){solN[s]=(solN[s]||0)+1;});
    if(cbMatches(c,"country")){var k=c.country||"";ctyN[k]=(ctyN[k]||0)+1;}
  });
  var solKeys=Object.keys(solN).sort(function(a,b){return solN[b]-solN[a]||a.localeCompare(b);});
  if(CB_SOL&&solKeys.indexOf(CB_SOL)<0)solKeys.push(CB_SOL);
  var ctyKeys=Object.keys(ctyN).sort(function(a,b){if(!a!==!b)return a?-1:1;return ctyN[b]-ctyN[a]||a.localeCompare(b);});
  if(CB_COUNTRY&&ctyKeys.indexOf(CB_COUNTRY)<0)ctyKeys.push(CB_COUNTRY);
  var chips="";
  toolbar=toolbar.replace(/<\/div>$/,
    uiDropdown({key:"cb-sol",onPick:"cbPickSol",cur:CB_SOL,opts:[{value:"",label:"All solutions"}].concat(
      solKeys.map(function(s){return {value:s,label:s,count:solN[s]||0,color:trkSolutionColor(s)};}))})+
    uiDropdown({key:"cb-country",onPick:"cbPickCountry",cur:CB_COUNTRY,opts:[{value:"",label:"All countries"}].concat(
      ctyKeys.map(function(k){return {value:k,label:k||"No country",count:ctyN[k]||0};}))})+
    "</div>");
  var sel=CB_SEL?all.filter(function(c){return c.key===CB_SEL;})[0]:null;
  if(!sel)CB_FULL=false;
  if(CB_FULL){
    content.innerHTML="<button class='trk-back' onclick='cbToggleFull()'>&larr; All customers</button>"+cbPanelHtml(sel);
    return;
  }
  var row=function(c){
    var pills=CB_CATS.map(function(x){
      return c.n[x.k]?"<span class='cb-pill cb-"+x.k+"' title='"+x.label.replace("&middot;","·")+"'>"+c.n[x.k]+" "+(x.k==="won"?"won":x.k)+"</span>":"";
    }).join("")+(c.pos?"<span class='cb-pill cb-po' title='Confirmed POs in the sales records'>"+c.pos+" PO"+(c.pos===1?"":"s")+"</span>":"")+
      /* open quotes from the sales records, for customers the tracker doesn't follow yet */
      (c.quotes&&!c.projects.length?"<span class='cb-pill cb-ongoing' title='Open quotations in the sales records'>"+c.quotes+" quote"+(c.quotes===1?"":"s")+"</span>":"");
    // under the name: the solution types bought / quoted (Custom, Posiva, Fire...);
    // the country is in the band above and the office is understood from it
    var sub=Object.keys(c.solutions).sort().map(function(s){return trkSolutionBadge({solution:s});}).join("");
    return "<tr class='po-row cb-row"+(c.key===CB_SEL?" sel":"")+"' onclick='cbOpen("+JSON.stringify(c.key).replace(/'/g,"&#39;")+")'>"+
      "<td><div class='cb-name'>"+trkEsc(c.name)+"</div>"+(sub?"<div class='cb-sub'>"+sub+"</div>":"")+"</td>"+
      "<td class='num cb-c-n'>"+(c.projects.length||"<span class='po-dim'>&mdash;</span>")+"</td>"+
      "<td><div class='cb-pills'>"+pills+"</div></td>"+
      "<td class='num cb-c-val'>"+(c.revenue?"<span class='po-amt'>"+cbMoney(c.revenue)+"</span>":"<span class='po-dim'>&mdash;</span>")+"</td>"+
      "<td class='cb-c-last po-dim'>"+(c.last?trkFmtDate(c.last):"")+"</td>"+
    "</tr>";
  };
  /* one band per country: most customers first, customers A-Z inside, no country last */
  var groups={},order=[];
  list.forEach(function(c){
    var k=c.country||"";
    if(!groups[k]){groups[k]=[];order.push(k);}
    groups[k].push(c);
  });
  order.sort(function(a,b){
    if(!a!==!b)return a?-1:1;
    return groups[b].length-groups[a].length||a.localeCompare(b);
  });
  var searching=!!(CB_Q.trim()||CB_FILTER||CB_SOL||CB_COUNTRY);
  var rows=order.map(function(k){
    var g=groups[k].sort(function(a,b){return a.name.localeCompare(b.name);});
    var shut=!searching&&cbIsShut(k),won=0,ongoing=0;
    g.forEach(function(c){won+=c.revenue;ongoing+=c.n.ongoing;});
    return "<tr class='po-grp cb-grp"+(shut?" shut":"")+"' onclick='cbToggleCountry("+JSON.stringify(k).replace(/'/g,"&#39;")+")' title='"+(shut?"Show":"Hide")+" these customers'>"+
        "<td colspan='3'><span class='cb-grp-in'><span class='cb-grp-chev'>&#9662;</span>"+(k?trkFlag(k,18)+" ":"")+"<span class='po-grp-name'>"+(k?trkEsc(k):"No country set")+"</span>"+
        "<span class='po-grp-n'>"+g.length+" customer"+(g.length===1?"":"s")+"</span>"+
        (ongoing?"<span class='cb-grp-open'>"+ongoing+" ongoing project"+(ongoing===1?"":"s")+"</span>":"")+"</span></td>"+
        "<td class='num cb-c-val'>"+(won?"<span class='po-grp-lbl'>Revenue</span><span class='po-grp-sum'>"+cbMoney(won)+"</span>":"")+"</td><td class='cb-c-last'></td>"+
      "</tr>"+
      (shut?"":g.map(row).join(""));
  }).join("");
  var table=list.length?
    "<div class='po-split"+(sel?" has-sel":"")+"'>"+
      "<div class='po-table-wrap'><table class='po-table po-list cb-list'><thead><tr>"+
        "<th>Customer</th><th class='num cb-c-n'>Projects</th><th>Outcome</th><th class='num cb-c-val'>Revenue</th><th class='cb-c-last'>Last update</th>"+
      "</tr></thead><tbody>"+rows+"</tbody></table></div>"+
      (sel?cbPanelHtml(sel):"")+
    "</div>"
    :"<div class='empty'>"+(all.length?"No customer matches that search or filter.":"No customers in the Project Tracker yet.")+"</div>";
  content.innerHTML=toolbar+chips+(searching?"<div class='trk-search-count'>"+list.length+" of "+all.length+" customers</div>":"")+table;
}

function cbRenderStats(all){
  var el=document.getElementById("stats");
  if(!el)return;
  var bought=all.filter(function(c){return c.n.won+c.n.done+c.pos;}).length;
  var rev=0,pos=0,ongoing=0,activeC=0,quotes=0;
  all.forEach(function(c){rev+=c.revenue;pos+=c.pos;ongoing+=c.n.ongoing;quotes+=c.quotes;if(c.n.ongoing)activeC++;});
  var w=0,l=0;all.forEach(function(c){w+=c.n.won+c.n.done;l+=c.n.lost;});
  el.innerHTML=
    "<div class='stat'><div class='stat-label'>Customers</div><div class='stat-value'>"+all.length+"</div><div class='stat-sub'>"+bought+" have bought</div></div>"+
    "<div class='stat'><div class='stat-label'>Revenue</div><div class='stat-value'>"+(rev?cbMoney(rev):"&mdash;")+"</div><div class='stat-sub'>"+pos+" confirmed POs &middot; USD equiv.</div></div>"+
    "<div class='stat'><div class='stat-label'>Ongoing projects</div><div class='stat-value'>"+ongoing+"</div><div class='stat-sub'>with "+activeC+" customer"+(activeC===1?"":"s")+(quotes?" &middot; "+quotes+" open quotes":"")+"</div></div>"+
    "<div class='stat'><div class='stat-label'>Win rate</div><div class='stat-value'>"+(w+l?Math.round(w/(w+l)*100)+"%":"&mdash;")+"</div><div class='stat-sub'>"+w+" won &middot; "+l+" lost (tracker)</div></div>";
}

function cbPanelHtml(c){
  var contacts=[],seen={};
  c.projects.forEach(function(p){
    trkAllContacts(p).forEach(function(x){
      var k=cbKey(x.name||x.info);
      if(!k||seen[k])return;seen[k]=1;contacts.push(x);
    });
  });
  var sols=Object.keys(c.solutions).sort().map(function(s){return trkSolutionBadge({solution:s});}).join(" ");
  var secs=CB_CATS.map(function(x){
    var ps=c.projects.filter(function(p){return cbCat(p)===x.k;});
    if(!ps.length)return"";
    return "<div class='po-panel-sec cb-sec cb-sec-"+x.k+"'>"+x.label+" &middot; "+ps.length+"</div>"+
      ps.map(function(p){
        var u=p.estValue!==null?trkEsc(p.estValue.toLocaleString())+" "+trkEsc(p.currency):"";
        return "<button class='cb-proj' onclick='navTo(\"tracker\","+JSON.stringify(p._id).replace(/'/g,"&#39;")+")'>"+
          "<span class='cb-proj-name'>"+trkDisplayName(p)+"</span>"+
          "<span class='cb-proj-meta'>"+trkStatusBadge(p.status)+trkPaymentBadge(p)+(p.lowPriority&&x.k==="ongoing"?trkLowBadge():"")+
            (p.solution?trkSolutionBadge(p):"")+"</span>"+
          "<span class='cb-proj-foot'><span>"+(p._cbLast?trkFmtDate(p._cbLast):"")+"</span><span>"+u+"</span></span>"+
        "</button>";
      }).join("");
  }).join("");
  var info=function(label,html){return html?"<div class='trk-pn-row'><span>"+label+"</span><div>"+html+"</div></div>":"";};
  var details=
    info("Win rate",c.winRate===null?"":c.winRate+"% <span class='po-dim'>of closed projects</span>")+
    info("Office",Object.keys(c.offices).sort().map(function(o){return "<span class='trk-badge trk-office po-of-"+poOfficeSlug(o)+"'>"+trkEsc(o)+"</span>";}).join(" "))+
    info("Solutions",sols)+
    info("Open pipeline",c.openUSD?cbMoney(c.openUSD)+" <span class='po-dim'>USD est.</span>":"")+
    info(contacts.length>1?"Contacts":"Contact",contacts.map(function(x){
      return "<div class='trk-xc-show'>"+trkEsc(x.name)+(x.position?" &middot; "+trkEsc(x.position):"")+(x.info?"<div class='trk-value-usd'>"+trkEsc(x.info)+"</div>":"")+"</div>";
    }).join(""));
  if(details)details="<div class='po-panel-sec'>Details</div>"+details;
  var hasSales=c.sales.txs.length||c.sales.projs.length;
  /* the By Customer history (revenue, printers by model, every order and
     document), drawn by the same code that page uses */
  var history=hasSales&&typeof buildMdDetail==="function"?
    "<div class='cb-hist-head'>PO &amp; quotation history</div><div class='cb-hist'>"+buildMdDetail(c.sales.name,{embedded:true,country:c.sales.country})+"</div>":"";
  return "<aside class='po-panel cb-panel"+(hasSales?" cb-panel-wide":"")+(CB_FULL?" cb-full":"")+"'><div class='cb-full-in'>"+
    "<div class='po-panel-head'><span class='po-panel-no'>"+trkEsc(c.name)+"</span>"+
      (CB_FULL?"":"<button class='trk-pn-expand' title='Open full page' aria-label='Open full page' onclick='cbToggleFull()'>&#x2922;</button>"+
      "<button class='po-panel-x' aria-label='Close' onclick='cbOpen(\"\")'>&times;</button>")+"</div>"+
    (c.country?"<div class='trk-pn-cust'>"+trkFlag(c.country,16)+" "+Object.keys(c.countries).map(trkEsc).join(", ")+"</div>":"")+
    "<div class='cb-kpis'>"+
      "<div><b>"+(c.revenue?cbMoney(c.revenue):"&mdash;")+"</b><span>revenue</span></div>"+
      "<div><b>"+(c.pos||"&mdash;")+"</b><span>confirmed POs</span></div>"+
      "<div><b>"+(c.projects.length||"&mdash;")+"</b><span>tracker projects</span></div>"+
    "</div>"+
    details+
    secs+
    history+
  "</div></aside>";
}

/* folded country bands are remembered on this device */
function cbShutMap(){try{return JSON.parse(localStorage.getItem("cb_shut")||"{}")||{};}catch(e){return {};}}
function cbIsShut(k){return !!cbShutMap()[k||"-"];}
function cbToggleCountry(k){
  var m=cbShutMap(),id=k||"-";
  if(m[id])delete m[id];else m[id]=1;
  try{localStorage.setItem("cb_shut",JSON.stringify(m));}catch(e){}
  renderCustBase();
}
/* expanded customer: the panel opens as a full page in the main area,
   like an expanded tracker project; "All customers" goes back to the list */
var CB_FULL=false;
function cbToggleFull(){CB_FULL=!CB_FULL;renderCustBase();window.scrollTo(0,0);}
function cbOpen(key){if(!key)CB_FULL=false;CB_SEL=key||"";renderCustBase();if(typeof syncRoute==="function")syncRoute();}
function cbPickFilter(v){CB_FILTER=v;renderCustBase();}
function cbPickSol(v){CB_SOL=v;renderCustBase();}
function cbPickCountry(v){CB_COUNTRY=v;renderCustBase();}
function cbSearchInput(v){
  CB_Q=v;
  clearTimeout(CB_Q_T);
  CB_Q_T=setTimeout(function(){
    renderCustBase();
    var el=document.getElementById("cb-search");
    if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}
  },180);
}
