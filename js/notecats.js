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
  return "<button class='nt-cat' style='--dc:"+ntCatColor(o.cat)+"' title='Change category' onclick='ntCatMenu(this,"+i+")'><i></i>"+trkEsc(o.cat)+"</button>";
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
