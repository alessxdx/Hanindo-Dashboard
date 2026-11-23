/* ============================================================
   EXPENSES — the second view of the Notes page. Office running
   costs and money in/out per department (Fire fighting office,
   POSIVA, ...), kept in the `expenses` table (expenses-setup.sql).
   Loaded the first time the view is opened; a failed load shows a
   message and never changes anything.
   ============================================================ */
var EXPENSES=[],EXP_LOADED=false,EXP_MISSING=false,EXP_ERROR=false;
var NT_VIEW="notes"; /* Notes page: "notes" or "expenses" */
var EXP_DEPTS=["Fire fighting office","POSIVA"]; /* shown first, in this order */

function expFromDb(r){return{_id:r.id,department:r.department||"",date:r.entry_date||"",period:r.period||"",description:r.description||"",
  category:r.category||"",amount:Number(r.amount)||0,currency:r.currency||"IDR",kind:r.kind==="received"?"received":"spent",
  paidBy:r.paid_by||"",note:r.note||"",attachments:Array.isArray(r.attachments)?r.attachments:[],createdAt:r.created_at||""};}
/* department heading colour = the matching Project Tracker solution colour
   ("Fire fighting office" → Fire fighting red, "POSIVA" → Posiva violet) */
function expDeptColor(d){
  var low=String(d||"").toLowerCase(),keys=typeof TRK_SOLUTION_COLORS!=="undefined"?Object.keys(TRK_SOLUTION_COLORS):[];
  for(var k=0;k<keys.length;k++)if(low.indexOf(keys[k].toLowerCase())===0)return TRK_SOLUTION_COLORS[keys[k]];
  return typeof trkSolutionColor==="function"?trkSolutionColor(d):"";
}
function expToDb(e){return{department:e.department,entry_date:e.date||null,period:e.period||null,description:e.description,
  category:e.category||null,amount:e.amount,currency:e.currency||"IDR",kind:e.kind,paid_by:e.paidBy||null,note:e.note||null};}

async function expLoad(){
  var r=await fetch(SB_URL+"/rest/v1/expenses?select=*&order=entry_date.asc",{headers:sbH()});
  if(r.status===404){EXP_MISSING=true;EXP_LOADED=true;return;}
  if(!r.ok){EXP_ERROR=true;return;}
  var rows=await r.json();
  if(!Array.isArray(rows)){EXP_ERROR=true;return;}
  EXPENSES=rows.map(expFromDb);EXP_LOADED=true;EXP_ERROR=false;
}

function ntSetView(v){NT_VIEW=v;renderContent();}
function ntViewChips(){
  return "<div class='trk-toolbar nt-views'><div class='trk-chips'>"+
    [["notes","Notes"],["expenses","Expenses"]].map(function(v){
      return "<button class='trk-chip"+(NT_VIEW===v[0]?" active":"")+"' onclick='ntSetView(\""+v[0]+"\")'>"+v[1]+"</button>";
    }).join("")+"</div></div>";
}

var EXP_MON=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function expDateHtml(e){
  if(e.period){
    var m=/^(.*?)\s*(\d{4})$/.exec(e.period);
    return m&&m[1]?trkEsc(m[1])+"<span>"+m[2]+"</span>":trkEsc(e.period);
  }
  var d=/^(\d{4})-(\d{2})-(\d{2})$/.exec(e.date||"");
  return d?(+d[3])+" "+EXP_MON[+d[2]-1]+"<span>"+d[1]+"</span>":"";
}
function expMoney(v,cur){return v.toLocaleString(undefined,{maximumFractionDigits:2})+" <span class='trk-r-cur'>"+trkEsc(cur)+"</span>";}
function expUsd(v,cur){return (cur!=="USD"&&typeof fxUsdText==="function")?fxUsdText(v,cur):"";}

var EXP_DEPT_SEL=""; /* department shown; empty = the first one */
function expSetDept(d){EXP_DEPT_SEL=d;renderExpenses();}
/* "30% down payment to X for:\n• A\n• B" → title "30% down payment to X for:", details "A · B" */
function expSplitDesc(t){
  var lines=String(t||"").split("\n").map(function(l){return l.replace(/^\s*[•*\-]\s*/,"").replace(/;\s*$/,"").trim();}).filter(Boolean);
  return {title:lines[0]||"",more:lines.slice(1).join(" \u00b7 ")};
}
function expShort(v){
  var a=Math.abs(v);
  if(a>=1e9)return (v/1e9).toFixed(a>=1e10?0:1).replace(/\.0$/,"")+"B";
  if(a>=1e6)return (v/1e6).toFixed(a>=1e7?0:1).replace(/\.0$/,"")+"M";
  if(a>=1e3)return (v/1e3).toFixed(a>=1e4?0:1).replace(/\.0$/,"")+"k";
  return String(Math.round(v));
}
function expMonthKey(e){return (e.date||"").slice(0,7);}
var EXP_MONTHS_LONG=["January","February","March","April","May","June","July","August","September","October","November","December"];

function renderExpenses(){
  var content=document.getElementById("content");
  var head=ntViewChips();
  if(!EXP_LOADED){
    content.innerHTML="<div class='nt-page nt-simple'>"+head+"<div class='nt-empty'>"+(EXP_ERROR?"Couldn't load expenses. Nothing was changed. Reload to try again.":"Loading expenses&hellip;")+"</div></div>";
    if(!EXP_ERROR)expLoad().then(function(){if(currentTab==="others"&&NT_VIEW==="expenses")renderExpenses();})
      .catch(function(err){console.error(err);EXP_ERROR=true;if(currentTab==="others"&&NT_VIEW==="expenses")renderExpenses();});
    return;
  }
  if(EXP_MISSING){
    content.innerHTML="<div class='nt-page nt-simple'>"+head+"<div class='nt-empty'>The expenses table isn't set up yet. Run <b>expenses-setup.sql</b> once in the Supabase SQL editor, then reload.</div></div>";
    return;
  }
  var depts=EXP_DEPTS.concat(EXPENSES.map(function(e){return e.department;}).filter(function(d,i,a){return d&&EXP_DEPTS.indexOf(d)<0&&a.indexOf(d)===i;}).sort());
  var dept=depts.indexOf(EXP_DEPT_SEL)>-1?EXP_DEPT_SEL:depts[0];
  var color=expDeptColor(dept)||"var(--accent)";
  var all=EXPENSES.filter(function(e){return e.department===dept;});
  var ico=function(kind,title,fn){
    var path=kind==="edit"?'<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>':'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
    return "<button class='nt-ico"+(kind==="edit"?"":" nt-ico-del")+"' title='"+title+"' aria-label='"+title+"' onclick='"+fn+"'><svg viewBox='0 0 24 24' aria-hidden='true'>"+path+"</svg></button>";
  };
  /* department switch, each with its entry count */
  var tabs="<div class='exp-tabs'>"+depts.map(function(d){
    var n=EXPENSES.filter(function(e){return e.department===d;}).length;
    return "<button class='exp-tab"+(d===dept?" on":"")+"' style='--dc:"+(expDeptColor(d)||"var(--accent)")+"' onclick='expSetDept("+JSON.stringify(d).replace(/'/g,"&#39;")+")'>"+trkEsc(d)+"<span>"+n+"</span></button>";
  }).join("")+"</div>";
  if(!all.length){
    content.innerHTML="<div class='nt-page nt-simple exp-page'>"+head+tabs+"<div class='nt-empty'>No expenses recorded for "+trkEsc(dept)+" yet. Use + Add entry.</div></div>";
    return;
  }
  /* main currency = the one with the most spent (a department normally uses one) */
  var byCur={};
  all.forEach(function(e){var c=byCur[e.currency]=byCur[e.currency]||{spent:0,recv:0};if(e.kind==="received")c.recv+=e.amount;else c.spent+=e.amount;});
  var curs=Object.keys(byCur).sort(function(x,y){return byCur[y].spent-byCur[x].spent;}),cur=curs[0],T=byCur[cur];
  var stat=function(label,v,cls,sign){var u=expUsd(v,cur);return "<div class='exp-stat"+(cls?" "+cls:"")+"'><div class='exp-stat-l'>"+label+"</div><div class='exp-stat-v'>"+(sign||"")+v.toLocaleString(undefined,{maximumFractionDigits:2})+" <span>"+trkEsc(cur)+"</span></div>"+(u?"<div class='exp-stat-u'>"+u+"</div>":"")+"</div>";};
  var stats="<div class='exp-stats'>"+stat("Spent",T.spent)+(T.recv?stat("Received",T.recv,"exp-stat-in","+")+stat("Net spent",T.spent-T.recv,"exp-stat-net"):"")+"</div>"+
    (curs.length>1?"<div class='exp-other-cur'>Also: "+curs.slice(1).map(function(c){return expMoney(byCur[c].spent,c)+" spent";}).join(", ")+"</div>":"");
  var spent=all.filter(function(e){return e.kind!=="received"&&e.currency===cur;});
  /* where the money went: by category (or the item itself when there's no category) */
  var cat={};
  spent.forEach(function(e){var k=e.category||expSplitDesc(e.description).title;cat[k]=(cat[k]||0)+e.amount;});
  var cats=Object.keys(cat).sort(function(x,y){return cat[y]-cat[x];});
  if(cats.length>8){var rest=cats.slice(7).reduce(function(t,k){return t+cat[k];},0);cats=cats.slice(0,7);cat["Everything else"]=rest;cats.push("Everything else");}
  var maxC=cats.length?cat[cats[0]]:0;
  var bars=cats.length?"<div class='exp-sec'>Where the money went</div><div class='exp-bars'>"+cats.map(function(k){
    var v=cat[k],pct=T.spent?Math.round(v/T.spent*100):0;
    return "<div class='exp-bar-row'><div class='exp-bar-l' title='"+trkEsc(k)+"'>"+trkEsc(k)+"</div>"+
      "<div class='exp-bar-t'><div class='exp-bar-f' style='width:"+Math.max(1.5,v/maxC*100).toFixed(1)+"%;background:"+color+"'></div></div>"+
      "<div class='exp-bar-v'><b>"+v.toLocaleString(undefined,{maximumFractionDigits:2})+"</b><span>"+pct+"%</span></div></div>";
  }).join("")+"</div>":"";
  /* spending per month, every month from the first to the last (only when it spans several) */
  var mon={};spent.forEach(function(e){var k=expMonthKey(e);if(k)mon[k]=(mon[k]||0)+e.amount;});
  var mk=Object.keys(mon).sort(),chart="";
  if(mk.length>1){
    var months=[],y=+mk[0].slice(0,4),m=+mk[0].slice(5,7),endY=+mk[mk.length-1].slice(0,4),endM=+mk[mk.length-1].slice(5,7);
    while(y<endY||(y===endY&&m<=endM)){months.push(y+"-"+("0"+m).slice(-2));m++;if(m>12){m=1;y++;}}
    var maxM=Math.max.apply(null,months.map(function(k){return mon[k]||0;}));
    chart="<div class='exp-sec'>Spent per month</div><div class='exp-cols'>"+months.map(function(k,i){
      var v=mon[k]||0,mm=+k.slice(5,7);
      return "<div class='exp-col' title='"+EXP_MONTHS_LONG[mm-1]+" "+k.slice(0,4)+": "+v.toLocaleString()+" "+trkEsc(cur)+"'>"+
        "<div class='exp-col-v'>"+(v?expShort(v):"")+"</div>"+
        "<div class='exp-col-b'><div style='height:"+(v?Math.max(3,v/maxM*100):0).toFixed(1)+"%;background:"+color+"'></div></div>"+
        "<div class='exp-col-l'>"+EXP_MON[mm-1]+(mm===1||i===0?"<span>"+k.slice(0,4)+"</span>":"")+"</div></div>";
    }).join("")+"</div>";
  }
  /* entries, newest month first, each month with its total */
  var groups={},order=[];
  all.slice().sort(function(a,b){return (b.date||"").localeCompare(a.date||"")||b.amount-a.amount;}).forEach(function(e){
    var k=e.period||expMonthKey(e)||"No date";
    if(!groups[k]){groups[k]=[];order.push(k);}groups[k].push(e);
  });
  var label=function(k){var m=/^(\d{4})-(\d{2})$/.exec(k);return m?EXP_MONTHS_LONG[+m[2]-1]+" "+m[1]:trkEsc(k);};
  var list=order.map(function(k){
    var g=groups[k],net=g.reduce(function(t,e){return e.currency!==cur?t:t+(e.kind==="received"?-e.amount:e.amount);},0);
    return "<div class='exp-month'><span>"+label(k)+"</span><b>"+expMoney(net,cur)+"</b></div>"+g.map(function(e){
      var i=EXPENSES.indexOf(e),d=expSplitDesc(e.description),day=/^\d{4}-\d{2}-(\d{2})$/.exec(e.date||"");
      var meta=[e.category,e.paidBy?(e.kind==="received"?"Received by ":"Paid by ")+e.paidBy:""].filter(Boolean).map(trkEsc).join(" &middot; ");
      return "<div class='exp-item'><div class='exp-day'>"+(e.period?"":day?(+day[1])+"<span>"+EXP_MON[+e.date.slice(5,7)-1]+"</span>":"")+"</div>"+
        "<div class='exp-main'><div class='exp-title'>"+trkEsc(d.title)+"</div>"+(d.more?"<div class='exp-more'>"+trkEsc(d.more)+"</div>":"")+
          (meta?"<div class='exp-meta'>"+meta+"</div>":"")+(e.note?"<div class='exp-note'>"+trkEsc(e.note)+"</div>":"")+"</div>"+
        "<div class='exp-amt"+(e.kind==="received"?" exp-in":"")+"'>"+(e.kind==="received"?"+":"")+expMoney(e.amount,e.currency)+(e.kind==="received"?"<small>received</small>":"")+"</div>"+
        "<div class='nt-acts'>"+ico("edit","Edit","expOpenModal("+i+")")+ico("trash","Remove","expDelete("+i+")")+"</div></div>";
    }).join("");
  }).join("");
  /* source files (the same file can be on several rows): listed once */
  var seen={},files=[];
  all.forEach(function(e){(e.attachments||[]).forEach(function(a){if(a&&a.url&&!seen[a.url]){seen[a.url]=1;files.push(a);}});});
  var src=files.length?"<div class='exp-files'><span>Source file"+(files.length>1?"s":"")+"</span>"+files.map(function(a){
    return "<a class='trk-att' href='"+trkEsc(a.url)+"' data-name='"+trkEsc(a.name)+"' onclick='return trkViewFile(this)'>"+(typeof trkFileIcon==="function"?trkFileIcon(a.name)+" ":"")+trkEsc(a.name)+"</a>";
  }).join("")+"</div>":"";
  content.innerHTML="<div class='nt-page nt-simple exp-page'>"+head+tabs+
    "<div class='exp-head'><span class='exp-dept' style='color:"+color+"'>"+trkEsc(dept)+"</span><span class='nt-n2'>"+all.length+" entr"+(all.length===1?"y":"ies")+"</span></div>"+
    stats+src+"<div class='exp-charts'>"+(bars?"<div>"+bars+"</div>":"")+(chart?"<div>"+chart+"</div>":"")+"</div><div class='exp-sec'>Entries</div>"+list+"</div>";
}

/* ---------- add / edit ---------- */
function expOpenModal(i){
  var m=document.getElementById("modal-expense"),e=i===undefined||i===null?null:EXPENSES[i];
  m.setAttribute("data-edit-idx",e?i:"");
  document.getElementById("exp-modal-title").textContent=e?"Edit expense":"Add expense";
  document.getElementById("btn-delete-expense").style.display=e?"":"none";
  var dl=document.getElementById("exp-dept-list");
  if(dl)dl.innerHTML=EXP_DEPTS.concat(EXPENSES.map(function(x){return x.department;})).filter(function(d,k,a){return d&&a.indexOf(d)===k;}).map(function(d){return "<option value='"+trkEsc(d)+"'>";}).join("");
  var v=function(id,val){document.getElementById(id).value=val===undefined||val===null?"":val;};
  v("exp-dept",e?e.department:(EXP_DEPT_SEL||EXP_DEPTS[0]));v("exp-date",e?e.date:new Date().toISOString().slice(0,10));v("exp-period",e?e.period:"");
  v("exp-desc",e?e.description:"");v("exp-cat",e?e.category:"");v("exp-amount",e?e.amount:"");
  v("exp-currency",e?e.currency:"IDR");v("exp-kind",e?e.kind:"spent");v("exp-paidby",e?e.paidBy:"");v("exp-note",e?e.note:"");
  m.classList.add("open");
}
async function expSave(){
  var g=function(id){return document.getElementById(id).value.trim();};
  var amt=parseFloat(g("exp-amount").replace(/,/g,""));
  if(!g("exp-dept")||!g("exp-desc")||isNaN(amt)){alert("Department, description and amount are needed.");return;}
  var m=document.getElementById("modal-expense"),idx=m.getAttribute("data-edit-idx"),old=idx!==""?EXPENSES[+idx]:null;
  var e={department:g("exp-dept"),date:g("exp-date"),period:g("exp-period"),description:g("exp-desc"),category:g("exp-cat"),
    amount:amt,currency:g("exp-currency")||"IDR",kind:g("exp-kind")==="received"?"received":"spent",paidBy:g("exp-paidby"),note:g("exp-note")};
  var r;
  if(old){
    r=await fetch(SB_URL+"/rest/v1/expenses?id=eq."+old._id,{method:"PATCH",headers:sbH(),body:JSON.stringify(expToDb(e))});
    if(!r.ok){alert("Couldn't save. Nothing was changed.");return;}
    e._id=old._id;e.createdAt=old.createdAt;e.attachments=old.attachments||[];EXPENSES[+idx]=e;
  }else{
    r=await sbInsert("expenses",expToDb(e));
    if(!r||!r[0]){alert("Couldn't save. Nothing was added.");return;}
    e._id=r[0].id;e.createdAt=r[0].created_at||"";EXPENSES.push(e);
  }
  closeModal("modal-expense");renderExpenses();
}
async function expDelete(i){
  var e=EXPENSES[i];if(!e||!confirm("Remove this expense?\n"+e.description.split("\n")[0]))return;
  if(e._id&&!(await sbDelete("expenses",e._id))){alert("Couldn't remove it. Nothing was changed.");return;}
  EXPENSES.splice(i,1);closeModal("modal-expense");renderExpenses();
}
function expDeleteFromModal(){var idx=document.getElementById("modal-expense").getAttribute("data-edit-idx");if(idx!=="")expDelete(+idx);}
