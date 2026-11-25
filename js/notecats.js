/* ============================================================
   NOTE CATEGORIES — "CUSTOM visits", "POSIVA updates", ... on the
   Notes page. A category is just a name on the note (others.category,
   notes-category-setup.sql): it exists as long as a note uses it, and a
   note without one is a plain note. Until that column exists nothing
   here is shown and nothing about notes changes.
   ============================================================ */
var OTHERS_HAS_CAT=false; /* set when the notes are loaded (supabase.js) */
var NT_CAT="";            /* category shown: "" = all, NT_PLAIN = no category */
var NT_PLAIN="/plain/";
var NT_POST_CAT="";       /* category the next posted update gets */
var NT_CATM=null;         /* the open category menu: {el,btn} */

function ntIsTerm(o){return o.value==="Shipping term";}
function ntCats(){
  var out=[];
  OTHERS.forEach(function(o){if(o.cat&&!ntIsTerm(o)&&out.indexOf(o.cat)<0)out.push(o.cat);});
  return out.sort(function(a,b){return a.toLowerCase().localeCompare(b.toLowerCase());});
}
/* one spelling per category: "custom VISITS " is the existing "CUSTOM visits" */
function ntCatClean(s){
  s=String(s||"").replace(/\s+/g," ").trim();
  var same=ntCats().filter(function(c){return c.toLowerCase()===s.toLowerCase();});
  return same[0]||s;
}
function ntCatColor(c){
  return (c&&c!==NT_PLAIN&&typeof expDeptColor==="function"&&expDeptColor(c))||"var(--accent)";
}
function ntInCat(o){return !NT_CAT||(!ntIsTerm(o)&&(NT_CAT===NT_PLAIN?!o.cat:o.cat===NT_CAT));}

/* the row of categories above the writing box; list = the notes found by the search */
function ntCatRow(list){
  if(!OTHERS_HAS_CAT)return "";
  var cats=ntCats(),n=function(f){return list.filter(f).length;};
  if(!cats.length)return "";
  var tab=function(key,label,count){
    return "<button class='exp-tab"+(NT_CAT===key?" on":"")+"' aria-pressed='"+(NT_CAT===key)+"' style='--dc:"+ntCatColor(key)+"' data-cat='"+trkEsc(key===NT_PLAIN?"plain":key)+"' onclick='ntCatTab(this)'>"+label+"<span>"+count+"</span></button>";
  };
  return "<div class='exp-tabs'>"+tab("","All",n(function(o){return !ntIsTerm(o);}))+
    cats.map(function(c){return tab(c,trkEsc(c),n(function(o){return o.cat===c;}));}).join("")+
    tab(NT_PLAIN,"Plain notes",n(function(o){return !o.cat&&!ntIsTerm(o);}))+"</div>";
}
function ntCatTab(b){
  var i=[].indexOf.call(b.parentNode.children,b),n=b.parentNode.children.length;
  NT_CAT=i===0?"":i===n-1?NT_PLAIN:b.getAttribute("data-cat");
  NT_POST_CAT=NT_CAT===NT_PLAIN?"":NT_CAT;
  renderOthers();
}
/* the last note of the shown category was moved or deleted: back to All */
function ntCatCheck(){
  if(NT_CAT&&NT_CAT!==NT_PLAIN&&ntCats().indexOf(NT_CAT)<0)NT_CAT="";
}
/* small label above a note; not repeated when only that category is shown */
function ntCatTag(o,i){
  if(!OTHERS_HAS_CAT||!o.cat||NT_CAT)return "";
  return "<button class='nt-cat nt-cat-c' style='--dc:"+ntCatColor(o.cat)+"' title='Change category' onclick='ntCatMenu(this,"+i+")'><i></i>"+trkEsc(o.cat)+"</button>";
}
function ntCatIcon(i){
  if(!OTHERS_HAS_CAT)return "";
  return "<button class='nt-ico' title='Category' aria-label='Category' aria-haspopup='listbox' onclick='ntCatMenu(this,"+i+")'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M4 4h8l8 8-8 8-8-8z'/><circle cx='8.5' cy='8.5' r='1'/></svg></button>";
}
/* the button next to Post update */
function ntPostCatBtn(){
  if(!OTHERS_HAS_CAT)return "";
  return "<button type='button' class='nt-postcat"+(NT_POST_CAT?" set":"")+"' style='--dc:"+ntCatColor(NT_POST_CAT)+"' title='Category of this update' aria-haspopup='listbox' onclick='ntCatMenu(this,-1)'>"+
    (NT_POST_CAT?"<i></i>"+trkEsc(NT_POST_CAT):"Plain note")+
    "<svg viewBox='0 0 16 16' width='13' height='13' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M4 6l4 4 4-4'/></svg></button>";
}
function ntPostCatSync(){var b=document.getElementById("nt-postcat");if(b)b.innerHTML=ntPostCatBtn();}

/* ---------- choosing a category (i = note, -1 = the update being written) ---------- */
function ntCatClose(){if(NT_CATM){NT_CATM.el.remove();NT_CATM=null;}}
function ntCatMenu(btn,i){
  if(NT_CATM){var same=NT_CATM.btn===btn;ntCatClose();if(same)return;}
  var o=i<0?null:OTHERS[i];if(i>=0&&!o)return;
  var cur=o?o.cat||"":NT_POST_CAT,cats=ntCats();
  if(cur&&cats.indexOf(cur)<0)cats.push(cur);
  var m=document.createElement("div");m.className="dd-pop nt-catm";
  m.innerHTML="<div role='listbox'>"+cats.concat([""]).map(function(c,k){
    return "<div class='dd-item"+(c===cur?" on":"")+"' role='option' aria-selected='"+(c===cur)+"' data-k='"+k+"'><span class='dd-check'>"+(c===cur?"&#10003;":"")+"</span>"+
      (c?"<i style='--dc:"+ntCatColor(c)+"'></i>":"")+"<span class='dd-lbl'>"+(c?trkEsc(c):"Plain note (no category)")+"</span></div>";
  }).join("")+"</div><form class='nt-catnew'><input placeholder='New category&hellip;' maxlength='40' autocomplete='off' data-1p-ignore data-lpignore='true' data-bwignore aria-label='New category'><button type='submit' class='nt-tool'>Add</button></form>";
  var pick=function(c){ntCatClose();if(o)ntCatSet(o,c);else{NT_POST_CAT=c;ntPostCatSync();}};
  m.addEventListener("click",function(e){var it=e.target.closest(".dd-item");if(it)pick(cats[+it.getAttribute("data-k")]||"");});
  m.querySelector("form").addEventListener("submit",function(e){
    e.preventDefault();var v=ntCatClean(this.querySelector("input").value);if(v)pick(v);
  });
  ntMenuOpen(btn,m);
}
/* shows a menu under (or above) its button */
function ntMenuOpen(btn,m){
  document.body.appendChild(m);m.style.display="block";
  var r=btn.getBoundingClientRect(),vv=window.visualViewport,h=vv?vv.offsetTop+vv.height:innerHeight,up=r.bottom+m.offsetHeight+8>h&&r.top>m.offsetHeight+8;
  m.style.left=Math.max(8,Math.min(r.left,document.documentElement.clientWidth-m.offsetWidth-8))+"px";
  m.style.top=(up?r.top-m.offsetHeight-4:r.bottom+4)+"px";
  NT_CATM={el:m,btn:btn};
}
document.addEventListener("pointerdown",function(e){if(NT_CATM&&!NT_CATM.el.contains(e.target)&&!NT_CATM.btn.contains(e.target))ntCatClose();},true);
document.addEventListener("keydown",function(e){if(NT_CATM&&e.key==="Escape"){e.preventDefault();e.stopPropagation();ntCatClose();}},true);
/* not while a name is typed: a phone scrolls the page when its keyboard opens */
window.addEventListener("scroll",function(e){if(NT_CATM&&!NT_CATM.el.contains(e.target)&&!NT_CATM.el.contains(document.activeElement))ntCatClose();},true);

async function ntCatPatch(where,cat){
  try{return (await fetch(SB_URL+"/rest/v1/others?"+where,{method:"PATCH",headers:sbH(),body:JSON.stringify({category:cat||null})})).ok;}catch(e){return false;}
}
async function ntCatSet(o,cat){
  var old=o.cat||"";if(old===cat)return;
  o.cat=cat;renderOthers();
  if(o._id&&!await ntCatPatch("id=eq."+o._id,cat)){
    o.cat=old;renderOthers();
    alert("Couldn't save the category. Nothing was changed, please try again.");
  }
}
/* rename / remove for the category that is shown */
async function ntCatRename(){
  var old=NT_CAT,v=prompt("New name for this category:",old);if(v===null)return;
  v=String(v).replace(/\s+/g," ").trim().slice(0,40);if(!v||v===old)return;
  var same=ntCats().filter(function(c){return c!==old&&c.toLowerCase()===v.toLowerCase();})[0];
  if(same){if(!confirm('"'+same+'" already exists. Put these notes together with it?'))return;v=same;}
  await ntCatMove(old,v);
}
async function ntCatRemove(){
  if(!confirm('Remove the category "'+NT_CAT+'"? The notes stay and become plain notes.'))return;
  await ntCatMove(NT_CAT,"");
}
async function ntCatMove(old,now){
  if(!await ntCatPatch("category=eq."+encodeURIComponent(old),now)){alert("Couldn't save. Nothing was changed, please try again.");return;}
  OTHERS.forEach(function(o){if(o.cat===old)o.cat=now;});
  NT_CAT=now||NT_PLAIN;if(NT_POST_CAT===old)NT_POST_CAT=now;
  renderOthers();
}
function ntCatTools(){
  if(!OTHERS_HAS_CAT||!NT_CAT||NT_CAT===NT_PLAIN)return "";
  return "<span class='nt-cattools'><button onclick='ntCatRename()'>Rename</button><button onclick='ntCatRemove()'>Remove category</button></span>";
}
/* Category field of the Add / Edit note form */
function ntCatField(val){
  var g=document.getElementById("o-cat-group"),inp=document.getElementById("o-cat");if(!g)return;
  g.style.display=OTHERS_HAS_CAT?"":"none";
  document.getElementById("o-cat-list").innerHTML=ntCats().map(function(c){return "<option value='"+trkEsc(c)+"'>";}).join("");
  inp.value=val||"";
}

/* ============================================================
   NOTE DATES — the date of an update can be picked before posting
   (today unless changed) and changed later by clicking the date.
   Stored as text like before: "25 Nov 2026".
   ============================================================ */
var NT_POST_DATE=""; /* "" = today, else 2026-11-20 */
function ntToday(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}
function ntDateIso(t){
  var m=/^(\d{1,2})\s+([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})$/.exec(String(t||"").trim());if(!m)return "";
  var k=EXP_MON.map(function(x){return x.toLowerCase();}).indexOf(m[2].toLowerCase());
  return k<0?"":m[3]+"-"+("0"+(k+1)).slice(-2)+"-"+("0"+m[1]).slice(-2);
}
function ntDateText(iso){var p=iso.split("-");return (+p[2])+" "+EXP_MON[+p[1]-1]+" "+p[0];}
/* a date field laid invisibly over what is shown: a click or tap opens the calendar */
function ntDateInput(iso,fn,label){
  return "<input type='date' value='"+trkEsc(iso)+"' min='2000-01-01' max='2099-12-31' aria-label='"+trkEsc(label)+"' onclick='try{this.showPicker()}catch(e){}' onchange='"+fn+"'>";
}
/* half-typed years (0002, 0202) and an emptied field are not dates */
function ntDateOk(v){return /^20\d\d-\d\d-\d\d$/.test(v);}
function ntPostDateBtn(){
  var iso=NT_POST_DATE||ntToday(),t=ntDateText(iso);
  return "<span class='nt-postcat nt-dpick"+(NT_POST_DATE?" set":"")+"' title='Date of this update'>"+
    "<svg viewBox='0 0 16 16' width='13' height='13' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><rect x='2' y='3' width='12' height='11' rx='2'/><path d='M2 6.5h12M5 1.5V4M11 1.5V4'/></svg>"+
    (NT_POST_DATE?t:"Today")+ntDateInput(iso,"ntPostDateSet(this)","Date of this update, "+t)+"</span>";
}
function ntPostDateSync(){
  var b=document.getElementById("nt-postdate");
  if(b&&!b.contains(document.activeElement))b.innerHTML=ntPostDateBtn();
}
function ntPostDateSet(inp){
  if(inp.value&&!ntDateOk(inp.value))return;
  NT_POST_DATE=inp.value===ntToday()?"":inp.value;
  inp.blur();ntPostDateSync();
}
async function ntDateSave(o,text){
  var old=o.date;if(old===text)return true;
  o.date=text;renderOthers();
  var ok=true;
  if(o._id){try{ok=(await fetch(SB_URL+"/rest/v1/others?id=eq."+o._id,{method:"PATCH",headers:sbH(),body:JSON.stringify({date:text})})).ok;}catch(e){ok=false;}}
  if(!ok){o.date=old;renderOthers();alert("Couldn't save the date. Nothing was changed, please try again.");}
  return ok;
}
async function ntDateSet(i,inp){
  var o=OTHERS[i];if(!o||!ntDateOk(inp.value))return;
  var old=o.date,text=ntDateText(inp.value);if(old===text)return;
  if(await ntDateSave(o,text))showUndoToast("Date changed to "+text,function(){ntDateSave(o,old);});
}

/* ============================================================
   NOTE FOLLOW-UPS — an optional follow-up date on a note
   (others.follow_up, notes-followup-setup.sql). It shows on the note and
   on the Today page: due or overdue, or coming up this week. "Done" takes
   it off. Until that column exists nothing here is shown.
   ============================================================ */
var OTHERS_HAS_FU=false; /* set when the notes are loaded (supabase.js) */
var NT_POST_FU="";       /* follow-up date the next posted update gets */
var NT_BELL="<svg viewBox='0 0 16 16' width='13' height='13' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><path d='M4 7a4 4 0 0 1 8 0c0 3 1.2 4 1.2 4H2.8S4 10 4 7zM6.8 13.5a1.4 1.4 0 0 0 2.4 0'/></svg>";
/* same shape as a project's follow-up, so trkFollowText shows both alike */
function ntFollow(o){
  if(!OTHERS_HAS_FU||!o.fu||ntIsTerm(o))return null;
  var late=trkDaysBetween(o.fu,ntToday());
  return {due:late>=0,kind:"followup",days:late,date:o.fu};
}
/* small line above a note: category and follow-up */
function ntMetaLine(o,i){
  var f=ntFollow(o),c=ntCatTag(o,i);
  if(!f)return c;
  return "<div class='nt-meta'>"+c+"<button class='nt-cat nt-fu"+(f.days>0?" late":f.days===0?" now":"")+"' title='Change or finish the follow-up' aria-haspopup='listbox' onclick='ntFuMenu(this,"+i+")'>"+NT_BELL+trkFollowText(f)+"</button></div>";
}
function ntFuIcon(i){
  if(!OTHERS_HAS_FU)return "";
  return "<button class='nt-ico' title='Follow-up date' aria-label='Follow-up date' aria-haspopup='listbox' onclick='ntFuMenu(this,"+i+")'><svg viewBox='0 0 24 24' aria-hidden='true'><path d='M6 10a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6zM10 20a2.2 2.2 0 0 0 4 0'/></svg></button>";
}
function ntPostFuBtn(){
  if(!OTHERS_HAS_FU)return "";
  return "<button type='button' class='nt-postcat"+(NT_POST_FU?" set":"")+"' title='Follow-up date of this update' aria-haspopup='listbox' onclick='ntFuMenu(this,-1)'>"+NT_BELL+
    (NT_POST_FU?"Follow up "+ntDateText(NT_POST_FU).replace(/ \d{4}$/,""):"Follow up")+"</button>";
}
function ntPostFuSync(){var b=document.getElementById("nt-postfu");if(b)b.innerHTML=ntPostFuBtn();}
function ntPlus(n){var d=new Date();d.setDate(d.getDate()+n);return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}
/* same day next month; 31 Jan gives the last day of February */
function ntNextMonth(){
  var d=new Date(),day=d.getDate();d.setDate(1);d.setMonth(d.getMonth()+1);
  d.setDate(Math.min(day,new Date(d.getFullYear(),d.getMonth()+1,0).getDate()));
  return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);
}
/* i = note, -1 = the update being written */
function ntFuMenu(btn,i){
  if(NT_CATM){var same=NT_CATM.btn===btn;ntCatClose();if(same)return;}
  var o=i<0?null:OTHERS[i];if(i>=0&&!o)return;
  var cur=o?o.fu||"":NT_POST_FU;
  var opts=[[ntPlus(3),"3 days"],[ntPlus(7),"1 week"],[ntNextMonth(),"1 month"]];
  var m=document.createElement("div");m.className="dd-pop nt-catm";
  var row=function(v,label,note,on){return "<div class='dd-item"+(on?" on":"")+"' role='option' aria-selected='"+!!on+"' data-v='"+v+"'><span class='dd-check'>"+(on?"&#10003;":"")+"</span><span class='dd-lbl'>"+label+"</span>"+(note?"<span class='nt-fu-d'>"+note+"</span>":"")+"</div>";};
  var day=function(iso){return new Date(iso+"T00:00:00").toLocaleDateString("en-GB",{weekday:"short"})+" "+ntDateText(iso).replace(/ \d{4}$/,"");};
  var preset=opts.some(function(x){return x[0]===cur;});
  m.innerHTML=(cur?"<div class='dd-group'>Follow up "+ntDateText(cur)+"</div>"+row("",o?"&#10003; Done, remove follow-up":"No follow-up","",false):"<div class='dd-group'>Follow up</div>")+
    "<div role='listbox'>"+opts.map(function(x){return row(x[0],x[1],day(x[0]),x[0]===cur);}).join("")+"</div>"+
    "<div class='dd-item nt-dpick nt-fu-pick"+(cur&&!preset?" on":"")+"'><span class='dd-check'>"+(cur&&!preset?"&#10003;":"")+"</span><span class='dd-lbl nt-fu-cal'><svg viewBox='0 0 16 16' width='14' height='14' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round' aria-hidden='true'><rect x='2' y='3' width='12' height='11' rx='2'/><path d='M2 6.5h12M5 1.5V4M11 1.5V4'/></svg>Calendar</span>"+
      (cur&&!preset?"<span class='nt-fu-d'>"+day(cur)+"</span>":"")+ntDateInput(cur||ntPlus(1),"","Follow-up date").replace("min='2000-01-01'","min='"+ntToday()+"'")+"</div>";
  var pick=function(v){ntCatClose();if(o)ntFuSet(o,v);else{NT_POST_FU=v;ntPostFuSync();}};
  m.addEventListener("click",function(e){var it=e.target.closest(".dd-item");if(it&&it.hasAttribute("data-v"))pick(it.getAttribute("data-v"));});
  m.querySelector("input").addEventListener("change",function(){if(ntDateOk(this.value)&&this.value>=ntToday())pick(this.value);});
  ntMenuOpen(btn,m);
}
async function ntFuSave(o,v){
  var old=o.fu||"";if(old===v)return true;
  o.fu=v;renderContent();
  var ok=true;
  if(o._id){try{ok=(await fetch(SB_URL+"/rest/v1/others?id=eq."+o._id,{method:"PATCH",headers:sbH(),body:JSON.stringify({follow_up:v||null})})).ok;}catch(e){ok=false;}}
  if(!ok){o.fu=old;renderContent();alert("Couldn't save the follow-up. Nothing was changed, please try again.");}
  return ok;
}
async function ntFuSet(o,v){
  var old=o.fu||"";if(old===v)return;
  if(await ntFuSave(o,v))showUndoToast(v?"Follow up "+ntDateText(v):"Follow-up done",function(){ntFuSave(o,old);});
}
/* Follow-up field of the Add / Edit note form */
function ntFuField(val){
  var g=document.getElementById("o-fu-group");if(!g)return;
  g.style.display=OTHERS_HAS_FU?"":"none";
  document.getElementById("o-fu").value=val||"";
}
/* first line of a note, without marks and list signs */
function ntTitle(o){
  var t=fmtNoSize(o.desc).replace(/\*\*|__|\*/g,"").split("\n").map(function(l){return l.replace(/^\s*([•●▪◦‣-]|\d+[.)])\s+/,"").trim();}).filter(Boolean)[0]||"Note";
  return t.length>90?t.slice(0,88).trim()+"\u2026":t;
}
/* from the Today page: the note, in view and marked for a moment */
function ntOpenNote(id){
  NT_VIEW="notes";NT_CAT="";NT_Q="";
  tdGo("others","");
  var el=document.querySelector('[data-nid="'+id+'"]');if(!el)return;
  el.scrollIntoView({block:"start"});window.scrollBy(0,-80);
  el.classList.add("nt-flash");setTimeout(function(){el.classList.remove("nt-flash");},2500);
}
