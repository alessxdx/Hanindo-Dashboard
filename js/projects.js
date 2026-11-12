/* ============================================================
   PROJECT / LINE-ITEM QUOTATION EDITOR ("Stage 3")
   Makes the By Project view editable: one quotation (project)
   holds N line items (printers, accessories, discounts,
   shipping adjustments) — mirroring real quotation PDFs.
   Data lives in the existing `projects` + `line_items` tables;
   the flat By Customer transactions are untouched.
   ============================================================ */
var PJ_EDIT_ID=null; /* project _id being edited, null = new */

var PJ_TYPES=[
  {v:"printer",label:"Product"}, /* stored as "printer": the main units counted (printers, wheel balancers, extinguishers…) */
  {v:"other",label:"Accessory / Service"},
  {v:"discount",label:"Discount (−)"},
  {v:"shipping_adjustment",label:"Shipping / Adj."}
];

function pjEsc(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;");}

function pjPopulateDatalists(){
  refreshFilterOptions(); /* fills customer-list / country-list / project-group-list */
  var dl=document.getElementById("pj-name-list");
  if(dl){
    var models=getModelList();
    var extras=[];
    BUYING.forEach(function(b){if(models.indexOf(b.model)===-1)extras.push(b.model);});
    if(typeof SPARES!=="undefined")SPARES.forEach(function(s){if(extras.indexOf(s.name)===-1&&models.indexOf(s.name)===-1)extras.push(s.name);});
    var all=models.concat(extras.sort());
    dl.innerHTML=all.map(function(m){return "<option value=\""+pjEsc(m)+"\">";}).join("");
  }
}

function pjRowHtml(li){
  li=li||{type:"printer",name:"",pn:"",qty:1,unitPrice:"",buyingPrice:""};
  var opts=PJ_TYPES.map(function(t){return "<option value='"+t.v+"'"+(li.type===t.v?" selected":"")+">"+t.label+"</option>";}).join("");
  return "<div class='pj-row'>"+
    "<select class='pj-type' onchange='pjRecalc()'>"+opts+"</select>"+
    "<input class='pj-name' placeholder='Model / item name' list='pj-name-list' value=\""+pjEsc(li.name)+"\" oninput='pjAutoFill(this)'>"+
    "<input class='pj-pn' placeholder='PN' value=\""+pjEsc(li.pn)+"\" oninput='pjAutoFill(this)' style=\"font-family:'DM Mono',monospace\">"+
    "<input class='pj-qty' type='number' step='any' min='0' placeholder='Qty' value=\""+pjEsc(li.qty)+"\" oninput='pjRecalc()'>"+
    "<input class='pj-price' type='number' step='any' placeholder='Unit price' value=\""+pjEsc(li.unitPrice)+"\" oninput='pjRecalc()'>"+
    "<input class='pj-bp' type='number' step='any' placeholder='Buy $' title='Buying price (USD) for margin' value=\""+pjEsc(li.buyingPrice)+"\">"+
    "<button type='button' class='pj-remove' title='Remove line' onclick='pjRemoveRow(this)'>&#10005;</button>"+
  "</div>";
}
function pjAddRow(li){
  var host=document.getElementById("pj-rows");
  host.insertAdjacentHTML("beforeend",pjRowHtml(li));
  pjRecalc();
}
function pjRemoveRow(btn){
  btn.closest(".pj-row").remove();
  pjRecalc();
}
/* Normalise a model name for matching: drop ATB/BTP tags, warranty text,
   and punctuation so "TK180 Metal ARINC (ATB)" == "tk180 metal arinc". */
function pjNormName(s){return String(s||"").toLowerCase().replace(/\((?:atb|btp)\)/g," ").replace(/\(\d+\s*years?\s*warranty\)/g," ").replace(/[^a-z0-9]+/g," ").trim();}
/* Normalise a part number: use the base PN before any "+ accessory" or
   "or <alt>", strip punctuation. "911HL010300733 + ARTFITT415" -> "911hl010300733". */
function pjNormPn(s){return String(s||"").split("+")[0].split(/\bor\b/i)[0].replace(/[^a-z0-9]/gi,"").toLowerCase();}
/* Find the Buying Prices row for a line item, by PN first then by name. */
function findBuyingMatch(name,pn){
  var np=pjNormPn(pn);
  if(np){var byPn=BUYING.find(function(b){return b.pn&&pjNormPn(b.pn)===np;});if(byPn)return byPn;}
  var nn=pjNormName(name);
  if(nn){var byName=BUYING.find(function(b){return pjNormName(b.model)===nn;});if(byName)return byName;}
  return null;
}
/* Fill PN + buying price (USD) from Buying Prices when the row's model or
   PN is known. Triggered from both the name and PN fields; never
   overwrites values already present. */
function pjAutoFill(el){
  var row=el.closest(".pj-row");
  var pn=row.querySelector(".pj-pn"),bp=row.querySelector(".pj-bp");
  var match=findBuyingMatch(row.querySelector(".pj-name").value,pn?pn.value:"");
  if(match){
    if(pn&&!pn.value)pn.value=match.pn||"";
    if(bp&&!bp.value&&match.currency==="USD")bp.value=match.price;
  }
  pjRecalc();
}
function pjReadRows(){
  return [...document.querySelectorAll("#pj-rows .pj-row")].map(function(row){
    return{
      type:row.querySelector(".pj-type").value,
      name:row.querySelector(".pj-name").value.trim(),
      pn:row.querySelector(".pj-pn").value.trim(),
      qty:parseFloat(row.querySelector(".pj-qty").value),
      unitPrice:parseFloat(row.querySelector(".pj-price").value),
      buyingPrice:row.querySelector(".pj-bp").value?parseFloat(row.querySelector(".pj-bp").value):null
    };
  });
}
function pjRecalc(){
  var cur=document.getElementById("p-currency")?document.getElementById("p-currency").value:"USD";
  var total=0,printer=0,any=false;
  pjReadRows().forEach(function(r){
    if(isNaN(r.qty)||isNaN(r.unitPrice))return;
    any=true;
    var sub=r.qty*r.unitPrice;
    total+=sub;
    if(r.type==="printer")printer+=sub;
  });
  var el=document.getElementById("pj-total");
  if(!el)return;
  if(!any){el.textContent="";return;}
  var ovr=document.getElementById("p-override")?parseFloat(document.getElementById("p-override").value):NaN;
  var fmt=function(v){return v.toLocaleString(undefined,{maximumFractionDigits:2});};
  var html="Products subtotal: <strong>"+fmt(printer)+" "+cur+"</strong> &nbsp;·&nbsp; Line total: <strong>"+fmt(total)+" "+cur+"</strong>";
  if(!isNaN(ovr))html+=" &nbsp;·&nbsp; Override shown as Project Total: <strong>"+fmt(ovr)+" "+cur+"</strong>";
  el.innerHTML=html;
}

var PJ_ATT=[];
function renderPjAttList(){
  var el=document.getElementById("p-pdf-current");
  if(el)el.innerHTML=attListHtml(PJ_ATT,"pjRemoveAttachment","pjSetDoctype","p-pdf","pjParseAttachment");
}
function pjAddFiles(){attStageFiles("p-pdf",PJ_ATT,renderPjAttList);}
function pjRemoveAttachment(e,i){
  if(e)e.preventDefault();
  PJ_ATT.splice(i,1);
  renderPjAttList();
}
function pjSetDoctype(val,i){if(PJ_ATT[i])PJ_ATT[i].doctype=val;}
function openProjectModal(){
  PJ_EDIT_ID=null;
  pjPopulateDatalists();
  document.getElementById("project-modal-title").textContent="Add quotation / project";
  var m=document.getElementById("modal-project");
  m.querySelectorAll("input,textarea").forEach(function(el){el.value="";});
  document.getElementById("p-status").value="Quotation";
  document.getElementById("p-currency").value="USD";
  document.getElementById("p-terms").value="";
  document.getElementById("p-warranty").value="";
  PJ_ATT=[];
  renderPjAttList();
  document.getElementById("pj-rows").innerHTML="";
  pjAddRow();
  var del=document.getElementById("btn-delete-project");if(del)del.style.display="none";
  m.classList.add("open");
}

function editProject(id){
  var p=PROJECTS.find(function(x){return x._id===id;});
  if(!p)return;
  PJ_EDIT_ID=id;
  pjPopulateDatalists();
  document.getElementById("project-modal-title").textContent="Edit quotation / project";
  var m=document.getElementById("modal-project");
  document.getElementById("p-customer").value=p.customer;
  document.getElementById("p-country").value=p.country;
  document.getElementById("p-date").value=p.date||"";
  document.getElementById("p-status").value=p.status||"Quotation";
  document.getElementById("p-project").value=p.project||"";
  document.getElementById("p-group").value=p.projectGroup||"";
  document.getElementById("p-currency").value=p.currency||"USD";
  document.getElementById("p-terms").value=p.shippingTerms||"";
  document.getElementById("p-warranty").value=p.warranty||"";
  document.getElementById("p-override").value=p.totalOverride||"";
  document.getElementById("p-notes").value=(p.notes||[]).join("\n");
  var pdfInput=document.getElementById("p-pdf");if(pdfInput)pdfInput.value="";
  PJ_ATT=(p.attachments||[]).slice();
  renderPjAttList();
  var rows=LINE_ITEMS.filter(function(li){return li.projectId===id;}).sort(function(a,b){return a.sortOrder-b.sortOrder;});
  document.getElementById("pj-rows").innerHTML="";
  if(rows.length)rows.forEach(function(li){pjAddRow({type:li.type,name:li.name,pn:li.pn,qty:li.qty,unitPrice:li.unitPrice,buyingPrice:li.buyingPrice});});
  else pjAddRow();
  var del=document.getElementById("btn-delete-project");if(del)del.style.display="inline-flex";
  m.classList.add("open");
}

function closeProjectModal(){
  PJ_EDIT_ID=null;
  closeModal("modal-project");
}
function projectToDb(p){
  var att=p.attachments||[];
  return{customer:p.customer,country:p.country,date:p.date||"",display_date:p.displayDate||null,status:p.status,project:p.project,project_group:p.projectGroup||null,shipping_terms:p.shippingTerms||"",warranty:p.warranty||"",currency:p.currency,notes:p.notes||[],total_override:p.totalOverride||null,attachments:att,pdf_url:att[0]?att[0].url:null};
}
function liToDb(li,projectId,order){
  return{project_id:projectId,type:li.type,name:li.name,display_model:li.type==="printer"?li.name:null,pn:li.pn||"",qty:li.qty,unit_price:li.unitPrice,buying_price:li.buyingPrice||null,sort_order:order};
}

async function pjReloadFromDB(){
  var res=await Promise.all([sbGet("projects"),sbGet("line_items")]);
  if(res[0]){PROJECTS.length=0;res[0].forEach(function(r){PROJECTS.push(dbToProject(r));});}
  if(res[1]){LINE_ITEMS.length=0;res[1].forEach(function(r){LINE_ITEMS.push(dbToLineItem(r));});}
}

async function sbSaveProject(){
  var customer=document.getElementById("p-customer").value.trim();
  var country=document.getElementById("p-country").value.trim();
  var project=document.getElementById("p-project").value.trim();
  if(!customer||!country||!project){alert("Please fill in Customer, Country and Project name.");return;}
  var rows=pjReadRows().filter(function(r){return r.name;});
  var bad=rows.filter(function(r){return isNaN(r.qty)||isNaN(r.unitPrice);});
  if(!rows.length){alert("Add at least one line item (name, qty and unit price).");return;}
  if(bad.length){alert("Every line item needs a quantity and a unit price.\n(For discounts use qty 1 and a negative unit price.)");return;}

  var existing=PJ_EDIT_ID?PROJECTS.find(function(x){return x._id===PJ_EDIT_ID;}):null;
  var notesRaw=document.getElementById("p-notes").value.trim();
  var ovr=document.getElementById("p-override").value;
  var header={
    customer:customer,country:country,
    date:document.getElementById("p-date").value.trim(),
    displayDate:existing?existing.displayDate:"",
    status:document.getElementById("p-status").value,
    project:project,
    projectGroup:document.getElementById("p-group").value.trim(),
    currency:document.getElementById("p-currency").value,
    shippingTerms:document.getElementById("p-terms").value,
    warranty:document.getElementById("p-warranty").value,
    notes:notesRaw?notesRaw.split("\n").map(function(n){return n.trim();}).filter(Boolean):[],
    totalOverride:ovr?parseFloat(ovr):null
  };
  try{await sbUploadAttachments("p-pdf",PJ_ATT);}catch(err){hideLoad();alert("PDF upload failed: "+err.message+"\nNothing was saved — please try again.");return;}
  header.attachments=PJ_ATT.slice();

  showLoad(PJ_EDIT_ID?"Updating project...":"Saving project...");
  try{
    var projId=PJ_EDIT_ID;
    if(PJ_EDIT_ID){
      var r=await fetch(SB_URL+"/rest/v1/projects?id=eq."+PJ_EDIT_ID,{method:"PATCH",headers:sbH(),body:JSON.stringify(projectToDb(header))});
      if(!r.ok)throw new Error("project update failed (HTTP "+r.status+")");
      var rd=await fetch(SB_URL+"/rest/v1/line_items?project_id=eq."+PJ_EDIT_ID,{method:"DELETE",headers:sbH()});
      if(!rd.ok)throw new Error("line item replace failed (HTTP "+rd.status+")");
    }else{
      var ri=await sbInsert("projects",projectToDb(header));
      if(!ri||!ri[0])throw new Error("project insert failed");
      projId=ri[0].id;
    }
    var liPayload=rows.map(function(li,i){return liToDb(li,projId,i*10);});
    var rl=await fetch(SB_URL+"/rest/v1/line_items",{method:"POST",headers:sbH(),body:JSON.stringify(liPayload)});
    if(!rl.ok)throw new Error("line item insert failed (HTTP "+rl.status+")");
    await pjReloadFromDB();
  }catch(err){
    console.error(err);
    hideLoad();
    alert("Save failed: "+err.message+"\nPlease check your connection and try again.");
    return;
  }
  hideLoad();
  closeProjectModal();
  renderContent();
}

async function sbDeleteProject(){
  if(!PJ_EDIT_ID)return;
  var p=PROJECTS.find(function(x){return x._id===PJ_EDIT_ID;});
  var liCount=LINE_ITEMS.filter(function(li){return li.projectId===PJ_EDIT_ID;}).length;
  if(!confirm("Delete project \""+(p?p.project:"")+"\" and its "+liCount+" line item"+(liCount!==1?"s":"")+" permanently?"))return;
  showLoad("Deleting project...");
  try{
    await fetch(SB_URL+"/rest/v1/line_items?project_id=eq."+PJ_EDIT_ID,{method:"DELETE",headers:sbH()});
    var r=await fetch(SB_URL+"/rest/v1/projects?id=eq."+PJ_EDIT_ID,{method:"DELETE",headers:sbH()});
    if(!r.ok)throw new Error("delete failed (HTTP "+r.status+")");
    await pjReloadFromDB();
  }catch(err){
    console.error(err);
    hideLoad();
    alert("Delete failed: "+err.message);
    return;
  }
  hideLoad();
  closeProjectModal();
  renderContent();
}
