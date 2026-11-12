/* ============================================================
   BACKUP — one click saves every table to a file on this computer.
   The Supabase free plan has no backup you can restore yourself, so
   this is the safety net if something is deleted by mistake.
   - Excel (.xlsx): one sheet per table, easy to read
   - JSON: the exact data, for restoring
   The Today page reminds you when the last backup on this device is
   more than BK_REMIND_DAYS old. PDFs/images stay in storage (not in
   the file); the file keeps their addresses.
   ============================================================ */
var BK_TABLES=["tracker_projects","tracker_entries","projects","line_items","purchase_orders","po_lines",
  "buying_prices","spares","models","pricing_profiles","others","transactions"];
var BK_REMIND_DAYS=7;
var BK_KEY="hanindo_last_backup";

function bkLast(){try{return localStorage.getItem(BK_KEY)||"";}catch(e){return "";}}
function bkDaysSince(){var l=bkLast();return l?Math.floor((Date.now()-Date.parse(l))/864e5):null;}

/* every row of a table, 1000 at a time */
async function bkFetchAll(t){
  var out=[],step=1000;
  for(var from=0;;from+=step){
    var h=Object.assign({},sbH(),{"Range-Unit":"items","Range":from+"-"+(from+step-1)});
    var r=await fetch(SB_URL+"/rest/v1/"+t+"?select=*",{headers:h});
    if(r.status===404)return null; /* table not there */
    if(!r.ok&&r.status!==206)throw new Error(t+": HTTP "+r.status);
    var rows=await r.json();
    out=out.concat(rows);
    if(rows.length<step)break;
  }
  return out;
}
async function bkCollect(){
  var data={},counts=[];
  for(var i=0;i<BK_TABLES.length;i++){
    showLoad("Backing up "+BK_TABLES[i].replace(/_/g," ")+"…");
    var rows=await bkFetchAll(BK_TABLES[i]);
    if(rows===null)continue;
    data[BK_TABLES[i]]=rows;counts.push(BK_TABLES[i]+": "+rows.length);
  }
  return {data:data,counts:counts};
}
function bkStamp(){var d=new Date();return d.getFullYear()+"-"+("0"+(d.getMonth()+1)).slice(-2)+"-"+("0"+d.getDate()).slice(-2);}
function bkSave(blob,name){
  var a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;
  document.body.appendChild(a);a.click();
  setTimeout(function(){URL.revokeObjectURL(a.href);a.remove();},1000);
}
function bkDone(){
  try{localStorage.setItem(BK_KEY,new Date().toISOString());}catch(e){}
  if(typeof currentTab!=="undefined"&&currentTab==="today"&&typeof renderToday==="function")renderToday();
}

async function bkDownloadExcel(){
  try{
    var c=await bkCollect();
    showLoad("Building the Excel file…");
    await trkLoadSheetJS();
    var wb=XLSX.utils.book_new();
    var about=[["Hanindo Dashboard backup"],["Made",new Date().toLocaleString()],["By",(typeof SB_SESSION!=="undefined"&&SB_SESSION&&SB_SESSION.email)||""],[""],["Rows per table"]].concat(c.counts.map(function(x){return x.split(": ");}));
    XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(about),"About");
    Object.keys(c.data).forEach(function(t){
      /* lists / objects (attachments, products, contacts) as JSON text */
      var rows=c.data[t].map(function(r){var o={};Object.keys(r).forEach(function(k){var v=r[k];o[k]=v!==null&&typeof v==="object"?JSON.stringify(v):v;});return o;});
      XLSX.utils.book_append_sheet(wb,rows.length?XLSX.utils.json_to_sheet(rows):XLSX.utils.aoa_to_sheet([["(empty)"]]),t.slice(0,31));
    });
    var buf=XLSX.write(wb,{bookType:"xlsx",type:"array"});
    bkSave(new Blob([buf],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}),"hanindo-backup-"+bkStamp()+".xlsx");
    hideLoad();bkDone();
  }catch(e){hideLoad();alert("Backup failed: "+e.message);}
}
async function bkDownloadJson(){
  try{
    var c=await bkCollect();
    var payload={app:"Hanindo Dashboard",made:new Date().toISOString(),by:(typeof SB_SESSION!=="undefined"&&SB_SESSION&&SB_SESSION.email)||"",tables:c.data};
    bkSave(new Blob([JSON.stringify(payload,null,1)],{type:"application/json"}),"hanindo-backup-"+bkStamp()+".json");
    hideLoad();bkDone();
  }catch(e){hideLoad();alert("Backup failed: "+e.message);}
}
