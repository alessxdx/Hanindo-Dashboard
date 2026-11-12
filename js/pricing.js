/* ============================================================
   PRICING CALCULATOR
   Selling prices from our buying cost, by order-quantity tier and
   customer type. Replaces the per-product Excel sheets (D4X.xlsx,
   "TK180 - vietnam.xlsx") with one set of shared rules:

     COGS  = buying cost × cost multiplier + add-on per unit
     price = ROUNDUP(COGS × (1 + markup), 0)      (Excel ROUNDUP)

   Rules are "profiles" in the pricing_profiles table (one row each:
   tiers + customer types as jsonb). A product picks its profile by
   keyword (first match in sort order, the keyword-less profile is
   the fallback). Everything is USD.

   Views: Calculator (one product + qty, plus what real customers
   paid for it), Price list (every sheet item), Rules.
   ============================================================ */

var PR_PROFILES=[];
var PR_LOADED=false,PR_MISSING=false;
var PR_VIEW="calc";            /* "calc" | "list" | "rules" */
var PR_DRAFT={};               /* rules editor: id -> edited copy */
var PR_LIST_Q="",PR_LIST_TYPE="";

/* Defaults = the formulas in the two Excel sheets. TK180's two
   add-on rows (30+30 / 25+25 / 15+15) are folded into one figure. */
var PR_STD_TYPES=[{name:"End user",markups:[1,0.6,0.6]},{name:"Dealer",markups:[0.6,0.35,0.35]}];
var PR_DEFAULTS=[
  {name:"TK180 accessories (TK180 - vietnam.xlsx)",match:"roll holder",sortOrder:1,
   tiers:[{min:1,mult:1.2,addon:0},{min:10,mult:1.2,addon:0},{min:100,mult:1.2,addon:0}],types:PR_STD_TYPES},
  {name:"TK180 printers (TK180 - vietnam.xlsx)",match:"tk180",sortOrder:2,
   tiers:[{min:1,mult:1.2,addon:60},{min:10,mult:1.2,addon:50},{min:100,mult:1.18,addon:30}],types:PR_STD_TYPES},
  {name:"D4X (D4X.xlsx)",match:"",sortOrder:3,
   tiers:[{min:1,mult:1.2,addon:30},{min:10,mult:1.2,addon:25},{min:100,mult:1.18,addon:20}],types:PR_STD_TYPES}
];

/* For now the calculator covers ONLY the products in the two Excel
   sheets the user supplied (not the whole Buying Prices list). Buying
   cost is worked out exactly as the sheet does: special price if the
   sheet has one, else list price × (1 − discount). `match` = default
   words for the "What customers paid" lookup. */
var PR_SHEETS=[
  {file:"D4X.xlsx",url:"pricing/D4X.xlsx"},
  {file:"TK180 - vietnam.xlsx",url:"pricing/TK180-vietnam.xlsx"}
];
var PR_ITEMS=[
  {sheet:"D4X.xlsx",model:"LABEL PRINTER D4X ETH USB",pn:"911PZ010100J33",list:276,disc:54,match:"d4x -bluetooth"},
  {sheet:"D4X.xlsx",model:"LABEL PRINTER D4X ETH USB BLUETOOTH",pn:"911PZ010200J33",list:348,disc:54,match:"d4x bluetooth"},
  {sheet:"TK180 - vietnam.xlsx",model:"PRINTER TK180 METAL ETH USB RS232 CUTTER",pn:"911HL011300733",special:394,match:"tk180 metal cutter -non"},
  {sheet:"TK180 - vietnam.xlsx",model:"PRINTER TK180 ETH USB RS232 AVIATION (Plastic casing)",pn:"911HL020900733",special:287.59,match:"tk180 plastic -non"},
  {sheet:"TK180 - vietnam.xlsx",model:"PRINTER TK180 METAL USB RS232 AVIATION NON-CUTTER",pn:"911HL010400733",special:300,match:"tk180 metal non cutter"},
  {sheet:"TK180 - vietnam.xlsx",model:"ROLL HOLDER KIT FOR TK180 METAL",pn:"974HL010000009",list:103,disc:55,match:"roll holder metal -plastic"},
  {sheet:"TK180 - vietnam.xlsx",model:"ROLL HOLDER KIT FOR TK180 PLASTIC",pn:"974HL020000004",special:46.8,match:"roll holder plastic"}
];
function prItemCost(b){return b.special!==undefined?b.special:b.list*(1-b.disc/100);}
function prItemCostNote(b){
  return b.special!==undefined?"special price ("+b.sheet+")":prMoney(b.list)+" price list − "+b.disc+"% ("+b.sheet+")";
}
function prSheetUrl(s){return SB_URL+"/storage/v1/object/public/documents/"+s.url;}

/* Calculator selection — a per-viewer convenience, kept in localStorage */
var PR_SEL={product:"",qty:1,type:0,profile:"",cost:"",match:null,test:""};
try{var _prs=JSON.parse(localStorage.getItem("cpd_pricing")||"null");if(_prs)PR_SEL=Object.assign(PR_SEL,_prs);}catch(e){}
function prSaveSel(){try{localStorage.setItem("cpd_pricing",JSON.stringify(PR_SEL));}catch(e){}}

function prEsc(s){return String(s===null||s===undefined?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function prClone(o){return JSON.parse(JSON.stringify(o));}

/* ===== db ===== */
function dbToPr(r){return{_id:r.id,name:r.name||"",match:r.match||"",sortOrder:Number(r.sort_order)||0,
  tiers:Array.isArray(r.tiers)?r.tiers:[],types:Array.isArray(r.types)?r.types:[]};}
function prToDb(p){return{name:p.name,match:p.match||"",sort_order:p.sortOrder||0,tiers:p.tiers,types:p.types};}

async function prLoad(force){
  if(PR_LOADED&&!force)return;
  var rows=await sbGet("pricing_profiles");
  if(!rows){
    /* table not created yet — work from the built-in rules, read-only */
    PR_MISSING=true;
    PR_PROFILES=PR_DEFAULTS.map(function(p,i){var c=prClone(p);c._id="default-"+i;return c;});
  }else{
    PR_MISSING=false;
    if(!rows.length){
      for(var i=0;i<PR_DEFAULTS.length;i++){
        var r=await sbInsert("pricing_profiles",prToDb(PR_DEFAULTS[i]));
        if(r&&r[0])rows.push(r[0]);
      }
    }
    PR_PROFILES=rows.map(dbToPr);
  }
  prSortProfiles();
  PR_LOADED=true;
}
function prSortProfiles(){PR_PROFILES.sort(function(a,b){return (a.sortOrder-b.sortOrder)||a.name.localeCompare(b.name);});}

/* ===== maths ===== */
/* Excel ROUNDUP(x,0). Trim float noise first: 420×1.6 is
   672.0000000000001 in JS and must stay 672, not become 673. */
function prRoundUp(x){return Math.ceil(Math.round(x*1e6)/1e6);}
function prCogs(cost,tier){return cost*(Number(tier.mult)||0)+(Number(tier.addon)||0);}
function prPrice(cogs,markup){return prRoundUp(cogs*(1+(Number(markup)||0)));}
function prTierIndex(profile,qty){
  var idx=0;
  profile.tiers.forEach(function(t,i){if(qty>=(Number(t.min)||0))idx=i;});
  return idx;
}
function prTierLabel(profile,i){
  var t=profile.tiers[i],next=profile.tiers[i+1];
  var min=Number(t.min)||1;
  if(!next)return min+"+ units";
  var max=(Number(next.min)||0)-1;
  return (max<=min?min:min+"–"+max)+" units";
}
function prMarginPct(price,cogs){return price>0?(price-cogs)/price*100:0;}
/* markup → margin, the conversion people trip over */
function prMarkupToMargin(m){m=Number(m)||0;return m>-1?m/(1+m)*100:0;}

function prMoney(v,dp){
  if(v===null||v===undefined||isNaN(v))return "—";
  var d=(dp===undefined)?(Math.abs(v%1)>1e-9?2:0):dp;
  var s=Math.abs(v).toLocaleString("en-US",{minimumFractionDigits:d,maximumFractionDigits:d});
  return (v<0?"−$":"$")+s;
}
function prPct(v){return (Math.round(v*10)/10).toFixed(1)+"%";}

/* ===== products (the two Excel sheets only) ===== */
function prProducts(){return PR_ITEMS;}
function prFindProduct(name){return PR_ITEMS.find(function(b){return b.model===name;})||null;}
function prAutoProfile(text){
  var hay=String(text||"").toLowerCase(),fallback=null;
  for(var i=0;i<PR_PROFILES.length;i++){
    var p=PR_PROFILES[i];
    var kws=String(p.match||"").split(",").map(function(k){return k.trim().toLowerCase();}).filter(Boolean);
    if(!kws.length){if(!fallback)fallback=p;continue;}
    if(kws.some(function(k){return hay.indexOf(k)!==-1;}))return p;
  }
  return fallback||PR_PROFILES[0]||null;
}
function prProductProfile(b){return prAutoProfile(b?b.model:"");}

/* The calculator's current product, buying cost and profile */
function prCurrent(){
  /* a saved pick that is no longer in the sheets falls back to the first item */
  if(!prFindProduct(PR_SEL.product)&&PR_ITEMS.length){PR_SEL.product=PR_ITEMS[0].model;PR_SEL.match=null;PR_SEL.cost="";}
  var b=prFindProduct(PR_SEL.product);
  var baseCost=b?prItemCost(b):null,costNote=b?prItemCostNote(b):"";
  var ov=parseFloat(PR_SEL.cost);
  var cost=!isNaN(ov)?ov:baseCost;
  if(!isNaN(ov))costNote="entered manually";
  var profile=null;
  if(PR_SEL.profile)profile=PR_PROFILES.find(function(p){return p._id===PR_SEL.profile;})||null;
  if(!profile)profile=prProductProfile(b);
  return{b:b,name:b?b.model:"",cost:cost,baseCost:baseCost,costNote:costNote,profile:profile,pn:b?b.pn:"",match:b?b.match:""};
}

/* ===== shell ===== */
function prSyncToolbar(){
  var btn=document.querySelector("#toolbar .btn-add");
  if(btn&&currentTab==="pricing")btn.style.display="none";
}
/* The source Excel files, previewed with the tracker's in-app viewer */
function prSheetsHtml(){
  return "<div class='pr-sheets'><span class='pr-sheets-l'>Reference sheets</span>"+
    PR_SHEETS.map(function(s){
      return "<a class='pr-sheet' href=\""+prEsc(prSheetUrl(s))+"\" data-name=\""+prEsc(s.file)+"\" onclick='return trkViewFile(this)'>"+
        "<svg viewBox='0 0 24 24' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'/><polyline points='14 2 14 8 20 8'/><line x1='8' y1='13' x2='16' y2='13'/><line x1='8' y1='17' x2='16' y2='17'/><line x1='12' y1='11' x2='12' y2='19'/></svg>"+
        prEsc(s.file)+"</a>";
    }).join("")+"</div>";
}
function renderPricing(){
  var content=document.getElementById("content");
  prSyncToolbar();
  var st=document.getElementById("stats");if(st)st.innerHTML="";
  if(!PR_LOADED){
    content.innerHTML="<div class='empty'>Loading pricing rules&hellip;</div>";
    prLoad().then(function(){if(currentTab==="pricing")renderPricing();})
      .catch(function(e){console.error(e);content.innerHTML="<div class='empty'>Could not load pricing rules.</div>";});
    return;
  }
  var chips="<div class='trk-toolbar'><div class='trk-chips'>"+
    [["calc","Calculator"],["list","Price list"],["rules","Pricing rules"]].map(function(v){
      return "<button class='trk-chip"+(PR_VIEW===v[0]?" active":"")+"' onclick='prSetView(\""+v[0]+"\")'>"+v[1]+"</button>";
    }).join("")+"</div>"+prSheetsHtml()+"</div>";
  var banner=PR_MISSING?"<div class='pr-banner'>Using the built-in rules from your Excel sheets. To edit and save rules for the whole team, run <b>pricing-setup.sql</b> once in the Supabase SQL editor, then reload.</div>":"";
  var body=PR_VIEW==="list"?prListHtml():PR_VIEW==="rules"?prRulesHtml():prCalcHtml();
  content.innerHTML="<div class='pr-wrap'>"+chips+banner+body+"</div>";
  if(PR_VIEW==="calc")prUpdateCalc();
}
function prSetView(v){PR_VIEW=v;renderPricing();}

/* ===== calculator ===== */
function prProductOptions(sel){
  var out="<option value=''>— Select a product —</option>",lastGroup=null;
  prProducts().forEach(function(b){
    if(b.sheet!==lastGroup){if(lastGroup!==null)out+="</optgroup>";out+="<optgroup label='"+prEsc(b.sheet)+"'>";lastGroup=b.sheet;}
    out+="<option value=\""+prEsc(b.model)+"\""+(b.model===sel?" selected":"")+">"+prEsc(b.model)+"</option>";
  });
  if(lastGroup!==null)out+="</optgroup>";
  return out;
}
function prCalcHtml(){
  var c=prCurrent();
  var profOpts="<option value=''>Auto"+(c.profile&&!PR_SEL.profile?" — "+prEsc(c.profile.name):"")+"</option>"+
    PR_PROFILES.map(function(p){return "<option value='"+prEsc(p._id)+"'"+(PR_SEL.profile===p._id?" selected":"")+">"+prEsc(p.name)+"</option>";}).join("");
  var hasProduct=!!c.b;
  var inputs=
    "<div class='pr-card pr-inputs'>"+
      "<div class='pr-field'><label>Product</label><select id='pr-product' onchange='prPickProduct(this.value)'>"+prProductOptions(PR_SEL.product)+"</select></div>"+
      (hasProduct?
      "<div class='pr-field'><label>Buying cost per unit (USD)</label><input id='pr-cost' type='number' step='any' value=\""+prEsc(PR_SEL.cost)+"\" placeholder=\""+(c.baseCost!==null?prEsc(Math.round(c.baseCost*100)/100):"")+"\" oninput='prInput(\"cost\",this.value)'>"+
        "<span class='pr-hint' id='pr-cost-note'></span></div>"+
      "<div class='pr-field'><label>Pricing rule</label><select onchange='PR_SEL.profile=this.value;prSaveSel();renderPricing()'>"+profOpts+"</select></div>"+
      "<div class='pr-row2'>"+
        "<div class='pr-field'><label>Customer quantity</label><input id='pr-qty' type='number' min='1' step='1' value=\""+prEsc(PR_SEL.qty)+"\" oninput='prInput(\"qty\",this.value)'></div>"+
        "<div class='pr-field'><label>Test a price <span class='pr-opt'>(optional)</span></label><input type='number' step='any' value=\""+prEsc(PR_SEL.test)+"\" placeholder='e.g. 260' oninput='prInput(\"test\",this.value)'></div>"+
      "</div>"+
      "<div class='pr-field'><label>Customer type</label><div class='pr-seg' id='pr-types'></div></div>":"")+
    "</div>";
  if(!hasProduct){
    return "<div class='pr-calc'>"+inputs+"<div class='pr-card pr-result'><div class='empty'>Pick a product to see its selling prices.<br><span style='font-size:12px'>Products and buying costs come from the two reference Excel sheets (D4X and TK180 Vietnam).</span></div></div></div>";
  }
  return "<div class='pr-calc'>"+inputs+"<div class='pr-card pr-result' id='pr-result'></div></div>"+
    "<div class='pr-card pr-cmp' id='pr-cmp'></div>";
}
function prPickProduct(v){
  PR_SEL.product=v;PR_SEL.cost="";PR_SEL.profile="";PR_SEL.match=null;
  prSaveSel();renderPricing();
}
/* Typing only refreshes the result panels, so inputs keep focus */
function prInput(field,val){
  PR_SEL[field]=val;prSaveSel();
  prUpdateCalc();
}
function prSetType(i){PR_SEL.type=i;prSaveSel();prUpdateCalc();}

function prUpdateCalc(){
  var res=document.getElementById("pr-result");
  if(!res)return;
  var c=prCurrent(),p=c.profile;
  var note=document.getElementById("pr-cost-note");
  if(note)note.textContent=c.cost!==null?prMoney(c.cost,2)+" · "+c.costNote:"";
  if(!p||!p.tiers.length){res.innerHTML="<div class='empty'>No pricing rule available.</div>";return;}
  if(PR_SEL.type>=p.types.length)PR_SEL.type=0;
  var seg=document.getElementById("pr-types");
  if(seg)seg.innerHTML=p.types.map(function(t,i){
    return "<button type='button' class='"+(i===PR_SEL.type?"active":"")+"' onclick='prSetType("+i+")'>"+prEsc(t.name)+"</button>";
  }).join("");
  if(c.cost===null||isNaN(c.cost)){
    res.innerHTML="<div class='empty'>Enter a buying cost"+""+".</div>";
    var cmp0=document.getElementById("pr-cmp");if(cmp0)cmp0.innerHTML="";
    return;
  }
  var qty=Math.max(1,parseInt(PR_SEL.qty,10)||1);
  var ti=prTierIndex(p,qty);
  var cogs=p.tiers.map(function(t){return prCogs(c.cost,t);});

  var head="<tr><th></th>"+p.tiers.map(function(t,i){
    return "<th class='"+(i===ti?"pr-on":"")+"'>"+prTierLabel(p,i)+(i===ti?"<span class='pr-here'>this order</span>":"")+"</th>";
  }).join("")+"</tr>";
  var cogsRow="<tr class='pr-cogs'><td>Cost (COGS)<span class='pr-sub'>to deliver one unit</span></td>"+p.tiers.map(function(t,i){
    var f=prMoney(c.cost,2)+" × "+(Number(t.mult)||0)+((Number(t.addon)||0)?" + "+prMoney(Number(t.addon)):"");
    return "<td class='"+(i===ti?"pr-on":"")+"'><div class='pr-num'>"+prMoney(cogs[i],2)+"</div><span class='pr-sub'>"+f+"</span></td>";
  }).join("")+"</tr>";
  var typeRows=p.types.map(function(ty,k){
    return "<tr class='"+(k===PR_SEL.type?"pr-type-on":"")+"'><td>"+prEsc(ty.name)+"</td>"+p.tiers.map(function(t,i){
      var mk=(ty.markups||[])[i]||0,price=prPrice(cogs[i],mk);
      return "<td class='"+(i===ti?"pr-on":"")+(i===ti&&k===PR_SEL.type?" pr-pick":"")+"' title='"+prPct(mk*100)+" markup on cost'>"+
        "<div class='pr-num pr-price'>"+prMoney(price)+"</div>"+
        "<span class='pr-sub'>+"+prMoney(price-cogs[i],2)+" · "+prPct(prMarginPct(price,cogs[i]))+" margin</span></td>";
    }).join("")+"</tr>";
  }).join("");

  var ty=p.types[PR_SEL.type]||p.types[0];
  var unit=ty?prPrice(cogs[ti],(ty.markups||[])[ti]):0;
  var total=unit*qty,profit=(unit-cogs[ti])*qty;
  var summary=ty?"<div class='pr-summary'>"+
    "<div><span class='pr-sum-l'>"+qty.toLocaleString()+" × "+prEsc(ty.name)+" "+prMoney(unit)+"</span><span class='pr-sum-v'>"+prMoney(total)+"</span></div>"+
    "<div><span class='pr-sum-l'>Total cost</span><span class='pr-sum-v pr-muted'>"+prMoney(cogs[ti]*qty,2)+"</span></div>"+
    "<div><span class='pr-sum-l'>Profit</span><span class='pr-sum-v pr-good'>"+prMoney(profit,2)+" <small>("+prPct(prMarginPct(unit,cogs[ti]))+" margin)</small></span></div>"+
  "</div>":"";

  var test="",tp=parseFloat(PR_SEL.test);
  if(!isNaN(tp)&&tp>0){
    var tc=cogs[ti],tProfit=tp-tc;
    var prices=p.types.map(function(t){return{name:t.name,price:prPrice(tc,(t.markups||[])[ti])};})
      .sort(function(a,b){return a.price-b.price;});
    var where,cls="";
    if(tProfit<0){where="below cost — you lose "+prMoney(-tProfit,2)+" per unit";cls="pr-bad";}
    else if(prices.length&&tp<prices[0].price){where=prMoney(prices[0].price-tp)+" below the "+prEsc(prices[0].name)+" price";cls="pr-bad";}
    else if(prices.length&&tp>=prices[prices.length-1].price){where=(tp===prices[prices.length-1].price?"at":prMoney(tp-prices[prices.length-1].price)+" above")+" the "+prEsc(prices[prices.length-1].name)+" price";cls="pr-good";}
    else{
      var lo=prices[0],hi=prices[prices.length-1];
      for(var j=0;j<prices.length-1;j++){if(tp>=prices[j].price&&tp<prices[j+1].price){lo=prices[j];hi=prices[j+1];}}
      where="between "+prEsc(lo.name)+" ("+prMoney(lo.price)+") and "+prEsc(hi.name)+" ("+prMoney(hi.price)+")";cls="pr-mid";
    }
    test="<div class='pr-test "+cls+"'><b>At "+prMoney(tp)+"</b> for "+qty.toLocaleString()+" units: profit "+prMoney(tProfit,2)+"/unit · "+
      prPct(prMarginPct(tp,tc))+" margin · "+prPct(tc>0?tProfit/tc*100:0)+" markup — "+where+"</div>";
  }

  res.innerHTML=
    "<div class='pr-res-head'><div><div class='pr-res-title'>"+prEsc(c.name)+"</div>"+
      "<div class='pr-res-meta'>"+(c.pn?"<span class='pr-mono'>"+prEsc(c.pn)+"</span> · ":"")+"Buying "+prMoney(c.cost,2)+" · rule: "+prEsc(p.name)+"</div></div></div>"+
    "<div class='pr-matrix-wrap'><table class='pr-matrix'><thead>"+head+"</thead><tbody>"+cogsRow+typeRows+"</tbody></table></div>"+
    summary+test+
    "<div class='pr-foot'>Price = cost × (1 + markup), rounded up to the dollar. Margin = profit ÷ selling price.</div>";
  prUpdateCmp(c,p);
}

/* ===== what customers actually paid ===== */
var PR_STOP={aea:1,with:1,for:1,and:1,the:1,china:1,outside:1,version:1,standard:1};
function prDefaultMatch(name){
  var words=String(name||"").toLowerCase().replace(/[()]/g," ").split(/\s+/).filter(function(w){return w&&!PR_STOP[w];});
  if(words.indexOf("non")===-1&&words.length)words.push("-non");
  return words.join(" ");
}
function prMatchTokens(q){
  var inc=[],exc=[];
  String(q||"").toLowerCase().split(/\s+/).forEach(function(w){
    if(!w)return;
    if(w.charAt(0)==="-"&&w.length>1)exc.push(w.slice(1));else inc.push(w);
  });
  return{inc:inc,exc:exc};
}
function prMatches(text,pn,tok,productPn){
  var hay=String(text||"").toLowerCase(),sq=hay.replace(/[\s\-_]/g,"");
  function has(w){return hay.indexOf(w)!==-1||sq.indexOf(w)!==-1;}
  if(tok.exc.some(has))return false;
  if(productPn&&pn&&String(pn).toLowerCase().indexOf(String(productPn).toLowerCase())!==-1)return true;
  return tok.inc.length>0&&tok.inc.every(has);
}
function prHistory(c,query){
  var tok=prMatchTokens(query),rows=[];
  var pnKey=(c.pn&&!/\s/.test(c.pn))?c.pn:"";   /* "915CG… or 915CG…" style PNs are too loose */
  if(typeof PROJECTS!=="undefined")PROJECTS.forEach(function(p){
    LINE_ITEMS.forEach(function(li){
      if(li.projectId!==p._id)return;
      if(!prMatches(li.name+" "+(li.displayModel||"")+" "+(li.pn||""),li.pn,tok,pnKey))return;
      rows.push({customer:p.customer,country:p.country,project:p.project,date:dDisplay(p),sort:parseDV(p.date),
        status:p.status,qty:li.qty,price:li.unitPrice,currency:p.currency||"USD",item:li.name});
    });
  });
  if(typeof TX!=="undefined")TX.forEach(function(t){
    if(!prMatches(t.model+" "+(t.displayModel||"")+" "+(t.pn||""),t.pn,tok,pnKey))return;
    rows.push({customer:t.customer,country:t.country,project:t.project,date:dDisplay(t),sort:parseDV(t.date),
      status:t.status,qty:parseInt(t.qty,10)||1,price:t.price,currency:t.currency||"USD",item:t.model});
  });
  rows.forEach(function(r){r.usd=(r.currency==="USD")?r.price:(typeof fxToUSD==="function"?fxToUSD(r.price,r.currency):null);});
  return rows.sort(function(a,b){return b.sort-a.sort;});
}
function prStatusBadge(s){
  if(s==="PO")return "<span class='badge b-po'>PO</span>";
  if(s==="Lose")return "<span class='badge b-ls'>Lost</span>";
  return "<span class='badge b-qt'>Quote</span>";
}
function prMatchInput(v){PR_SEL.match=v;prSaveSel();var c=prCurrent();prUpdateCmp(c,c.profile,true);}
function prUpdateCmp(c,p,keepInput){
  var el=document.getElementById("pr-cmp");
  if(!el||!p)return;
  var q=PR_SEL.match===null?(c.match||prDefaultMatch(c.name)):PR_SEL.match;
  var rows=prHistory(c,q);
  var body;
  if(!rows.length){
    body="<div class='empty' style='padding:22px'>No past deals match these words. Try fewer words, e.g. just the model family.</div>";
  }else{
    var priced=p.types.map(function(t,k){return{k:k,name:t.name};});
    var trs=rows.map(function(r){
      var ti=prTierIndex(p,r.qty),cogs=prCogs(c.cost,p.tiers[ti]);
      var list=priced.map(function(t){return{name:t.name,price:prPrice(cogs,(p.types[t.k].markups||[])[ti])};})
        .sort(function(a,b){return a.price-b.price;});
      var cmp="—",cls="";
      if(r.usd!==null&&list.length){
        var lo=list[0],hi=list[list.length-1];
        if(r.usd<cogs){cmp="Below cost";cls="pr-bad";}
        else if(r.usd<lo.price){cmp=prMoney(lo.price-r.usd,0)+" under "+prEsc(lo.name);cls="pr-bad";}
        else if(r.usd>=hi.price){cmp=(Math.round(r.usd)===hi.price?"At ":prMoney(r.usd-hi.price,0)+" over ")+prEsc(hi.name);cls="pr-good";}
        else{cmp="Between "+prEsc(lo.name)+" & "+prEsc(hi.name);cls="pr-mid";}
      }
      var paid=r.usd!==null?prMoney(r.usd,r.usd%1?2:0):"—";
      var orig=r.currency!=="USD"?"<span class='pr-sub'>"+Number(r.price).toLocaleString()+" "+prEsc(r.currency)+"</span>":"";
      var margin=r.usd?prPct(prMarginPct(r.usd,cogs)):"—";
      return "<tr>"+
        "<td class='pr-h-cust' data-label='Customer'><div class='pr-cust'>"+(typeof flagImg==="function"?flagImg(r.country,18):"")+
          "<div><div class='pr-cust-n'>"+prEsc(r.customer)+"</div><span class='pr-sub'>"+prEsc(r.project||r.item)+"</span></div></div></td>"+
        "<td data-label='Date'>"+prEsc(r.date||"—")+" "+prStatusBadge(r.status)+"</td>"+
        "<td data-label='Qty' class='pr-r'>"+Number(r.qty).toLocaleString()+"</td>"+
        "<td data-label='Paid / unit' class='pr-r'><b>"+paid+"</b>"+orig+"</td>"+
        "<td data-label='Vs price list' class='"+cls+"'><span class='pr-flag'>"+cmp+"</span></td>"+
        "<td data-label='Margin today' class='pr-r'>"+margin+"</td>"+
      "</tr>";
    }).join("");
    var usd=rows.filter(function(r){return r.usd!==null;});
    var units=usd.reduce(function(s,r){return s+r.qty;},0);
    var avg=units?usd.reduce(function(s,r){return s+r.usd*r.qty;},0)/units:null;
    body="<div class='pr-cmp-stats'>"+rows.length+" deal"+(rows.length===1?"":"s")+" · "+units.toLocaleString()+" units"+
      (avg!==null?" · weighted average "+prMoney(avg,2)+"/unit":"")+"</div>"+
      "<div class='pr-hist-wrap'><table class='pr-hist'><thead><tr><th>Customer</th><th>Date</th><th class='pr-r'>Qty</th><th class='pr-r'>Paid / unit</th><th>Vs price list</th><th class='pr-r'>Margin today</th></tr></thead><tbody>"+trs+"</tbody></table></div>"+
      "<div class='pr-foot'>Each deal is compared with the prices for <i>its own</i> quantity tier, at today’s buying cost. Non-USD prices use today’s exchange rate. Bundled prices (warranty, mounting kits) will read high.</div>";
  }
  var head="<div class='pr-cmp-head'><div><div class='pr-res-title'>What customers paid</div>"+
    "<div class='pr-res-meta'>Past quotations and POs from Customer Base</div></div>"+
    "<label class='pr-match'><span>Match items containing</span><input id='pr-match' value=\""+prEsc(q)+"\" oninput='prMatchInput(this.value)' title='All words must appear in the item name. Prefix a word with - to exclude it.'></label></div>";
  if(keepInput&&document.getElementById("pr-match")){
    var bodyEl=document.getElementById("pr-cmp-body");
    if(bodyEl){bodyEl.innerHTML=body;return;}
  }
  el.innerHTML=head+"<div id='pr-cmp-body'>"+body+"</div>";
}

/* ===== price list (every item in the two sheets) ===== */
function prListSearch(v){
  PR_LIST_Q=v;
  var el=document.getElementById("pr-list-body");
  if(el)el.innerHTML=prListBody();
}
function prListBody(){
  var q=PR_LIST_Q.trim().toLowerCase();
  var items=prProducts().filter(function(b){return !q||(b.model+" "+(b.pn||"")+" "+b.sheet).toLowerCase().indexOf(q)!==-1;});
  if(!items.length)return "<div class='empty'>No products match.</div>";
  var lastGroup=null,html="";
  items.forEach(function(b){
    var g=b.sheet;
    if(g!==lastGroup){html+="<div class='po-month'>"+prEsc(g)+"</div>";lastGroup=g;}
    var p=prProductProfile(b);
    if(!p)return;
    var cost=prItemCost(b);
    var types=p.types.map(function(t,k){return{t:t,k:k};}).filter(function(x){return !PR_LIST_TYPE||x.t.name===PR_LIST_TYPE;});
    var cells=p.tiers.map(function(t,i){
      var cogs=prCogs(cost,t);
      return "<div class='pr-pl-tier'><div class='pr-pl-tl'>"+prTierLabel(p,i)+"</div>"+
        types.map(function(x){
          var price=prPrice(cogs,(x.t.markups||[])[i]);
          return "<div class='pr-pl-line'><span>"+prEsc(x.t.name)+"</span><b>"+prMoney(price)+"</b></div>";
        }).join("")+
        "<div class='pr-pl-line pr-pl-cogs'><span>Cost</span><span>"+prMoney(cogs,2)+"</span></div></div>";
    }).join("");
    html+="<div class='pr-pl-row' onclick='prOpenInCalc(this.dataset.m)' data-m=\""+prEsc(b.model)+"\" title='Open in calculator'>"+
      "<div class='pr-pl-name'><div class='pr-cust-n'>"+prEsc(b.model)+"</div>"+
        "<span class='pr-sub'>"+(b.pn?"<span class='pr-mono'>"+prEsc(b.pn)+"</span> · ":"")+"buy "+prMoney(cost,2)+" · "+prEsc(p.name)+"</span>"+
        "<span class='pr-sub'>"+prEsc(prItemCostNote(b))+"</span>"+
      "</div><div class='pr-pl-tiers'>"+cells+"</div></div>";
  });
  return html;
}
function prOpenInCalc(model){prPickProductSilent(model);PR_VIEW="calc";renderPricing();window.scrollTo(0,0);}
function prPickProductSilent(v){PR_SEL.product=v;PR_SEL.cost="";PR_SEL.profile="";PR_SEL.match=null;prSaveSel();}
function prListHtml(){
  var typeNames=[];
  PR_PROFILES.forEach(function(p){p.types.forEach(function(t){if(typeNames.indexOf(t.name)===-1)typeNames.push(t.name);});});
  return "<div class='pr-list-tools'>"+
      "<div class='trk-search'><span class='trk-search-ico'>&#128269;</span><input type='text' placeholder='Search product or part number…' value=\""+prEsc(PR_LIST_Q)+"\" oninput='prListSearch(this.value)'></div>"+
      "<select class='pr-select' onchange='PR_LIST_TYPE=this.value;renderPricing()'><option value=''>All customer types</option>"+
        typeNames.map(function(n){return "<option"+(PR_LIST_TYPE===n?" selected":"")+">"+prEsc(n)+"</option>";}).join("")+"</select>"+
    "</div>"+
    "<div class='pr-card pr-pl'><div id='pr-list-body'>"+prListBody()+"</div></div>"+
    "<div class='pr-foot'>Products and buying costs exactly as in the two reference Excel sheets. Click a product to open it in the calculator.</div>";
}

/* ===== rules editor ===== */
function prDraft(id){
  if(!PR_DRAFT[id]){var p=PR_PROFILES.find(function(x){return x._id===id;});if(p)PR_DRAFT[id]=prClone(p);}
  return PR_DRAFT[id];
}
function prRuleNum(v){var n=parseFloat(v);return isNaN(n)?0:n;}
function prRuleSet(id,path,val){
  var d=prDraft(id);if(!d)return;
  var parts=path.split(".");
  if(parts[0]==="name")d.name=val;
  else if(parts[0]==="match")d.match=val;
  else if(parts[0]==="tier")d.tiers[+parts[1]][parts[2]]=prRuleNum(val);
  else if(parts[0]==="typename")d.types[+parts[1]].name=val;
  else if(parts[0]==="markup"){
    var t=d.types[+parts[1]];t.markups=t.markups||[];t.markups[+parts[2]]=prRuleNum(val)/100;
    var h=document.getElementById("pr-mg-"+id+"-"+parts[1]+"-"+parts[2]);
    if(h)h.textContent="= "+prPct(prMarkupToMargin(t.markups[+parts[2]]))+" margin";
  }
  var b=document.getElementById("pr-dirty-"+id);if(b)b.style.display="contents";
}
function prRuleAddTier(id){
  var d=prDraft(id),last=d.tiers[d.tiers.length-1]||{min:0,mult:1.2,addon:0};
  d.tiers.push({min:(Number(last.min)||1)*10,mult:last.mult,addon:last.addon});
  d.types.forEach(function(t){t.markups=t.markups||[];t.markups.push(t.markups[t.markups.length-1]||0);});
  renderPricing();
}
function prRuleDelTier(id,i){
  var d=prDraft(id);if(d.tiers.length<=1)return;
  d.tiers.splice(i,1);d.types.forEach(function(t){(t.markups||[]).splice(i,1);});
  renderPricing();
}
function prRuleAddType(id){
  var d=prDraft(id);
  d.types.push({name:"New type",markups:d.tiers.map(function(){return 0.5;})});
  renderPricing();
}
function prRuleDelType(id,k){
  var d=prDraft(id);if(d.types.length<=1)return;
  if(!confirm("Remove the customer type “"+d.types[k].name+"” from this rule?"))return;
  d.types.splice(k,1);renderPricing();
}
function prRuleReset(id){delete PR_DRAFT[id];if(String(id).indexOf("new-")===0)PR_PROFILES=PR_PROFILES.filter(function(p){return p._id!==id;});renderPricing();}
function prRuleNew(){
  var id="new-"+Date.now();
  var base=PR_PROFILES[PR_PROFILES.length-1];
  var p={_id:id,name:"New rule",match:"",sortOrder:PR_PROFILES.reduce(function(m,x){return Math.max(m,x.sortOrder||0);},0)+1,
    tiers:base?prClone(base.tiers):prClone(PR_DEFAULTS[2].tiers),types:base?prClone(base.types):prClone(PR_STD_TYPES)};
  PR_PROFILES.push(p);PR_DRAFT[id]=prClone(p);
  renderPricing();
}
async function prRuleSave(id){
  if(PR_MISSING){alert("Run pricing-setup.sql in Supabase first — rules can't be saved until the table exists.");return;}
  var d=prDraft(id);if(!d)return;
  if(!d.name.trim()){alert("Give the rule a name.");return;}
  d.tiers.sort(function(a,b){return (a.min||0)-(b.min||0);});
  var isNew=String(id).indexOf("new-")===0,row=prToDb(d),ok=false,saved=null;
  try{
    if(isNew){var r=await sbInsert("pricing_profiles",row);if(r&&r[0]){saved=dbToPr(r[0]);ok=true;}}
    else{
      var resp=await fetch(SB_URL+"/rest/v1/pricing_profiles?id=eq."+id,{method:"PATCH",headers:sbH(),body:JSON.stringify(row)});
      if(resp.ok){var j=await resp.json();saved=j&&j[0]?dbToPr(j[0]):prClone(d);ok=true;}
    }
  }catch(e){console.error(e);}
  if(!ok){alert("Could not save the rule. Check your connection and try again.");return;}
  PR_PROFILES=PR_PROFILES.filter(function(p){return p._id!==id;});
  PR_PROFILES.push(saved);prSortProfiles();
  delete PR_DRAFT[id];
  if(PR_SEL.profile===id)PR_SEL.profile=saved._id;
  renderPricing();
}
async function prRuleDelete(id){
  var p=PR_PROFILES.find(function(x){return x._id===id;});
  if(!p)return;
  if(PR_PROFILES.length<=1){alert("Keep at least one pricing rule.");return;}
  if(!confirm("Delete the pricing rule “"+p.name+"”?"))return;
  if(String(id).indexOf("new-")!==0){
    if(PR_MISSING)return;
    var r=await fetch(SB_URL+"/rest/v1/pricing_profiles?id=eq."+id,{method:"DELETE",headers:sbH()});
    if(!r.ok){alert("Could not delete the rule.");return;}
  }
  PR_PROFILES=PR_PROFILES.filter(function(x){return x._id!==id;});
  delete PR_DRAFT[id];
  if(PR_SEL.profile===id){PR_SEL.profile="";prSaveSel();}
  renderPricing();
}
function prRuleCard(p){
  var id=p._id,d=PR_DRAFT[id]||p,dirty=!!PR_DRAFT[id];
  var idq="\""+prEsc(id)+"\"";
  function inp(path,val,cls,extra){
    return "<input class='"+(cls||"")+"' value=\""+prEsc(val)+"\" oninput='prRuleSet("+idq+",\""+path+"\",this.value)'"+(extra||"")+">";
  }
  var cols=d.tiers.length;
  var head="<tr><th></th>"+d.tiers.map(function(t,i){
    return "<th>"+prEsc(prTierLabel(d,i))+(cols>1?" <button class='pr-x' title='Remove this tier' onclick='prRuleDelTier("+idq+","+i+")'>×</button>":"")+"</th>";
  }).join("")+"<th class='pr-addcol'><button class='pr-link' onclick='prRuleAddTier("+idq+")'>+ tier</button></th></tr>";
  function row(label,key,hint){
    return "<tr><td>"+label+(hint?"<span class='pr-sub'>"+hint+"</span>":"")+"</td>"+d.tiers.map(function(t,i){
      return "<td>"+inp("tier."+i+"."+key,t[key],"pr-num-in"," type='number' step='any'")+"</td>";
    }).join("")+"<td></td></tr>";
  }
  var typeRows=d.types.map(function(t,k){
    return "<tr class='pr-type-row'><td><div class='pr-type-name'>"+inp("typename."+k,t.name,"pr-name-in")+
      (d.types.length>1?"<button class='pr-x' title='Remove customer type' onclick='prRuleDelType("+idq+","+k+")'>×</button>":"")+
      "</div><span class='pr-sub'>markup % on cost</span></td>"+
      d.tiers.map(function(x,i){
        var m=(t.markups||[])[i]||0;
        return "<td>"+inp("markup."+k+"."+i,Math.round(m*10000)/100,"pr-num-in"," type='number' step='any'")+
          "<span class='pr-sub' id='pr-mg-"+prEsc(id)+"-"+k+"-"+i+"'>= "+prPct(prMarkupToMargin(m))+" margin</span></td>";
      }).join("")+"<td></td></tr>";
  }).join("");
  return "<div class='pr-card pr-rule'>"+
    "<div class='pr-rule-head'>"+
      "<div class='pr-field'><label>Rule name</label>"+inp("name",d.name,"")+"</div>"+
      "<div class='pr-field'><label>Applies to products containing <span class='pr-opt'>(comma-separated; empty = everything else)</span></label>"+inp("match",d.match,""," placeholder='e.g. tk180'")+"</div>"+
    "</div>"+
    "<div class='pr-matrix-wrap'><table class='pr-rules'><thead>"+head+"</thead><tbody>"+
      "<tr><td>Starts at qty</td>"+d.tiers.map(function(t,i){return "<td>"+inp("tier."+i+".min",t.min,"pr-num-in"," type='number' min='1' step='1'")+"</td>";}).join("")+"<td></td></tr>"+
      row("Cost multiplier","mult","buying cost ×")+
      row("Add-on per unit ($)","addon","delivery estimate")+
      typeRows+
    "</tbody></table></div>"+
    "<div class='pr-rule-actions'>"+
      "<button class='pr-link' onclick='prRuleAddType("+idq+")'>+ Customer type</button>"+
      "<span style='flex:1'></span>"+
      "<button class='delete-btn' style='font-size:12px;padding:7px 12px' onclick='prRuleDelete("+idq+")'>Delete</button>"+
      "<span id='pr-dirty-"+prEsc(id)+"' style='display:"+(dirty?"contents":"none")+"'>"+
        "<button class='btn-cancel' onclick='prRuleReset("+idq+")'>Discard</button>"+
        "<button class='btn-save' onclick='prRuleSave("+idq+")'"+(PR_MISSING?" disabled title='Run pricing-setup.sql first'":"")+">Save rule</button>"+
      "</span>"+
    "</div></div>";
}
function prRulesHtml(){
  return "<div class='pr-explain'>"+
      "<div><b>Cost (COGS)</b> = buying cost × cost multiplier + add-on per unit</div>"+
      "<div><b>Selling price</b> = COGS × (1 + markup), rounded up to the dollar</div>"+
      "<div class='pr-sub'>A product uses the first rule whose words appear in its name or group (top to bottom); the rule with no words catches everything else. The calculator can also override the rule per quote.</div>"+
    "</div>"+
    PR_PROFILES.map(prRuleCard).join("")+
    "<button class='pr-link pr-newrule' onclick='prRuleNew()'>+ New pricing rule</button>";
}
