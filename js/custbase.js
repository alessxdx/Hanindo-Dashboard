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
function cbKey(name){return String(name||"").trim().toLowerCase();}
function cbUSD(p){
  if(p.estValue===null||isNaN(p.estValue))return null;
  return (typeof fxToUSD==="function")?fxToUSD(p.estValue,p.currency):(p.currency==="USD"?p.estValue:null);
}
function cbMoney(v){return typeof fxFormatUSD==="function"?fxFormatUSD(v):"$"+Math.round(v).toLocaleString();}

/* one record per customer, newest activity first */
function cbCustomers(){
  var act=trkLastActivityMap(),by={},out=[];
  TRK_PROJECTS.forEach(function(p){
    var k=cbKey(p.customer);
    if(!k||p.status==="Other")return; /* "Other" projects sit outside the sales pipeline */
    var c=by[k];
    if(!c){c=by[k]={key:k,name:p.customer.trim(),countries:{},offices:{},solutions:{},projects:[],n:{ongoing:0,won:0,done:0,lost:0},wonUSD:0,openUSD:0,last:""};out.push(c);}
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
  out.forEach(function(c){
    c.projects.sort(function(a,b){return (b._cbLast||"").localeCompare(a._cbLast||"");});
    var closed=c.n.won+c.n.done+c.n.lost;
    c.winRate=closed?Math.round((c.n.won+c.n.done)/closed*100):null;
    c.country=Object.keys(c.countries)[0]||"";
  });
  out.sort(function(a,b){return b.last.localeCompare(a.last)||a.name.localeCompare(b.name);});
  return out;
}
function cbMatches(c,skip){
  if(skip!=="sol"&&CB_SOL&&!c.solutions[CB_SOL])return false;
  if(skip!=="country"&&CB_COUNTRY&&(c.country||"")!==CB_COUNTRY)return false;
  if(CB_FILTER==="ongoing"&&!c.n.ongoing)return false;
  if(CB_FILTER==="won"&&!(c.n.won+c.n.done))return false;
  if(CB_FILTER==="lost"&&!(c.n.lost&&!c.n.ongoing&&!c.n.won&&!c.n.done))return false;
  var q=CB_Q.trim().toLowerCase();
  if(!q)return true;
  var hay=[c.name,Object.keys(c.countries).join(" "),Object.keys(c.offices).join(" "),Object.keys(c.solutions).join(" ")]
    .concat(c.projects.map(function(p){return p.name+" "+(p.products||[]).join(" ")+" "+trkAllContacts(p).map(function(x){return x.name;}).join(" ");}))
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
        {value:"won",label:"Have won before",count:cnt(function(c){return c.n.won+c.n.done;})},
        {value:"lost",label:"Only lost",count:cnt(function(c){return c.n.lost&&!c.n.ongoing&&!c.n.won&&!c.n.done;})}
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
  var chip=function(fn,v,cur,inner,n){
    return "<button class='trk-chip cb-chip"+(v===cur?" active":"")+"' onclick='"+fn+"("+JSON.stringify(v).replace(/'/g,"&#39;")+")'>"+inner+
      (n!==undefined?"<span class='cb-chip-n'>"+n+"</span>":"")+"</button>";
  };
  var chips=
    "<div class='cb-chips'>"+
      "<div class='cb-chip-row'><span class='cb-chip-lbl'>Solution</span><div class='cb-chip-set'>"+
        chip("cbPickSol","",CB_SOL,"All")+
        solKeys.map(function(s){return chip("cbPickSol",s,CB_SOL,"<span class='trk-sol-dot' style='background:"+trkSolutionColor(s)+"'></span>"+trkEsc(s),solN[s]||0);}).join("")+
      "</div></div>"+
      "<div class='cb-chip-row'><span class='cb-chip-lbl'>Country</span><div class='cb-chip-set'>"+
        chip("cbPickCountry","",CB_COUNTRY,"All")+
        ctyKeys.map(function(k){return chip("cbPickCountry",k,CB_COUNTRY,(k?trkFlag(k,14)+" "+trkEsc(k):"No country"),ctyN[k]||0);}).join("")+
      "</div></div>"+
    "</div>";
  var sel=CB_SEL?all.filter(function(c){return c.key===CB_SEL;})[0]:null;
  var row=function(c){
    var pills=CB_CATS.map(function(x){
      return c.n[x.k]?"<span class='cb-pill cb-"+x.k+"' title='"+x.label.replace("&middot;","·")+"'>"+c.n[x.k]+" "+(x.k==="won"?"won":x.k)+"</span>":"";
    }).join("");
    // under the name: the solution types bought / quoted (Custom, Posiva, Fire...);
    // the country is in the band above and the office is understood from it
    var other=Object.keys(c.countries).filter(function(k){return k!==c.country;});
    var sols=Object.keys(c.solutions).sort().map(function(s){return trkSolutionBadge({solution:s});}).join("");
    var sub=sols+(other.length?"<span>also "+other.map(trkEsc).join(", ")+"</span>":"");
    return "<tr class='po-row cb-row"+(c.key===CB_SEL?" sel":"")+"' onclick='cbOpen("+JSON.stringify(c.key).replace(/'/g,"&#39;")+")'>"+
      "<td><div class='cb-name'>"+trkEsc(c.name)+"</div>"+(sub?"<div class='cb-sub'>"+sub+"</div>":"")+"</td>"+
      "<td class='num cb-c-n'>"+c.projects.length+"</td>"+
      "<td><div class='cb-pills'>"+pills+"</div></td>"+
      "<td class='num cb-c-val'>"+(c.wonUSD?"<span class='po-amt'>"+cbMoney(c.wonUSD)+"</span>":"<span class='po-dim'>&mdash;</span>")+"</td>"+
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
    g.forEach(function(c){won+=c.wonUSD;ongoing+=c.n.ongoing;});
    return "<tr class='po-grp cb-grp"+(shut?" shut":"")+"' onclick='cbToggleCountry("+JSON.stringify(k).replace(/'/g,"&#39;")+")' title='"+(shut?"Show":"Hide")+" these customers'>"+
        "<td colspan='3'><span class='cb-grp-in'><span class='cb-grp-chev'>&#9662;</span>"+(k?trkFlag(k,18)+" ":"")+"<span class='po-grp-name'>"+(k?trkEsc(k):"No country set")+"</span>"+
        "<span class='po-grp-n'>"+g.length+" customer"+(g.length===1?"":"s")+"</span>"+
        (ongoing?"<span class='cb-grp-open'>"+ongoing+" ongoing project"+(ongoing===1?"":"s")+"</span>":"")+"</span></td>"+
        "<td class='num cb-c-val'>"+(won?"<span class='po-grp-lbl'>Won</span><span class='po-grp-sum'>"+cbMoney(won)+"</span>":"")+"</td><td class='cb-c-last'></td>"+
      "</tr>"+
      (shut?"":g.map(row).join(""));
  }).join("");
  var table=list.length?
    "<div class='po-split"+(sel?" has-sel":"")+"'>"+
      "<div class='po-table-wrap'><table class='po-table po-list cb-list'><thead><tr>"+
        "<th>Customer</th><th class='num cb-c-n'>Projects</th><th>Outcome</th><th class='num cb-c-val'>Won value</th><th class='cb-c-last'>Last update</th>"+
      "</tr></thead><tbody>"+rows+"</tbody></table></div>"+
      (sel?cbPanelHtml(sel):"")+
    "</div>"
    :"<div class='empty'>"+(all.length?"No customer matches that search or filter.":"No customers in the Project Tracker yet.")+"</div>";
  content.innerHTML=toolbar+chips+(searching?"<div class='trk-search-count'>"+list.length+" of "+all.length+" customers</div>":"")+table;
}

function cbRenderStats(all){
  var el=document.getElementById("stats");
  if(!el)return;
  var active=all.filter(function(c){return c.n.ongoing;}).length;
  var winners=all.filter(function(c){return c.n.won+c.n.done;});
  var repeat=all.filter(function(c){return c.n.won+c.n.done>=2;}).length;
  var w=0,l=0;all.forEach(function(c){w+=c.n.won+c.n.done;l+=c.n.lost;});
  el.innerHTML=
    "<div class='stat'><div class='stat-label'>Customers</div><div class='stat-value'>"+all.length+"</div><div class='stat-sub'>"+active+" with ongoing projects</div></div>"+
    "<div class='stat'><div class='stat-label'>Have bought</div><div class='stat-value'>"+winners.length+"</div><div class='stat-sub'>"+repeat+" more than once</div></div>"+
    "<div class='stat'><div class='stat-label'>Win rate</div><div class='stat-value'>"+(w+l?Math.round(w/(w+l)*100)+"%":"&mdash;")+"</div><div class='stat-sub'>"+w+" won &middot; "+l+" lost (closed projects)</div></div>";
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
  return "<aside class='po-panel cb-panel'>"+
    "<div class='po-panel-head'><span class='po-panel-no'>"+trkEsc(c.name)+"</span>"+
      "<button class='po-panel-x' aria-label='Close' onclick='cbOpen(\"\")'>&times;</button></div>"+
    (c.country?"<div class='trk-pn-cust'>"+trkFlag(c.country,16)+" "+Object.keys(c.countries).map(trkEsc).join(", ")+"</div>":"")+
    "<div class='cb-kpis'>"+
      "<div><b>"+c.projects.length+"</b><span>projects</span></div>"+
      "<div><b>"+(c.wonUSD?cbMoney(c.wonUSD):"&mdash;")+"</b><span>won value</span></div>"+
      "<div><b>"+(c.winRate===null?"&mdash;":c.winRate+"%")+"</b><span>win rate</span></div>"+
    "</div>"+
    "<div class='po-panel-sec'>Details</div>"+
    info("Office",Object.keys(c.offices).sort().map(function(o){return "<span class='trk-badge trk-office po-of-"+poOfficeSlug(o)+"'>"+trkEsc(o)+"</span>";}).join(" "))+
    info("Solutions",sols)+
    info("Open pipeline",c.openUSD?cbMoney(c.openUSD)+" <span class='po-dim'>USD est.</span>":"")+
    info(contacts.length>1?"Contacts":"Contact",contacts.map(function(x){
      return "<div class='trk-xc-show'>"+trkEsc(x.name)+(x.position?" &middot; "+trkEsc(x.position):"")+(x.info?"<div class='trk-value-usd'>"+trkEsc(x.info)+"</div>":"")+"</div>";
    }).join(""))+
    secs+
  "</aside>";
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
function cbOpen(key){CB_SEL=key||"";renderCustBase();if(typeof syncRoute==="function")syncRoute();}
function cbPickFilter(v){CB_FILTER=v;renderCustBase();}
function cbPickSol(v){CB_SOL=(v&&v===CB_SOL)?"":v;renderCustBase();}
function cbPickCountry(v){CB_COUNTRY=(v&&v===CB_COUNTRY)?"":v;renderCustBase();}
function cbSearchInput(v){
  CB_Q=v;
  clearTimeout(CB_Q_T);
  CB_Q_T=setTimeout(function(){
    renderCustBase();
    var el=document.getElementById("cb-search");
    if(el){el.focus();el.setSelectionRange(el.value.length,el.value.length);}
  },180);
}
