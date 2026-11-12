/* Rich text boxes: entry details, project descriptions and notes are edited
   in a contenteditable box, so bold / italic / underline show as you type.
   The original textarea stays (hidden) and holds the text with the marks
   **bold**, *italic* and __underline__, so code that reads or sets its
   .value works unchanged and saved text renders the same as before.
   The box keeps one <div> per line; list keys mirror listKeys in render.js. */
var RICH_IDS=["te-details","tp-notes","o-desc","others-quick"];
var RICH_CMDS={b:"bold",i:"italic",u:"underline","**":"bold","*":"italic","__":"underline"};
var TA_VALUE=Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value");

function richEsc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
/* marked text -> one <div> per line */
function richToHtml(v){
  return fmtSpan(v).split("\n").map(function(l){return "<div>"+(l?fmtInline(richEsc(l)):"<br>")+"</div>";}).join("");
}
function richMarks(el,m){
  var t=el.tagName,s=el.style,fw=s.fontWeight,deco=s.textDecorationLine||s.textDecoration||"";
  m={b:m.b,i:m.i,u:m.u};
  if(t==="B"||t==="STRONG"||fw==="bold"||+fw>=600)m.b=true;
  else if(fw==="normal"||+fw&&+fw<600)m.b=false;
  if(t==="I"||t==="EM"||s.fontStyle==="italic")m.i=true;
  else if(s.fontStyle==="normal")m.i=false;
  if(t==="U"||/underline/.test(deco))m.u=true;
  return m;
}
/* box -> marked text. Each run of same-formatted text gets its own marks,
   with spaces at its edges kept outside them so the marks still render */
function richToText(ed){
  var lines=[[]];
  function nl(){lines.push([]);}
  function cur(){return lines[lines.length-1];}
  (function walk(n,m){
    [].forEach.call(n.childNodes,function(c){
      if(c.nodeType===3){
        c.data.replace(/ /g," ").split("\n").forEach(function(t,j){if(j)nl();if(t)cur().push({t:t,m:m});});
        return;
      }
      if(c.nodeType!==1)return;
      if(c.tagName==="BR"){
        // a <br> that ends a line is only the browser's filler (it holds an empty line open)
        if(!(c.nextSibling===null&&n!==ed))nl();
        return;
      }
      var block=/^(DIV|P|LI|H\d|BLOCKQUOTE|PRE)$/.test(c.tagName);
      if(block&&cur().length)nl();
      walk(c,richMarks(c,m));
      if(block)nl();
    });
  })(ed,{});
  // walk() opens a fresh line after every block, so drop the last empty one
  if(lines.length>1&&!lines[lines.length-1].length)lines.pop();
  return richRunsToText(lines);
}
/* lines of {t,m} runs -> marked text */
function richRunsToText(lines){
  return lines.map(function(runs){
    var merged=[];
    runs.forEach(function(r){
      var p=merged[merged.length-1];
      if(p&&!!p.m.b===!!r.m.b&&!!p.m.i===!!r.m.i&&!!p.m.u===!!r.m.u)p.t+=r.t;
      else merged.push({t:r.t,m:r.m});
    });
    return merged.map(function(r){
      var x=/^(\s*)([^]*?)(\s*)$/.exec(r.t);
      if(!x[2])return r.t;
      return x[1]+(r.m.u?"__":"")+(r.m.b?"**":"")+(r.m.i?"*":"")+x[2]+(r.m.i?"*":"")+(r.m.b?"**":"")+(r.m.u?"__":"")+x[3];
    }).join("");
  }).join("\n");
}
/* Pasted HTML (an email, Word, a web page) -> marked text. Numbered and
   bulleted lists become "1." / "•" lines, nested lists and quoted blocks
   are indented 4 spaces per level, and bold / italic / underline are kept;
   fonts, colours and sizes are dropped. */
function richFromHtml(html){
  var doc=new DOMParser().parseFromString(html,"text/html");
  var lines=[{ind:"",runs:[]}];
  function cur(){return lines[lines.length-1];}
  // start a fresh line unless the current one has no text yet (a list item
  // whose text sits in a <p> keeps its number on the same line)
  function nl(ind){
    var c=cur();
    if(c.runs.length)lines.push({ind:ind||"",runs:[]});else if(!c.mk)c.ind=ind||"";
  }
  function brk(ind){lines.push({ind:ind||"",runs:[]});}
  function pad(lv){return new Array(Math.max(0,lv)+1).join("    ");}
  (function walk(n,m,lv,pre){
    [].forEach.call(n.childNodes,function(c){
      if(c.nodeType===3){
        var t=c.data.replace(/ /g," ");
        if(!pre)t=t.replace(/[\r\n\t ]+/g," ");
        (pre?t.split("\n"):[t]).forEach(function(p,j){if(j)brk(pad(lv));if(p)cur().runs.push({t:p,m:m});});
        return;
      }
      if(c.nodeType!==1)return;
      var tag=c.tagName;
      if(/^(STYLE|SCRIPT|HEAD|TITLE|META|LINK|XML|TEMPLATE)$/.test(tag))return;
      if(tag==="BR"){brk(pad(lv));return;}
      if(tag==="OL"||tag==="UL"){
        nl(pad(lv));
        var k=tag==="OL"?(parseInt(c.getAttribute("start"),10)||1):0;
        [].forEach.call(c.children,function(li){
          if(li.tagName!=="LI"){walk(li,m,lv+1,pre);return;}
          if(tag==="OL"&&li.getAttribute("value"))k=parseInt(li.getAttribute("value"),10)||k;
          nl(pad(lv));cur().mk=tag==="OL"?(k++)+". ":"• ";
          walk(li,richMarks(li,m),lv+1,pre);
          nl(pad(lv));
        });
        return;
      }
      var mm=richMarks(c,m);
      if(/^H\d$/.test(tag))mm=Object.assign({},mm,{b:true});
      if(tag==="TD"||tag==="TH"){if(c.previousElementSibling)cur().runs.push({t:"   ",m:{}});walk(c,mm,lv,pre);return;}
      var block=/^(DIV|P|LI|H\d|BLOCKQUOTE|PRE|TR|TABLE|SECTION|ARTICLE|HEADER|FOOTER|DL|DT|DD|HR)$/.test(tag);
      if(!block){walk(c,mm,lv,pre);return;}
      // Word / Outlook lists are paragraphs carrying "mso-list:l0 level2"; the number is already in the text
      var st=c.getAttribute("style")||"",ml=/mso-list:\s*l\d+\s+level(\d+)/i.exec(st);
      var sub=lv+(tag==="BLOCKQUOTE"||tag==="DD"?1:0)+(ml?(+ml[1]-1):0);
      nl(pad(sub));
      walk(c,mm,sub,pre||tag==="PRE");
      nl(pad(lv));
    });
  })(doc.body,{},0,false);
  // trim each line, put its indent and list marker in front, drop blank runs at both ends
  var out=lines.map(function(l){
    var runs=l.runs.slice();
    while(runs.length&&!runs[0].t.trim())runs.shift();
    while(runs.length&&!runs[runs.length-1].t.trim())runs.pop();
    if(runs.length){
      runs[0]={t:runs[0].t.replace(/^\s+/,""),m:runs[0].m};
      var e=runs.length-1;runs[e]={t:runs[e].t.replace(/\s+$/,""),m:runs[e].m};
      // Word bullets come through as "·", "§", "o" or "▪" glyphs
      if(!l.mk&&/^[·§▪◦o]\s/.test(runs[0].t)&&/mso|Mso/.test(html))runs[0]={t:"• "+runs[0].t.slice(2),m:runs[0].m};
    }
    if(!runs.length&&!l.mk)return [];
    var head=l.ind+(l.mk||"");
    return head?[{t:head,m:{}}].concat(runs):runs;
  });
  while(out.length&&!out[0].length)out.shift();
  while(out.length&&!out[out.length-1].length)out.pop();
  // runs of blank lines (Outlook puts empty paragraphs everywhere) shrink to one
  out=out.filter(function(r,i){return r.length||(i&&out[i-1].length);});
  return richRunsToText(out);
}
/* List lines hang: wrapped text lines up under the text, not under the
   number. The width of the indent + marker is measured on the line itself. */
function richHang(ed){
  [].forEach.call(ed.children,function(d){
    var m=LIST_RE.exec(d.textContent),w=0;
    if(m&&m[3]){
      var p=richPoint(d,m[1].length+m[2].length+1),r=document.createRange();
      r.setStart(d,0);r.setEnd(p[0],p[1]);
      d.style.paddingLeft="";d.style.textIndent="";
      w=r.getBoundingClientRect().width;
    }
    // list lines also sit a little in from the edge, like an email's list
    d.style.paddingLeft=w?(w+16)+"px":"";d.style.textIndent=w?(-w)+"px":"";
  });
}
function richEmpty(ed){ed.classList.toggle("is-empty",!ed.textContent&&ed.childNodes.length<2);}
function richSync(ed){TA_VALUE.set.call(ed._ta,richToText(ed));richEmpty(ed);richHang(ed);}

/* caret as character offsets over the box's text, to survive DOM moves */
function richSave(ed){
  var sel=getSelection();if(!sel.rangeCount)return null;
  var r=sel.getRangeAt(0);if(!ed.contains(r.startContainer))return null;
  var pre=document.createRange();pre.selectNodeContents(ed);pre.setEnd(r.startContainer,r.startOffset);
  var a=pre.toString().length;return [a,a+r.toString().length];
}
function richPoint(root,off){
  var w=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),t,last=null;
  while((t=w.nextNode())){if(off<=t.data.length)return [t,off];off-=t.data.length;last=t;}
  return last?[last,last.data.length]:[root.firstChild||root,0];
}
function richSelect(a,b){
  var r=document.createRange();r.setStart(a[0],a[1]);r.setEnd((b||a)[0],(b||a)[1]);
  var sel=getSelection();sel.removeAllRanges();sel.addRange(r);
}
/* keep every line in its own <div>: an emptied box, or text the browser
   left loose at the top level, gets wrapped */
function richNormalize(ed){
  if(!ed.firstChild){ed.innerHTML="<div><br></div>";if(document.activeElement===ed)richSelect([ed.firstChild,0]);return;}
  var loose=[].some.call(ed.childNodes,function(c){return !(c.nodeType===1&&(c.tagName==="DIV"||c.tagName==="P"));});
  if(!loose)return;
  var s=richSave(ed),line=null;
  [].slice.call(ed.childNodes).forEach(function(c){
    if(c.nodeType===1&&(c.tagName==="DIV"||c.tagName==="P")){line=null;return;}
    if(c.nodeType===1&&c.tagName==="BR"){
      if(line&&line.firstChild){ed.removeChild(c);line=null;return;}
      line=document.createElement("div");ed.insertBefore(line,c);line.appendChild(c);line=null;return;
    }
    if(!line){line=document.createElement("div");ed.insertBefore(line,c);}
    line.appendChild(c);
  });
  if(s)richSelect(richPoint(ed,s[0]),richPoint(ed,s[1]));
}
/* the line(s) the selection is on */
function richCtx(ed){
  richNormalize(ed);
  var sel=getSelection();if(!sel.rangeCount)return null;
  var r=sel.getRangeAt(0);if(!ed.contains(r.startContainer))return null;
  function top(n,o){
    if(n===ed)return ed.childNodes[Math.min(o,ed.childNodes.length-1)];
    while(n.parentNode!==ed)n=n.parentNode;return n;
  }
  var a=top(r.startContainer,r.startOffset),b=top(r.endContainer,r.endOffset),lines=[],x=a;
  while(x){lines.push(x);if(x===b)break;x=x.nextSibling;}
  var pre=document.createRange();pre.selectNodeContents(a);pre.setEnd(r.startContainer,r.startOffset);
  return {line:a,lines:lines,text:a.textContent,before:pre.toString(),collapsed:r.collapsed};
}
/* swap the first `rm` characters of a line for `ins` (indents, list
   markers), keeping a caret on that line where it was in the text */
function richPrefix(line,rm,ins){
  var sel=getSelection(),k=-1;
  if(sel.rangeCount&&sel.isCollapsed&&line.contains(sel.anchorNode)){
    var r=document.createRange();r.selectNodeContents(line);r.setEnd(sel.anchorNode,sel.anchorOffset);k=r.toString().length;
  }
  var w=document.createTreeWalker(line,NodeFilter.SHOW_TEXT),t,first=null,left=rm;
  while((t=w.nextNode())){
    if(!first)first=t;
    if(left<=0)break;
    var d=Math.min(left,t.data.length);t.data=t.data.slice(d);left-=d;
  }
  if(ins){if(first)first.data=ins+first.data;else line.insertBefore(document.createTextNode(ins),line.firstChild);}
  // a line left with no text needs its <br>, or it collapses and the caret jumps away
  if(!line.textContent){line.innerHTML="<br>";if(k>=0)richSelect([line,0]);return;}
  if(k>=0)richSelect(richPoint(line,ins.length+Math.max(0,k-rm)));
}
function richSelectLines(lines){
  var last=lines[lines.length-1];richSelect([lines[0],0],[last,last.childNodes.length]);
}

function richKeys(e){
  var ed=e.currentTarget,k=e.key,mod=(e.ctrlKey||e.metaKey)&&!e.altKey;
  if(mod&&!e.shiftKey&&/^[biu]$/i.test(k)){e.preventDefault();document.execCommand(RICH_CMDS[k.toLowerCase()]);return;}
  if(mod&&k==="Enter"){if(ed._ta.id==="others-quick"){e.preventDefault();postOtherQuick();}return;}
  var c;
  if(k==="Enter"&&!e.shiftKey){
    // Enter continues a "•" or "1." list; Enter on an empty item ends it
    c=richCtx(ed);if(!c||!c.collapsed)return;
    var m=LIST_RE.exec(c.text);if(!m)return;
    e.preventDefault();
    if(!m[3].trim()){richPrefix(c.line,c.text.length,"");richSync(ed);return;}
    var n=/^\d+/.exec(m[2]);
    document.execCommand("insertParagraph");
    document.execCommand("insertText",false,m[1]+(n?(+n[0]+1)+m[2].slice(n[0].length):"•")+" ");
  }else if(k==="Tab"){
    // Tab indents; on list lines or several lines it shifts whole lines; Shift+Tab outdents
    e.preventDefault();
    c=richCtx(ed);if(!c)return;
    if(!e.shiftKey&&c.collapsed&&!MARK_RE.test(c.text)){document.execCommand("insertText",false,"    ");return;}
    c.lines.forEach(function(l){
      if(!e.shiftKey){richPrefix(l,0,"    ");return;}
      var x=/^[  ]{1,4}|^\t/.exec(l.textContent);if(x)richPrefix(l,x[0].length,"");
    });
    if(!c.collapsed)richSelectLines(c.lines);
    richSync(ed);
  }
}
/* "- " or "* " typed at a line start becomes "• " (on input, so phone keyboards get it too) */
function richBullet(ed){
  var c=richCtx(ed);if(!c||!c.collapsed)return;
  if(/^\s*[-*]\s$/.test(c.before))richPrefix(c.line,c.before.length,c.before.slice(0,-2)+"• ");
}
/* list toolbar buttons: the selected lines become a list, or plain lines again */
function richToggleList(ed,kind){
  if(document.activeElement!==ed)ed.focus();
  var c=richCtx(ed);if(!c)return;
  var texts=c.lines.map(function(l){return l.textContent;});
  var same=function(m){return m&&(m[2]==="•")===(kind==="•");};
  var isList=texts.every(function(t){return !t.trim()||same(LIST_RE.exec(t));}),k=0;
  c.lines.forEach(function(l,j){
    var t=texts[j],m=LIST_RE.exec(t);
    if(isList){if(m)richPrefix(l,m[1].length+m[2].length+1,m[1]);return;}
    if(!t.trim()&&c.lines.length>1)return;
    var ind=m?m[1]:/^\s*/.exec(t)[0];
    richPrefix(l,m?m[1].length+m[2].length+1:ind.length,ind+(kind==="•"?"•":(++k)+".")+" ");
  });
  if(!c.collapsed)richSelectLines(c.lines);
  richSync(ed);
}
function richFormat(ed,mk){
  if(document.activeElement!==ed)ed.focus();
  document.execCommand(RICH_CMDS[mk]);
}

function richify(ta){
  if(!ta||ta._rich)return;
  var ed=document.createElement("div");
  ed.className="rich-ed";ed.contentEditable="true";ed.spellcheck=true;
  ed.setAttribute("role","textbox");ed.setAttribute("aria-multiline","true");
  ed.dataset.placeholder=ta.placeholder||"";
  ed.style.cssText=ta.style.cssText;
  ta.after(ed);ta.style.display="none";
  ta._rich=ed;ed._ta=ta;
  // setting the textarea's value (opening a form, clearing it) refills the box
  Object.defineProperty(ta,"value",{configurable:true,
    get:function(){return TA_VALUE.get.call(ta);},
    set:function(v){TA_VALUE.set.call(ta,v);ed.innerHTML=richToHtml(v);richEmpty(ed);requestAnimationFrame(function(){richHang(ed);});}});
  ta.focus=function(){ed.focus();};
  ed.innerHTML=richToHtml(TA_VALUE.get.call(ta));richEmpty(ed);
  // a box filled while hidden measured nothing, so measure again once it is used or resized
  ed.addEventListener("focus",function(){richHang(ed);});
  if(window.ResizeObserver){var rw=0;new ResizeObserver(function(){if(ed.offsetWidth!==rw){rw=ed.offsetWidth;richHang(ed);}}).observe(ed);}
  ed.addEventListener("keydown",richKeys);
  ed.addEventListener("input",function(e){
    richNormalize(ed);
    if(e.data===" ")richBullet(ed);
    richSync(ed);
  });
  // pasted emails keep their lists, indents and bold / italic / underline;
  // other sites' fonts and colours stay out
  ed.addEventListener("paste",function(e){
    var cd=e.clipboardData;if(!cd)return;
    var h=cd.getData("text/html"),t=cd.getData("text/plain"),v=null;
    if(h){try{v=richFromHtml(h);}catch(err){v=null;}}
    e.preventDefault();
    if(v===null||(!v.trim()&&t)){document.execCommand("insertText",false,t||"");return;}
    var lines=v.split("\n");
    if(lines.length===1){document.execCommand("insertHTML",false,fmtInline(richEsc(fmtSpan(v))));return;}
    // into an empty box it simply becomes the text, caret at the end
    if(!richToText(ed).trim()){ed._ta.value=v;richSelect(richPoint(ed,ed.textContent.length));richSync(ed);return;}
    // several lines go in as one <div> each; the round trip clears any styling the browser added
    document.execCommand("insertHTML",false,richToHtml(v));
    var s=richSave(ed);richNormalize(ed);
    var txt=richToText(ed);ed.innerHTML=richToHtml(txt);
    if(s)richSelect(richPoint(ed,s[0]));
    richSync(ed);
  });
}
try{document.execCommand("defaultParagraphSeparator",false,"div");}catch(err){}
RICH_IDS.forEach(function(id){richify(document.getElementById(id));});
