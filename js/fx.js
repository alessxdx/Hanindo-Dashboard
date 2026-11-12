/* ============================================================
   FX — USD equivalents for display only.
   Live rates from open.er-api.com (free, no key), cached in
   localStorage for 12h, with hardcoded fallback rates if the
   API is unreachable. Stored native prices are NEVER modified.
   Rates are USD-based: FX.rates[CODE] = units of CODE per 1 USD.
   ============================================================ */
var FX_FALLBACK_RATES={USD:1,SGD:1.29,CNY:7.10,IDR:16300,EUR:0.86};
var FX={rates:Object.assign({},FX_FALLBACK_RATES),dateLabel:"",live:false};

function fxApiCode(cur){return cur==="RMB"?"CNY":cur;}
function fxRate(cur){return FX.rates[fxApiCode(cur)]||null;}
function fxToUSD(amount,cur){
  if(typeof amount!=="number"||isNaN(amount))return null;
  var r=fxRate(cur);
  return r?amount/r:null;
}
function fxFormatUSD(v){
  if(v===null||v===undefined||isNaN(v))return"";
  return "$"+v.toLocaleString(undefined,{maximumFractionDigits:Math.abs(v)>=100?0:2});
}
/* "≈ $1,234 USD" (empty string for USD or unknown currency) */
function fxUsdText(amount,cur){
  if(cur==="USD")return"";
  var v=fxToUSD(amount,cur);
  if(v===null)return"";
  return "≈ "+fxFormatUSD(v)+" USD";
}
/* "1 USD = 16,300 IDR (as of 7 Jul 2026)" */
function fxNote(cur){
  if(cur==="USD")return"";
  var r=fxRate(cur);
  if(!r)return"";
  var rStr=r.toLocaleString(undefined,{maximumFractionDigits:r>=100?0:4});
  var when=FX.live?"as of "+FX.dateLabel:"offline estimate";
  return "1 USD = "+rStr+" "+cur+" ("+when+")";
}

(function fxInit(){
  var CACHE_KEY="cpd_fx",MAX_AGE=12*3600*1000;
  try{
    var cached=JSON.parse(localStorage.getItem(CACHE_KEY)||"null");
    if(cached&&cached.rates&&cached.rates.USD&&(Date.now()-cached.ts)<MAX_AGE){
      FX.rates=cached.rates;FX.dateLabel=cached.dateLabel;FX.live=true;
      return;
    }
  }catch(e){}
  fetch("https://open.er-api.com/v6/latest/USD")
    .then(function(r){return r.ok?r.json():null;})
    .then(function(d){
      if(!d||d.result!=="success"||!d.rates||!d.rates.IDR)return;
      FX.rates=d.rates;FX.live=true;
      var dt=d.time_last_update_utc?new Date(d.time_last_update_utc):new Date();
      FX.dateLabel=isNaN(dt)?new Date().toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}):dt.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
      try{localStorage.setItem(CACHE_KEY,JSON.stringify({rates:FX.rates,dateLabel:FX.dateLabel,ts:Date.now()}));}catch(e){}
      /* refresh whatever is on screen so equivalents use live rates */
      if(typeof renderContent==="function"&&document.getElementById("content")){
        try{renderContent();}catch(e){}
      }
    })
    .catch(function(){/* fallback rates stay in place */});
})();
