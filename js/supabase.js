const SB_URL="https://mtuteycxdhlqpdupqolb.supabase.co";
const SB_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im10dXRleWN4ZGhscXBkdXBxb2xiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY3NDY4NDAsImV4cCI6MjA5MjMyMjg0MH0.LTP6V7jECT3ArHiiUPIi1yf_38Rpdl0JhFAatHte22M";
function sbH(){return{"apikey":SB_KEY,"Authorization":"Bearer "+sbToken(),"Content-Type":"application/json","Prefer":"return=representation"};}
async function sbGet(t){var r=await fetch(SB_URL+"/rest/v1/"+t+"?select=*&order=created_at.asc",{headers:sbH()});return r.ok?r.json():null;}
async function sbInsert(t,row){var r=await fetch(SB_URL+"/rest/v1/"+t,{method:"POST",headers:sbH(),body:JSON.stringify(row)});return r.ok?r.json():null;}
async function sbDelete(t,id){return (await fetch(SB_URL+"/rest/v1/"+t+"?id=eq."+id,{method:"DELETE",headers:sbH()})).ok;}
/* Attachments: array of {name,url}. Legacy rows saved before multi-PDF
   support only have pdf_url — fall back to it when attachments is null,
   recovering the original filename from the storage path. */
function attNameFromUrl(url){
  try{
    var base=decodeURIComponent(String(url).split("/").pop().split("?")[0]);
    return base.replace(/^\d{10,}-/,"")||"PDF";
  }catch(e){return "PDF";}
}
var DOCTYPES=["Quotation","PO","Invoice","Other"];
/* Best-guess document type from a filename. Underscores are normalised to
   spaces first: \b treats _ as a word character, so "PO_4415000186.pdf" had
   no boundary after "po" and fell through to Other. */
function guessDoctype(name){
  var s=String(name||"").toLowerCase().replace(/_/g," ");
  if(/invoice|\btax\b|\bti[-_ ]/.test(s))return "Invoice";
  if(/\bp\.?o\.?\b|purchase[\s_-]?order/.test(s))return "PO";
  if(/quotation|\bquote\b|(^|[^a-z])q\d/.test(s))return "Quotation";
  return "Other";
}
function attFromDb(r){
  if(r.attachments&&Array.isArray(r.attachments)){
    return r.attachments.map(function(a){
      var name=(!a.name||a.name==="PDF")?attNameFromUrl(a.url):a.name;
      return {name:name,url:a.url,doctype:a.doctype||guessDoctype(name)};
    });
  }
  if(r.pdf_url){var n=attNameFromUrl(r.pdf_url);return[{name:n,url:r.pdf_url,doctype:guessDoctype(n)}];}
  return[];
}
function dbToTx(r){return{_id:r.id,customer:r.customer||"",country:r.country||"",date:r.date||"",status:r.status||"PO",project:r.project||"",pn:r.pn||"",model:r.model||"",qty:r.qty||"",price:Number(r.price)||0,dualPrice:r.dual_price?Number(r.dual_price):undefined,currency:r.currency||"USD",terms:r.terms||[],warranty:r.warranty||"",bp:r.bp?Number(r.bp):null,totalOverride:r.total_override?Number(r.total_override):undefined,printerTotalOverride:r.printer_total_override?Number(r.printer_total_override):undefined,noPrinterTotal:r.no_printer_total||false,projectGroup:r.project_group||"",displayModel:r.display_model||"",attachments:attFromDb(r),notes:r.notes||[]};}
function txToDb(t){var att=t.attachments||[];return{customer:t.customer,country:t.country,date:t.date,status:t.status,project:t.project,pn:t.pn,model:t.model,qty:t.qty,price:t.price,dual_price:t.dualPrice||null,currency:t.currency,terms:t.terms,warranty:t.warranty,bp:t.bp||null,total_override:t.totalOverride||null,printer_total_override:t.printerTotalOverride||null,no_printer_total:t.noPrinterTotal||false,project_group:t.projectGroup||null,display_model:t.displayModel||null,attachments:att,pdf_url:att[0]?att[0].url:null,notes:t.notes};}
/* Upload a PDF to the "documents" storage bucket; returns its public URL. */
async function sbUploadPdf(file){
  var safe=(file.name||"document.pdf").replace(/[^a-zA-Z0-9._-]/g,"_");
  var path="tx/"+Date.now()+"-"+safe;
  var r=await fetch(SB_URL+"/storage/v1/object/documents/"+path,{
    method:"POST",
    headers:{"apikey":SB_KEY,"Authorization":"Bearer "+sbToken(),"Content-Type":file.type||"application/pdf"},
    body:file
  });
  if(!r.ok)throw new Error("upload failed (HTTP "+r.status+")");
  return SB_URL+"/storage/v1/object/public/documents/"+path;
}
/* Uploads any staged entries (those carrying a File instead of a url) in
   place, preserving the doctype the user chose. Also drains the input in case
   files were picked without the change handler having staged them. */
async function sbUploadAttachments(inputId,current){
  attStageFiles(inputId,current);
  var pending=current.filter(function(a){return a.file&&!a.url;});
  for(var i=0;i<pending.length;i++){
    var a=pending[i];
    showLoad("Uploading PDF "+(i+1)+" of "+pending.length+"...");
    a.url=await sbUploadPdf(a.file);
    delete a.file;
  }
  return current;
}
function attEscName(n){return String(n||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function docTypeSelect(cur,setFn,i){
  return "<select class='att-type' title='Document type' onchange='"+setFn+"(this.value,"+i+")'>"+
    DOCTYPES.map(function(t){return "<option"+(t===cur?" selected":"")+">"+t+"</option>";}).join("")+
  "</select>";
}
/* Every attachment — already uploaded or just picked — renders the same way:
   a doctype dropdown, the filename, a ⚡ to parse that specific document, and
   a remove. Picked-but-unsaved files used to render as an inert label with no
   dropdown and no ⚡, so you couldn't set a type or parse from them until
   after saving. */
function attListHtml(list,removeFn,setFn,inputId,parseFn){
  var html=list.map(function(a,i){
    var parseBtn=parseFn?" <a href='#' class='att-parse' title='Fill the form from this PDF' onclick='"+parseFn+"(event,"+i+")'>&#9889;</a>":"";
    var name=a.url
      ?"<a href='"+a.url+"' target='_blank' rel='noopener'>"+attEscName(a.name)+"</a>"
      :attEscName(a.name)+" <em>(uploads on save)</em>";
    return "<span class='att-item"+(a.url?"":" att-pending")+"'>"+
      docTypeSelect(a.doctype||guessDoctype(a.name),setFn,i)+" &#128206; "+name+parseBtn+
      " <a href='#' class='att-remove' title='Remove' onclick='"+removeFn+"(event,"+i+")'>&#10005;</a></span>";
  }).join("");
  return html||"<span class='att-empty'>No documents yet. Add the quotation, PO or tax invoice — you can tag each one and choose which to read.</span>";
}
/* Move whatever is sitting in the file input into `list` and clear the input,
   so a second "Choose files" adds to the set instead of replacing it. */
function attStageFiles(inputId,list,rerender){
  var input=document.getElementById(inputId);
  var files=input&&input.files?Array.prototype.slice.call(input.files):[];
  for(var i=0;i<files.length;i++){
    var f=files[i];
    if(f.type&&f.type!=="application/pdf"&&!/\.pdf$/i.test(f.name||"")){
      alert("\""+f.name+"\" is not a PDF — skipped.");
      continue;
    }
    list.push({name:f.name||"document.pdf",file:f,doctype:guessDoctype(f.name)});
  }
  if(input)input.value="";
  if(rerender)rerender();
}
/* Attachment state for the transaction modal */
var TX_ATT=[];
function renderTxAttList(){
  var el=document.getElementById("f-pdf-current");
  if(el)el.innerHTML=attListHtml(TX_ATT,"txRemoveAttachment","txSetDoctype","f-pdf");
}
function txAddFiles(){attStageFiles("f-pdf",TX_ATT,renderTxAttList);}
function txRemoveAttachment(e,i){
  if(e)e.preventDefault();
  TX_ATT.splice(i,1);
  renderTxAttList();
}
function txSetDoctype(val,i){if(TX_ATT[i])TX_ATT[i].doctype=val;}
function dbToB(r){return{_id:r.id,model:r.model,pn:r.pn||"",price:Number(r.price),currency:r.currency,specialPrice:r.special_price?Number(r.special_price):undefined,specialCustomer:r.special_customer||"",group:r.grp||""};}
function bToDb(b){return{model:b.model,pn:b.pn||"",price:b.price,currency:b.currency,special_price:b.specialPrice||null,special_customer:b.specialCustomer||null,grp:b.group||null};}
function dbToO(r){return{_id:r.id,date:r.date||"",desc:r.description||"",value:r.value||"",sub:r.sub||"",cat:r.category||"",fu:r.follow_up||"",atts:Array.isArray(r.attachments)?r.attachments:[],created:r.created_at||""};}
function oToDb(o){var r={date:o.date||"",description:o.desc,value:o.value,sub:o.sub||""};if(OTHERS_HAS_CAT)r.category=o.cat||null;if(OTHERS_HAS_FU)r.follow_up=o.fu||null;
  /* files are only sent when the note has some, so an edit never clears them */
  if(OTHERS_HAS_ATT&&o.atts&&o.atts.length)r.attachments=o.atts;return r;}
function dbToS(r){return{_id:r.id,name:r.name||"",pn:r.pn||"",price:Number(r.price)||0,currency:r.currency||"USD",customer:r.customer||"",terms:r.terms||"",note:r.note||""};}
function sToDb(s){return{name:s.name,pn:s.pn||"",price:s.price,currency:s.currency||"USD",customer:s.customer||"",terms:s.terms||"",note:s.note||""};}
function dbToM(r){return r.name;}
// NEW (Stage 2): Project + line item converters
function dbToProject(r){return{_id:r.id,customer:r.customer||"",country:r.country||"",date:r.date||"",displayDate:r.display_date||"",status:r.status||"PO",project:r.project||"",projectGroup:r.project_group||"",shippingTerms:r.shipping_terms||"",warranty:r.warranty||"",currency:r.currency||"USD",notes:r.notes||[],totalOverride:r.total_override?Number(r.total_override):null,attachments:attFromDb(r)};}
function dbToLineItem(r){return{_id:r.id,projectId:r.project_id,type:r.type||"printer",name:r.name||"",displayModel:r.display_model||"",pn:r.pn||"",qty:Number(r.qty)||1,unitPrice:Number(r.unit_price)||0,buyingPrice:r.buying_price?Number(r.buying_price):null,sortOrder:Number(r.sort_order)||0};}
function showLoad(m){var e=document.getElementById("ld");if(e){e.style.display="flex";e.querySelector("span").textContent=m||"Loading...";}}
function hideLoad(){var e=document.getElementById("ld");if(e)e.style.display="none";}
async function loadFromDB(){
  showLoad("Connecting to database...");
  try{
    var res=await Promise.all([sbGet("transactions"),sbGet("buying_prices"),sbGet("others"),sbGet("spares"),sbGet("models"),sbGet("projects"),sbGet("line_items")]);
    var txRows=res[0],buyRows=res[1],othRows=res[2],spareRows=res[3],modelRows=res[4],projRows=res[5],liRows=res[6];

    // NEW (Stage 2): Load projects + line items (read-only, no seeding)
    if(projRows){PROJECTS.length=0;projRows.forEach(function(r){PROJECTS.push(dbToProject(r));});}
    if(liRows){LINE_ITEMS.length=0;liRows.forEach(function(r){LINE_ITEMS.push(dbToLineItem(r));});}

    // Legacy flat deals. Nothing writes to this table any more — every deal
    // is a project + line items — but existing rows are still rendered and
    // reconciled by resolveDeals() if any are ever restored.
    TX.length=0;
    if(txRows)txRows.forEach(function(r){TX.push(dbToTx(r));});

    /* Reference tables are only ever READ here. They used to be wiped and
       re-seeded whenever a load came back empty, and on 12 Nov 2026 a failed
       load (wrong sign-in token) was taken as "empty" and erased Notes,
       Buying Prices, Spare Parts and Models. Now: a load that worked is used
       as it is (even if empty); a load that failed changes nothing and says so. */
    var failed=[];
    if(Array.isArray(buyRows)){BUYING.length=0;buyRows.forEach(function(r){BUYING.push(dbToB(r));});}else failed.push("Buying Prices");
    if(Array.isArray(othRows)){OTHERS_HAS_CAT=!!othRows[0]&&"category" in othRows[0];OTHERS_HAS_FU=!!othRows[0]&&"follow_up" in othRows[0];OTHERS_HAS_ATT=!!othRows[0]&&"attachments" in othRows[0];OTHERS.length=0;othRows.forEach(function(r){OTHERS.push(dbToO(r));});}else failed.push("Notes");
    if(Array.isArray(spareRows)){SPARES.length=0;spareRows.forEach(function(r){SPARES.push(dbToS(r));});}else failed.push("Spare Parts");
    if(Array.isArray(modelRows)){if(modelRows.length)CUSTOM_MODELS=modelRows.map(dbToM);}else failed.push("Models");
    if(failed.length)alert("Couldn't load "+failed.join(", ")+" from the database. Nothing was changed. Reload the page; if it keeps happening, sign out and back in.");

  }catch(e){console.error(e);alert("Could not connect to database. Using local data.");}
  /* renderContent: with URL routing the app can
     start on any tab, so re-render whichever view the route selected. */
  hideLoad();refreshFilterOptions();renderStats();renderContent();
  pxFollowOnLoad();
}


var CUSTOM_MODELS=JSON.parse(localStorage.getItem("cpd_models")||"null");
function getModelList(){
  if(CUSTOM_MODELS)return CUSTOM_MODELS;
  return ["TK180 Plastic","TK180 Plastic AEA","TK180 Metal Cutter","TK180 Metal Cutter AEA","TK180 Metal Cutter NON AEA","TK180 Metal Cutter ARINC","TK180 Metal Non Cutter","TK180 Metal Non Cutter ARINC","TK180 TPH","TK302 Metal Triple Feeder","KPM180 Cutter NON AEA","KPM180 with AEA","KPM180H-LL","KPM180 NON AEA","KPM180 TPH","TK202 Plastic","TK202 with AEA","TG2460HIII","TG2480HIII","VKP80II","VKP80II-RX","VKP80III","VKP80III Rear Connector","K80","KX80S"];
}
function openManageModels(){
  document.getElementById("model-list-editor").value=getModelList().join("\n");
  document.getElementById("modal-models").classList.add("open");
}
async function saveModelList(){
  var lines=document.getElementById("model-list-editor").value.split("\n").map(function(l){return l.trim();}).filter(Boolean);
  showLoad("Saving model list...");
  try{
    /* add the new list first; the old rows go only once every insert worked */
    var old=await sbGet("models");
    if(!Array.isArray(old))throw new Error("couldn't read the current list");
    for(var i=0;i<lines.length;i++){
      if(!await sbInsert("models",{name:lines[i]}))throw new Error("couldn't save "+lines[i]);
    }
    for(var k=0;k<old.length;k++)await sbDelete("models",old[k].id);
    CUSTOM_MODELS=lines;
    localStorage.setItem("cpd_models",JSON.stringify(lines));
  }catch(e){console.error(e);alert("Save failed: "+e.message);hideLoad();return;}
  hideLoad();
  var ml=document.getElementById("model-list");
  if(ml)ml.innerHTML=lines.map(function(m){return "<option value=\""+m+"\">";}).join("");
  closeModal("modal-models");
  alert("Model list saved to cloud — visible on all devices.");
}


function autoFillPN(){
  var modelVal=document.getElementById("f-model").value.trim();
  if(!modelVal)return;
  var match=BUYING.find(function(b){return b.model.toLowerCase()===modelVal.toLowerCase();});
  var pnField=document.getElementById("f-pn");
  var bpField=document.getElementById("f-bp");
  if(match){
    if(pnField)pnField.value=match.pn?match.pn:"";
    if(bpField&&match.currency==="USD")bpField.value=match.price;
  } else {
    if(pnField)pnField.value="";
    if(bpField)bpField.value="";
  }
}


async function sbDeleteTx(){
  var idx=parseInt(document.getElementById("modal-tx").getAttribute("data-edit-idx"));
  if(isNaN(idx))return;
  if(!confirm("Delete this entry permanently?"))return;
  var tx=TX[idx];
  showLoad("Deleting...");
  if(tx&&tx._id)await sbDelete("transactions",tx._id);
  TX.splice(idx,1);
  hideLoad();
  closeModal("modal-tx");
  refreshFilterOptions();renderStats();renderContent();
}

async function sbUpdateTx(idx){
  var tx=TX[idx];
  if(!tx)return;
  var customer=document.getElementById("f-customer").value.trim();
  var country=document.getElementById("f-country").value.trim();
  var price=parseFloat(document.getElementById("f-price").value);
  var model=document.getElementById("f-model").value.trim();
  if(!customer||!country||!model||isNaN(price)){alert("Please fill in Customer, Country, Model and Price.");return;}
  var termsVal=document.getElementById("f-terms").value;
  var notesRaw=document.getElementById("f-notes").value.trim();
  var notes=notesRaw?notesRaw.split("\n").map(function(n){return n.trim();}).filter(Boolean):[];
  var bpVal=document.getElementById("f-bp").value;
  var pgv=document.getElementById("f-project-group")?document.getElementById("f-project-group").value.trim():"";
  /* Carry over fields the modal doesn't edit, so editing an entry never
     wipes dual pricing, total overrides or the attached PDF. */
  var updated={customer:customer,country:country,date:document.getElementById("f-date").value.trim(),status:document.getElementById("f-status").value,project:document.getElementById("f-project").value.trim()||"—",pn:document.getElementById("f-pn").value.trim(),model:model,qty:document.getElementById("f-qty").value.trim()||"—",price:price,currency:document.getElementById("f-currency").value,terms:termsVal?[termsVal]:[],warranty:document.getElementById("f-warranty").value,bp:bpVal?parseFloat(bpVal):null,notes:notes,projectGroup:pgv,dualPrice:tx.dualPrice,totalOverride:tx.totalOverride,printerTotalOverride:tx.printerTotalOverride,noPrinterTotal:tx.noPrinterTotal,displayModel:tx.displayModel,displayDate:tx.displayDate,_id:tx._id};
  try{await sbUploadAttachments("f-pdf",TX_ATT);}catch(err){hideLoad();alert("PDF upload failed: "+err.message+"\nEntry was not updated — please try again.");return;}
  updated.attachments=TX_ATT.slice();
  showLoad("Updating...");
  if(tx._id){
    await fetch(SB_URL+"/rest/v1/transactions?id=eq."+tx._id,{method:"PATCH",headers:sbH(),body:JSON.stringify(txToDb(updated))});
  }
  TX[idx]=updated;
  hideLoad();
  closeModal("modal-tx");
  refreshFilterOptions();renderStats();renderContent();
}

async function sbSaveTx(){
  var customer=document.getElementById("f-customer").value.trim(),country=document.getElementById("f-country").value.trim(),price=parseFloat(document.getElementById("f-price").value),model=document.getElementById("f-model").value.trim();
  if(!customer||!country||!model||isNaN(price)){alert("Please fill in Customer, Country, Model and Price.");return;}
  var termsVal=document.getElementById("f-terms").value,notesRaw=document.getElementById("f-notes").value.trim();
  var notes=notesRaw?notesRaw.split("\n").map(function(n){return n.trim();}).filter(Boolean):[];
  var bpVal=document.getElementById("f-bp").value;
  var pgv=document.getElementById("f-project-group")?document.getElementById("f-project-group").value.trim():"";var nt={customer:customer,country:country,date:document.getElementById("f-date").value.trim(),status:document.getElementById("f-status").value,project:document.getElementById("f-project").value.trim()||"—",pn:document.getElementById("f-pn").value.trim(),model:model,qty:document.getElementById("f-qty").value.trim()||"—",price:price,currency:document.getElementById("f-currency").value,terms:termsVal?[termsVal]:[],warranty:document.getElementById("f-warranty").value,bp:bpVal?parseFloat(bpVal):null,notes:notes,projectGroup:pgv};
  try{await sbUploadAttachments("f-pdf",TX_ATT);}catch(err){hideLoad();alert("PDF upload failed: "+err.message+"\nEntry was not saved — please try again.");return;}
  nt.attachments=TX_ATT.slice();
  showLoad("Saving...");
  var r=await sbInsert("transactions",txToDb(nt));if(r&&r[0])nt._id=r[0].id;
  TX.push(nt);hideLoad();closeModal("modal-tx");
  document.getElementById("modal-tx").querySelectorAll("input,textarea").forEach(function(el){el.value="";});
  refreshFilterOptions();renderStats();renderContent();
}
async function sbSaveBuying(){
  var model=document.getElementById("b-model").value.trim(),price=parseFloat(document.getElementById("b-price").value);
  if(!model||isNaN(price)){alert("Please fill in Model and Price.");return;}
  var grpVal=document.getElementById("b-group")?document.getElementById("b-group").value.trim():"";var nb={model:model,pn:document.getElementById("b-pn").value.trim(),price:price,currency:document.getElementById("b-currency").value,group:grpVal||null,specialPrice:parseFloat(document.getElementById("b-special-price").value)||undefined,specialCustomer:document.getElementById("b-special-customer").value.trim()};
  showLoad("Saving...");var r=await sbInsert("buying_prices",bToDb(nb));if(r&&r[0])nb._id=r[0].id;
  BUYING.push(nb);hideLoad();closeBuyingModal();renderContent();
}
async function sbSaveOther(){
  var desc=document.getElementById("o-desc").value.trim(),value=document.getElementById("o-value").value.trim();
  if(!desc){alert("Please fill in Description.");return;}
  var no={date:document.getElementById("o-date").value.trim(),desc:desc,value:value,sub:document.getElementById("o-sub").value.trim(),cat:ntCatClean(document.getElementById("o-cat").value),fu:document.getElementById("o-fu").value||""};
  showLoad("Saving...");var r=await sbInsert("others",oToDb(no));if(r&&r[0])no._id=r[0].id;
  OTHERS.push(no);hideLoad();closeOtherModal();renderContent();
}
async function sbDeleteBuying(i){
  if(!confirm("Remove this buying price entry?"))return;
  var item=BUYING[i];if(item&&item._id)await sbDelete("buying_prices",item._id);
  BUYING.splice(i,1);renderContent();
}

function editTx(i, e){
  if(e) e.stopPropagation();
  var tx=TX[i];
  document.getElementById("modal-tx").setAttribute("data-edit-idx", i);
  var delBtn=document.getElementById("btn-delete-tx");
  var saveBtn=document.getElementById("btn-save-tx");
  if(delBtn)delBtn.style.display="inline-flex";
  if(saveBtn){saveBtn.textContent="Update entry";saveBtn.onclick=function(){sbUpdateTx(i);};}
  document.getElementById("modal-tx").querySelector(".modal-title").textContent="Edit transaction entry";
  refreshFilterOptions();
  populateModelSelect();
  document.getElementById("f-customer").value=tx.customer;
  document.getElementById("f-country").value=tx.country;
  document.getElementById("f-date").value=tx.date||"";
  document.getElementById("f-status").value=tx.status;
  document.getElementById("f-project").value=tx.project==="—"?"":tx.project;
  var pgField=document.getElementById("f-project-group");if(pgField)pgField.value=tx.projectGroup||"";
  document.getElementById("f-model").value=tx.model;
  document.getElementById("f-pn").value=tx.pn||"";
  document.getElementById("f-qty").value=tx.qty==="—"?"":tx.qty;
  document.getElementById("f-price").value=tx.price;
  document.getElementById("f-currency").value=tx.currency;
  document.getElementById("f-bp").value=tx.bp||"";
  document.getElementById("f-terms").value=tx.terms[0]||"";
  document.getElementById("f-warranty").value=tx.warranty||"";
  document.getElementById("f-notes").value=tx.notes.join("\n");
  var pdfInput=document.getElementById("f-pdf");if(pdfInput)pdfInput.value="";
  TX_ATT=(tx.attachments||[]).slice();
  renderTxAttList();
  document.getElementById("modal-tx").classList.add("open");
}

function editBuying(i){
  var b=BUYING[i];
  document.getElementById("modal-buying").setAttribute("data-edit-idx",i);
  document.getElementById("buying-modal-title").textContent="Edit cost";
  document.getElementById("b-model").value=b.model;
  document.getElementById("b-pn").value=b.pn||"";
  document.getElementById("b-price").value=b.price;
  document.getElementById("b-currency").value=b.currency;
  document.getElementById("b-group").value=b.group||"";
  document.getElementById("b-special-price").value=b.specialPrice||"";
  document.getElementById("b-special-customer").value=b.specialCustomer||"";
  var delBtn=document.getElementById("btn-delete-buying");
  if(delBtn)delBtn.style.display="inline-flex";
  var saveBtnB=document.getElementById("btn-save-buying");
  saveBtnB.textContent="Update entry";
  saveBtnB.onclick=async function(){
    var model=document.getElementById("b-model").value.trim();
    var price=parseFloat(document.getElementById("b-price").value);
    if(!model||isNaN(price)){alert("Please fill in Model and Price.");return;}
    var spVal=document.getElementById("b-special-price").value;
    var grpVal=document.getElementById("b-group").value.trim();
    var updated={model:model,pn:document.getElementById("b-pn").value.trim(),price:price,currency:document.getElementById("b-currency").value,group:grpVal||null,specialPrice:spVal?parseFloat(spVal):undefined,specialCustomer:document.getElementById("b-special-customer").value.trim()||undefined,_id:b._id};
    showLoad("Updating...");
    if(b._id){
      await fetch(SB_URL+"/rest/v1/buying_prices?id=eq."+b._id,{method:"PATCH",headers:sbH(),body:JSON.stringify(bToDb(updated))});
    }
    BUYING[i]=updated;
    hideLoad();
    closeBuyingModal();
    renderContent();
  };
  document.getElementById("modal-buying").classList.add("open");
}

function closeBuyingModal(){
  var delBtn=document.getElementById("btn-delete-buying");
  if(delBtn)delBtn.style.display="none";
  var saveBtnB=document.getElementById("btn-save-buying");
  saveBtnB.textContent="Save entry";
  saveBtnB.onclick=sbSaveBuying;
  document.getElementById("buying-modal-title").textContent="Add item cost";
  document.getElementById("modal-buying").querySelectorAll("input").forEach(function(el){el.value="";});
  closeModal("modal-buying");
}

async function sbDeleteBuyingFromModal(){
  var i=parseInt(document.getElementById("modal-buying").getAttribute("data-edit-idx"));
  if(isNaN(i))return;
  if(!confirm("Delete this buying price entry permanently?"))return;
  var item=BUYING[i];
  showLoad("Deleting...");
  if(item&&item._id)await sbDelete("buying_prices",item._id);
  BUYING.splice(i,1);
  hideLoad();
  closeBuyingModal();
  renderContent();
}

function editOther(i){
  var o=OTHERS[i];
  document.getElementById("modal-others").setAttribute("data-edit-idx",i);
  document.getElementById("others-modal-title").textContent="Edit note / record";
  document.getElementById("o-date").value=o.date||"";
  document.getElementById("o-value").value=o.value||"";
  document.getElementById("o-desc").value=o.desc||"";
  document.getElementById("o-sub").value=o.sub||"";
  ntCatField(o.cat);ntFuField(o.fu);
  var delBtn=document.getElementById("btn-delete-other");if(delBtn)delBtn.style.display="inline-flex";
  var saveBtnO=document.getElementById("btn-save-other");
  saveBtnO.textContent="Update entry";
  saveBtnO.onclick=async function(){
    var desc=document.getElementById("o-desc").value.trim();
    var value=document.getElementById("o-value").value.trim();
    if(!desc){alert("Please fill in Description.");return;}
    var updated={date:document.getElementById("o-date").value.trim(),desc:desc,value:value,sub:document.getElementById("o-sub").value.trim(),cat:ntCatClean(document.getElementById("o-cat").value),fu:document.getElementById("o-fu").value||"",atts:o.atts||[],_id:o._id,created:o.created};
    showLoad("Updating...");
    if(o._id){
      await fetch(SB_URL+"/rest/v1/others?id=eq."+o._id,{method:"PATCH",headers:sbH(),body:JSON.stringify(oToDb(updated))});
    }
    OTHERS[i]=updated;
    hideLoad();
    closeOtherModal();
    renderContent();
  };
  document.getElementById("modal-others").classList.add("open");
}

function closeOtherModal(){
  document.getElementById("modal-others").removeAttribute("data-edit-idx");
  document.getElementById("others-modal-title").textContent="Add note / record";
  var delBtn=document.getElementById("btn-delete-other");if(delBtn)delBtn.style.display="none";
  var saveBtnO=document.getElementById("btn-save-other");
  if(saveBtnO){saveBtnO.textContent="Save entry";saveBtnO.onclick=sbSaveOther;}
  document.getElementById("modal-others").querySelectorAll("input,textarea").forEach(function(el){el.value="";});
  closeModal("modal-others");
}

async function deleteOtherFromModal(){
  var i=parseInt(document.getElementById("modal-others").getAttribute("data-edit-idx"));
  if(isNaN(i))return;
  if(!confirm("Delete this note permanently?"))return;
  var item=OTHERS[i];
  showLoad("Deleting...");
  if(item&&item._id)await sbDelete("others",item._id);
  OTHERS.splice(i,1);
  hideLoad();
  closeOtherModal();
  renderContent();
}
function deleteOther(i){if(!confirm("Remove this note?"))return;var item=OTHERS[i];if(item&&item._id){fetch(SB_URL+"/rest/v1/others?id=eq."+item._id,{method:"DELETE",headers:sbH()});}OTHERS.splice(i,1);renderContent();}
