/* ============================================================
   ONE DROP-DOWN for every form field
   - <select>              : choose from a list
   - <input list="...">    : type, with suggestions (native list replaced)
   - ddSuggest(input, ...) : type, with suggestions from a function
   All three get the same arrow (styles.css) and the same pop-up list.
   The real field stays underneath, so saving and onchange/oninput work
   as before. On touch screens a <select> keeps the phone's own picker.
   ============================================================ */
var DD={el:null,pop:null,items:[],idx:-1,typed:false,ptr:"mouse",down:null,tabT:0,buf:"",bufT:0,quiet:false};

function ddEsc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;");}
function ddIsInput(el){return !!el&&el.tagName==="INPUT"&&!!(el._ddValues||el.getAttribute("data-dd-list")||el.getAttribute("list"));}
function ddIsSelect(el){return !!el&&el.tagName==="SELECT"&&!el.multiple&&!(el.size>1)&&!el.disabled;}

/* type-ahead fed by a function. With onPick (several values, e.g. products)
   a choice goes to onPick instead of filling the field. */
function ddSuggest(inp,getValues,onPick){
  if(!inp)return;
  inp._ddValues=getValues;inp._ddPick=onPick||null;
}
/* take the browser's own suggestion list off the field, remember which one */
function ddAdopt(inp){
  var id=inp.getAttribute("list");
  if(id){inp.setAttribute("data-dd-list",id);inp.removeAttribute("list");inp.setAttribute("autocomplete","off");}
}
function ddBuild(){
  var el=DD.el,out=[];
  if(el.tagName==="SELECT"){
    Array.prototype.forEach.call(el.options,function(o){
      if(o.hidden)return;
      var g=o.parentNode&&o.parentNode.tagName==="OPTGROUP"?o.parentNode.label:"";
      out.push({label:o.text,group:g,off:o.disabled,on:o.index===el.selectedIndex,i:o.index});
    });
    return out;
  }
  var vals=[];
  if(el._ddValues)vals=el._ddValues();
  else{
    var dl=document.getElementById(el.getAttribute("data-dd-list"));
    if(dl)Array.prototype.forEach.call(dl.options,function(o){if(o.value)vals.push(o.value);});
  }
  var q=el.value.trim().toLowerCase(),filter=DD.typed&&q,seen={};
  vals.forEach(function(v){
    v=String(v);var k=v.toLowerCase();
    if(seen["$"+k]||(filter&&k.indexOf(q)<0))return;
    seen["$"+k]=1;out.push({label:v,group:"",on:!el._ddPick&&k===q});
  });
  /* typed exactly the only suggestion: nothing left to offer */
  if(filter&&out.length===1&&out[0].on)return [];
  return out;
}
function ddRender(){
  if(!DD.el)return;
  DD.items=ddBuild();
  if(!DD.items.length){if(DD.pop)DD.pop.style.display="none";return;}
  if(!DD.pop){
    DD.pop=document.createElement("div");
    DD.pop.className="dd-pop";DD.pop.setAttribute("role","listbox");
    /* keep the focus in the field while the list is used */
    DD.pop.addEventListener("mousedown",function(e){e.preventDefault();});
    DD.pop.addEventListener("click",function(e){
      e.stopPropagation();
      var t=e.target.closest(".dd-item");
      if(t)ddPick(+t.getAttribute("data-i"));
    });
    document.body.appendChild(DD.pop);
  }
  var grp="",sel=DD.el.tagName==="SELECT"||!DD.el._ddPick;
  DD.pop.innerHTML=DD.items.map(function(it,i){
    var h="";
    if(it.group!==grp){grp=it.group;if(grp)h="<div class='dd-group'>"+ddEsc(grp)+"</div>";}
    return h+"<div class='dd-item"+(it.on?" on":"")+(i===DD.idx?" cur":"")+(it.off?" off":"")+"' role='option' aria-selected='"+!!it.on+"' data-i='"+i+"'>"+
      (sel?"<span class='dd-check'>"+(it.on?"&#10003;":"")+"</span>":"")+"<span class='dd-lbl'>"+(ddEsc(it.label)||"&nbsp;")+"</span></div>";
  }).join("");
  DD.pop.style.display="block";
  DD.el.classList.add("dd-open");
  ddPlace();
}
function ddPlace(){
  if(!ddIsOpen())return;
  var r=DD.el.getBoundingClientRect(),vv=window.visualViewport;
  if(!r.width&&!r.height){ddClose();return;}
  /* scrolled out of sight inside its form */
  var box=DD.el.closest(".modal");
  if(box){var b=box.getBoundingClientRect();if(r.bottom<b.top||r.top>b.bottom){ddClose();return;}}
  var top=vv?vv.offsetTop:0,h=vv?vv.height:window.innerHeight,vw=document.documentElement.clientWidth;
  if(r.bottom<top||r.top>top+h){ddClose();return;}
  var below=top+h-r.bottom-12,above=r.top-top-12,up=below<180&&above>below;
  var w=Math.min(Math.max(r.width,160),vw-16);
  DD.pop.style.width=w+"px";
  DD.pop.style.left=Math.max(8,Math.min(r.left,vw-w-8))+"px";
  DD.pop.style.maxHeight=Math.max(110,Math.min(280,up?above:below))+"px";
  DD.pop.style.top=(up?r.top-DD.pop.offsetHeight-4:r.bottom+4)+"px";
}
function ddIsOpen(){return !!(DD.el&&DD.pop&&DD.pop.style.display==="block");}
function ddOpen(el){
  if(DD.el&&DD.el!==el)ddClose();
  DD.el=el;DD.typed=false;DD.idx=-1;DD.buf="";
  ddRender();
  if(!ddIsOpen())return;
  var c=DD.pop.querySelector(".dd-item.on");
  DD.pop.scrollTop=c?Math.max(0,c.offsetTop-DD.pop.clientHeight/2+c.offsetHeight/2):0;
}
function ddClose(){
  if(DD.el)DD.el.classList.remove("dd-open");
  if(DD.pop)DD.pop.style.display="none";
  DD.el=null;DD.items=[];DD.idx=-1;
}
function ddFire(el,type){el.dispatchEvent(new Event(type,{bubbles:true}));}
function ddPick(i){
  var el=DD.el,it=DD.items[i];
  if(!el||!it||it.off)return;
  ddClose();
  if(el.tagName==="SELECT"){
    if(el.selectedIndex===it.i)return;
    el.selectedIndex=it.i;ddFire(el,"input");ddFire(el,"change");
  }else if(el._ddPick)el._ddPick(it.label);
  else{
    el.value=it.label;
    DD.quiet=true;
    try{ddFire(el,"input");ddFire(el,"change");}finally{DD.quiet=false;}
  }
}
function ddMove(step){
  var n=DD.items.length,i=DD.idx;
  if(!n)return;
  if(i<0){
    i=step>0?-1:n;
    for(var k=0;k<n;k++)if(DD.items[k].on){i=k;break;}
  }
  do{i+=step;}while(i>=0&&i<n&&DD.items[i].off);
  if(i>=0&&i<n)ddGo(i);
}
function ddGo(i){
  DD.idx=i;
  Array.prototype.forEach.call(DD.pop.querySelectorAll(".dd-item"),function(e,k){e.classList.toggle("cur",k===i);});
  var c=DD.pop.querySelector(".dd-item.cur");if(c)c.scrollIntoView({block:"nearest"});
}

document.addEventListener("pointerdown",function(e){DD.ptr=e.pointerType||"mouse";DD.down=e.target;},true);
document.addEventListener("mousedown",function(e){
  var t=e.target;
  if(DD.pop&&DD.pop.contains(t))return;
  var s=t.closest&&t.closest("select");
  if(ddIsSelect(s)){
    if(DD.ptr==="touch"||e.button!==0)return; /* the phone's own picker */
    e.preventDefault();s.focus({preventScroll:true});
    if(DD.el===s&&ddIsOpen())ddClose();else ddOpen(s);
    return;
  }
  if(ddIsInput(t)){
    ddAdopt(t);
    /* already in the field: a click opens the list; on the arrow it also closes it */
    if(document.activeElement===t){
      if(DD.el===t&&ddIsOpen()){if(e.clientX>t.getBoundingClientRect().right-34)ddClose();}
      else ddOpen(t);
    }
    return;
  }
  if(DD.el)ddClose();
},true);
document.addEventListener("focusin",function(e){
  var t=e.target;
  if(ddIsInput(t)){
    ddAdopt(t);
    /* only when the person clicked or tabbed in, not when a form focuses it */
    if(DD.down===t||Date.now()-DD.tabT<300)ddOpen(t);
  }else if(DD.el&&t!==DD.el)ddClose();
});
document.addEventListener("focusout",function(e){if(DD.el&&e.target===DD.el)ddClose();});
document.addEventListener("input",function(e){
  var t=e.target;
  if(DD.quiet||!ddIsInput(t)||document.activeElement!==t)return;
  ddAdopt(t);
  if(DD.el&&DD.el!==t)ddClose();
  DD.el=t;DD.typed=true;DD.idx=-1;ddRender();
  t.classList.toggle("dd-open",ddIsOpen());
  if(DD.pop)DD.pop.scrollTop=0;
},true);
document.addEventListener("keydown",function(e){
  if(e.key==="Tab")DD.tabT=Date.now();
  var t=e.target,sel=ddIsSelect(t),open=ddIsOpen()&&DD.el===t;
  if(!sel&&!ddIsInput(t))return;
  if(sel&&!open){
    if(e.key===" "||e.key==="Enter"||e.key==="F4"||(e.altKey&&(e.key==="ArrowDown"||e.key==="ArrowUp"))){e.preventDefault();ddOpen(t);}
    return;
  }
  if(sel&&e.key.length===1&&e.key!==" "&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
    /* typing jumps to the matching choice */
    var now=Date.now();DD.buf=(now-DD.bufT<800?DD.buf:"")+e.key.toLowerCase();DD.bufT=now;
    var at=-1;
    DD.items.forEach(function(it,i){
      if(it.off)return;
      var p=it.label.toLowerCase().indexOf(DD.buf);
      if(p===0&&(at<0||DD.items[at].label.toLowerCase().indexOf(DD.buf)!==0))at=i;
      else if(p>0&&at<0&&DD.buf.length>1)at=i;
    });
    if(at>-1)ddGo(at);
    e.preventDefault();return;
  }
  if(e.key==="ArrowDown"||e.key==="ArrowUp"){
    e.preventDefault();
    if(open)ddMove(e.key==="ArrowDown"?1:-1);else ddOpen(t);
  }else if(e.key==="Enter"||(sel&&e.key===" ")){
    if(open&&DD.idx>-1){e.preventDefault();e.stopPropagation();ddPick(DD.idx);}
    else if(sel){e.preventDefault();ddClose();}
    else if(t._ddPick&&t.value.trim()){e.preventDefault();var v=t.value.trim();ddClose();t._ddPick(v);}
  }else if(e.key==="Escape"&&open){e.preventDefault();e.stopPropagation();ddClose();}
  else if(e.key==="Tab"&&open)ddClose();
},true);
window.addEventListener("scroll",function(e){if(DD.el&&!(DD.pop&&DD.pop.contains(e.target)))ddPlace();},true);
window.addEventListener("resize",ddPlace);
if(window.visualViewport){
  window.visualViewport.addEventListener("resize",ddPlace);
  window.visualViewport.addEventListener("scroll",ddPlace);
}
