/* ============================================================
   TODAY — the page to open each morning. Everything that needs
   attention, gathered from the tracker and the sales records:
   - follow-ups due (and projects gone quiet), same rules as the
     tracker's Needs follow-up
   - money owed: won projects not fully paid, with the due date
     worked out from the Invoice timeline entry + payment terms
   - quotes whose "Prices valid till …" date is close or just passed
   - what's coming up in the next 7 days
   Nothing here is stored; it is all read from existing data.
   ============================================================ */
var TD_SOON=14;        /* "due soon" window for payments, days */
var TD_QUOTE_WIN=30;   /* quotes expiring within / expired within, days */
var TD_DEFAULT_TERMS=30;

function tdEsc(s){return typeof trkEsc==="function"?trkEsc(s):String(s==null?"":s);}
function tdAddDays(iso,n){var d=new Date(iso+"T00:00:00");d.setDate(d.getDate()+n);return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}
function tdDays(a,b){return trkDaysBetween(a,b);} /* b - a, in days */

/* "July 31, 2026", "31st Oct 2025", "31 Oct 2026", "2026-10-31", "31/10/2026" → "YYYY-MM-DD" */
var TD_MON={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function tdParseDate(s){
  s=String(s||"");var m,y,mo,d;
  if((m=s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/))){y=+m[1];mo=+m[2];d=+m[3];}
  else if((m=s.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3})[a-z]*\.?,?\s+(\d{4})/i))&&TD_MON[m[2].toLowerCase()]){d=+m[1];mo=TD_MON[m[2].toLowerCase()];y=+m[3];}
  else if((m=s.match(/([a-z]{3})[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i))&&TD_MON[m[1].toLowerCase()]){mo=TD_MON[m[1].toLowerCase()];d=+m[2];y=+m[3];}
  else if((m=s.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/))){d=+m[1];mo=+m[2];y=+m[3];}
  else return "";
  if(!(mo>=1&&mo<=12&&d>=1&&d<=31))return "";
  return y+"-"+("0"+mo).slice(-2)+"-"+("0"+d).slice(-2);
}

/* payment terms in days, read from the invoice entry or the project's
   description ("Payment terms: 30 days after invoice", "Net 45") */
function tdTerms(texts){
  for(var i=0;i<texts.length;i++){
    var t=String(texts[i]||""),m;
    if((m=t.match(/payment\s*terms?[^.\n]*?(\d{1,3})\s*days?/i))||(m=t.match(/(\d{1,3})\s*days?\s*(?:after|from|of|upon)[^.\n]*invoice/i))||(m=t.match(/\bnet\s*(\d{1,3})\b/i)))
      return {days:+m[1],assumed:false};
  }
  return {days:TD_DEFAULT_TERMS,assumed:true};
}

/* won projects not fully paid, each with its invoice/due dates */
function tdMoneyOwed(){
  var today=trkToday();
  return TRK_PROJECTS.filter(function(p){return p.status==="Won"&&p.payment!=="Fully paid";}).map(function(p){
    var ents=trkEntriesFor(p._id);
    var inv=ents.filter(function(e){return e.type==="Invoice";}).sort(function(a,b){return b.date.localeCompare(a.date);})[0];
    var po=ents.filter(function(e){return e.type==="Purchase order";}).sort(function(a,b){return a.date.localeCompare(b.date);})[0];
    var terms=tdTerms([inv?(inv.title||"")+" "+(inv.details||""):"",p.notes]);
    var r={p:p,inv:inv?inv.date:"",po:po?po.date:"",terms:terms,amt:p.estValue,cur:p.currency||"USD",partial:p.payment==="Partially paid"};
    r.usd=r.amt!==null&&typeof fxToUSD==="function"?fxToUSD(r.amt,r.cur):null;
    if(!r.inv){r.state="noinv";return r;}
    r.due=tdAddDays(r.inv,terms.days);
    r.days=tdDays(today,r.due); /* negative = overdue by that many days */
    r.state=r.days<0?"overdue":r.days<=TD_SOON?"soon":"later";
    return r;
  });
}

/* quotations with a "valid till" date, from the sales records and the
   tracker (open quotes only) */
function tdQuotes(){
  var today=trkToday(),out=[];
  var push=function(o){
    if(!o.valid)return;
    o.days=tdDays(today,o.valid);
    if(o.days<=TD_QUOTE_WIN&&o.days>=-TD_QUOTE_WIN)out.push(o);
  };
  if(typeof resolveDeals==="function"){
    var d=resolveDeals();
    d.txs.concat(d.projs).forEach(function(e){
      if(e.status!=="Quotation")return;
      var n=(e.notes||[]).filter(function(x){return /valid/i.test(x);})[0];
      if(!n)return;
      push({name:e.project||e.displayModel||e.model||"Quotation",cust:e.customer,country:e.country,valid:tdParseDate(n),go:"custbase",sel:typeof cbKey==="function"?cbKey(e.customer):""});
    });
  }
  TRK_PROJECTS.forEach(function(p){
    if(p.status!=="Quoted"||p.done)return;
    var txt=[p.notes].concat(trkEntriesFor(p._id).filter(function(e){return e.type==="Quotation";}).map(function(e){return (e.title||"")+" "+(e.details||"");})).join("\n");
    var m=txt.match(/valid[^.\n]{0,20}?(?:till|until|to|thru|through)\s*([^.\n]{6,25})/i);
    if(m)push({name:p.name,cust:p.customer,country:p.country,valid:tdParseDate(m[1]),go:"tracker",sel:p._id});
  });
  return out.sort(function(a,b){return a.days-b.days;});
}

function tdGo(tab,sel){navTo(tab,sel||null);if(typeof syncRoute==="function")syncRoute();window.scrollTo(0,0);}
function tdGoAttr(tab,sel){return "tdGo("+JSON.stringify(tab)+","+JSON.stringify(sel||"")+")";}
function tdAttr(js){return js.replace(/&/g,"&amp;").replace(/'/g,"&#39;");}
function tdUSD(v){return typeof cbMoney==="function"?cbMoney(v):"$"+Math.round(v).toLocaleString();}
function tdAmt(r){return r.amt===null?"<span class='td-dim'>value not set</span>":tdEsc(r.amt.toLocaleString())+" <span class='trk-r-cur'>"+tdEsc(r.cur)+"</span>";}

function tdRow(o){
  /* o: {name, cust, country, right, sub, badge, go, sel} */
  /* the customer is left out when the project name already starts with it */
  var cust=o.cust&&String(o.name||"").toLowerCase().indexOf(String(o.cust).toLowerCase())===0?"":(o.cust||"");
  var sub=[tdEsc(cust),o.sub||""].filter(Boolean).join(" &middot; ");
  return "<button class='td-row' onclick='"+tdAttr(tdGoAttr(o.go,o.sel))+"'>"+
    "<span class='td-main'><span class='td-name'>"+tdEsc(o.name)+"</span>"+
      "<span class='td-sub'>"+(o.country?trkFlag(o.country,14)+" ":"")+sub+"</span></span>"+
    (o.badge?"<span class='td-badge'>"+o.badge+"</span>":"")+
    (o.right?"<span class='td-right'>"+o.right+"</span>":"")+
    "<span class='td-go'>&rsaquo;</span>"+
  "</button>";
}
function tdCard(title,count,body,empty,cls){
  return "<section class='td-card"+(cls?" "+cls:"")+"'><div class='td-card-head'><h2>"+title+"</h2>"+(count?"<span class='td-n'>"+count+"</span>":"")+"</div>"+
    (body||"<div class='td-empty'>"+empty+"</div>")+"</section>";
}

function renderToday(){
  var content=document.getElementById("content");
  if(!TRK_LOADED){
    content.innerHTML="<div class='empty'>Loading&hellip;</div>";
    trkLoad().then(function(ok){
      if(currentTab!=="today")return;
      if(!ok){content.innerHTML="<div class='empty'>The tracker tables don't exist in Supabase yet.</div>";return;}
      renderToday();
    });
    return;
  }
  if(typeof trkReconcileStatus==="function")trkReconcileStatus();
  var act=trkLastActivityMap(),today=trkToday();

  /* follow-ups: due today / overdue, then gone quiet; next 7 days separately */
  var due=[],quiet=[],soon=[];
  TRK_PROJECTS.forEach(function(p){
    var f=trkFollow(p,act);
    if(!f)return;
    if(f.due)(f.kind==="quiet"?quiet:due).push({p:p,f:f});
    else if(f.kind==="followup"&&tdDays(today,f.date)<=7)soon.push({p:p,f:f});
  });
  due.sort(function(a,b){return b.f.days-a.f.days;});
  quiet.sort(function(a,b){return b.f.days-a.f.days;});
  soon.sort(function(a,b){return a.f.date.localeCompare(b.f.date);});
  var fuRow=function(x){
    var last=trkLastDate(x.p,act);
    return tdRow({name:x.p.name,cust:x.p.customer,country:x.p.country,badge:trkFollowBadge(x.f),
      sub:last?"last update "+trkFmtDate(last):"",go:"tracker",sel:x.p._id});
  };

  /* money owed */
  var money=tdMoneyOwed();
  var by={overdue:[],soon:[],later:[],noinv:[]};
  money.forEach(function(r){by[r.state].push(r);});
  by.overdue.sort(function(a,b){return a.days-b.days;});
  by.soon.sort(function(a,b){return a.days-b.days;});
  by.later.sort(function(a,b){return a.days-b.days;});
  by.noinv.sort(function(a,b){return (a.po||"").localeCompare(b.po||"");});
  var sumUSD=function(a){return a.reduce(function(n,r){return n+(r.usd||0);},0);};
  var payRow=function(r){
    var sub,badge;
    var termTxt=r.terms.days+" days"+(r.terms.assumed?" (assumed)":"");
    if(r.state==="noinv"){
      sub=(r.po?"PO "+trkFmtDate(r.po)+" &middot; ":"")+"no invoice on the timeline yet";
      badge="<span class='trk-badge td-b-wait'>Not invoiced</span>";
    }else{
      sub="invoiced "+trkFmtDate(r.inv)+" &middot; "+termTxt+" &middot; due "+trkFmtDate(r.due);
      badge=r.state==="overdue"?"<span class='trk-badge trk-stale trk-stale-hot'>Overdue "+(-r.days)+"d</span>":
        r.state==="soon"?"<span class='trk-badge trk-stale'>"+(r.days===0?"Due today":"Due in "+r.days+"d")+"</span>":
        "<span class='trk-badge trk-fu'>Due "+trkFmtDate(r.due).replace(/ \d{4}$/,"")+"</span>";
    }
    if(r.partial)badge+=" <span class='trk-badge td-b-part'>Partly paid</span>";
    return tdRow({name:r.p.name,cust:r.p.customer,country:r.p.country,sub:sub,badge:badge,right:tdAmt(r),go:"tracker",sel:r.p._id});
  };
  var paySec=function(label,arr,cls){
    if(!arr.length)return "";
    return "<div class='td-sec "+cls+"'><span>"+label+" &middot; "+arr.length+"</span><span>"+(sumUSD(arr)?tdUSD(sumUSD(arr)):"")+"</span></div>"+arr.map(payRow).join("");
  };
  /* per customer, largest first */
  var custTot={};
  money.forEach(function(r){var k=r.p.customer||"—";(custTot[k]=custTot[k]||{n:0,usd:0,over:0,country:r.p.country});custTot[k].n++;custTot[k].usd+=r.usd||0;if(r.state==="overdue")custTot[k].over+=r.usd||0;});
  var custHtml=Object.keys(custTot).sort(function(a,b){return custTot[b].usd-custTot[a].usd;}).map(function(k){
    var c=custTot[k];
    return "<button class='td-cust' onclick='"+tdAttr(tdGoAttr("custbase",typeof cbKey==="function"?cbKey(k):""))+"'>"+
      "<span>"+(c.country?trkFlag(c.country,14)+" ":"")+tdEsc(k)+" <span class='td-dim'>&middot; "+c.n+" project"+(c.n===1?"":"s")+"</span></span>"+
      "<span>"+(c.over?"<span class='td-over'>"+tdUSD(c.over)+" overdue</span> &middot; ":"")+"<b>"+(c.usd?tdUSD(c.usd):"&mdash;")+"</b></span></button>";
  }).join("");
  var moneyBody=money.length?
    "<div class='td-money-sum'>"+
      "<div class='td-ms td-ms-over'><b>"+tdUSD(sumUSD(by.overdue))+"</b><span>overdue &middot; "+by.overdue.length+"</span></div>"+
      "<div class='td-ms'><b>"+tdUSD(sumUSD(by.soon))+"</b><span>due in "+TD_SOON+" days &middot; "+by.soon.length+"</span></div>"+
      "<div class='td-ms'><b>"+tdUSD(sumUSD(by.noinv))+"</b><span>not invoiced yet &middot; "+by.noinv.length+"</span></div>"+
      "<div class='td-ms'><b>"+tdUSD(sumUSD(money))+"</b><span>owed in total</span></div>"+
    "</div>"+
    paySec("Overdue",by.overdue,"td-sec-over")+
    paySec("Due in the next "+TD_SOON+" days",by.soon,"td-sec-soon")+
    paySec("Invoiced, due later",by.later,"td-sec-later")+
    paySec("Won, not invoiced yet",by.noinv,"td-sec-wait")+
    (custHtml?"<details class='td-bycust'><summary>By customer</summary>"+custHtml+"</details>":"")+
    "<div class='td-note'>Due date = the project's Invoice timeline entry + its payment terms (read from the description, e.g. &ldquo;30 days after invoice&rdquo;; "+TD_DEFAULT_TERMS+" days when none is written). Add a &ldquo;Payment received&rdquo; entry to mark it paid. Amounts in USD equivalent.</div>"
    :"";

  /* quotes */
  var quotes=tdQuotes();
  var qRow=function(q){
    var badge=q.days<0?"<span class='trk-badge trk-stale trk-stale-hot'>Expired "+(-q.days)+"d ago</span>":
      "<span class='trk-badge trk-stale'>"+(q.days===0?"Expires today":"Expires in "+q.days+"d")+"</span>";
    return tdRow({name:q.name,cust:q.cust,country:q.country,sub:"valid till "+trkFmtDate(q.valid),badge:badge,go:q.go,sel:q.sel});
  };

  /* coming up: follow-ups in the next 7 days and payments due in 7 */
  var upPay=by.soon.filter(function(r){return r.days<=7;});

  var st=document.getElementById("stats");
  if(st)st.innerHTML=
    "<div class='stat'><div class='stat-label'>Follow up today</div><div class='stat-value'>"+due.length+"</div><div class='stat-sub'>"+(quiet.length?quiet.length+" more gone quiet":"planned follow-ups due")+"</div></div>"+
    "<div class='stat'><div class='stat-label'>Overdue payments</div><div class='stat-value'>"+(by.overdue.length?tdUSD(sumUSD(by.overdue)):"&mdash;")+"</div><div class='stat-sub'>"+by.overdue.length+" project"+(by.overdue.length===1?"":"s")+" past due</div></div>"+
    "<div class='stat'><div class='stat-label'>Money owed</div><div class='stat-value'>"+(money.length?tdUSD(sumUSD(money)):"&mdash;")+"</div><div class='stat-sub'>"+money.length+" won project"+(money.length===1?"":"s")+" not fully paid</div></div>"+
    "<div class='stat'><div class='stat-label'>Quotes expiring</div><div class='stat-value'>"+quotes.filter(function(q){return q.days>=0;}).length+"</div><div class='stat-sub'>in the next "+TD_QUOTE_WIN+" days</div></div>";

  var dateStr=new Date().toLocaleDateString(undefined,{weekday:"long",day:"numeric",month:"long"});
  content.innerHTML="<div class='td-date'>"+tdEsc(dateStr)+"</div><div class='td-grid'>"+
    "<div class='td-col'>"+
      tdCard("Follow up",due.length+quiet.length,
        (due.length?"<div class='td-sec td-sec-over'><span>Due &middot; "+due.length+"</span></div>"+due.map(fuRow).join(""):"")+
        (quiet.length?"<div class='td-sec td-sec-soon'><span>Gone quiet &middot; no update for "+TRK_STALE_DAYS+"+ days &middot; "+quiet.length+"</span></div>"+quiet.map(fuRow).join(""):""),
        "Nothing to follow up today. &#127881;")+
      tdCard("Coming up this week",soon.length+upPay.length,
        soon.map(fuRow).join("")+upPay.map(payRow).join(""),
        "No follow-ups or payments due in the next 7 days.")+
      tdCard("Quotes expiring",quotes.length,quotes.map(qRow).join(""),
        "No quotes expire in the next "+TD_QUOTE_WIN+" days. (Read from &ldquo;Prices valid till &hellip;&rdquo; in the quote notes.)")+
    "</div>"+
    "<div class='td-col'>"+
      tdCard("Money owed",money.length,moneyBody,"Every won project is fully paid. &#128176;","td-card-money")+
    "</div>"+
  "</div>";
}
