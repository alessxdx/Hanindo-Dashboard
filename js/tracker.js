/* ============================================================
   PROJECT TRACKER — upcoming / ongoing / future sales projects.
   Standalone tab: its own tables (tracker_projects, tracker_entries),
   lazy-loaded on first open. Each project moves through a sales
   pipeline (Enquiry → Quoted → Won / Lost)
   and carries a dated timeline of entries (meetings, quotations,
   calls…), each with PDF/Excel attachments in the shared
   "documents" storage bucket under tracker/.
   ============================================================ */

var TRK_PROJECTS=[],TRK_ENTRIES=[];
var TRK_LOADED=false,TRK_MISSING=false;
var TRK_SEL=null;            /* project id shown in detail view */
var TRK_EXPAND=false;        /* list view: selected project opened full page */
/* status chips are multi-select: an array of statuses, or ["stale"] alone */
/* Status chips: everything but Lost is on by default; Lost sits at
   the end, off until picked. */
var TRK_CHIP_ORDER=["Enquiry","Quoted","Other","Won","Lost"];
var TRK_FSTATUS_DEFAULT=["Enquiry","Quoted","Other","Won"];
var TRK_FSTATUS=TRK_FSTATUS_DEFAULT.slice(),TRK_FOFFICE="",TRK_FSOL="";
var TRK_Q="";                 /* list search box text */
var TRK_ATT=[];              /* entry-modal attachment staging */

/* Pipeline: Enquiry → Quoted → Won / Lost. (Negotiation and On hold
   were retired; legacy projects with those statuses still render.)
   "Other" is a project KIND more than a status: not customer related
   (internal tasks, admin, anything worth a dated timeline). It sits
   outside the pipeline — never derived from entries, never counted in
   the stats — and its filter chip only shows once one exists. */
var TRK_STATUSES=["Enquiry","Quoted","Won","Lost","Other"];
var TRK_ACTIVE_STATUSES=["Enquiry","Quoted"];
var TRK_CLOSED_STATUSES=["Won","Lost"];
var TRK_OFFICES=["China","Indonesia","Singapore"];

/* ===== converters ===== */
function dbToTrkP(r){return{_id:r.id,name:r.name||"",customer:r.customer||"",country:r.country||"",office:r.office||"",status:r.status||"Enquiry",payment:r.payment||"",solution:r.solution||"",products:Array.isArray(r.products)?r.products:[],estValue:(r.est_value===null||r.est_value===undefined)?null:Number(r.est_value),currency:r.currency||"USD",expectedDate:r.expected_date||"",expectedPeriod:r.expected_period||"",contactName:r.contact_name||"",contactPosition:r.contact_position||"",contactInfo:r.contact_info||"",notes:r.notes||"",nextFollowup:r.next_followup||"",lowPriority:!!r.low_priority,createdAt:r.created_at||""};}
var TRK_HAS_FU=true;
/* low_priority is set only by its own toggle (never by the project form) */
var TRK_HAS_LOW=true;
function trkPToDb(p){var r=trkPToDbBase(p);if(TRK_HAS_FU)r.next_followup=p.nextFollowup||null;return r;}
function trkPToDbBase(p){return{name:p.name,customer:p.customer||null,country:p.country||null,office:p.office||null,status:p.status,payment:p.payment||null,solution:p.solution||null,products:p.products||[],est_value:(p.estValue===null||isNaN(p.estValue))?null:p.estValue,currency:p.currency||"USD",expected_date:p.expectedDate||null,expected_period:p.expectedPeriod||null,contact_name:p.contactName||null,contact_position:p.contactPosition||null,contact_info:p.contactInfo||null,notes:p.notes||null};}
function dbToTrkE(r){return{_id:r.id,projectId:r.project_id,date:r.entry_date||"",type:r.entry_type||"Note",title:r.title||"",details:r.details||"",attachments:Array.isArray(r.attachments)?r.attachments:[],createdAt:r.created_at||""};}
function trkEToDb(e){return{project_id:e.projectId,entry_date:e.date||null,entry_type:e.type,title:e.title||null,details:e.details||null,attachments:e.attachments||[]};}

/* ===== helpers ===== */
function trkEsc(s){return String(s===null||s===undefined?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
var TRK_MONTHS=["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function trkFmtDate(d){
  if(!d)return"";
  var dt=new Date(String(d).slice(0,10)+"T00:00:00");
  if(isNaN(dt))return d;
  return dt.getDate()+" "+TRK_MONTHS[dt.getMonth()]+" "+dt.getFullYear();
}
/* ===== expected close periods =====
   Stored as "2026-Q3" or "2026-12" in expected_period; expected_date
   is kept at the period's LAST day so overdue checks keep working.
   Projects saved before periods existed may have only a date. */
var TRK_Q_END={Q1:"03-31",Q2:"06-30",Q3:"09-30",Q4:"12-31"};
function trkPeriodEnd(per){
  var m=/^(\d{4})-(Q[1-4])$/.exec(per);
  if(m)return m[1]+"-"+TRK_Q_END[m[2]];
  m=/^(\d{4})-(\d{2})$/.exec(per);
  if(m)return m[1]+"-"+m[2]+"-"+("0"+new Date(+m[1],+m[2],0).getDate()).slice(-2);
  return"";
}
function trkPeriodLabel(p){
  var m=/^(\d{4})-(Q[1-4])$/.exec(p.expectedPeriod||"");
  if(m)return m[2]+" "+m[1];
  m=/^(\d{4})-(\d{2})$/.exec(p.expectedPeriod||"");
  if(m)return TRK_MONTHS[+m[2]-1]+" "+m[1];
  return p.expectedDate?trkFmtDate(p.expectedDate):"";
}
function trkStatusSlug(s){
  return {"Enquiry":"enquiry","Quoted":"quoted","Negotiation":"negotiation","Won":"won","Lost":"lost","On hold":"onhold","Other":"other"}[s]||"enquiry";
}
function trkStatusBadge(s){
  return "<span class='trk-badge trk-s-"+trkStatusSlug(s)+"'>"+trkEsc(s)+"</span>";
}
/* Payment progress badge, shown on Won projects only. An unset value
   means nothing has been received yet. */
var TRK_PAYMENTS=["Not paid","Partially paid","Fully paid"];
function trkPaymentBadge(p){
  if(p.status!=="Won")return"";
  var pay=p.payment||"Not paid";
  var slug={"Not paid":"not","Partially paid":"partial","Fully paid":"paid"}[pay]||"not";
  return " <span class='trk-badge trk-pay-"+slug+"'>"+trkEsc(pay)+"</span>"+
    (trkIsDelivered(p)?" <span class='trk-badge trk-delivered'>&#128666; Delivered</span>":"");
}
/* Delivered = the timeline has a "Delivery" entry (deleting it undoes it). */
function trkIsDelivered(p){
  return !!p._id&&TRK_ENTRIES.some(function(e){return e.projectId===p._id&&e.type==="Delivery";});
}
/* Won, fully paid and delivered = nothing left to do. */
function trkIsDone(p){return p.status==="Won"&&p.payment==="Fully paid"&&trkIsDelivered(p);}
/* ===== solution / product-type tag =====
   One small tag saying WHAT the project is about — Custom (printers),
   Posiva, Fire fighting… Free text with type-ahead so a new category
   needs no code change: the known ones get a curated dot color, any
   new one a stable hashed hue (same trick as the country colors). */
var TRK_SOLUTIONS=["Custom","Posiva","Fire fighting","Automotive","Others"];
var TRK_SOLUTION_COLORS={
  "Custom":"#1d4ed8",        /* blue */
  "Posiva":"#7c3aed",        /* violet */
  "Fire fighting":"#dc2626", /* red, obviously */
  "Automotive":"#0f766e",    /* teal — workshop equipment */
  "Others":"#6b7280"         /* gray — the catch-all bucket */
};
function trkSolutionColor(s){
  if(TRK_SOLUTION_COLORS[s])return TRK_SOLUTION_COLORS[s];
  var h=0;for(var i=0;i<s.length;i++)h=(h*31+s.charCodeAt(i))>>>0;
  return "hsl("+(h%360)+",60%,45%)";
}
function trkSolutionBadge(p){
  if(!p.solution)return"";
  return "<span class='trk-badge trk-sol'><span class='trk-sol-dot' style='background:"+trkSolutionColor(p.solution)+"'></span>"+trkEsc(p.solution)+"</span>";
}
/* Suggestion vocabulary: the seed list plus anything already tagged. */
function trkSolutionValues(){
  var seen={},out=[];
  TRK_SOLUTIONS.concat(TRK_PROJECTS.map(function(p){return p.solution;})).forEach(function(v){
    v=String(v||"").trim();
    if(v&&!seen[v.toLowerCase()]){seen[v.toLowerCase()]=1;out.push(v);}
  });
  return out.sort(trkAlpha);
}
function trkTypeSlug(t){
  return {"Meeting":"meeting","Quotation":"quotation","Purchase order":"po","Invoice":"invoice","Payment received":"payment","Call":"call","Email":"email","WhatsApp":"whatsapp","Site visit":"site","Delivery":"delivery","Note":"note"}[t]||"note";
}
function trkTypeBadge(t){return "<span class='trk-badge trk-type trk-t-"+trkTypeSlug(t)+"'>"+trkEsc(t)+"</span>";}
function trkValueHtml(p){
  if(p.estValue===null)return"";
  var usd=(p.currency!=="USD"&&typeof fxUsdText==="function")?fxUsdText(p.estValue,p.currency):"";
  return "<span class='trk-value'>"+p.estValue.toLocaleString()+" "+trkEsc(p.currency)+"</span>"+(usd?" <span class='trk-value-usd'>"+usd+"</span>":"");
}
/* Newest entry per project id, in one pass over the entries. Keeps the
   entry's created_at alongside its date so two entries on the same day
   can still be ordered by which was logged last. */
function trkLastActivityMap(){
  var m={};
  TRK_ENTRIES.forEach(function(e){
    var k={d:e.date||"",c:e.createdAt||""};
    var cur=m[e.projectId];
    if(!cur||k.d>cur.d||(k.d===cur.d&&k.c>cur.c))m[e.projectId]=k;
  });
  return m;
}
/* ===== follow-up reminder =====
   Only for projects still waiting on us (Enquiry, Quoted, Others, or Won
   but not fully paid):
   - a "next follow-up" date, when set, decides: due once that day
     arrives, quietly scheduled before. Any entry dated on/after it
     counts as the follow-up done, so it then stops applying.
   - otherwise the project goes "quiet" once its newest entry is 14+
     days old.
   Returns null when nothing applies, else {due,kind,days,date}. */
var TRK_STALE_DAYS=14;
function trkDaysBetween(a,b){return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/864e5);}
function trkToday(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}
function trkLastDate(p,act){
  var a=(act||trkLastActivityMap())[p._id];
  return a?a.d:(p.createdAt||"").slice(0,10);
}
/* the follow-up date still in force (blank once an entry covers it) */
function trkActiveFollowup(p,act){
  var f=p.nextFollowup;
  if(!f)return"";
  var last=trkLastDate(p,act);
  return last&&last>=f?"":f;
}
function trkIsOpen(p){
  return TRK_ACTIVE_STATUSES.indexOf(p.status)>-1||p.status==="Other"||(p.status==="Won"&&p.payment!=="Fully paid");
}
function trkFollow(p,act){
  /* low priority = just waiting on them: no reminders at all, neither
     Quiet nor an overdue follow-up date */
  if(!trkIsOpen(p)||p.lowPriority)return null;
  var today=trkToday(),f=trkActiveFollowup(p,act);
  if(f){
    var late=trkDaysBetween(f,today);
    return {due:late>=0,kind:"followup",days:late,date:f};
  }
  var last=trkLastDate(p,act);
  if(!last)return null;
  var days=trkDaysBetween(last,today);
  return days>=TRK_STALE_DAYS?{due:true,kind:"quiet",days:days,date:last}:null;
}
function trkFollowDue(p,act){var f=trkFollow(p,act);return f&&f.due?f:null;}
function trkFollowBadge(f){
  if(!f)return"";
  if(f.kind==="quiet")
    return "<span class='trk-badge trk-stale"+(f.days>=30?" trk-stale-hot":"")+"' title='No timeline entry for "+f.days+" days'>&#9200; Quiet "+f.days+"d</span>";
  var nice=trkFmtDate(f.date).replace(/ \d{4}$/,"");
  if(!f.due)return "<span class='trk-badge trk-fu' title='Next follow-up "+trkFmtDate(f.date)+"'>&#128197; Follow up "+nice+"</span>";
  if(f.days===0)return "<span class='trk-badge trk-stale' title='Follow-up planned for today'>&#9200; Follow up today</span>";
  return "<span class='trk-badge trk-stale trk-stale-hot' title='Follow-up was planned for "+trkFmtDate(f.date)+"'>&#9200; Follow-up overdue "+f.days+"d</span>";
}
/* ===== low priority =====
   For deals where we're just waiting on the customer: the project
   sinks to the bottom of its band, drops out of Needs follow-up (no
   Quiet nag) and shows a grey badge. One click on/off, from the panel
   or the full page. */
/* hourglass icon (the sleep emoji rendered as a blurry squiggle) */
var TRK_LOW_ICO="<svg class='trk-low-ico' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 2h12M6 22h12M7 2v4l5 6-5 6v4M17 2v4l-5 6 5 6v4'/></svg>";
function trkLowBadge(){return "<span class='trk-badge trk-low' title='Low priority — just waiting, no follow-up reminders'>"+TRK_LOW_ICO+"Low priority</span>";}
/* an on/off switch with a one-line explanation, so it reads as a
   setting rather than a stray link */
function trkLowBtn(p){
  if(!TRK_HAS_LOW)return"";
  return "<button class='trk-low-sw"+(p.lowPriority?" on":"")+"' role='switch' aria-checked='"+(p.lowPriority?"true":"false")+"' onclick='trkToggleLow(\""+p._id+"\")'>"+
    "<span class='trk-low-knob'></span>"+
    "<span class='trk-low-txt'><strong>"+TRK_LOW_ICO+"Low priority</strong>"+
      "<small>"+(p.lowPriority?"Waiting on them &mdash; kept at the bottom, no reminders":"Just waiting? Move it to the bottom and stop reminders")+"</small></span>"+
  "</button>";
}
async function trkToggleLow(id){
  var p=TRK_PROJECTS.find(function(x){return x._id===id;});
  if(!p)return;
  var v=!p.lowPriority;
  showLoad("Saving...");
  try{
    var r=await fetch(SB_URL+"/rest/v1/tracker_projects?id=eq."+p._id,{method:"PATCH",headers:sbH(),body:JSON.stringify({low_priority:v})});
    if(!r.ok)throw new Error("HTTP "+r.status);
    p.lowPriority=v;
  }catch(err){hideLoad();alert("Save failed: "+err.message);return;}
  hideLoad();
  renderTracker();
}
function trkEntriesFor(pid){
  return TRK_ENTRIES.filter(function(e){return e.projectId===pid;})
    .sort(function(a,b){
      var d=(b.date||"").localeCompare(a.date||"");
      return d!==0?d:(b.createdAt||"").localeCompare(a.createdAt||"");
    });
}
/* Flag only when we can actually draw one (hand-drawn SVG or a known
   ISO code for the CDN fallback) — the generic "?" placeholder looks
   broken next to unrecognized country names. */
function trkFlag(country,size){
  if(typeof FLAGS!=="undefined"&&FLAGS[country])return flagImg(country,size);
  if(typeof countryCode==="function"&&countryCode(country))return flagImg(country,size);
  return"";
}

/* ===== per-country card colors (left edge) =====
   Curated colors for the main markets — aligned with the office badge
   colors where country and office coincide — plus a stable hashed hue
   for any new country, so color coding needs no upkeep. */
var TRK_COUNTRY_COLORS={
  "China":"#b91c1c",        /* red — matches China office */
  "Indonesia":"#b45309",    /* gold — matches Indonesia office */
  "Singapore":"#1d4ed8",    /* blue — matches Singapore office */
  "Philippines":"#0d9488",  /* teal */
  "Bangladesh":"#15803d",   /* green */
  "India":"#ea580c",        /* orange */
  "Thailand":"#7c3aed",     /* violet */
  "Vietnam":"#0891b2",      /* cyan */
  "Malaysia":"#4f46e5",     /* indigo */
  "Italy":"#16a34a"         /* green */
};
function trkCountryColor(c){
  if(!c)return"";
  if(TRK_COUNTRY_COLORS[c])return TRK_COUNTRY_COLORS[c];
  var h=0;for(var i=0;i<c.length;i++)h=(h*31+c.charCodeAt(i))>>>0;
  return "hsl("+(h%360)+",60%,45%)";
}

/* ===== title date suffix =====
   Cards show "Name — 7 Sep 2026" using the project's earliest entry
   date (fallback: creation date), unless the name already contains a
   date of its own. */
var TRK_DATE_IN_NAME=/\d{1,2}\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|\d{4}-\d{2}|\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}/i;
function trkFirstDate(p){
  var d=null;
  TRK_ENTRIES.forEach(function(e){
    if(e.projectId===p._id&&e.date&&(!d||e.date<d))d=e.date;
  });
  return d||(p.createdAt||"").slice(0,10);
}
function trkDisplayName(p){return trkEsc(p.name);}
/* The project's own start date, shown beside customer and country. Blank
   when the name already spells a date out, so it is never said twice. */
function trkProjectDate(p){
  if(TRK_DATE_IN_NAME.test(p.name))return"";
  var d=trkFirstDate(p);
  return d?trkFmtDate(d):"";
}
function trkFileIcon(name){
  var n=String(name||"").toLowerCase();
  if(/\.(xls|xlsx|xlsm|csv)$/.test(n))return "&#128202;";   /* 📊 */
  if(/\.pdf$/.test(n))return "&#128196;";                    /* 📄 */
  if(/\.(png|jpe?g|gif|webp)$/.test(n))return "&#128247;";   /* 📷 */
  return "&#128206;";                                        /* 📎 */
}

/* Insert that surfaces the server's reason on failure — a bare "insert
   failed" told the user nothing when a column was missing. */
async function trkInsert(table,row){
  var r=await fetch(SB_URL+"/rest/v1/"+table,{method:"POST",headers:sbH(),body:JSON.stringify(row)});
  if(!r.ok){
    var detail="";try{detail=(await r.text()).slice(0,300);}catch(e){}
    throw new Error("HTTP "+r.status+(detail?" — "+detail:""));
  }
  return r.json();
}

/* ===== data load (lazy, on first tab open) ===== */
async function trkLoad(force){
  if(TRK_LOADED&&!force)return true;
  var res=await Promise.all([sbGet("tracker_projects"),sbGet("tracker_entries")]);
  if(!res[0]||!res[1]){TRK_MISSING=true;return false;}
  TRK_MISSING=false;
  TRK_PROJECTS=res[0].map(dbToTrkP);
  TRK_ENTRIES=res[1].map(dbToTrkE);
  /* next_followup is a later column; until it exists the follow-up
     fields stay hidden and saves leave it out */
  TRK_HAS_FU=!res[0].length||("next_followup" in res[0][0]);
  document.querySelectorAll(".trk-fu-field").forEach(function(el){el.style.display=TRK_HAS_FU?"":"none";});
  TRK_HAS_LOW=!res[0].length||("low_priority" in res[0][0]);
  TRK_LOADED=true;
  return true;
}

/* ===== stats (replaces the customer stat row while on this tab) ===== */
function trkRenderStats(){
  var el=document.getElementById("stats");
  if(!el)return;
  var active=TRK_PROJECTS.filter(function(p){return TRK_ACTIVE_STATUSES.indexOf(p.status)>-1;});
  var quoted=TRK_PROJECTS.filter(function(p){return p.status==="Quoted";}).length;
  var won=TRK_PROJECTS.filter(function(p){return p.status==="Won";});
  var wonVal=0;
  won.forEach(function(p){
    if(p.estValue===null)return;
    var v=(typeof fxToUSD==="function")?fxToUSD(p.estValue,p.currency):(p.currency==="USD"?p.estValue:null);
    if(v!==null)wonVal+=v;
  });
  el.innerHTML=
    "<div class='stat'><div class='stat-label'>Active projects</div><div class='stat-value'>"+active.length+"</div><div class='stat-sub'>enquiry &rarr; quoted</div></div>"+
    "<div class='stat'><div class='stat-label'>Quotes outstanding</div><div class='stat-value'>"+quoted+"</div><div class='stat-sub'>waiting on customer</div></div>"+
    "<div class='stat'><div class='stat-label'>Won</div><div class='stat-value'>"+won.length+"</div><div class='stat-sub'>"+(wonVal?(typeof fxFormatUSD==="function"?fxFormatUSD(wonVal):"$"+wonVal.toLocaleString())+" USD equivalent":"projects closed")+"</div></div>";
}

/* On the tracker the global toolbar "+ Add entry" button is only the
   phone's floating + (the computer uses the Add project button in the
   tracker's own filter row). It creates a project, so relabel it; in the
   detail view the Timeline has its own button, so hide the global one. */
var TRK_BTN_HTML=null;
function trkSyncToolbar(){
  var btn=document.querySelector("#toolbar .btn-add");
  if(!btn)return;
  if(TRK_BTN_HTML===null)TRK_BTN_HTML=btn.innerHTML;
  /* phones hide the toolbar but keep its add button as a floating + on every
     tab that can add something; the computer's tracker uses its own button */
  var tb=document.getElementById("toolbar");
  tb.classList.toggle("trk-fab",currentTab==="tracker");
  tb.classList.toggle("has-fab",["customers","tracker","po","buying","spares","others"].indexOf(currentTab)>-1);
  if(currentTab==="tracker"){
    if(TRK_SEL&&TRK_VIEW==="cal"){btn.style.display="none";}
    else{btn.style.display="";btn.innerHTML=TRK_BTN_HTML.replace("Add entry","Add project");}
  }else{
    btn.style.display="";
    btn.innerHTML=TRK_BTN_HTML;
  }
}

/* Status is DERIVED from the timeline, not edited by hand:
   Purchase order / Invoice / Payment received / Delivery ⇒ Won
   (you only invoice or deliver after a sale), Quotation ⇒ Quoted,
   nothing ⇒ Enquiry. "Lost" is the one manual flag (set from the
   editor's Mark-as-lost button) and is never derived away. The pass
   runs on every tracker render, so adding, editing or deleting
   entries keeps statuses correct with no extra bookkeeping. */
var TRK_WIN_TYPES=["Purchase order","Invoice","Payment received","Delivery"];
function trkDerivedStatus(p){
  if(p.status==="Lost")return "Lost";
  if(p.status==="Other")return "Other"; /* outside the pipeline */
  var won=false,quoted=false;
  TRK_ENTRIES.forEach(function(e){
    if(e.projectId!==p._id)return;
    if(TRK_WIN_TYPES.indexOf(e.type)>-1)won=true;
    else if(e.type==="Quotation")quoted=true;
  });
  return won?"Won":(quoted?"Quoted":"Enquiry");
}
function trkReconcileStatus(){
  TRK_PROJECTS.forEach(function(p){
    var s=trkDerivedStatus(p);
    if(p.status===s)return;
    p.status=s;
    fetch(SB_URL+"/rest/v1/tracker_projects?id=eq."+p._id,{method:"PATCH",headers:sbH(),body:JSON.stringify({status:s})})
      .catch(function(err){console.error("Status reconcile failed:",err);});
  });
}

/* ===== main render ===== */
function renderTracker(){
  var content=document.getElementById("content");
  if(!TRK_LOADED){
    content.innerHTML="<div class='empty'>Loading project tracker&hellip;</div>";
    trkLoad().then(function(ok){
      if(currentTab!=="tracker")return;
      if(!ok){
        var st=document.getElementById("stats");if(st)st.innerHTML="";
        content.innerHTML="<div class='empty'>The tracker tables don't exist in Supabase yet (tracker_projects / tracker_entries).<br>Run the setup SQL once in the Supabase SQL editor, then reload.</div>";
        return;
      }
      renderTracker();
    });
    return;
  }
  trkReconcileStatus();
  trkRenderStats();
  if(TRK_SEL&&!TRK_PROJECTS.some(function(p){return p._id===TRK_SEL;}))TRK_SEL=null;
  if(!TRK_SEL)TRK_EXPAND=false;
  trkSyncToolbar();
  /* in list view a selected project opens in the side panel (clicking it
     again, or Expand, opens the full detail page); the calendar always
     opens the full page */
  if(TRK_SEL&&(TRK_VIEW==="cal"||TRK_EXPAND)){trkRenderDetail();window.scrollTo(0,0);return;}
  trkRenderList();
}

function trkStaleOn(){return TRK_FSTATUS[0]==="stale";}
function trkAllStatusesOn(){
  return TRK_CHIP_ORDER.every(function(s){return TRK_FSTATUS.indexOf(s)>-1;});
}
function trkDefaultStatusesOn(){
  return TRK_FSTATUS.length===TRK_FSTATUS_DEFAULT.length&&
    TRK_FSTATUS_DEFAULT.every(function(s){return TRK_FSTATUS.indexOf(s)>-1;});
}
/* "All" turns every status on (again: back to the default),
   "Needs follow-up" is exclusive (it re-sorts the list), any other chip
   toggles on or off; switching the last one off returns to the default */
function trkSetStatusFilter(s){
  if(!s)TRK_FSTATUS=trkAllStatusesOn()?TRK_FSTATUS_DEFAULT.slice():TRK_CHIP_ORDER.slice();
  else if(s==="stale")TRK_FSTATUS=trkStaleOn()?TRK_FSTATUS_DEFAULT.slice():["stale"];
  else{
    var cur=TRK_FSTATUS.filter(function(x){return x!=="stale";}),at=cur.indexOf(s);
    if(at>-1)cur.splice(at,1);else cur.push(s);
    TRK_FSTATUS=cur.length?cur:TRK_FSTATUS_DEFAULT.slice();
  }
  renderTracker();
}
function trkPickStatus(v){
  if(v==="__all"){TRK_FSTATUS=TRK_CHIP_ORDER.slice();renderTracker();}
  else if(v==="__open"){TRK_FSTATUS=TRK_FSTATUS_DEFAULT.slice();renderTracker();}
  else trkSetStatusFilter(v);
}
function trkSetOfficeFilter(s){TRK_FOFFICE=s;renderTracker();}
function trkSetSolutionFilter(s){TRK_FSOL=s;renderTracker();}

/* ===== smart search =====
   Nothing is hard-coded: every project is indexed from its own fields
   and timeline entries, and each query word is matched loosely —
     exact / start of a word   "phili"  → Philippine Airlines
     initials                  "PAL"    → Philippine AirLines (letters may
                                          run on inside a word, fzf-style)
     inside a word / squashed  "180", "tk 180" → TK180
     small typos               "phillipines" → Philippines
     dates                     "oct", "october 2026", "2026-10", "10/2026", "Q4"
   Every query word must match somewhere; the best matches rank first. */
var TRK_FULL_MONTHS=["january","february","march","april","may","june","july","august","september","october","november","december"];
function trkNorm(s){
  return String(s===null||s===undefined?"":s).normalize("NFD").replace(/[̀-ͯ]/g,"")
    .toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
function trkSearchQuery(raw){
  var n=trkNorm(raw);
  if(!n)return null;
  return {tokens:n.split(" "),compact:n.replace(/ /g,"")};
}
/* Every way someone might type a date: 7 Oct 2026, October 2026,
   2026-10-07, 2026-10, 07/10/2026, 10/2026, Q4 2026. */
function trkDateWords(d){
  var m=/^(\d{4})-(\d{2})-(\d{2})/.exec(d||"");
  if(!m)return"";
  var y=m[1],mo=+m[2],day=+m[3];
  return [y+"-"+m[2]+"-"+m[3],y+"-"+m[2],day+" "+TRK_MONTHS[mo-1]+" "+y,TRK_FULL_MONTHS[mo-1]+" "+y,
    m[3]+"/"+m[2]+"/"+y,mo+"/"+y,"q"+Math.ceil(mo/3)+" "+y].join(" ");
}
/* filler words that don't count towards initials ("Bank of X" → BX too) */
var TRK_SEARCH_STOP={of:1,and:1,the:1,"for":1,inc:1,co:1,ltd:1,corp:1,pt:1,tbk:1};
/* "entity" fields are short names (customer, products, contact…) — the
   only ones loose tricks like initials and squashed matching run on, so
   long notes don't throw up false hits. */
function trkSearchField(label,text,shown,extra,entity){
  var n=trkNorm(text+(extra?" "+extra:""));
  var words=n?n.split(" "):[];
  return {label:label,raw:String(text||""),shown:shown,entity:!!entity,words:words,compact:words.join(""),
    sig:words.filter(function(w){return !TRK_SEARCH_STOP[w];})};
}
function trkSearchFields(p){
  var first=trkFirstDate(p);
  var f=[
    trkSearchField("Name",p.name,true,"",true),
    trkSearchField("Customer",p.customer,true,"",true),
    trkSearchField("Country",p.country,true,"",true),
    trkSearchField("Office",p.office?p.office+" office":"",true),
    trkSearchField("Status",[p.status,p.payment].filter(Boolean).join(" · "),true),
    trkSearchField("Solution",p.solution,true,"",true),
    trkSearchField("Products",(p.products||[]).join(", "),true,"",true),
    trkSearchField("Contact",[p.contactName,p.contactPosition,p.contactInfo].filter(Boolean).join(" · "),false,"",true),
    trkSearchField("Notes",p.notes,false),
    trkSearchField("Value",p.estValue!==null?p.estValue.toLocaleString()+" "+p.currency:"",true,p.estValue!==null?String(p.estValue):""),
    trkSearchField("Expected",trkPeriodLabel(p),true,trkDateWords(p.expectedDate)+" "+(p.expectedPeriod||"")),
    trkSearchField("Started",trkFmtDate(first),true,trkDateWords(first)),
    trkSearchField("Follow-up",p.nextFollowup?"follow up "+trkFmtDate(p.nextFollowup):"",true,trkDateWords(p.nextFollowup))
  ];
  trkEntriesFor(p._id).forEach(function(e){
    var att=(e.attachments||[]).map(function(a){return a.name;}).join(", ");
    f.push(trkSearchField(trkFmtDate(e.date)+" · "+e.type,
      [e.title,e.details,att].filter(Boolean).join(" — ")||e.type,false,e.type+" "+trkDateWords(e.date)));
  });
  return f;
}
/* Optimal-string-alignment distance, bailing out once it passes max. */
function trkEditDist(a,b,max){
  if(Math.abs(a.length-b.length)>max)return max+1;
  var prev2=null,prev=[],i,j;
  for(j=0;j<=b.length;j++)prev[j]=j;
  for(i=1;i<=a.length;i++){
    var cur=[i],best=i;
    for(j=1;j<=b.length;j++){
      cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));
      if(prev2&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])cur[j]=Math.min(cur[j],prev2[j-2]+1);
      if(cur[j]<best)best=cur[j];
    }
    if(best>max)return max+1;
    prev2=prev;prev=cur;
  }
  return prev[b.length];
}
/* Initials: first letter starts a word, each next letter starts the
   following word (CP → Cebu Pacific) or, when loose, may also continue
   inside the current one (PAL → Philippine AirLines). Spans 2+ words. */
function trkAcronym(t,words,loose){
  function go(ti,wi,pos,span){
    if(ti===t.length)return span>=2;
    var c=t[ti],w=words[wi];
    if(loose)for(var k=pos;k<w.length;k++)if(w[k]===c&&go(ti+1,wi,k+1,span))return true;
    var nx=words[wi+1];
    return !!nx&&nx[0]===c&&go(ti+1,wi+1,1,span+1);
  }
  for(var i=0;i<words.length-1;i++)if(words[i][0]===t[0]&&go(1,i,1,1))return true;
  return false;
}
function trkTokenScore(t,f){
  var best=0,num=/^\d+$/.test(t);
  for(var i=0;i<f.words.length;i++){
    var w=f.words[i];
    if(w===t)return 10;
    if(w.indexOf(t)===0)best=Math.max(best,8);
    else if(t.length>=3&&w.indexOf(t)>0)best=Math.max(best,5);
    /* typos: same first letter, 1 slip from 5 letters, 2 from 8 */
    else if(!num&&t.length>=5&&best<3&&w[0]===t[0]){
      var max=t.length>=8?2:1;
      if(trkEditDist(t,w.slice(0,t.length),max)<=max||trkEditDist(t,w,max)<=max)best=3;
    }
  }
  if(f.entity&&best<8&&!num&&t.length>=2&&f.sig.length>1){
    if(trkAcronym(t,f.sig,false))best=9;
    else if(best<7&&trkAcronym(t,f.sig,true))best=7;
  }
  if(f.entity&&best<4&&t.length>=3&&f.compact.indexOf(t)>-1)best=4;
  return best;
}
function trkSearchProject(p,q){
  var fields=trkSearchFields(p),score=0,why=null;
  for(var i=0;i<q.tokens.length;i++){
    var t=q.tokens[i],top=0,topF=null;
    fields.forEach(function(f){
      var s=trkTokenScore(t,f);
      /* on-card fields win ties, so the reason line only shows when the
         match really is somewhere you can't see */
      if(s>top||(s===top&&s>0&&f.shown&&!topF.shown)){top=s;topF=f;}
    });
    if(!top)return null;
    /* hits in the name or customer outrank e.g. the country */
    score+=top+(topF.shown?1:0)+(topF.label==="Name"||topF.label==="Customer"?1:0);
    if(!topF.shown&&!why)why=topF;
  }
  /* the whole query squashed together, e.g. "tk 180" inside "TK180" */
  if(q.tokens.length>1&&q.compact.length>=4&&fields.some(function(f){return f.entity&&f.compact.indexOf(q.compact)>-1;}))score+=5;
  return {score:score,why:why?"<span class='trk-why-label'>"+trkEsc(why.label)+":</span> "+trkSnippet(why.raw,q):""};
}
/* Escape text, marking the part of each word a query word matched. */
function trkHighlight(text,q){
  return String(text||"").split(/([^A-Za-z0-9À-ɏ]+)/).map(function(part){
    var n=trkNorm(part);
    if(!n)return trkEsc(part);
    var len=0;
    q.tokens.forEach(function(t){
      if(n.indexOf(t)===0){if(t.length>len&&len>=0)len=t.length;}
      else if(t.length>=3&&n.indexOf(t)>0)len=-1;
    });
    if(len>0)return "<mark>"+trkEsc(part.slice(0,len))+"</mark>"+trkEsc(part.slice(len));
    if(len<0)return "<mark>"+trkEsc(part)+"</mark>";
    return trkEsc(part);
  }).join("");
}
/* A short window of the hidden text around the first word that matched. */
function trkSnippet(raw,q){
  var words=raw.split(/\s+/),at=0;
  for(var i=0;i<words.length;i++){
    var n=trkNorm(words[i]);
    if(n&&q.tokens.some(function(t){return n.indexOf(t)>-1;})){at=i;break;}
  }
  var from=Math.max(0,at-6),to=Math.min(words.length,at+14);
  return (from?"&hellip;":"")+trkHighlight(words.slice(from,to).join(" "),q)+(to<words.length?"&hellip;":"");
}

function trkRenderList(bodyOnly){
  var act=trkLastActivityMap();
  var staleN=TRK_PROJECTS.filter(function(p){return trkFollowDue(p,act);}).length;
  var cnt=function(f){return TRK_PROJECTS.filter(f).length;};
  var stOpts=TRK_CHIP_ORDER.map(function(st){
    var n=cnt(function(p){return p.status===st;});
    return (st==="Other"&&!n)?null:{value:st,label:st==="Other"?"Others":st,count:n};
  }).filter(Boolean);
  var stLabel=trkStaleOn()?"Status: any":trkDefaultStatusesOn()?"Status: All but Lost":trkAllStatusesOn()?"All statuses":
    TRK_FSTATUS.length<=2?TRK_FSTATUS.map(function(x){return x==="Other"?"Others":x;}).join(" + "):TRK_FSTATUS.length+" statuses";
  var statusMenu=uiDropdown({key:"trk-status",multi:true,onPick:"trkPickStatus",cur:trkStaleOn()?[]:TRK_FSTATUS,opts:stOpts,
    label:stLabel,count:trkStaleOn()?undefined:cnt(function(p){return TRK_FSTATUS.indexOf(p.status)>-1;}),
    foot:[{value:"__all",label:"Show all"},{value:"__open",label:"Hide Lost"}]});
  var fuBtn=(staleN||trkStaleOn())?"<button class='trk-fu-toggle"+(trkStaleOn()?" active":"")+"' onclick='trkSetStatusFilter(\"stale\")' title='Open projects due a follow-up'>&#9200;<span class='trk-fu-txt'> Needs follow-up</span> <span class='po-dd-n'>"+staleN+"</span></button>":"";

  var officeSel=uiDropdown({key:"trk-office",onPick:"trkSetOfficeFilter",cur:TRK_FOFFICE,
    opts:[{value:"",label:"All offices",count:TRK_PROJECTS.length}].concat(TRK_OFFICES.map(function(o){
      return {value:o,label:o,dot:poOfficeSlug(o),count:cnt(function(p){return p.office===o;})};
    }))});

  /* Solution filter only appears once at least one project is tagged. */
  var solsUsed={};
  TRK_PROJECTS.forEach(function(p){var v=String(p.solution||"").trim();if(v)solsUsed[v]=1;});
  var solList=Object.keys(solsUsed).sort(trkAlpha);
  var solSel=solList.length?uiDropdown({key:"trk-sol",onPick:"trkSetSolutionFilter",cur:TRK_FSOL,
    opts:[{value:"",label:"All solutions",count:TRK_PROJECTS.length}].concat(solList.map(function(x){
      return {value:x,label:x,color:trkSolutionColor(x),count:cnt(function(p){return p.solution===x;})};
    }))}):"";

  /* Most recently active project first — the "Last: …" line on each card
     is what drives the order, so logging an entry brings that project to
     the top. Closed projects (Won/Lost) sink below the live pipeline. */
  function actOf(p){return act[p._id]||{d:(p.createdAt||"").slice(0,10),c:p.createdAt||""};}
  /* With the default chips, a search looks through everything (Won and
     Lost included); a changed chip selection narrows it. Each hit
     carries a score and a "why it matched". */
  var q=trkSearchQuery(TRK_Q),hits={};
  var list=TRK_PROJECTS.filter(function(p){
    if(!(trkStaleOn()?trkFollowDue(p,act):(q&&trkDefaultStatusesOn())||TRK_FSTATUS.indexOf(p.status)>-1)||(TRK_FOFFICE&&p.office!==TRK_FOFFICE)||(TRK_FSOL&&p.solution!==TRK_FSOL))return false;
    if(!q)return true;
    var h=trkSearchProject(p,q);
    if(h)hits[p._id]=h;
    return !!h;
  }).sort(function(a,b){
    if(q&&hits[a._id].score!==hits[b._id].score)return hits[b._id].score-hits[a._id].score;
    /* the follow-up list puts the longest-forgotten first */
    if(trkStaleOn())return trkFollowDue(b,act).days-trkFollowDue(a,act).days;
    /* completed projects (won, paid, delivered) go to the very bottom */
    var xa=trkIsDone(a)?1:0,xb=trkIsDone(b)?1:0;
    if(xa!==xb)return xa-xb;
    var ca=TRK_CLOSED_STATUSES.indexOf(a.status)>-1?1:0;
    var cb=TRK_CLOSED_STATUSES.indexOf(b.status)>-1?1:0;
    if(ca!==cb)return ca-cb;
    /* low-priority (waiting) projects sit below the live ones */
    if(!!a.lowPriority!==!!b.lowPriority)return a.lowPriority?1:-1;
    var da=actOf(a),db=actOf(b);
    if(da.d!==db.d)return db.d.localeCompare(da.d);
    if(da.c!==db.c)return db.c.localeCompare(da.c);
    return (b.createdAt||"").localeCompare(a.createdAt||"");
  });

  function rowHtml(p){
    var entries=trkEntriesFor(p._id),last=entries[0];
    var hl=q?function(t){return trkHighlight(t,q);}:trkEsc,hit=hits[p._id];
    var flag=trkFlag(p.country,14);
    var sub=[hl(p.customer),hl(p.country)].filter(Boolean).join(" &middot; ");
    var done=trkIsDone(p);
    return "<tr class='trk-row"+(TRK_SEL===p._id?" sel":"")+(done?" trk-row-done":p.lowPriority?" trk-row-low":"")+"' onclick='trkOpen(\""+p._id+"\")'>"+
      "<td class='trk-c-proj'><div class='trk-r-name'>"+(q?hl(p.name):trkDisplayName(p))+"</div>"+
        (sub?"<div class='trk-r-sub'>"+(flag?flag+" ":"")+sub+"</div>":"")+
        (hit&&hit.why?"<div class='trk-card-why'>&#128269; "+hit.why+"</div>":"")+"</td>"+
      "<td class='trk-c-st'>"+(done?"<span class='trk-badge trk-s-won'>&#10003; Done</span>":trkStatusBadge(p.status)+trkPaymentBadge(p))+"</td>"+
      "<td class='trk-c-of'>"+(p.office?"<span class='trk-badge po-of-"+poOfficeSlug(p.office)+"'>"+trkEsc(p.office)+"</span>":"")+"</td>"+
      "<td class='trk-c-val num'>"+(p.estValue!==null?p.estValue.toLocaleString()+" <span class='trk-r-cur'>"+trkEsc(p.currency)+"</span>":"<span class='trk-r-none'>&mdash;</span>")+"</td>"+
      "<td class='trk-c-last'>"+(last?"<div>"+trkFmtDate(last.date)+"</div><div class='trk-r-sub'>"+trkEsc(last.type)+(last.title?" &mdash; "+trkEsc(last.title):"")+"</div>":"<span class='trk-r-none'>No activity yet</span>")+"</td>"+
      "<td class='trk-c-fu'>"+(trkFollowBadge(trkFollow(p,act))||(p.lowPriority&&!done?trkLowBadge():""))+"</td>"+
    "</tr>";
  }
  var COLS=6;
  /* rows with a thin divider above each run of low-priority rows */
  function isLow(p){return p&&p.lowPriority&&!trkIsDone(p);}
  function rowsWithLowDiv(arr){
    return arr.map(function(p,i){
      if(!isLow(p)||isLow(arr[i-1]))return rowHtml(p);
      var n=0;while(isLow(arr[i+n]))n++;
      return "<tr class='trk-low-div'><td colspan='"+COLS+"'>"+TRK_LOW_ICO+"Low priority &middot; waiting<span class='trk-low-n'>"+n+"</span></td></tr>"+rowHtml(p);
    }).join("");
  }

  /* ===== solution bands =====
     Once anything is tagged, rows sit under tinted solution bands
     (Custom, Posiva, Fire fighting, Others…), untagged projects last.
     A flat list remains for a search, the follow-up list, a single
     solution, or when nothing is tagged yet. */
  var rows;
  if(q||TRK_FSOL||trkStaleOn()||!list.some(function(p){return p.solution;})){
    /* a search or the follow-up list is ordered by relevance, not priority */
    rows=q||trkStaleOn()?list.map(rowHtml).join(""):rowsWithLowDiv(list);
  }else{
    var order=TRK_SOLUTIONS.slice(),extra=[];
    list.forEach(function(p){
      var x=p.solution;
      if(x&&order.indexOf(x)===-1&&extra.indexOf(x)===-1)extra.push(x);
    });
    order=order.concat(extra.sort(trkAlpha));
    order.push(""); /* untagged bucket last */
    rows=order.map(function(x){
      var grp=list.filter(function(p){return (p.solution||"")===x;});
      if(!grp.length)return"";
      /* Inside a sector the newest entry wins outright — closed
         projects don't sink here, per the user's preference — except
         completed ones (won, paid, delivered), which go to the bottom. */
      grp.sort(function(a,b){
        var xa=trkIsDone(a)?2:a.lowPriority?1:0,xb=trkIsDone(b)?2:b.lowPriority?1:0;
        if(xa!==xb)return xa-xb;
        var da=actOf(a),db=actOf(b);
        if(da.d!==db.d)return db.d.localeCompare(da.d);
        if(da.c!==db.c)return db.c.localeCompare(da.c);
        return (b.createdAt||"").localeCompare(a.createdAt||"");
      });
      var due=grp.filter(function(p){return trkFollowDue(p,act);}).length;
      return "<tr class='trk-band'><td colspan='"+COLS+"' style='box-shadow:inset 3px 0 0 "+(x?trkSolutionColor(x):"var(--border-strong)")+",inset 0 -1px 0 var(--border)'>"+
        "<span class='po-grp-name'>"+(x?trkEsc(x):"No tag yet")+"</span><span class='po-grp-n'>"+grp.length+"</span>"+
        (due?"<span class='trk-band-due'>&#9200; "+due+" need follow-up</span>":"")+
      "</td></tr>"+rowsWithLowDiv(grp);
    }).join("");
  }
  var selP=TRK_SEL?TRK_PROJECTS.find(function(x){return x._id===TRK_SEL;}):null;
  var cards=rows?"<div class='po-split trk-split"+(selP?" has-sel":"")+"'>"+
    "<div class='po-table-wrap'><table class='po-table trk-list'><thead><tr>"+
      "<th>Project</th><th>Status</th><th class='trk-c-of'>Office</th><th class='trk-c-val num'>Value</th><th>Last update</th><th>Follow-up</th>"+
    "</tr></thead><tbody>"+rows+"</tbody></table></div>"+
    (selP?trkPanelHtml(selP,act):"")+
  "</div>":"";

  var body=TRK_VIEW==="cal"?trkCalendarHtml(list,act):(q?"<div class='trk-search-count'>"+list.length+" project"+(list.length===1?"":"s")+" match <strong>"+trkEsc(TRK_Q.trim())+"</strong></div>":"")+
    (cards||"<div class='empty'>"+(q?"Nothing matches that search. Try part of a name, a model, a month (e.g. <em>oct 2026</em>) or initials (e.g. <em>PAL</em>).":trkStaleOn()?"All caught up &mdash; no follow-ups due and every open project has an update from the last "+TRK_STALE_DAYS+" days.":TRK_PROJECTS.length?"No projects match this filter.":"No projects yet. Click <strong>+ Add entry</strong> to record your first enquiry.")+"</div>");
  /* Typing only swaps the list body, so the search box keeps focus. */
  if(bodyOnly&&document.getElementById("trk-list-body")){
    document.getElementById("trk-list-body").innerHTML=body;
    return;
  }
  var search="<div class='trk-search'><span class='trk-search-ico'>&#128269;</span>"+
    "<input id='trk-search' type='search' value='"+trkEsc(TRK_Q)+"' placeholder='Search projects&hellip;' title='Customer, model, month, notes or initials' autocomplete='off' data-1p-ignore data-lpignore='true' data-bwignore data-form-type='other' readonly onfocus=\"this.removeAttribute('readonly')\" oninput='trkSearchInput(this.value)'>"+
    "</div>";
  var viewSw="<div class='trk-viewsw' role='group' aria-label='View'>"+
    "<button class='"+(TRK_VIEW!=="cal"?"active":"")+"' onclick='trkSetView(\"list\")' title='List'>&#9776;<span class='trk-vs-txt'> List</span></button>"+
    "<button class='"+(TRK_VIEW==="cal"?"active":"")+"' onclick='trkSetView(\"cal\")' title='Calendar'>&#128197;<span class='trk-vs-txt'> Calendar</span></button>"+
    "</div>";
  /* The menus and List/Calendar fold away behind a Filters button
     (dot = something is narrowing the list). */
  var narrowed=(!trkStaleOn()&&!trkDefaultStatusesOn())||TRK_FOFFICE||TRK_FSOL||TRK_VIEW==="cal";
  var filtBtn="<button class='trk-filt-btn"+(narrowed?" on":"")+"' onclick='trkToggleFilters()' aria-expanded='"+TRK_FILT_OPEN+"'>"+
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round'><path d='M4 6h16M7 12h10M10 18h4'/></svg>Filters</button>";
  var addBtn="<button class='btn-add trk-add' onclick='trkOpenAdd()'>"+
    "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' style='width:13px;height:13px'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg> Add project</button>";
  document.getElementById("content").innerHTML=
    "<div class='trk-bar"+(TRK_FILT_OPEN?" open":"")+"'>"+search+fuBtn+filtBtn+addBtn+
      "<div class='trk-bar-more'>"+statusMenu+solSel+officeSel+viewSw+"</div></div>"+
    "<div id='trk-list-body'>"+body+"</div>";
}
function trkSearchInput(v){TRK_Q=v;trkRenderList(true);}
var TRK_FILT_OPEN=false;
function trkToggleFilters(){
  TRK_FILT_OPEN=!TRK_FILT_OPEN;
  var bar=document.querySelector(".trk-bar");
  if(!bar)return;
  bar.classList.toggle("open",TRK_FILT_OPEN);
  bar.querySelector(".trk-filt-btn").setAttribute("aria-expanded",TRK_FILT_OPEN);
}

/* Side panel for the selected project: the key facts, its next step and
   the timeline, with Add update / Edit project — the same entry and
   project forms the full detail page uses (they act on TRK_SEL). */
function trkPanelHtml(p,act){
  var entries=trkEntriesFor(p._id);
  var info=function(label,html){return html?"<div class='trk-pn-row'><span>"+label+"</span><div>"+html+"</div></div>":"";};
  var flag=trkFlag(p.country,16);
  var tl=entries.map(function(e){
    var atts=(e.attachments||[]).map(function(a){
      return "<a class='trk-att' href='"+trkEsc(a.url)+"' data-name='"+trkEsc(a.name)+"' onclick='return trkViewFile(this)'>"+trkFileIcon(a.name)+" "+trkEsc(a.name)+"</a>";
    }).join("");
    return "<div class='trk-pn-e'><div class='trk-pn-e-meta'><strong>"+trkFmtDate(e.date)+"</strong> "+trkTypeBadge(e.type)+
        "<a href='#' class='trk-tl-edit' onclick='trkEditEntry(event,\""+e._id+"\")'>Edit</a></div>"+
      (e.title?"<div class='trk-pn-e-title'>"+trkEsc(e.title)+"</div>":"")+
      (e.details?"<div class='trk-pn-e-det'>"+trkEsc(e.details).replace(/\n/g,"<br>")+"</div>":"")+
      (atts?"<div class='trk-tl-atts'>"+atts+"</div>":"")+
    "</div>";
  }).join("");
  return "<aside class='po-panel trk-panel'>"+
    "<div class='po-panel-head'><span class='po-panel-no'>"+trkDisplayName(p)+"</span>"+
      "<button class='trk-pn-expand' title='Open full page' aria-label='Open full page' onclick='trkExpand()'>&#x2922;</button>"+
      "<button class='po-panel-x' aria-label='Close' onclick='trkBack()'>&times;</button></div>"+
    "<div class='po-panel-meta'>"+trkStatusBadge(p.status)+trkPaymentBadge(p)+trkFollowBadge(trkFollow(p,act))+(p.lowPriority?trkLowBadge():"")+"</div>"+
    ((p.customer||p.country)?"<div class='trk-pn-cust'>"+(flag?flag+" ":"")+[trkEsc(p.customer),trkEsc(p.country)].filter(Boolean).join(" &middot; ")+"</div>":"")+
    "<div class='po-panel-acts'><button class='btn-save' onclick='trkOpenEntryModal()'>+ Add update</button><button class='edit-btn' onclick='trkEditProject()'>Edit project</button></div>"+trkLowBtn(p)+
    "<div class='po-panel-sec'>Details</div>"+
    info("Office",p.office?"<span class='trk-badge po-of-"+poOfficeSlug(p.office)+"'>"+trkEsc(p.office)+" office</span>":"")+
    info("Solution",trkSolutionBadge(p))+
    info("Products",trkProductChips(p))+
    info("Value",p.estValue!==null?trkValueHtml(p):"")+
    info("Expected close",trkPeriodLabel(p))+
    info("Next follow-up",trkActiveFollowup(p,act)?trkFmtDate(trkActiveFollowup(p,act)):"")+
    info("Contact",trkEsc(p.contactName)+(p.contactPosition?" &middot; "+trkEsc(p.contactPosition):"")+(p.contactInfo?"<div class='trk-value-usd'>"+trkEsc(p.contactInfo)+"</div>":""))+
    (p.notes?"<div class='po-panel-sec'>Description</div><div class='po-panel-note'>"+trkEsc(p.notes)+"</div>":"")+
    "<div class='po-panel-sec'>Timeline &middot; "+entries.length+"</div>"+
    (tl||"<div class='trk-r-none' style='font-size:12px'>No updates yet. Add the enquiry, a call or a quotation.</div>")+
  "</aside>";
}
/* Esc closes the panel */
document.addEventListener("keydown",function(e){
  if(e.key!=="Escape"||typeof currentTab==="undefined"||currentTab!=="tracker"||!TRK_SEL||TRK_VIEW==="cal")return;
  if(/^(INPUT|TEXTAREA|SELECT)$/.test((e.target&&e.target.tagName)||""))return;
  if(document.querySelector(".modal-overlay.open")||(typeof UI_DD_OPEN!=="undefined"&&UI_DD_OPEN))return;
  trkBack();
});

/* untagged projects' bucket key */
var TRK_GROUP_NONE="__untagged";

/* ===== calendar view =====
   Same projects as the list (status chips, search, office and solution
   filters all apply). Each project shows once, on the day of its LATEST
   timeline entry, coloured by how long it has gone without an update:
   green under 14 days, amber 14+, red 30+ (closed projects in grey).
   A project's next follow-up, when one is set, also shows on its day.
   The side panel groups the open projects by those same bands (oldest
   first); picking a day swaps it for that day's projects. */
var TRK_VIEW=(function(){try{return localStorage.getItem("cpd_trk_view")==="cal"?"cal":"list";}catch(e){return "list";}})();
var TRK_CAL_M="";   /* "YYYY-MM" shown; blank = this month */
var TRK_CAL_SEL=""; /* picked day; blank = none (panel shows the bands) */
/* side panel shown or collapsed (remembered per browser) */
var TRK_CAL_SIDE=(function(){try{return localStorage.getItem("cpd_trk_side")!=="0";}catch(e){return true;}})();
function trkCalToggleSide(show){
  TRK_CAL_SIDE=show===undefined?!TRK_CAL_SIDE:!!show;
  try{localStorage.setItem("cpd_trk_side",TRK_CAL_SIDE?"1":"0");}catch(e){}
  trkRenderList(true);
}
/* age bands folded shut in the side panel (remembered per browser);
   toggled in place so the panel keeps its scroll position */
var TRK_CAL_FOLD=(function(){try{return (localStorage.getItem("cpd_trk_fold")||"").split(",").filter(Boolean);}catch(e){return [];}})();
function trkCalToggleBand(btn,tone){
  var at=TRK_CAL_FOLD.indexOf(tone);
  if(at>-1)TRK_CAL_FOLD.splice(at,1);else TRK_CAL_FOLD.push(tone);
  try{localStorage.setItem("cpd_trk_fold",TRK_CAL_FOLD.join(","));}catch(e){}
  var band=btn.parentNode,shut=at===-1;
  band.classList.toggle("trk-cal-folded",shut);
  btn.setAttribute("aria-expanded",shut?"false":"true");
}
function trkSetView(v){
  TRK_VIEW=v==="cal"?"cal":"list";
  try{localStorage.setItem("cpd_trk_view",TRK_VIEW);}catch(e){}
  trkRenderList();
}
function trkYmd(dt){return dt.getFullYear()+"-"+("0"+(dt.getMonth()+1)).slice(-2)+"-"+("0"+dt.getDate()).slice(-2);}
function trkCalShift(n){
  var m=(TRK_CAL_M||trkToday().slice(0,7)).split("-");
  TRK_CAL_M=trkYmd(new Date(+m[0],+m[1]-1+n,1)).slice(0,7);
  trkRenderList(true);
}
function trkCalToday(){TRK_CAL_M="";TRK_CAL_SEL="";trkRenderList(true);}
function trkCalPick(d){
  TRK_CAL_SEL=TRK_CAL_SEL===d?"":d; /* click the picked day again to clear */
  if(TRK_CAL_SEL){TRK_CAL_M=d.slice(0,7);TRK_CAL_SIDE=true;}
  trkRenderList(true);
}
function trkCalShort(p){return p.name||p.customer||"";}
/* update-age band: fresh / warm (14d+) / hot (30d+); closed = done/lost */
function trkCalTone(p,days){
  if(!trkIsOpen(p))return "closed";
  return days>=30?"hot":days>=TRK_STALE_DAYS?"warm":"fresh";
}
function trkCalAgeTxt(n){return n<=0?"today":n+"d";}
/* follow-up state on its planned day */
function trkCalFuState(p,act,today){
  var f=p.nextFollowup;
  if(!f)return null;
  var last=trkLastDate(p,act);
  if(last&&last>=f)return "done";
  if(!trkIsOpen(p))return null;
  return f<today?"late":(f===today?"today":"plan");
}
var TRK_CAL_FU={
  done:{ico:"&#10003;",label:"Followed up"},
  late:{ico:"&#9200;",label:"Follow-up overdue"},
  today:{ico:"&#9200;",label:"Follow up today"},
  plan:{ico:"&#128197;",label:"Follow-up planned"}
};
function trkCalendarHtml(list,act){
  var today=trkToday(),month=TRK_CAL_M||today.slice(0,7),sel=TRK_CAL_SEL;
  var ym=month.split("-"),y=+ym[0],mo=+ym[1]-1;
  /* one item per project: its latest entry, plus any follow-up */
  var days={},items=[],hasFu=false,hasClosed=false;
  function slot(d){return days[d]||(days[d]={ev:[],fu:[]});}
  list.forEach(function(p){
    var e=trkEntriesFor(p._id)[0];
    if(e&&e.date){
      var n=trkDaysBetween(e.date,today),it={p:p,e:e,n:n,tone:trkCalTone(p,n)};
      if(it.tone==="closed")hasClosed=true;
      slot(e.date).ev.push(it);items.push(it);
    }
    var st=trkCalFuState(p,act,today);
    if(st){hasFu=true;slot(p.nextFollowup).fu.push({p:p,st:st});}
  });
  var toneRank={hot:0,warm:1,fresh:2,closed:3};
  Object.keys(days).forEach(function(d){
    days[d].ev.sort(function(a,b){return toneRank[a.tone]-toneRank[b.tone]||trkAlpha(trkCalShort(a.p),trkCalShort(b.p));});
  });
  function evChip(it){
    var tip=it.p.name+" — latest: "+it.e.type+(it.e.title?": "+it.e.title:"")+(it.tone==="closed"?"":" ("+(it.n<=0?"today":it.n+" days ago")+")");
    return "<span class='trk-cal-ev trk-cal-"+it.tone+"' title='"+trkEsc(tip)+"' onclick='event.stopPropagation();trkOpen(\""+it.p._id+"\")'>"+
      (it.tone==="closed"?"":"<b class='trk-cal-age'>"+trkCalAgeTxt(it.n)+"</b>")+trkEsc(trkCalShort(it.p))+"</span>";
  }
  function fuChip(f){
    return "<span class='trk-cal-ev trk-cal-fu trk-cal-fu-"+f.st+"' title='"+trkEsc(TRK_CAL_FU[f.st].label+": "+f.p.name)+"' onclick='event.stopPropagation();trkOpen(\""+f.p._id+"\")'>"+
      TRK_CAL_FU[f.st].ico+" "+trkEsc(trkCalShort(f.p))+"</span>";
  }
  function cellBody(d){
    var s=days[d];
    if(!s)return"";
    return s.fu.map(fuChip).join("")+s.ev.map(evChip).join("")+
      /* phones: coloured dots only */
      "<span class='trk-cal-dots'>"+
        s.fu.map(function(f){return "<i class='trk-cal-fu-"+f.st+"'></i>";}).join("")+
        s.ev.map(function(it){return "<i class='trk-cal-"+it.tone+"'></i>";}).join("")+
      "</span>";
  }
  /* Monday-first grid */
  var first=new Date(y,mo,1),lead=(first.getDay()+6)%7,nDays=new Date(y,mo+1,0).getDate();
  var cells="",total=Math.ceil((lead+nDays)/7)*7;
  for(var i=0;i<total;i++){
    var dt=new Date(y,mo,1-lead+i),d=trkYmd(dt),wd=dt.getDay();
    var cls="trk-cal-cell"+(dt.getMonth()!==mo?" trk-cal-out":"")+(wd===0||wd===6?" trk-cal-wkend":"")+(d===today?" trk-cal-today":"")+(d===sel?" trk-cal-sel":"");
    cells+="<div class='"+cls+"' onclick='trkCalPick(\""+d+"\")'><div class='trk-cal-num'>"+dt.getDate()+"</div>"+cellBody(d)+"</div>";
  }
  var legend="<span class='trk-cal-key trk-cal-fresh'>updated &lt; "+TRK_STALE_DAYS+"d</span>"+
    "<span class='trk-cal-key trk-cal-warm'>"+TRK_STALE_DAYS+"d+</span>"+
    "<span class='trk-cal-key trk-cal-hot'>30d+</span>"+
    (hasClosed?"<span class='trk-cal-key trk-cal-closed'>won / lost</span>":"")+
    (hasFu?"<span class='trk-cal-key trk-cal-fu-plan'>&#128197; follow-up</span>":"");
  var head="<div class='trk-cal-head'>"+
    "<div class='trk-cal-navgrp'>"+
      "<button class='trk-cal-nav' onclick='trkCalShift(-1)' aria-label='Previous month'>&lsaquo;</button>"+
      "<span class='trk-cal-title'>"+first.toLocaleString("en-GB",{month:"long",year:"numeric"})+"</span>"+
      "<button class='trk-cal-nav' onclick='trkCalShift(1)' aria-label='Next month'>&rsaquo;</button>"+
      (month!==today.slice(0,7)||sel?"<button class='trk-chip' onclick='trkCalToday()'>Today</button>":"")+
    "</div>"+
    "<div class='trk-cal-legend'>"+legend+
      (TRK_CAL_SIDE?"":"<button class='trk-cal-sidebtn' onclick='trkCalToggleSide(true)' title='Show the side panel'>&lsaquo; Show panel</button>")+
    "</div></div>";
  var grid="<div class='trk-cal-grid'>"+
    ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(function(w,k){return "<div class='trk-cal-wd"+(k>4?" trk-cal-wd-end":"")+"'>"+w+"</div>";}).join("")+
    cells+"</div>";

  /* side panel row: name, age pill, latest entry */
  function row(it){
    return "<div class='trk-cal-row' onclick='trkOpen(\""+it.p._id+"\")'>"+
      "<div class='trk-cal-row-top'><span class='trk-cal-row-name' title='"+trkEsc(it.p.name)+"'>"+trkEsc(it.p.name)+"</span>"+
      (it.tone==="closed"?"":"<span class='trk-cal-pill trk-cal-"+it.tone+"'>"+(it.n<=0?"today":it.n+"d ago")+"</span>")+"</div>"+
      "<div class='trk-cal-row-sub'>"+trkFmtDate(it.e.date)+" &middot; "+trkEsc(it.e.type)+(it.e.title?" &mdash; "+trkEsc(it.e.title):"")+"</div>"+
    "</div>";
  }
  var side;
  if(sel){
    var s=days[sel]||{ev:[],fu:[]};
    side="<div class='trk-cal-side-h'><button class='trk-cal-back' onclick='trkCalPick(\""+sel+"\")'>&lsaquo; All open projects</button></div>"+
      "<div class='trk-cal-sec'>"+trkFmtDate(sel)+(sel===today?" &middot; today":"")+"</div>"+
      s.fu.map(function(f){
        return "<div class='trk-cal-row' onclick='trkOpen(\""+f.p._id+"\")'><div class='trk-cal-row-top'><span class='trk-cal-row-name' title='"+trkEsc(f.p.name)+"'>"+trkEsc(f.p.name)+"</span></div>"+
          "<div class='trk-cal-row-sub'><span class='trk-cal-key trk-cal-fu-"+f.st+"'>"+TRK_CAL_FU[f.st].ico+" "+TRK_CAL_FU[f.st].label+"</span></div></div>";
      }).join("")+
      (s.ev.map(row).join("")||(s.fu.length?"":"<div class='trk-cal-empty'>No project had its latest update on this day.</div>"));
  }else{
    /* open projects in age bands, oldest first */
    var open=items.filter(function(it){return it.tone!=="closed";}).sort(function(a,b){return b.n-a.n;});
    var bands=[
      {tone:"hot",label:"No update for 30+ days"},
      {tone:"warm",label:"No update for "+TRK_STALE_DAYS+"+ days"},
      {tone:"fresh",label:"Updated in the last "+TRK_STALE_DAYS+" days"}
    ];
    side="<div class='trk-cal-side-h'>Open projects &middot; last update</div>"+
      bands.map(function(b){
        var rows=open.filter(function(it){return it.tone===b.tone;});
        if(!rows.length)return"";
        var shut=TRK_CAL_FOLD.indexOf(b.tone)>-1;
        return "<div class='trk-cal-band"+(shut?" trk-cal-folded":"")+"'>"+
          "<button class='trk-cal-sec trk-cal-sec-"+b.tone+"' aria-expanded='"+(shut?"false":"true")+"' onclick='trkCalToggleBand(this,\""+b.tone+"\")'>"+
            "<i class='trk-cal-chev'>&#9662;</i>"+b.label+"<span>"+rows.length+"</span></button>"+
          "<div class='trk-cal-band-rows'>"+rows.map(row).join("")+"</div></div>";
      }).join("")||"<div class='trk-cal-empty'>No open projects in this view.</div>";
  }

  if(!TRK_CAL_SIDE)return "<div class='trk-cal trk-cal-noside'><div class='trk-cal-main'>"+head+grid+"</div></div>";
  return "<div class='trk-cal'><div class='trk-cal-main'>"+head+grid+"</div><div class='trk-cal-side'>"+
    "<button class='trk-cal-hide' onclick='trkCalToggleSide(false)' title='Hide the side panel' aria-label='Hide the side panel'>&rsaquo;</button>"+
    side+"</div></div>";
}

/* clicking the open project again closes its panel */
/* list view: first click opens the side panel, clicking the same project
   again expands it to the full page */
function trkOpen(id){
  if(TRK_VIEW!=="cal"&&TRK_SEL===id)TRK_EXPAND=true;
  else{TRK_SEL=id;TRK_EXPAND=false;}
  renderTracker();
}
function trkExpand(){TRK_EXPAND=true;renderTracker();}
/* from an expanded project, back returns to the list with its panel open */
function trkBack(){
  if(TRK_EXPAND&&TRK_VIEW!=="cal")TRK_EXPAND=false;
  else TRK_SEL=null;
  renderTracker();
}

function trkRenderDetail(){
  var p=TRK_PROJECTS.find(function(x){return x._id===TRK_SEL;});
  if(!p){trkBack();return;}
  var entries=trkEntriesFor(p._id);
  var flag=trkFlag(p.country,18);

  var infoRow=function(label,html){return html?"<div class='trk-info'><div class='trk-info-label'>"+label+"</div><div class='trk-info-val'>"+html+"</div></div>":"";};
  var header=
    "<button class='trk-back' onclick='trkBack()'>&larr; All projects</button>"+
    "<div class='trk-detail-card'>"+
      "<div class='trk-detail-head'>"+
        "<div class='trk-detail-name'>"+trkDisplayName(p)+" "+trkStatusBadge(p.status)+trkPaymentBadge(p)+(p.lowPriority?trkLowBadge():"")+"</div>"+
        "<button class='edit-btn' onclick='trkEditProject()'>Edit project</button>"+
      "</div>"+trkLowBtn(p)+
      "<div class='trk-info-grid'>"+
        infoRow("Customer",(p.customer?flag+" "+trkEsc(p.customer):""))+
        infoRow("Country",trkEsc(p.country))+
        infoRow("Project date",trkProjectDate(p))+
        infoRow("Handling office",p.office?"<span class='trk-badge trk-office po-of-"+poOfficeSlug(p.office)+"'>"+trkEsc(p.office)+" office</span>":"")+
        infoRow("Solution type",trkSolutionBadge(p))+
        infoRow("Products of interest",trkProductChips(p))+
        infoRow("Estimated value",p.estValue!==null?trkValueHtml(p):"")+
        infoRow("Expected close",trkPeriodLabel(p))+
        infoRow("Next follow-up",trkActiveFollowup(p)?trkFollowBadge(trkFollow(p))||trkFmtDate(p.nextFollowup):"")+
        infoRow("Contact",trkEsc(p.contactName)+
          (p.contactPosition?" <span class='trk-contact-pos'>&middot; "+trkEsc(p.contactPosition)+"</span>":"")+
          (p.contactInfo?" <span class='trk-value-usd'>"+trkEsc(p.contactInfo)+"</span>":""))+
      "</div>"+
      (p.notes?"<div class='trk-notes'><div class='trk-notes-label'>Project description</div>"+trkEsc(p.notes).replace(/\n/g,"<br>")+"</div>":"")+
    "</div>";

  var tl=entries.map(function(e){
    var atts=(e.attachments||[]).map(function(a){
      return "<a class='trk-att' href='"+trkEsc(a.url)+"' data-name='"+trkEsc(a.name)+"' onclick='return trkViewFile(this)'>"+trkFileIcon(a.name)+" "+trkEsc(a.name)+"</a>";
    }).join("");
    return "<div class='trk-tl-item trk-t-"+trkTypeSlug(e.type)+"'><div class='trk-tl-dot'></div><div class='trk-tl-body'>"+
      "<div class='trk-tl-meta'><strong>"+trkFmtDate(e.date)+"</strong> "+trkTypeBadge(e.type)+
        "<a href='#' class='trk-tl-edit' onclick='trkEditEntry(event,\""+e._id+"\")'>Edit</a></div>"+
      (e.title?"<div class='trk-tl-title'>"+trkEsc(e.title)+"</div>":"")+
      (e.details?"<div class='trk-tl-details'>"+trkEsc(e.details).replace(/\n/g,"<br>")+"</div>":"")+
      (atts?"<div class='trk-tl-atts'>"+atts+"</div>":"")+
    "</div></div>";
  }).join("");

  document.getElementById("content").innerHTML=header+
    "<div class='trk-tl-head'><span>Timeline</span>"+
      "<button class='btn-add' onclick='trkOpenEntryModal()'>"+
        "<svg viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.5' style='width:13px;height:13px'><line x1='12' y1='5' x2='12' y2='19'/><line x1='5' y1='12' x2='19' y2='12'/></svg>"+
        " Add entry</button></div>"+
    (tl?"<div class='trk-timeline'>"+tl+"</div>"
       :"<div class='empty'>No timeline entries yet. Click <strong>+ Add entry</strong> to record the enquiry, meeting minutes or a quotation &mdash; that's also where you attach the PDF / Excel files.</div>");
}

/* ===== in-app file viewer =====
   Clicking an attachment chip previews the file right here instead of
   downloading it: PDFs and images render inline, Excel/CSV are parsed
   with SheetJS (lazy-loaded from the CDN on first use) and shown as
   tables with one tab per sheet. Anything else falls back to a link. */

function trkViewFile(a){
  trkOpenViewer(a.getAttribute("href"),a.getAttribute("data-name")||"");
  return false; /* cancel the default navigation/download */
}
function trkToggleViewSize(){
  var mm=document.querySelector("#modal-trk-view .modal");
  var full=mm.classList.toggle("trk-view-full");
  document.getElementById("trk-view-expand").textContent=full?"Shrink":"Expand";
  pdfvLayout();
}
function trkOpenViewer(url,name){
  var m=document.getElementById("modal-trk-view");
  /* each file starts at the normal size */
  var mm=m.querySelector(".modal");
  if(mm)mm.classList.remove("trk-view-full");
  var ex=document.getElementById("trk-view-expand");
  if(ex)ex.textContent="Expand";
  document.getElementById("trk-view-title").textContent=name;
  document.getElementById("trk-view-open").href=url;
  document.getElementById("trk-view-tabs").innerHTML="";
  document.getElementById("trk-view-fzctl").style.display=/\.(xlsx|xlsm|xls|csv)$/i.test(String(name))?"flex":"none";
  var body=document.getElementById("trk-view-body");
  var n=String(name).toLowerCase();
  /* older attachments can have a bare name — fall back to the URL's extension */
  var isPdf=/\.pdf$/.test(n)||/\.pdf(\?|#|$)/i.test(String(url));
  document.getElementById("trk-view-pdfctl").style.display=isPdf?"flex":"none";
  body.classList.toggle("pdfv-body",isPdf);
  pdfvReset();
  m.classList.add("open");
  if(isPdf){
    body.innerHTML="<div class='empty'>Loading PDF&hellip;</div>";
    pdfvOpen(url,name);
  }else if(/\.(png|jpe?g|gif|webp)$/.test(n)){
    body.innerHTML="<img src='"+trkEsc(url)+"' alt='"+trkEsc(name)+"' style='max-width:100%;height:auto;display:block;margin:0 auto'>";
  }else if(/\.(xlsx|xlsm|xls|csv)$/.test(n)){
    body.innerHTML="<div class='empty'>Loading spreadsheet&hellip;</div>";
    trkRenderSpreadsheet(url,name);
  }else{
    body.innerHTML="<div class='empty'>No inline preview for this file type. <a href='"+trkEsc(url)+"' target='_blank' rel='noopener'>Open / download it</a> instead.</div>";
  }
}
/* ===== PDF viewer =====
   pdf.js draws each page onto a canvas instead of using an <iframe>:
   phone browsers either won't show a PDF inside an iframe at all
   (Android) or show it stuck at one size (iOS). Zoom is relative to
   "fit width" (1 = page as wide as the viewer). Pinch, double-tap,
   ctrl+wheel (trackpad pinch) and the − / + / Fit buttons all go
   through pdfvSetZoom; one-finger panning stays native scrolling. */
var PDFV={doc:null,sizes:[],zoom:1,base:1,token:0};
var PDFV_MIN=0.5,PDFV_MAX=5;
function pdfvReset(){
  PDFV.token++;
  if(PDFV.doc){try{PDFV.doc.destroy();}catch(e){}}
  PDFV.doc=null;PDFV.sizes=[];PDFV.zoom=1;
}
async function pdfvOpen(url,name){
  var body=document.getElementById("trk-view-body");
  var tok=++PDFV.token;
  try{
    await loadPdfJs();
    var doc=await window.pdfjsLib.getDocument({url:url}).promise;
    var sizes=[];
    for(var i=1;i<=doc.numPages;i++){
      var vp=(await doc.getPage(i)).getViewport({scale:1});
      sizes.push([vp.width,vp.height]);
    }
    if(tok!==PDFV.token){doc.destroy();return;}
    PDFV.doc=doc;PDFV.sizes=sizes;
    body.innerHTML="<div class='pdfv-pages'>"+sizes.map(function(s,k){
      return "<canvas class='pdfv-page' data-page='"+(k+1)+"'></canvas>";
    }).join("")+"</div>";
    pdfvLayout();
  }catch(err){
    if(tok!==PDFV.token)return;
    /* offline / pdf.js failed — the browser's own viewer beats nothing */
    body.classList.remove("pdfv-body");
    document.getElementById("trk-view-pdfctl").style.display="none";
    body.innerHTML="<iframe class='trk-view-frame' src='"+trkEsc(url)+"' title='"+trkEsc(name)+"'></iframe>";
  }
}
/* fit-width depends on the viewer's width (rotate, Expand) — recompute and redraw */
function pdfvLayout(){
  if(!PDFV.doc)return;
  var avail=document.getElementById("trk-view-body").clientWidth-16;
  if(avail<=0)return;
  PDFV.base=avail/Math.max.apply(null,PDFV.sizes.map(function(s){return s[0];}));
  pdfvRender();
}
/* canvases are resized synchronously (so callers can fix the scroll
   position straight after); the drawing itself is async */
function pdfvRender(){
  var doc=PDFV.doc;if(!doc)return;
  var tok=++PDFV.token;
  document.getElementById("trk-view-zoom").textContent=Math.round(PDFV.zoom*100)+"%";
  var scale=PDFV.base*PDFV.zoom;
  var canvases=document.querySelectorAll("#trk-view-body .pdfv-page");
  PDFV.sizes.forEach(function(s,i){
    canvases[i].style.width=Math.floor(s[0]*scale)+"px";
    canvases[i].style.height=Math.floor(s[1]*scale)+"px";
  });
  var dpr=window.devicePixelRatio||1;
  (async function(){
    for(var i=0;i<canvases.length;i++){
      var page=await doc.getPage(i+1);
      if(tok!==PDFV.token)return;
      var vp=page.getViewport({scale:scale});
      /* iOS refuses canvases over ~16M pixels — past that, draw at a
         lower resolution and let CSS stretch it (soft only at extreme zoom) */
      var px=Math.min(dpr,Math.sqrt(12e6/(vp.width*vp.height)));
      var off=document.createElement("canvas");
      off.width=Math.floor(vp.width*px);off.height=Math.floor(vp.height*px);
      await page.render({canvasContext:off.getContext("2d"),viewport:vp,transform:[px,0,0,px,0,0]}).promise;
      if(tok!==PDFV.token)return;
      /* swap the finished bitmap in at once so pages never flash blank */
      var c=canvases[i];
      c.width=off.width;c.height=off.height;
      c.getContext("2d").drawImage(off,0,0);
    }
  })().catch(function(){});
}
/* zoom keeping the point (fx,fy) — viewer coordinates — under the finger/cursor */
function pdfvSetZoom(z,fx,fy){
  if(!PDFV.doc)return;
  z=Math.max(PDFV_MIN,Math.min(PDFV_MAX,z));
  var body=document.getElementById("trk-view-body");
  if(fx==null){fx=body.clientWidth/2;fy=body.clientHeight/2;}
  var r=z/PDFV.zoom;
  var cx=body.scrollLeft+fx,cy=body.scrollTop+fy;
  PDFV.zoom=z;
  pdfvRender();
  body.scrollLeft=cx*r-fx;
  body.scrollTop=cy*r-fy;
}
function pdfvStep(dir){pdfvSetZoom(PDFV.zoom*(dir>0?1.25:0.8));}
function pdfvFit(){pdfvSetZoom(1,0,0);}
(function(){
  var body=document.getElementById("trk-view-body");
  if(!body)return;
  var pinch=null,lastTap=0,tapX=0,tapY=0;
  function mid(e){
    var r=body.getBoundingClientRect(),a=e.touches[0],b=e.touches[1];
    return{d:Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY),
      x:(a.clientX+b.clientX)/2-r.left,y:(a.clientY+b.clientY)/2-r.top};
  }
  body.addEventListener("touchstart",function(e){
    if(!PDFV.doc||e.touches.length!==2)return;
    var p=mid(e),wrap=body.querySelector(".pdfv-pages");
    pinch={d:p.d,x:p.x,y:p.y,r:1,wrap:wrap};
    /* while pinching, just CSS-scale the pages about the pinch centre;
       the sharp redraw happens once the fingers lift */
    if(wrap)wrap.style.transformOrigin=(body.scrollLeft+p.x)+"px "+(body.scrollTop+p.y)+"px";
  },{passive:true});
  body.addEventListener("touchmove",function(e){
    if(!pinch||e.touches.length!==2)return;
    e.preventDefault();
    var z=Math.max(PDFV_MIN,Math.min(PDFV_MAX,PDFV.zoom*mid(e).d/pinch.d));
    pinch.r=z/PDFV.zoom;
    if(pinch.wrap)pinch.wrap.style.transform="scale("+pinch.r+")";
  },{passive:false});
  body.addEventListener("touchend",function(e){
    if(pinch){
      if(e.touches.length<2){
        var p=pinch;pinch=null;
        if(p.wrap)p.wrap.style.transform="";
        if(Math.abs(p.r-1)>0.01)pdfvSetZoom(PDFV.zoom*p.r,p.x,p.y);
        lastTap=0;
      }
      return;
    }
    /* double-tap toggles fit-width <-> 2.5x at the tapped spot */
    if(!PDFV.doc||e.changedTouches.length!==1||e.touches.length)return;
    var t=e.changedTouches[0],r=body.getBoundingClientRect();
    var x=t.clientX-r.left,y=t.clientY-r.top,now=Date.now();
    if(now-lastTap<320&&Math.abs(x-tapX)<30&&Math.abs(y-tapY)<30){
      e.preventDefault();lastTap=0;
      pdfvSetZoom(PDFV.zoom>1.2?1:2.5,x,y);
    }else{lastTap=now;tapX=x;tapY=y;}
  });
  /* iOS Safari: stop its own page-zoom gesture from kicking in over the viewer */
  body.addEventListener("gesturestart",function(e){if(PDFV.doc)e.preventDefault();});
  body.addEventListener("dblclick",function(e){
    if(!PDFV.doc)return;
    var r=body.getBoundingClientRect();
    pdfvSetZoom(PDFV.zoom>1.2?1:2.5,e.clientX-r.left,e.clientY-r.top);
  });
  /* trackpad pinch arrives as ctrl+wheel */
  body.addEventListener("wheel",function(e){
    if(!PDFV.doc||!e.ctrlKey)return;
    e.preventDefault();
    var r=body.getBoundingClientRect();
    pdfvSetZoom(PDFV.zoom*Math.exp(-e.deltaY*0.01),e.clientX-r.left,e.clientY-r.top);
  },{passive:false});
  var rt=null;
  window.addEventListener("resize",function(){clearTimeout(rt);rt=setTimeout(pdfvLayout,200);});
})();
function trkLoadScript(src){
  return new Promise(function(res,rej){
    var s=document.createElement("script");
    s.src=src;s.onload=res;
    s.onerror=function(){rej(new Error("could not load the spreadsheet viewer (offline?)"));};
    document.head.appendChild(s);
  });
}
function trkLoadSheetJS(){
  return window.XLSX?Promise.resolve():trkLoadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
}
function trkLoadExcelJS(){
  return window.ExcelJS?Promise.resolve():trkLoadScript("https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js");
}
/* SheetJS (free) gives the displayed VALUES ("USD 220.95") but no styling;
   ExcelJS gives the STYLING (fills, bold, merges via theme) but doesn't
   apply number formats. So: values from SheetJS, colors from ExcelJS. */
var TRK_VIEW_SJS=null,TRK_VIEW_EJS=null,TRK_VIEW_THEME=null;
async function trkRenderSpreadsheet(url,name){
  var body=document.getElementById("trk-view-body");
  try{
    var styled=/\.(xlsx|xlsm)$/i.test(name);
    await Promise.all(styled?[trkLoadSheetJS(),trkLoadExcelJS()]:[trkLoadSheetJS()]);
    var r=await fetch(url);
    if(!r.ok)throw new Error("could not fetch the file (HTTP "+r.status+")");
    var buf=await r.arrayBuffer();
    TRK_VIEW_SJS=XLSX.read(new Uint8Array(buf),{type:"array"});
    TRK_VIEW_EJS=null;TRK_VIEW_THEME=null;
    if(styled){
      try{
        var ewb=new ExcelJS.Workbook();
        await ewb.xlsx.load(buf);
        TRK_VIEW_EJS=ewb;
        TRK_VIEW_THEME=trkParseTheme(ewb);
      }catch(e){/* styling is best-effort — values still render */}
    }
    var tabs=document.getElementById("trk-view-tabs");
    tabs.innerHTML=TRK_VIEW_SJS.SheetNames.length>1
      ?TRK_VIEW_SJS.SheetNames.map(function(sn,i){
        return "<button class='trk-chip' data-sheet='"+i+"' onclick='trkShowSheet("+i+")'>"+trkEsc(sn)+"</button>";
      }).join("")
      :"";
    trkShowSheet(0);
  }catch(err){
    body.innerHTML="<div class='empty'>Preview failed: "+trkEsc(err.message)+"<br><a href='"+trkEsc(url)+"' target='_blank' rel='noopener'>Open / download it</a> instead.</div>";
  }
}
/* Theme palette from the workbook's theme XML. Theme color indexes swap
   the dark/light pairs (0↔1, 2↔3) relative to the XML order — an Excel
   quirk, not a bug here. */
function trkParseTheme(ewb){
  try{
    var xml=ewb.model&&ewb.model.themes&&ewb.model.themes.theme1;
    if(!xml)return null;
    var scheme=xml.match(/<a:clrScheme[\s\S]*?<\/a:clrScheme>/);
    if(!scheme)return null;
    var cols=[],re=/<a:(?:srgbClr val="([0-9A-Fa-f]{6})"|sysClr[^>]*lastClr="([0-9A-Fa-f]{6})")/g,m;
    while((m=re.exec(scheme[0]))&&cols.length<12)cols.push(m[1]||m[2]);
    if(cols.length<10)return null;
    return [cols[1],cols[0],cols[3],cols[2]].concat(cols.slice(4));
  }catch(e){return null;}
}
function trkThemeColor(idx,tint){
  if(!TRK_VIEW_THEME||idx==null||idx>=TRK_VIEW_THEME.length)return null;
  var hex=TRK_VIEW_THEME[idx];
  var r=parseInt(hex.slice(0,2),16),g=parseInt(hex.slice(2,4),16),b=parseInt(hex.slice(4,6),16);
  if(tint>0){r=Math.round(r+(255-r)*tint);g=Math.round(g+(255-g)*tint);b=Math.round(b+(255-b)*tint);}
  else if(tint<0){r=Math.round(r*(1+tint));g=Math.round(g*(1+tint));b=Math.round(b*(1+tint));}
  return "rgb("+r+","+g+","+b+")";
}
function trkCellColor(c){
  if(!c)return null;
  if(c.argb)return "#"+(c.argb.length===8?c.argb.slice(2):c.argb);
  if(c.theme!==undefined)return trkThemeColor(c.theme,c.tint||0);
  return null;
}
/* ---- freeze panes ----
   Priority: the freeze the file's author set in Excel; otherwise a guess
   (leading mostly-text columns = labels, leading number-free rows =
   titles/headers); the +/- controls override either for the open sheet. */
var TRK_VIEW_SHEET=0,TRK_VIEW_FZ={cols:1,rows:0};
function trkGuessFreeze(ws,range,es){
  if(es&&es.views&&es.views[0]&&es.views[0].state==="frozen"){
    return {cols:es.views[0].xSplit||0,rows:es.views[0].ySplit||0};
  }
  var maxR=Math.min(range.e.r,range.s.r+80);
  var cols=0;
  for(var c=range.s.c;c<=Math.min(range.s.c+3,range.e.c);c++){
    var num=0,txt=0;
    for(var r=range.s.r;r<=maxR;r++){
      var cell=ws[XLSX.utils.encode_cell({r:r,c:c})];
      if(!cell||cell.v==null||cell.v==="")continue;
      if(cell.t==="n")num++;else txt++;
    }
    if(txt>num&&txt>0)cols++;else break;
  }
  var rows=0;
  for(var r2=range.s.r;r2<=Math.min(range.e.r,range.s.r+4);r2++){
    var hasNum=false,hasAny=false;
    for(var c2=range.s.c;c2<=Math.min(range.e.c,range.s.c+59);c2++){
      var cl=ws[XLSX.utils.encode_cell({r:r2,c:c2})];
      if(cl&&cl.v!=null&&cl.v!==""){hasAny=true;if(cl.t==="n"){hasNum=true;break;}}
    }
    if(hasNum)break;
    rows++;
    if(!hasAny&&rows>2)break; /* stop drifting through blank space */
  }
  return {cols:Math.max(1,Math.min(cols,3)),rows:Math.min(rows,4)};
}
function trkFreezeLabels(){
  var ec=document.getElementById("trk-fz-cols"),er=document.getElementById("trk-fz-rows");
  if(ec)ec.textContent=TRK_VIEW_FZ.cols;
  if(er)er.textContent=TRK_VIEW_FZ.rows;
}
function trkFreezeAdj(which,d){
  TRK_VIEW_FZ[which]=Math.max(0,Math.min(6,TRK_VIEW_FZ[which]+d));
  trkFreezeLabels();
  trkShowSheet(TRK_VIEW_SHEET,true);
}
/* Sticky offsets need real cell widths/heights, so they're measured after
   the table is in the DOM: each frozen column/row cell gets left/top from
   the column's rendered position. */
function trkApplyFreezeOffsets(holder){
  var table=holder.querySelector("table");
  if(!table)return;
  holder.scrollLeft=0;holder.scrollTop=0;
  /* sticky cells are "positioned", so offsetTop/Left would measure from the
     modal, not the table — use rect differences instead */
  var tRect=table.getBoundingClientRect();
  var lefts={},tops={};
  table.querySelectorAll("td[data-fc]").forEach(function(td){
    var j=td.getAttribute("data-fc");
    if(lefts[j]===undefined)lefts[j]=td.getBoundingClientRect().left-tRect.left;
  });
  table.querySelectorAll("td[data-fc]").forEach(function(td){
    td.style.left=(lefts[td.getAttribute("data-fc")]||0)+"px";
  });
  table.querySelectorAll("td[data-fr]").forEach(function(td){
    var j=td.getAttribute("data-fr");
    if(tops[j]===undefined)tops[j]=td.getBoundingClientRect().top-tRect.top;
  });
  table.querySelectorAll("td[data-fr]").forEach(function(td){
    td.style.top=(tops[td.getAttribute("data-fr")]||0)+"px";
  });
}
function trkShowSheet(i,keepFreeze){
  var wb=TRK_VIEW_SJS;
  if(!wb)return;
  TRK_VIEW_SHEET=i;
  document.querySelectorAll("#trk-view-tabs .trk-chip").forEach(function(b){
    b.classList.toggle("active",Number(b.dataset.sheet)===i);
  });
  var body=document.getElementById("trk-view-body");
  var name=wb.SheetNames[i],ws=wb.Sheets[name];
  if(!ws||!ws["!ref"]){body.innerHTML="<div class='empty'>This sheet is empty.</div>";return;}
  var range=XLSX.utils.decode_range(ws["!ref"]);
  var maxR=Math.min(range.e.r,range.s.r+499),maxC=Math.min(range.e.c,range.s.c+59);
  var covered={},span={};
  (ws["!merges"]||[]).forEach(function(m){
    span[m.s.r+"_"+m.s.c]={cs:m.e.c-m.s.c+1,rs:m.e.r-m.s.r+1};
    for(var r=m.s.r;r<=m.e.r;r++)for(var c=m.s.c;c<=m.e.c;c++)
      if(r!==m.s.r||c!==m.s.c)covered[r+"_"+c]=1;
  });
  var es=TRK_VIEW_EJS?TRK_VIEW_EJS.getWorksheet(name):null;
  if(!keepFreeze)TRK_VIEW_FZ=trkGuessFreeze(ws,range,es);
  trkFreezeLabels();
  var fzC=range.s.c+TRK_VIEW_FZ.cols,fzR=range.s.r+TRK_VIEW_FZ.rows;
  var html="<table>";
  for(var r=range.s.r;r<=maxR;r++){
    html+="<tr>";
    for(var c=range.s.c;c<=maxC;c++){
      if(covered[r+"_"+c])continue;
      var cell=ws[XLSX.utils.encode_cell({r:r,c:c})];
      var text=cell?(cell.w!==undefined?cell.w:(cell.v!=null?String(cell.v):"")):"";
      var st="",attrs="";
      var sp=span[r+"_"+c];
      if(sp){
        if(sp.cs>1)attrs+=" colspan='"+sp.cs+"'";
        if(sp.rs>1)attrs+=" rowspan='"+sp.rs+"'";
      }
      try{
        if(es){
          var ec=es.getRow(r+1).getCell(c+1);
          var bg=(ec.fill&&ec.fill.type==="pattern"&&ec.fill.pattern!=="none")?trkCellColor(ec.fill.fgColor):null;
          var fc=ec.font?trkCellColor(ec.font.color):null;
          if(bg)st+="background:"+bg+";";
          /* excel fills are designed for dark-on-light — keep the text dark
             on a colored cell even when the app is in a dark theme */
          if(bg&&!fc)fc="#2a2a2a";
          if(fc)st+="color:"+fc+";";
          if(ec.font&&ec.font.bold)st+="font-weight:600;";
          var al=ec.alignment&&ec.alignment.horizontal;
          if(al&&al!=="fill")st+="text-align:"+al+";";
          else if(cell&&cell.t==="n")st+="text-align:right;";
        }else if(cell&&cell.t==="n")st+="text-align:right;";
      }catch(e){/* style of one cell failing shouldn't kill the table */}
      var cls=[];
      if(c<fzC){cls.push("trk-fz-col");attrs+=" data-fc='"+(c-range.s.c)+"'";}
      if(r<fzR){cls.push("trk-fz-row");attrs+=" data-fr='"+(r-range.s.r)+"'";}
      if(cls.length)attrs+=" class='"+cls.join(" ")+"'";
      html+="<td"+attrs+(st?" style='"+st+"'":"")+">"+trkEsc(text)+"</td>";
    }
    html+="</tr>";
  }
  html+="</table>";
  if(range.e.r>maxR||range.e.c>maxC)html+="<div class='empty'>Large sheet — preview truncated. Use &quot;Open in new tab&quot; for the full file.</div>";
  body.innerHTML="<div class='trk-sheet-holder'>"+html+"</div>";
  trkApplyFreezeOffsets(body);
}

/* ===== global "+ Add entry" button (toolbar) ===== */
function trkOpenAdd(){
  if(TRK_SEL&&TRK_VIEW==="cal")trkOpenEntryModal();
  else trkOpenProjectModal();
}

/* ===== project modal ===== */
function trkAlpha(a,b){return a.localeCompare(b,undefined,{sensitivity:"base"});}
function trkComboValues(field){
  var vals=TRK_PROJECTS.map(function(p){return p[field];});
  if(field==="customer"&&typeof allDealCustomers==="function")vals=vals.concat(allDealCustomers());
  if(field==="country"&&typeof allDealCountries==="function")vals=vals.concat(allDealCountries());
  var seen={},out=[];
  vals.forEach(function(v){
    v=String(v||"").trim();
    if(!v||seen[v.toLowerCase()])return;
    seen[v.toLowerCase()]=1;out.push(v);
  });
  return out.sort(trkAlpha);
}
/* Type-ahead: plain text input + an app-styled suggestion panel of existing
   values. Replaces both the browser's native datalist dropdown (ugly, and it
   attracted the password manager) and the "+ Add new…" select — typing a
   brand-new value just works. With onPick (multi-value mode, e.g. products),
   choosing or pressing Enter hands the value to onPick instead of filling
   the input. Safe to call repeatedly; wires each input once. */
function trkSuggestInit(inputId,getValues,onPick){
  var inp=document.getElementById(inputId);
  var panel=document.getElementById(inputId+"-suggest");
  if(!inp||!panel||inp._trkSuggest)return;
  inp._trkSuggest=true;
  var idx=-1,items=[];
  function close(){panel.style.display="none";idx=-1;}
  function pick(v){
    if(onPick)onPick(v);else inp.value=v;
    close();
  }
  function render(){
    var q=inp.value.trim().toLowerCase();
    items=getValues().filter(function(v){return !q||v.toLowerCase().indexOf(q)>-1;});
    if(idx>items.length-1)idx=items.length-1;
    /* nothing to suggest, or the input already IS the only match */
    if(!items.length||(!onPick&&items.length===1&&items[0].toLowerCase()===q)){close();return;}
    panel.innerHTML=items.map(function(v,i){
      return "<div class='trk-suggest-item"+(i===idx?" active":"")+"' data-i='"+i+"'>"+trkEsc(v)+"</div>";
    }).join("");
    panel.style.display="block";
    var act=panel.querySelector(".trk-suggest-item.active");
    if(act)act.scrollIntoView({block:"nearest"});
  }
  inp.addEventListener("focus",function(){idx=-1;render();});
  inp.addEventListener("input",function(){idx=-1;render();});
  inp.addEventListener("keydown",function(e){
    var open=panel.style.display!=="none";
    if(e.key==="ArrowDown"&&open){idx=Math.min(idx+1,items.length-1);render();e.preventDefault();}
    else if(e.key==="ArrowUp"&&open){idx=Math.max(idx-1,0);render();e.preventDefault();}
    else if(e.key==="Enter"){
      if(open&&idx>-1){pick(items[idx]);e.preventDefault();}
      else if(onPick&&inp.value.trim()){pick(inp.value.trim());e.preventDefault();}
    }
    else if(e.key==="Escape"&&open){close();}
  });
  inp.addEventListener("blur",function(){setTimeout(close,150);});
  panel.addEventListener("mousedown",function(e){
    var t=e.target.closest(".trk-suggest-item");
    if(!t)return;
    e.preventDefault();
    pick(items[parseInt(t.dataset.i,10)]);
  });
}
function trkInitProjectSuggests(){
  trkSuggestInit("tp-customer",function(){return trkComboValues("customer");});
  trkSuggestInit("tp-country",function(){return trkComboValues("country");});
  trkSuggestInit("tp-solution",trkSolutionValues);
  trkSuggestInit("tp-product",function(){
    /* Vocabulary = the master model list PLUS products free-typed on any
       tracker project (qty prefixes like "79× " stripped), minus what's
       already on this project. */
    function bare(s){return String(s||"").replace(/^\s*\d+\s*[x×]\s*/i,"").trim();}
    var seen={},list=[];
    function add(name){
      var b=bare(name);
      if(b&&!seen[b.toLowerCase()]){seen[b.toLowerCase()]=true;list.push(b);}
    }
    (typeof getModelList==="function"?getModelList():[]).forEach(add);
    TRK_PROJECTS.forEach(function(p){(p.products||[]).forEach(add);});
    var have={};
    TRK_PROD.forEach(function(p){have[bare(p).toLowerCase()]=true;});
    return list.filter(function(m){return !have[m.toLowerCase()];}).sort(trkAlpha);
  },function(v){trkAddProduct(v);});
}
/* Products of interest — staged chips, saved as a jsonb string array */
var TRK_PROD=[];
function trkRenderProducts(){
  document.getElementById("tp-products").innerHTML=TRK_PROD.map(function(pr,i){
    return "<span class='att-item'>"+trkEsc(pr)+" <a href='#' class='att-remove' title='Remove' onclick='trkRemoveProduct(event,"+i+")'>&#10005;</a></span>";
  }).join("")||"<span class='att-empty'>Nothing added yet.</span>";
}
function trkAddProduct(v){
  var inp=document.getElementById("tp-product");
  var qEl=document.getElementById("tp-product-qty");
  v=String(v!==undefined?v:inp.value).trim();
  if(!v)return;
  var q=qEl?qEl.value.trim():"";
  if(q)v=q+"× "+v;                       /* "50× TK180" */
  if(TRK_PROD.map(function(p){return p.toLowerCase();}).indexOf(v.toLowerCase())===-1)TRK_PROD.push(v);
  inp.value="";
  if(qEl)qEl.value="";
  trkRenderProducts();
  trkAutoName();
}
function trkRemoveProduct(e,i){
  if(e)e.preventDefault();
  TRK_PROD.splice(i,1);
  trkRenderProducts();
  trkAutoName();
}

/* ===== auto project name =====
   Standard format: "Customer — 50× Model" (the card appends the first
   entry date on its own). The name field live-fills from the customer
   and product fields, but stops as soon as the user types their own
   name; it resumes if they clear the field. */
function trkComposedName(){
  var cEl=document.getElementById("tp-customer");
  var customer=cEl?cEl.value.trim():"";
  var prods=TRK_PROD.slice(0,3).join(", ")+(TRK_PROD.length>3?" +"+(TRK_PROD.length-3):"");
  if(!customer)return TRK_PROD.length?prods:"";
  return customer+(TRK_PROD.length?" — "+prods:"");
}
var TRK_NAME_AUTO="";
function trkAutoName(){
  var el=document.getElementById("tp-name");
  if(!el)return;
  var cur=el.value.trim();
  if(cur&&cur!==TRK_NAME_AUTO)return;       /* user wrote their own */
  TRK_NAME_AUTO=trkComposedName();
  el.value=TRK_NAME_AUTO;
}
/* The "↻ Auto" button: regenerate the name from the current fields.
   Setting the field to the composed value also re-arms live auto-fill
   (a hand-written name normally switches it off). */
function trkResetAutoName(){
  TRK_NAME_AUTO=trkComposedName();
  document.getElementById("tp-name").value=TRK_NAME_AUTO;
}
(function trkWireAutoName(){
  var c=document.getElementById("tp-customer");
  if(!c)return;
  c.addEventListener("input",trkAutoName);
  c.addEventListener("blur",trkAutoName);   /* suggest clicks set the value programmatically */
})();
function trkProductChips(p,max){
  var prods=p.products||[];
  if(!prods.length)return"";
  var shown=max?prods.slice(0,max):prods;
  return shown.map(function(pr){return "<span class='trk-badge trk-prod'>"+trkEsc(pr)+"</span>";}).join(" ")+
    (max&&prods.length>max?" <span class='trk-value-usd'>+"+(prods.length-max)+" more</span>":"");
}
/* ===== project kind =====
   "Customer" (the default sales pipeline) or "Other" (not customer
   related — internal tasks, admin, anything). Other hides every
   customer/deal/contact field and stores the project with the fixed
   status "Other", so the modal's toggle is the only place the kind is
   chosen; it round-trips through the status column, no schema change. */
var TRK_KIND="Customer";
function trkSetKind(k){
  TRK_KIND=k;
  var other=k==="Other";
  document.getElementById("tp-kind-customer").classList.toggle("active",!other);
  document.getElementById("tp-kind-other").classList.toggle("active",other);
  document.querySelectorAll("#modal-trk-project .tp-cust-only").forEach(function(el){
    el.style.display=other?"none":"";
  });
  document.getElementById("tp-name-hint").style.display=other?"none":"";
  document.getElementById("tp-name-auto").style.display=other?"none":"";
  document.getElementById("tp-kind-hint").style.display=other?"":"none";
  document.getElementById("tp-name").placeholder=other
    ?"e.g. Office renovation — contractor updates"
    :"e.g. Biman — 50× TK180 — boarding pass printers";
  if(other)trkSyncPaymentVis("Other"); /* payment row is Won-only */
}
function trkOpenProjectModal(){
  var m=document.getElementById("modal-trk-project");
  m.removeAttribute("data-edit-id");
  document.getElementById("trk-project-modal-title").textContent="Add project";
  document.getElementById("btn-delete-trk-project").style.display="none";
  m.querySelectorAll("input,textarea").forEach(function(el){el.value="";});
  trkInitProjectSuggests();
  TRK_PROD=[];trkRenderProducts();
  TRK_NAME_AUTO="";
  trkSetKind("Customer");
  document.getElementById("tp-office").value="";
  document.getElementById("tp-close-period").value="";
  trkSetStatusDisplay("Enquiry");
  trkSetPaymentDisplay("");
  trkSyncPaymentVis("Enquiry");
  document.getElementById("btn-lost-trk-project").style.display="none";
  document.getElementById("tp-currency").value="USD";
  trkFollowupMin(document.getElementById("tp-followup"));
  m.classList.add("open");
}
/* the Payment field only applies to Won projects */
function trkSyncPaymentVis(status){
  var wrap=document.getElementById("tp-payment-wrap");
  if(wrap)wrap.style.display=status==="Won"?"":"none";
}
/* Status is read-only in the editor — the timeline drives it. */
function trkSetStatusDisplay(status){
  var el=document.getElementById("tp-status-display");
  if(!el)return;
  el.innerHTML=trkStatusBadge(status)+
    " <span style='font-size:10.5px;color:var(--text-faint)'>from the timeline &mdash; quotation &rArr; Quoted; PO, invoice, payment or delivery &rArr; Won</span>";
}
/* Mark as lost / Reopen — the only manual status action. Reopening
   re-derives from the timeline. */
async function trkToggleLost(){
  var m=document.getElementById("modal-trk-project");
  var id=m.getAttribute("data-edit-id");
  var p=TRK_PROJECTS.find(function(x){return x._id===id;});
  if(!p)return;
  if(p.status==="Lost"){p.status="Enquiry";p.status=trkDerivedStatus(p);}
  else p.status="Lost";
  showLoad("Saving...");
  try{
    await fetch(SB_URL+"/rest/v1/tracker_projects?id=eq."+p._id,{method:"PATCH",headers:sbH(),body:JSON.stringify({status:p.status})});
  }catch(err){console.error("Status update failed:",err);}
  hideLoad();
  closeModal("modal-trk-project");
  renderTracker();
}
/* Payment is read-only here — it is driven by "Payment received"
   timeline entries, so the modal just shows the current state. */
function trkSetPaymentDisplay(pay){
  var el=document.getElementById("tp-payment-display");
  if(!el)return;
  el.innerHTML=trkPaymentBadge({status:"Won",payment:pay})+
    " <span style='font-size:10.5px;color:var(--text-faint)'>set by &ldquo;Payment received&rdquo; entries in the timeline</span>";
}
function trkEditProject(){
  var p=TRK_PROJECTS.find(function(x){return x._id===TRK_SEL;});
  if(!p)return;
  var m=document.getElementById("modal-trk-project");
  m.setAttribute("data-edit-id",p._id);
  document.getElementById("trk-project-modal-title").textContent="Edit project";
  document.getElementById("btn-delete-trk-project").style.display="inline-flex";
  document.getElementById("tp-name").value=p.name;
  trkInitProjectSuggests();
  trkSetKind(p.status==="Other"?"Other":"Customer");
  document.getElementById("tp-customer").value=p.customer;
  document.getElementById("tp-country").value=p.country;
  document.getElementById("tp-solution").value=p.solution||"";
  TRK_PROD=(p.products||[]).slice();trkRenderProducts();
  /* if the stored name matches the composed format, keep it in sync
     with later customer/product edits; a custom name stays untouched */
  TRK_NAME_AUTO=trkComposedName();
  document.getElementById("tp-office").value=p.office||"";
  trkSetStatusDisplay(p.status);
  trkSetPaymentDisplay(p.payment);
  trkSyncPaymentVis(p.status);
  var lostBtn=document.getElementById("btn-lost-trk-project");
  lostBtn.style.display=p.status==="Other"?"none":"inline-flex"; /* no pipeline to lose */
  lostBtn.textContent=p.status==="Lost"?"Reopen project":"Mark as lost";
  document.getElementById("tp-value").value=p.estValue===null?"":p.estValue;
  document.getElementById("tp-currency").value=p.currency||"USD";
  /* period picker: prefer the stored period; legacy date-only projects
     load as their month */
  var perM=/^(\d{4})-(Q[1-4]|\d{2})$/.exec(p.expectedPeriod||"");
  if(perM){
    document.getElementById("tp-close-period").value=perM[2];
    document.getElementById("tp-close-year").value=perM[1];
  }else if(p.expectedDate){
    document.getElementById("tp-close-period").value=String(p.expectedDate).slice(5,7);
    document.getElementById("tp-close-year").value=String(p.expectedDate).slice(0,4);
  }else{
    document.getElementById("tp-close-period").value="";
    document.getElementById("tp-close-year").value="";
  }
  document.getElementById("tp-contact").value=p.contactName;
  document.getElementById("tp-position").value=p.contactPosition;
  document.getElementById("tp-contact-info").value=p.contactInfo;
  document.getElementById("tp-notes").value=p.notes;
  document.getElementById("tp-followup").value=trkActiveFollowup(p);
  trkFollowupMin(document.getElementById("tp-followup"));
  m.classList.add("open");
}
async function trkSaveProject(){
  var other=TRK_KIND==="Other";
  var name=document.getElementById("tp-name").value.trim();
  var customer=document.getElementById("tp-customer").value.trim();
  /* a product typed but never added shouldn't be lost */
  if(!other&&document.getElementById("tp-product").value.trim())trkAddProduct();
  if(!name){
    /* Standard auto-name; the card appends the first entry date itself. */
    name=other?"":trkComposedName();
    if(!name){alert(other?"Please give it a name.":"Please pick a customer or give the project a name.");return;}
  }
  var valRaw=document.getElementById("tp-value").value;
  /* payment is owned by "Payment received" entries — carry it over
     untouched when editing, start empty on a new project */
  var mEl=document.getElementById("modal-trk-project");
  var prevId=mEl.getAttribute("data-edit-id");
  var prev=prevId?TRK_PROJECTS.find(function(x){return x._id===prevId;}):null;
  /* An Other project keeps none of the customer/deal fields — switching
     kind on an existing project deliberately clears them. Its status is
     the fixed "Other"; switching back to Customer starts at Enquiry and
     the reconcile pass re-derives from the timeline on the next render. */
  var p={
    name:name,
    customer:other?"":customer,
    country:other?"":document.getElementById("tp-country").value.trim(),
    office:document.getElementById("tp-office").value,
    solution:document.getElementById("tp-solution").value.trim(), /* applies to Other too — e.g. fire fighting */
    status:other?"Other":(prev&&prev.status!=="Other"?prev.status:"Enquiry"),
    payment:prev?(prev.payment||""):"",
    lowPriority:prev?!!prev.lowPriority:false,
    products:other?[]:TRK_PROD.slice(),
    estValue:(other||valRaw==="")?null:parseFloat(valRaw),
    currency:document.getElementById("tp-currency").value,
    expectedPeriod:other?"":(function(){
      var per=document.getElementById("tp-close-period").value;
      var yr=document.getElementById("tp-close-year").value.trim();
      return (per&&/^\d{4}$/.test(yr))?yr+"-"+per:"";
    })(),
    contactName:other?"":document.getElementById("tp-contact").value.trim(),
    contactPosition:other?"":document.getElementById("tp-position").value.trim(),
    contactInfo:other?"":document.getElementById("tp-contact-info").value.trim(),
    notes:document.getElementById("tp-notes").value.trim(),
    nextFollowup:document.getElementById("tp-followup").value||""
  };
  /* keep expected_date at the period's last day for overdue checks */
  p.expectedDate=trkPeriodEnd(p.expectedPeriod);
  var m=document.getElementById("modal-trk-project");
  var editId=m.getAttribute("data-edit-id");
  showLoad("Saving...");
  try{
    if(editId){
      var r1=await fetch(SB_URL+"/rest/v1/tracker_projects?id=eq."+editId,{method:"PATCH",headers:sbH(),body:JSON.stringify(trkPToDb(p))});
      if(!r1.ok)throw new Error("HTTP "+r1.status);
      var idx=TRK_PROJECTS.findIndex(function(x){return x._id===editId;});
      if(idx>-1){p._id=editId;p.createdAt=TRK_PROJECTS[idx].createdAt;TRK_PROJECTS[idx]=p;}
    }else{
      var r=await trkInsert("tracker_projects",trkPToDb(p));
      if(!r||!r[0])throw new Error("insert failed");
      p._id=r[0].id;p.createdAt=r[0].created_at;
      TRK_PROJECTS.push(p);
    }
  }catch(err){hideLoad();alert("Save failed: "+err.message);return;}
  hideLoad();
  closeModal("modal-trk-project");
  renderTracker();
}
async function trkDeleteProject(){
  var m=document.getElementById("modal-trk-project");
  var editId=m.getAttribute("data-edit-id");
  if(!editId)return;
  var p=TRK_PROJECTS.find(function(x){return x._id===editId;});
  if(!confirm("Delete \""+(p?p.name:"this project")+"\" and its whole timeline permanently?"))return;
  showLoad("Deleting...");
  await sbDelete("tracker_projects",editId); /* entries cascade in DB */
  TRK_PROJECTS=TRK_PROJECTS.filter(function(x){return x._id!==editId;});
  TRK_ENTRIES=TRK_ENTRIES.filter(function(e){return e.projectId!==editId;});
  TRK_SEL=null;
  hideLoad();
  closeModal("modal-trk-project");
  renderTracker();
}

/* ===== entry modal ===== */
function trkRenderAttList(){
  var el=document.getElementById("te-att-list");
  if(!el)return;
  el.innerHTML=TRK_ATT.map(function(a,i){
    var name=a.url
      ?"<a href='"+trkEsc(a.url)+"' target='_blank' rel='noopener'>"+trkEsc(a.name)+"</a>"
      :trkEsc(a.name)+" <em>(uploads on save)</em>";
    return "<span class='att-item"+(a.url?"":" att-pending")+"'>"+trkFileIcon(a.name)+" "+name+
      " <a href='#' class='att-remove' title='Remove' onclick='trkRemoveAtt(event,"+i+")'>&#10005;</a></span>";
  }).join("")||"<span class='att-empty'>No files yet. Attach the meeting minutes, quotation PDF or Excel.</span>";
}
function trkAddFiles(){
  var input=document.getElementById("te-files");
  var files=input&&input.files?Array.prototype.slice.call(input.files):[];
  files.forEach(function(f){TRK_ATT.push({name:f.name||"file",file:f});});
  if(input)input.value="";
  trkRenderAttList();
}
function trkRemoveAtt(e,i){
  if(e)e.preventDefault();
  TRK_ATT.splice(i,1);
  trkRenderAttList();
}
/* Drag & drop onto the open entry modal stages files exactly like the
   file picker. The overlay covers the screen while open, so a drop
   anywhere lands here instead of the browser opening the file. */
(function trkInitDrop(){
  var zone=document.getElementById("modal-trk-entry");
  var box=document.getElementById("te-drop");
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
    files.forEach(function(f){TRK_ATT.push({name:f.name||"file",file:f});});
    if(files.length)trkRenderAttList();
  });
})();
async function trkUploadFile(file){
  var safe=(file.name||"file").replace(/[^a-zA-Z0-9._-]/g,"_");
  var path="tracker/"+Date.now()+"-"+safe;
  var r=await fetch(SB_URL+"/storage/v1/object/documents/"+path,{
    method:"POST",
    headers:{"apikey":SB_KEY,"Authorization":"Bearer "+SB_KEY,"Content-Type":file.type||"application/octet-stream"},
    body:file
  });
  if(!r.ok)throw new Error("upload failed (HTTP "+r.status+")");
  return SB_URL+"/storage/v1/object/public/documents/"+path;
}
function trkOpenEntryModal(){
  var m=document.getElementById("modal-trk-entry");
  m.removeAttribute("data-edit-id");
  document.getElementById("trk-entry-modal-title").textContent="Add timeline entry";
  document.getElementById("btn-delete-trk-entry").style.display="none";
  document.getElementById("te-date").value=new Date().toISOString().slice(0,10);
  document.getElementById("te-type").value="Note";
  document.getElementById("te-title").value="";
  document.getElementById("te-details").value="";
  document.getElementById("te-payment").value="Partially paid";
  trkSyncEntryPaymentVis();
  trkPrefillFollowup();
  var fi=document.getElementById("te-files");if(fi)fi.value="";
  TRK_ATT=[];
  trkRenderAttList();
  m.classList.add("open");
}
/* Logging an entry is when you know when to chase next, so the entry
   form carries the project's next follow-up date (shared, not per entry). */
function trkPrefillFollowup(){
  var p=TRK_PROJECTS.find(function(x){return x._id===TRK_SEL;});
  var el=document.getElementById("te-followup");
  el.value=p?trkActiveFollowup(p):"";
  trkFollowupMin(el);
}
/* An entry on/after the date counts as the follow-up done, so the picker
   starts tomorrow — a date already covered would clear itself at once. */
function trkFollowupMin(el){var d=new Date();d.setDate(d.getDate()+1);el.min=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}
function trkFollowupIn(id,days){
  var el=document.getElementById(id);
  if(days===null){el.value="";return;}
  var d=new Date();d.setDate(d.getDate()+days);
  el.value=d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
/* the payment-level select only applies to Payment received entries */
function trkSyncEntryPaymentVis(){
  var wrap=document.getElementById("te-payment-wrap");
  if(wrap)wrap.style.display=document.getElementById("te-type").value==="Payment received"?"":"none";
}
function trkEditEntry(ev,id){
  if(ev)ev.preventDefault();
  var e=TRK_ENTRIES.find(function(x){return x._id===id;});
  if(!e)return;
  var m=document.getElementById("modal-trk-entry");
  m.setAttribute("data-edit-id",id);
  document.getElementById("trk-entry-modal-title").textContent="Edit timeline entry";
  document.getElementById("btn-delete-trk-entry").style.display="inline-flex";
  document.getElementById("te-date").value=e.date?String(e.date).slice(0,10):"";
  document.getElementById("te-type").value=e.type;
  trkSyncEntryPaymentVis();
  trkPrefillFollowup();
  document.getElementById("te-title").value=e.title;
  document.getElementById("te-details").value=e.details;
  var fi=document.getElementById("te-files");if(fi)fi.value="";
  TRK_ATT=(e.attachments||[]).map(function(a){return{name:a.name,url:a.url};});
  trkRenderAttList();
  m.classList.add("open");
}
async function trkSaveEntry(){
  if(!TRK_SEL){alert("Open a project first.");return;}
  var date=document.getElementById("te-date").value;
  if(!date){alert("Please pick a date.");return;}
  var title=document.getElementById("te-title").value.trim();
  var details=document.getElementById("te-details").value.trim();
  if(!title&&!details&&!TRK_ATT.length){alert("Add a title, some details or a file.");return;}
  /* upload staged files first */
  try{
    var pending=TRK_ATT.filter(function(a){return a.file&&!a.url;});
    for(var i=0;i<pending.length;i++){
      showLoad("Uploading file "+(i+1)+" of "+pending.length+"...");
      pending[i].url=await trkUploadFile(pending[i].file);
      delete pending[i].file;
    }
  }catch(err){hideLoad();alert("File upload failed: "+err.message+"\nEntry was not saved — please try again.");return;}
  var entry={
    projectId:TRK_SEL,
    date:date,
    type:document.getElementById("te-type").value,
    title:title,
    details:details,
    attachments:TRK_ATT.map(function(a){return{name:a.name,url:a.url};})
  };
  var m=document.getElementById("modal-trk-entry");
  var editId=m.getAttribute("data-edit-id");
  var oldType="";
  showLoad("Saving...");
  try{
    if(editId){
      var r1=await fetch(SB_URL+"/rest/v1/tracker_entries?id=eq."+editId,{method:"PATCH",headers:sbH(),body:JSON.stringify(trkEToDb(entry))});
      if(!r1.ok)throw new Error("HTTP "+r1.status);
      var idx=TRK_ENTRIES.findIndex(function(x){return x._id===editId;});
      if(idx>-1)oldType=TRK_ENTRIES[idx].type;
      if(idx>-1){entry._id=editId;entry.createdAt=TRK_ENTRIES[idx].createdAt;TRK_ENTRIES[idx]=entry;}
    }else{
      var r=await trkInsert("tracker_entries",trkEToDb(entry));
      if(!r||!r[0])throw new Error("insert failed");
      entry._id=r[0].id;entry.createdAt=r[0].created_at;
      TRK_ENTRIES.push(entry);
    }
  }catch(err){hideLoad();alert("Save failed: "+err.message);return;}
  /* The follow-up date lives on the project; save it when it changed. */
  var fuProj=TRK_PROJECTS.find(function(x){return x._id===TRK_SEL;});
  var fu=document.getElementById("te-followup").value||"";
  if(TRK_HAS_FU&&fuProj&&fu!==trkActiveFollowup(fuProj)){
    try{
      var rf=await fetch(SB_URL+"/rest/v1/tracker_projects?id=eq."+fuProj._id,{method:"PATCH",headers:sbH(),body:JSON.stringify({next_followup:fu||null})});
      if(!rf.ok)throw new Error("HTTP "+rf.status);
      fuProj.nextFollowup=fu;
    }catch(err){console.error("Follow-up update failed:",err);alert("The entry was saved, but the follow-up date wasn't: "+err.message);}
  }
  /* Status re-derives in renderTracker below; payment is event-driven
     and only a Payment received entry moves it. */
  if(entry.type==="Payment received"){
    var proj=TRK_PROJECTS.find(function(x){return x._id===TRK_SEL;});
    var lvl=document.getElementById("te-payment").value;
    if(proj&&proj.payment!==lvl){
      proj.payment=lvl;
      try{
        await fetch(SB_URL+"/rest/v1/tracker_projects?id=eq."+proj._id,{method:"PATCH",headers:sbH(),body:JSON.stringify({payment:lvl})});
      }catch(err){console.error("Payment update failed:",err);}
    }
  }else if(oldType==="Payment received")await trkResyncPayment(TRK_SEL);
  hideLoad();
  closeModal("modal-trk-entry");
  renderTracker();
}
/* A Payment received entry was deleted or retyped: with none left the
   project goes back to Not paid (otherwise the badge would stay stuck).
   The level itself lives on the project, so remaining ones keep it. */
async function trkResyncPayment(projId){
  var proj=TRK_PROJECTS.find(function(x){return x._id===projId;});
  if(!proj||!proj.payment)return;
  if(TRK_ENTRIES.some(function(e){return e.projectId===projId&&e.type==="Payment received";}))return;
  proj.payment="";
  try{
    await fetch(SB_URL+"/rest/v1/tracker_projects?id=eq."+projId,{method:"PATCH",headers:sbH(),body:JSON.stringify({payment:null})});
  }catch(err){console.error("Payment reset failed:",err);}
}
async function trkDeleteEntry(){
  var m=document.getElementById("modal-trk-entry");
  var editId=m.getAttribute("data-edit-id");
  if(!editId)return;
  if(!confirm("Delete this timeline entry permanently?"))return;
  showLoad("Deleting...");
  await sbDelete("tracker_entries",editId);
  var gone=TRK_ENTRIES.find(function(x){return x._id===editId;});
  TRK_ENTRIES=TRK_ENTRIES.filter(function(x){return x._id!==editId;});
  if(gone&&gone.type==="Payment received")await trkResyncPayment(gone.projectId);
  hideLoad();
  closeModal("modal-trk-entry");
  renderTracker();
}
