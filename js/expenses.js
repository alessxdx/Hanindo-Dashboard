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
  paidBy:r.paid_by||"",note:r.note||"",createdAt:r.created_at||""};}
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
  var ico=function(kind,title,fn){
    var path=kind==="edit"?'<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M14 6l4 4"/>':'<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';
    return "<button class='nt-ico"+(kind==="edit"?"":" nt-ico-del")+"' title='"+title+"' aria-label='"+title+"' onclick='"+fn+"'><svg viewBox='0 0 24 24' aria-hidden='true'>"+path+"</svg></button>";
  };
  var body=depts.map(function(dept){
    var list=EXPENSES.filter(function(e){return e.department===dept;})
      .sort(function(a,b){return (b.date||"").localeCompare(a.date||"")||(a.createdAt||"").localeCompare(b.createdAt||"");});
    if(!list.length&&EXP_DEPTS.indexOf(dept)<0)return "";
    /* totals per currency: spent, received, and what it cost after money came back */
    var cur={};
    list.forEach(function(e){var c=cur[e.currency]=cur[e.currency]||{spent:0,recv:0};if(e.kind==="received")c.recv+=e.amount;else c.spent+=e.amount;});
    var sum=Object.keys(cur).map(function(c){
      var t=cur[c],rows="",usd;
      usd=expUsd(t.spent,c);
      rows+="<div class='exp-sum-row'><span>Spent"+(Object.keys(cur).length>1?" ("+trkEsc(c)+")":"")+"</span><b>"+expMoney(t.spent,c)+"</b>"+(usd?"<small>"+usd+"</small>":"")+"</div>";
      if(t.recv){
        usd=expUsd(t.recv,c);
        rows+="<div class='exp-sum-row exp-sum-in'><span>Received</span><b>+"+expMoney(t.recv,c)+"</b>"+(usd?"<small>"+usd+"</small>":"")+"</div>";
        usd=expUsd(t.spent-t.recv,c);
        rows+="<div class='exp-sum-row exp-sum-tot'><span>Net spent</span><b>"+expMoney(t.spent-t.recv,c)+"</b>"+(usd?"<small>"+usd+"</small>":"")+"</div>";
      }
      return rows;
    }).join("");
    var rows=list.map(function(e){
      var i=EXPENSES.indexOf(e);
      var sub=[e.category,e.paidBy?(e.kind==="received"?"Received by ":"Paid by ")+e.paidBy:""].filter(Boolean).map(trkEsc).join(" &middot; ");
      return "<div class='nt-upd exp-row'><div class='nt-day2'>"+expDateHtml(e)+"</div>"+
        "<div class='nt-body'><div class='exp-desc'>"+trkEsc(e.description.split("\n")[0])+"</div>"+
          (e.description.indexOf("\n")>-1?"<div class='exp-desc-more'>"+trkEsc(e.description.split("\n").slice(1).join("\n")).replace(/\n/g,"<br>")+"</div>":"")+
          (sub?"<div class='nt-sub'>"+sub+"</div>":"")+(e.note?"<div class='exp-note'>"+trkEsc(e.note)+"</div>":"")+"</div>"+
        "<div class='exp-amt"+(e.kind==="received"?" exp-in":"")+"'>"+(e.kind==="received"?"+":"")+expMoney(e.amount,e.currency)+
          (e.kind==="received"?"<small>received</small>":"")+"</div>"+
        "<div class='nt-acts'>"+ico("edit","Edit","expOpenModal("+i+")")+ico("trash","Remove","expDelete("+i+")")+"</div></div>";
    }).join("");
    return "<div class='nt-card'><div class='nt-head'><span class='nt-h'>"+trkEsc(dept)+"</span><span class='nt-n2'>"+list.length+" entr"+(list.length===1?"y":"ies")+"</span></div>"+
      (list.length?"<div class='exp-sum'>"+sum+"</div>"+rows:"<div class='nt-empty'>No expenses recorded yet.</div>")+"</div>";
  }).join("");
  content.innerHTML="<div class='nt-page nt-simple'>"+head+body+"</div>";
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
  v("exp-dept",e?e.department:EXP_DEPTS[0]);v("exp-date",e?e.date:new Date().toISOString().slice(0,10));v("exp-period",e?e.period:"");
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
    e._id=old._id;e.createdAt=old.createdAt;EXPENSES[+idx]=e;
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
