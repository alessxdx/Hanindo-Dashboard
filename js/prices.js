/* ============================================================
   PRICES — what we pay and what we charge, one row per item.
   Joins the old Buying Prices and Spare Parts pages. Nothing is
   stored here: costs stay in `buying_prices` (BUYING), customer
   prices in `spares` (SPARES), and the last price paid is read
   from the purchase orders. The two edit forms are the same ones.
   - rows are joined by part number (by name when there is none)
   - the saved cost follows the newest PO by itself (pxFollow); when that
     is not safe (pxFollowWhy) it stays and the item is marked "Check cost"
   ============================================================ */
var PX_SECS=["Printers","Spare parts","Accessories","Services"];
var PX_SEC="",PX_CHECK=false,PX_SORT="name",PX_OPEN={},PX_ITEMS=[],PX_PO_TRY=false;
/* a PO older than this says nothing about today's price */
var PX_PO_DAYS=365;

/* "915CG040200300 or 915CG060100300" -> both, letters and digits only */
function pxPns(s){
  return String(s||"").split("+")[0].split(/\bor\b|\//i).map(function(x){return x.replace(/[^a-z0-9]/gi,"").toLowerCase();}).filter(Boolean);
}
function pxUsd(v,cur){return typeof fxToUSD==="function"?fxToUSD(v,cur):(cur==="USD"?v:null);}
function pxMoney(v,cur){return poFmtMoney(v,cur)+" <span class='trk-r-cur'>"+trkEsc(cur)+"</span>";}
function pxSame(a,b){return Math.abs(a-b)<0.005;}

/* the section an item is listed under */
function pxSection(it){
  var txt=it.names.join(" ");
  if(!it.costs.length&&!it.pns.length&&/install|mainten|service|warranty|support|labou?r|training/i.test(txt))return "Services";
  if(/spare/i.test(it.group))return "Spare parts";
  if(/accessor/i.test(it.group))return "Accessories";
  if(it.pns.some(function(p){return /^91[15]/.test(p);}))return "Printers";
  if(/holder|tray|cable|power supply|plug|\bkit\b|paper roll/i.test(txt))return "Accessories";
  if(it.group||!it.costs.length)return "Spare parts";
  return it.pns.length?"Spare parts":"Printers";
}
/* several costs on one part number (KPM180: China / outside China):
   the shared name, and what tells each cost apart */
function pxNames(it){
  var base=it.costs.map(function(c){return c.b.model.replace(/\s*\([^)]*\)\s*$/,"").trim();});
  if(it.costs.length>1&&base.every(function(x){return x===base[0];})){
    it.name=base[0];
    it.costs.forEach(function(c){var m=/\(([^)]*)\)\s*$/.exec(c.b.model);c.label=m?m[1]:"";});
  }else if(it.costs.length>1){
    it.name=it.costs.map(function(c){return c.b.model;}).join(" / ");
    it.costs.forEach(function(c){c.label=c.b.model;});
  }else it.name=it.costs.length?it.costs[0].b.model:it.names[0];
  it.alt=it.names.filter(function(n){
    return n!==it.name&&!it.costs.some(function(c){return c.b.model===n;})&&it.name.toLowerCase().indexOf(n.toLowerCase())===-1;
  });
}
/* the price paid before the newest one: the latest earlier PO at a different
   price. Another region's cost or a customer's special price is not an
   earlier price, so those POs are skipped. */
function pxPrev(it){
  var L=it.last,best=null;
  if(!L)return null;
  var skip=function(x){
    return it.costs.some(function(c){
      if(c.b.currency!==x.p.currency)return false;
      return (it.costs.length>1&&pxSame(c.b.price,x.l.unitPrice))||(c.b.specialPrice&&pxSame(c.b.specialPrice,x.l.unitPrice));
    });
  };
  it.pos.forEach(function(x){
    if(x.p.date>=L.p.date||x.p.currency!==L.p.currency||pxSame(x.l.unitPrice,L.l.unitPrice)||skip(x))return;
    if(!best||x.p.date>best.p.date)best=x;
  });
  return best;
}
/* the latest price paid on a PO for any of the item's part numbers,
   counting the P/Ns the PO page joins as the same model (PO_SAME) */
function pxPos(it,byPn){
  var out=[];
  it.pns.forEach(function(pn){(byPn[pn]||[]).forEach(function(x){if(out.indexOf(x)===-1)out.push(x);});});
  return out;
}
function pxLast(it){
  var best=null;
  it.pos.forEach(function(x){if(!best||x.p.date>best.p.date)best=x;});
  return best;
}
function pxPoIndex(){
  var ids={},by={},same={};
  Object.keys(PO_SAME).forEach(function(k){pxPns(k).forEach(function(a){same[a]=pxPns(PO_SAME[k])[0];});});
  PO_LIST.forEach(function(p){if(p.date&&p.section!==PO_FIRE)ids[p._id]=p;});
  PO_LINES.forEach(function(l){
    var p=ids[l.poId];
    if(!p||!l.pn||!(l.unitPrice>0))return;
    var keys={};
    pxPns(l.pn).forEach(function(k){
      keys[k]=1;
      if(same[k])keys[same[k]]=1;
      Object.keys(same).forEach(function(o){if(same[o]===k)keys[o]=1;});
    });
    Object.keys(keys).forEach(function(k){(by[k]=by[k]||[]).push({p:p,l:l});});
  });
  return by;
}
function pxBuild(){
  var items=[],byPn={},byName={};
  function add(pns,name){
    var it={pns:pns.slice(),pnText:[],names:[],costs:[],sells:[],group:""};
    items.push(it);
    pns.forEach(function(p){byPn[p]=it;});
    return it;
  }
  function find(pns,name){
    for(var i=0;i<pns.length;i++)if(byPn[pns[i]])return byPn[pns[i]];
    /* a name only joins rows when one of them has no part number */
    var n=byName[pjNormName(name)];
    return n&&(!pns.length||!n.pns.length)?n:null;
  }
  function fill(it,pns,pnText,name){
    pns.forEach(function(p){if(it.pns.indexOf(p)===-1)it.pns.push(p);byPn[p]=byPn[p]||it;});
    if(pnText&&it.pnText.indexOf(pnText)===-1)it.pnText.push(pnText);
    if(it.names.indexOf(name)===-1)it.names.push(name);
    var k=pjNormName(name);if(k&&!byName[k])byName[k]=it;
  }
  BUYING.forEach(function(b,i){
    var pns=pxPns(b.pn),it=find(pns,b.model)||add(pns,b.model);
    fill(it,pns,b.pn,b.model);
    it.costs.push({b:b,i:i,usd:pxUsd(b.price,b.currency),label:""});
    if(b.group&&!it.group)it.group=b.group;
  });
  SPARES.forEach(function(s,i){
    var pns=pxPns(s.pn),it=find(pns,s.name)||add(pns,s.name);
    fill(it,pns,s.pn,s.name);
    it.sells.push({s:s,i:i,usd:pxUsd(s.price,s.currency)});
  });
  var idx=PO_LOADED?pxPoIndex():{};
  items.forEach(function(it){
    pxNames(it);
    it.key=it.pns.length?it.pns[0]:"n:"+it.name.toLowerCase();
    it.sec=pxSection(it);
    it.band=it.sec==="Spare parts"?(it.group||"Other Spare Parts"):it.sec;
    it.pos=pxPos(it,idx);
    it.last=pxLast(it);
    it.prev=pxPrev(it);
    it.check=false;
    if(it.last&&it.costs.length){
      var L=it.last,cur=L.p.currency;
      var comparable=it.costs.some(function(c){return c.b.currency===cur;});
      var known=it.costs.some(function(c){return c.b.currency===cur&&(pxSame(c.b.price,L.l.unitPrice)||(c.b.specialPrice&&pxSame(c.b.specialPrice,L.l.unitPrice)));});
      it.check=comparable&&!known&&trkDaysBetween(L.p.date,trkToday())<=PX_PO_DAYS;
    }
    it.sells.sort(function(a,b){return poAz(a.s.customer,b.s.customer);});
    it.sells.forEach(function(x){
      x.cost=pxCostFor(it,x.s.customer);
      x.margin=x.cost&&x.cost.usd!==null&&x.usd>0?Math.round((x.usd-x.cost.usd)/x.usd*100):null;
    });
    it.hay=[it.name,it.names.join(" "),it.pnText.join(" "),it.pns.join(" "),it.group,it.sec,
      it.costs.map(function(c){return c.b.specialCustomer||"";}).join(" "),
      it.sells.map(function(x){return [x.s.customer,x.s.terms,x.s.note].join(" ");}).join(" ")].join(" ").toLowerCase();
  });
  return items;
}
/* the cost a customer's margin is worked out from: its special price when
   there is one, else the highest cost on file (never flatters the margin),
   else the newest PO price when no cost was saved */
function pxCostFor(it,customer){
  var k=String(customer||"").trim().toLowerCase(),sp=null,top=null;
  it.costs.forEach(function(c){
    var u=c.usd;
    if(u!==null&&(!top||u>top.usd))top={usd:u};
    if(k&&c.b.specialPrice&&String(c.b.specialCustomer||"").trim().toLowerCase()===k)sp={usd:pxUsd(c.b.specialPrice,c.b.currency),special:true};
  });
  if(!top&&it.last){var lu=pxUsd(it.last.l.unitPrice,it.last.p.currency);if(lu!==null)top={usd:lu};}
  return sp||top;
}

/* ---------- page ---------- */
function pxPickSort(v){PX_SORT=v;renderPrices();}
function pxPickSec(v){
  if(v==="check"){PX_CHECK=!PX_CHECK;PX_SEC="";}
  else{PX_SEC=v;PX_CHECK=false;}
  renderPrices();
}
function pxToggle(n){var it=PX_ITEMS[n];if(!it)return;PX_OPEN[it.key]=!PX_OPEN[it.key];renderPrices(true);}
function pxKey(ev,n){if((ev.key==="Enter"||ev.key===" ")&&ev.target===ev.currentTarget){ev.preventDefault();pxToggle(n);}}

function pxIco(kind,title,fn){
  var path=kind==="edit"?'<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>':'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
  return "<button class='nt-ico"+(kind==="edit"?"":" nt-ico-del")+"' title='"+title+"' aria-label='"+title+"' onclick='"+fn+"'><svg viewBox='0 0 24 24' aria-hidden='true'>"+path+"</svg></button>";
}
/* the cost before the newest one; when the price never changed, the same price */
function pxPrevCell(it){
  if(it.prev)return "<div class='px-num'>"+pxMoney(it.prev.l.unitPrice,it.prev.p.currency)+"</div><div class='px-sub'>"+trkFmtDate(it.prev.p.date)+"</div>";
  if(it.pns.length&&!PO_LOADED&&!PO_MISSING)return "<span class='px-none'>&hellip;</span>";
  var now=it.last?pxMoney(it.last.l.unitPrice,it.last.p.currency):it.costs.length?pxMoney(it.costs[0].b.price,it.costs[0].b.currency):"";
  return now?"<div class='px-num px-prev-same'>"+now+"</div>":"<span class='px-none'>&mdash;</span>";
}
/* the newest cost, then the other prices on file (another region, a customer's special price) */
function pxLastCell(it){
  if(it.pns.length&&!PO_LOADED&&!PO_MISSING)return "<span class='px-none'>&hellip;</span>";
  if(!it.last&&!it.costs.length)return "<span class='px-none'>"+(it.sec==="Services"?"&mdash;":"no cost yet")+"</span>";
  var L=it.last,p=L?L.l.unitPrice:it.costs[0].b.price,cur=L?L.p.currency:it.costs[0].b.currency;
  var isNow=function(v,c){return c===cur&&pxSame(v,p);};
  var tag="",more="";
  it.costs.forEach(function(c,k){
    var b=c.b,who=trkEsc(b.specialCustomer||"special deal"),sp=b.specialPrice&&isNow(b.specialPrice,b.currency);
    if(sp)tag+="<div class='px-sub px-special'>for "+who+"</div>";
    if(isNow(b.price,b.currency)){if(c.label)tag+="<div class='px-sub'>"+trkEsc(c.label)+"</div>";}
    else if(!it.check&&(c.label||it.costs.some(function(o){return o.b.specialPrice&&isNow(o.b.specialPrice,o.b.currency);})))
      more+="<div class='px-sub'>"+pxMoney(b.price,b.currency)+" "+trkEsc(c.label||"normal price")+"</div>";
    if(b.specialPrice&&!sp)more+="<div class='px-sub px-special'>"+pxMoney(b.specialPrice,b.currency)+" for "+who+"</div>";
  });
  return "<div class='px-num"+(it.check?" px-warn":"")+"'>"+pxMoney(p,cur)+"</div>"+tag+
    "<div class='px-sub'>"+(L?trkFmtDate(L.p.date):"no PO yet")+"</div>"+more+
    (it.check?"<div class='px-flag'>Saved cost is "+it.costs.map(function(c){return poFmtMoney(c.b.price,c.b.currency);}).join(" / ")+"</div>":"");
}
function pxSellCell(it){
  var n=it.sells.length;
  if(!n)return "<span class='px-none'>&mdash;</span>";
  if(n===1){var x=it.sells[0];return "<div class='px-num'>"+pxMoney(x.s.price,x.s.currency)+"</div><div class='px-sub'>"+trkEsc(x.s.customer||"any customer")+"</div>";}
  var same=it.sells.every(function(x){return x.s.currency===it.sells[0].s.currency;});
  var val=function(x){return same?x.s.price:x.usd;};
  var vals=it.sells.map(val).filter(function(v){return v!==null;}),lo=Math.min.apply(null,vals),hi=Math.max.apply(null,vals),cur=same?it.sells[0].s.currency:"USD";
  var r=function(v){return poFmtMoney(same?v:Math.round(v),cur);};
  return "<div class='px-num'>"+(same?"":"&asymp; ")+(pxSame(lo,hi)?r(lo):r(lo)+" &ndash; "+r(hi))+" <span class='trk-r-cur'>"+cur+"</span></div><div class='px-sub'>"+n+" customer prices</div>";
}
function pxMarginCell(it){
  var m=it.sells.map(function(x){return x.margin;}).filter(function(v){return v!==null;});
  if(!m.length)return "<span class='px-none'>&mdash;</span>";
  var lo=Math.min.apply(null,m),hi=Math.max.apply(null,m);
  return "<div class='px-num"+(lo<0?" px-neg":"")+"'>"+(lo===hi?lo+"%":lo+"&ndash;"+hi+"%")+"</div>";
}
var PX_DELIVERED=/^(DDP|DAP|CIF|CIP|CPT|DDU)$/i;
function pxDetail(it,n){
  var h="";
  h+="<div class='px-d-sec'><div class='px-d-head'><span>Cost</span></div>";
  if(it.costs.length)h+=it.costs.map(function(c){
    return "<div class='px-d-row'><span class='px-d-main'>"+trkEsc(c.b.model)+(c.b.pn?"<span class='px-sub'>"+trkEsc(c.b.pn)+"</span>":"")+"</span>"+
      "<span class='px-d-val'>"+pxMoney(c.b.price,c.b.currency)+(c.b.specialPrice?"<span class='px-sub px-special'>"+pxMoney(c.b.specialPrice,c.b.currency)+" for "+trkEsc(c.b.specialCustomer||"special deal")+"</span>":"")+"</span>"+
      "<span class='nt-acts'>"+pxIco("edit","Edit cost","editBuying("+c.i+")")+pxIco("trash","Remove cost","sbDeleteBuying("+c.i+")")+"</span></div>";
  }).join("");
  else h+="<div class='px-d-none'>No cost saved. <button class='px-link' onclick='pxAddCost("+n+")'>Add the cost</button></div>";
  if(it.last){
    var L=it.last;
    h+="<div class='px-d-row'><span class='px-d-main'>Last PO<span class='px-sub'><button class='px-link' onclick='pxOpenPo("+n+")'>"+trkEsc(L.p.poNumber||"Open PO")+"</button> &middot; "+trkFmtDate(L.p.date)+(L.p.office?" &middot; "+trkEsc(L.p.office):"")+" &middot; "+L.l.qty.toLocaleString()+" "+trkEsc(L.l.unit||"pcs")+"</span></span>"+
      "<span class='px-d-val"+(it.check?" px-warn":"")+"'>"+pxMoney(L.l.unitPrice,L.p.currency)+"</span><span class='nt-acts'></span></div>";
    if(it.prev){
      var P=it.prev;
      h+="<div class='px-d-row'><span class='px-d-main'>Previous cost<span class='px-sub'><button class='px-link' onclick='pxOpenPo("+n+",true)'>"+trkEsc(P.p.poNumber||"Open PO")+"</button> &middot; "+trkFmtDate(P.p.date)+(P.p.office?" &middot; "+trkEsc(P.p.office):"")+" &middot; "+P.l.qty.toLocaleString()+" "+trkEsc(P.l.unit||"pcs")+"</span></span>"+
        "<span class='px-d-val'>"+pxMoney(P.l.unitPrice,P.p.currency)+"</span><span class='nt-acts'></span></div>";
    }
    if(it.check)h+="<div class='px-d-warn'>The last PO paid a different price than the saved cost"+(pxFollowWhy(it)?" (not changed by itself: "+pxFollowWhy(it)+")":"")+". "+
      (it.costs.length===1?"<button class='px-link' onclick='pxUseLast("+n+")'>Use "+poFmtMoney(L.l.unitPrice,L.p.currency)+" as the cost</button>":"Use the pencil to change the cost it belongs to.")+"</div>";
  }
  h+="</div><div class='px-d-sec'><div class='px-d-head'><span>Customer prices</span><button class='px-link' onclick='pxAddSell("+n+")'>+ Customer price</button></div>";
  if(it.sells.length)h+=it.sells.map(function(x){
    var s=x.s,usd=s.currency!=="USD"?fxUsdText(s.price,s.currency):"";
    var sub=[s.terms?trkEsc(s.terms):"",s.name!==it.name?trkEsc(s.name):"",s.note?trkEsc(s.note):""].filter(Boolean).join(" &middot; ");
    var m=x.margin===null?"":"<span class='px-sub"+(x.margin<0?" px-neg":"")+"'>margin "+x.margin+"%"+(PX_DELIVERED.test(s.terms)?" before delivery":"")+(x.cost.special?" (special cost)":"")+"</span>";
    return "<div class='px-d-row'><span class='px-d-main'>"+trkEsc(s.customer||"Any customer")+(sub?"<span class='px-sub'>"+sub+"</span>":"")+"</span>"+
      "<span class='px-d-val'>"+pxMoney(s.price,s.currency)+(usd?"<span class='px-sub'>"+usd+"</span>":"")+m+"</span>"+
      "<span class='nt-acts'>"+pxIco("edit","Edit price","editSpare("+x.i+")")+pxIco("trash","Remove price","deleteSpare("+x.i+")")+"</span></div>";
  }).join("");
  else h+="<div class='px-d-none'>No customer price saved.</div>";
  return h+"</div>";
}
function pxLowCost(it){var v=it.costs.map(function(c){return c.usd;}).filter(function(u){return u!==null;});return v.length?Math.min.apply(null,v):it.last?pxUsd(it.last.l.unitPrice,it.last.p.currency):null;}

function renderPrices(bodyOnly){
  pgHideStats();
  if(!PO_LOADED&&!PX_PO_TRY){
    PX_PO_TRY=true;
    poLoad().then(function(){if(currentTab==="prices")renderPrices(true);}).catch(function(){});
  }
  PX_ITEMS=pxBuild();
  var old=document.getElementById("px-search"),q=old?old.value:"";
  var words=q.toLowerCase().split(/\s+/).filter(Boolean);
  var found=PX_ITEMS.filter(function(it){return words.every(function(w){return it.hay.indexOf(w)>-1;});});
  var nCheck=found.filter(function(it){return it.check;}).length;
  /* nothing left to check (the last one was just accepted): show all again */
  if(PX_CHECK&&!PX_ITEMS.some(function(it){return it.check;})&&PO_LOADED)PX_CHECK=false;
  var list=found.filter(function(it){return PX_CHECK?it.check:(!PX_SEC||it.sec===PX_SEC);});
  var flat=PX_SORT!=="name";
  list.sort(function(a,b){
    if(flat){
      var x=pxLowCost(a),y=pxLowCost(b);
      if(x===null||y===null){if(x!==y)return x===null?1:-1;}
      else if(x!==y)return PX_SORT==="low"?x-y:y-x;
    }
    return poAz(a.name,b.name);
  });
  function row(it){
    var n=PX_ITEMS.indexOf(it),open=!!PX_OPEN[it.key];
    return "<tr class='px-row"+(open?" open":"")+"' tabindex='0' aria-expanded='"+open+"' onclick='pxToggle("+n+")' onkeydown='pxKey(event,"+n+")'>"+
      "<td class='px-c-name'><div class='buy-name'>"+trkEsc(it.name)+"</div>"+(it.pnText.length?"<div class='buy-pn'>"+trkEsc(it.pnText.join(", "))+"</div>":"")+
        (it.alt.length?"<div class='px-sub'>also "+trkEsc(it.alt.join(", "))+"</div>":"")+"</td>"+
      "<td class='num' data-label='Previous cost'>"+pxPrevCell(it)+"</td>"+
      "<td class='num' data-label='Last PO'>"+pxLastCell(it)+"</td>"+
      "<td class='num' data-label='Selling price'>"+pxSellCell(it)+"</td>"+
      "<td class='num' data-label='Margin'>"+pxMarginCell(it)+"</td>"+
      "<td class='px-c-go' aria-hidden='true'><span>&rsaquo;</span></td></tr>"+
      (open?"<tr class='px-detail'><td colspan='6'>"+pxDetail(it,n)+"</td></tr>":"");
  }
  var band=function(name,n){return "<tr class='buy-band2'><td colspan='6'><span class='buy-band2-name'>"+trkEsc(name)+"</span><span class='buy-band2-n'>"+n+" item"+(n===1?"":"s")+"</span></td></tr>";};
  var rows="";
  if(flat)rows=list.map(row).join("");
  else PX_SECS.forEach(function(sec){
    var by={};
    list.forEach(function(it){if(it.sec===sec)(by[it.band]=by[it.band]||[]).push(it);});
    var other=function(b){return /^other/i.test(b)?1:0;};
    Object.keys(by).sort(function(a,b){return other(a)-other(b)||poAz(a,b);}).forEach(function(b){rows+=band(b,by[b].length)+by[b].map(row).join("");});
  });
  if(!rows)rows="<tr><td colspan='6' class='empty'>"+(words.length?"Nothing matches that search.":"No prices yet.")+"</td></tr>";
  var chip=function(v,label,n,on,cls){return "<button class='trk-chip"+(cls||"")+(on?" active":"")+"' aria-pressed='"+on+"' onclick='pxPickSec(\""+v+"\")'>"+label+" <span class='trk-chip-n'>"+n+"</span></button>";};
  var chips=chip("","All",found.length,!PX_SEC&&!PX_CHECK)+
    PX_SECS.map(function(s){return chip(s,s,found.filter(function(it){return it.sec===s;}).length,PX_SEC===s&&!PX_CHECK);}).join("")+
    (nCheck||PX_CHECK?chip("check","Check cost",nCheck,PX_CHECK," trk-chip-stale"):"");
  var tbody=document.getElementById("px-tbody");
  if(bodyOnly&&tbody){
    tbody.innerHTML=rows;
    document.getElementById("px-chips").innerHTML=chips;
    return;
  }
  var grps=BUYING.map(function(b){return b.group;}).filter(Boolean).filter(function(g,i,a){return a.indexOf(g)===i;}).sort();
  var bgl=document.getElementById("b-group-list");
  if(bgl)bgl.innerHTML=grps.map(function(g){return "<option value='"+trkEsc(g)+"'>";}).join("");
  var sortMenu=uiDropdown({key:"px-sort",onPick:"pxPickSort",cur:PX_SORT,opts:[
    {value:"name",label:"Grouped, A–Z"},{value:"low",label:"Cost: low to high"},{value:"high",label:"Cost: high to low"}]});
  document.getElementById("content").innerHTML=
    "<div class='trk-bar buy-bar'>"+
      "<div class='trk-search'><span class='trk-search-ico'>&#128269;</span><input id='px-search' type='search' placeholder='Search item, part number or customer&hellip;' oninput='renderPrices(true)' value='"+trkEsc(q)+"' autocomplete='off'></div>"+
      sortMenu+
      "<button class='edit-btn px-add' onclick='pxAddSell(-1)'>+ Customer price</button>"+
    "</div>"+
    "<div class='trk-chips px-chips' id='px-chips'>"+chips+"</div>"+
    "<div class='po-table-wrap buy-table'><table class='po-table buy-list buy-simple px-list'><thead><tr><th>Item</th><th class='num'>Previous cost</th><th class='num'>Last PO</th><th class='num'>Selling price</th><th class='num'>Margin</th><th></th></tr></thead>"+
    "<tbody id='px-tbody'>"+rows+"</tbody></table></div>"+
    "<div class='px-note'>Previous cost = the last PO price before the newest one; in grey when it never changed. The saved cost follows the newest PO. Margin = (selling price &minus; cost) &divide; selling price, in USD at today's rate. With several costs the highest one is used. Delivery and duty are not taken off.</div>";
  var inp=document.getElementById("px-search");
  /* not on touch screens: focusing would pop the keyboard up on every visit */
  if(inp&&!matchMedia("(pointer:coarse)").matches){inp.focus();inp.setSelectionRange(inp.value.length,inp.value.length);}
}

/* ---------- actions ---------- */
function pxOpenPo(n,prev){var it=PX_ITEMS[n],x=it&&(prev?it.prev:it.last);if(x)poOpenSheet(x.p._id);}
/* the add-cost form, filled with the item's name and part number */
function pxAddCost(n){
  var it=n>-1?PX_ITEMS[n]:null;
  closeBuyingModal();
  document.getElementById("modal-buying").removeAttribute("data-edit-idx");
  if(it){
    document.getElementById("b-model").value=it.name;
    document.getElementById("b-pn").value=it.pnText[0]||"";
  }
  document.getElementById("modal-buying").classList.add("open");
}
function pxAddSell(n){
  var it=n>-1?PX_ITEMS[n]:null;
  closeSpareModal();
  var names=SPARES.map(function(s){return s.customer;}).concat(typeof allDealCustomers==="function"?allDealCustomers():[]);
  var seen={};names=names.filter(function(c){var k=String(c||"").toLowerCase();if(!k||seen[k])return false;seen[k]=1;return true;}).sort(poAz);
  var dl=document.getElementById("sp-customer-list");
  if(dl)dl.innerHTML=names.map(function(c){return "<option value='"+trkEsc(c)+"'>";}).join("");
  if(it){
    document.getElementById("sp-name").value=it.name;
    document.getElementById("sp-pn").value=it.pnText[0]||"";
  }
  document.getElementById("modal-spares").classList.add("open");
}
/* ---------- the cost follows the newest PO ---------- */
/* why an item's cost must not change by itself ("" = it may) */
function pxFollowWhy(it){
  var L=it.last;
  if(!L||!it.costs.length)return "no PO";
  if(it.costs.length>1)return "it has more than one cost";
  var b=it.costs[0].b;
  if(b.specialPrice)return "it has a special price for "+trkEsc(b.specialCustomer||"a customer");
  if(L.p.date>trkToday())return "the PO date is in the future";
  if(it.pos.some(function(x){return x.p.date===L.p.date&&(x.p.currency!==L.p.currency||!pxSame(x.l.unitPrice,L.l.unitPrice));}))return "POs on the same day paid different prices";
  if(L.l.unitPrice>b.price*1.5||L.l.unitPrice<b.price*0.5)return "the price moved by more than half, please check it";
  return "";
}
/* newest PO price per item, taken before a PO is saved or deleted */
function pxSnap(){
  var m={};
  /* never let this stop a PO from being saved */
  try{if(PO_LOADED)pxBuild().forEach(function(it){m[it.key]=it.last?it.last.l.unitPrice+it.last.p.currency:"";});}catch(e){console.error(e);return null;}
  return m;
}
/* with a snapshot: items whose newest PO price just changed. Always: items
   still saved at an earlier PO's price (a PO added elsewhere). A cost typed
   in by hand that no PO has is left alone and only marked "Check cost". */
var PX_FOLLOWING=false;
async function pxFollow(before){
  /* 1000 rows is the most the database hands over: beyond that the newest
     lines could be missing, so nothing is changed */
  if(PX_FOLLOWING||!sbSignedIn()||!PO_LOADED||PO_LINES.length>=1000)return;
  PX_FOLLOWING=true;
  var done=[];
  try{
    var todo=pxBuild().filter(function(it){
      if(!it.check||!it.costs[0].b._id||pxFollowWhy(it))return false;
      var b=it.costs[0].b,L=it.last;
      if(before&&before[it.key]!==L.l.unitPrice+L.p.currency)return true;
      return it.pos.some(function(x){return x.p.date<L.p.date&&x.p.currency===b.currency&&pxSame(x.l.unitPrice,b.price);});
    });
    for(var i=0;i<todo.length;i++){
      var b=todo[i].costs[0].b,v=todo[i].last.l.unitPrice,was=b.price;
      /* only if the saved price is still the one we looked at */
      var r=await fetch(SB_URL+"/rest/v1/buying_prices?id=eq."+b._id+"&price=eq."+was,{method:"PATCH",headers:sbH(),body:JSON.stringify({price:v})});
      var got=r.ok?await r.json():[];
      if(!got.length)continue;
      b.price=v;
      done.push(b.model+" "+poFmtMoney(was,b.currency)+" → "+poFmtMoney(v,b.currency));
    }
  }catch(e){console.error("cost follow:",e);}
  PX_FOLLOWING=false;
  if(!done.length)return;
  if(currentTab==="prices")renderPrices(true);
  var t=document.getElementById("undo-toast");if(t)t.remove();
  t=document.createElement("div");t.id="undo-toast";t.className="undo-toast";
  t.setAttribute("role","status");
  t.textContent="Cost updated from the newest PO: "+done.join(", ");
  document.body.appendChild(t);
  setTimeout(function(){if(t.parentNode)t.remove();},9000);
}
/* once after the data has loaded: POs are fetched in the background */
function pxFollowOnLoad(){
  if(!sbSignedIn())return;
  poLoad().then(function(ok){if(ok)return pxFollow();}).catch(function(){});
}
/* accept the last PO's price as the cost on file */
async function pxUseLast(n){
  var it=PX_ITEMS[n];
  if(!it||!it.last||it.costs.length!==1)return;
  var b=it.costs[0].b,v=it.last.l.unitPrice,cur=it.last.p.currency;
  if(!confirm("Change the cost of "+b.model+" from "+poFmtMoney(b.price,b.currency)+" to "+poFmtMoney(v,cur)+"?"))return;
  var up=Object.assign({},b,{price:v,currency:cur});
  showLoad("Saving...");
  try{
    var r=await fetch(SB_URL+"/rest/v1/buying_prices?id=eq."+b._id,{method:"PATCH",headers:sbH(),body:JSON.stringify(bToDb(up))});
    if(!r.ok)throw new Error("HTTP "+r.status);
    var got=await r.json();
    if(!got.length)throw new Error("nothing was saved");
    BUYING[it.costs[0].i]=up;
  }catch(e){hideLoad();alert("The cost was not changed: "+e.message);return;}
  hideLoad();
  renderPrices(true);
}
