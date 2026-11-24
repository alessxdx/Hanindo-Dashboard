/* ============================================================
   SIGN-IN (Supabase Auth, email + password, no SDK)
   Once signed in, every database / storage request carries the
   person's own access token instead of the public anon key, so the
   database can be locked to signed-in people only (row-level
   security). Passwords are typed here and checked by Supabase; they
   are never stored in this code or in the browser — only the session
   tokens Supabase hands back (kept in localStorage, refreshed before
   they expire).

   SB_AUTH_REQUIRED: false while the database is still open — sign-in
   is optional (sidebar "Sign in") so accounts can be tested. Set it to
   true in the same release that switches row-level security on; from
   then on the site shows the sign-in screen until someone signs in.
   ============================================================ */
var SB_AUTH_REQUIRED=true;
/* All of the owner's GitHub Pages sites share one browser storage
   (alessxdx.github.io), and another of them keeps its own Supabase session
   under "sb_session" — so this site's key names the project, and a stored
   session is only trusted when its token was issued by THIS project. */
var SB_REF=String(SB_URL).replace(/^https?:\/\//,"").split(".")[0];
var SB_SESSION_KEY="hanindo_sb_session_"+SB_REF;
function sbTokenRef(tok){
  try{var p=JSON.parse(atob(String(tok).split(".")[1].replace(/-/g,"+").replace(/_/g,"/")));
    return String(p.iss||"").indexOf(SB_REF)>-1||p.ref===SB_REF;}catch(e){return false;}
}
function sbValidSession(s){return !!(s&&s.access_token&&s.refresh_token&&s.email&&sbTokenRef(s.access_token));}
/* "Keep me signed in" on: the session lives in localStorage and survives
   closing the browser (it is refreshed in the background, so it lasts until
   Sign out). Off: sessionStorage, so it ends when the browser closes. */
var SB_SESSION=(function(){
  try{
    var s=JSON.parse(localStorage.getItem(SB_SESSION_KEY)||"null");
    if(!sbValidSession(s))s=JSON.parse(sessionStorage.getItem(SB_SESSION_KEY)||"null");
    return sbValidSession(s)?s:null;
  }catch(e){return null;}
})();

function sbSaveSession(s){
  SB_SESSION=s;
  try{
    localStorage.removeItem(SB_SESSION_KEY);sessionStorage.removeItem(SB_SESSION_KEY);
    if(s)(s.keep===false?sessionStorage:localStorage).setItem(SB_SESSION_KEY,JSON.stringify(s));
  }catch(e){}
  sbRenderAuthNav();
}
/* the token requests send: the person's session, else the anon key */
function sbToken(){return SB_SESSION&&SB_SESSION.access_token?SB_SESSION.access_token:SB_KEY;}
function sbSignedIn(){return !!(SB_SESSION&&SB_SESSION.access_token);}

function sbSessionFrom(j,email,keep){
  return {access_token:j.access_token,refresh_token:j.refresh_token,
    expires_at:Date.now()+((j.expires_in||3600)*1000),
    email:(j.user&&j.user.email)||email||"",keep:keep!==false};
}
async function sbSignIn(email,password,keep){
  var r=await fetch(SB_URL+"/auth/v1/token?grant_type=password",{method:"POST",
    headers:{"apikey":SB_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:email,password:password})});
  var j=await r.json().catch(function(){return {};});
  if(!r.ok||!j.access_token)throw new Error(j.error_description||j.msg||j.error||"Sign-in failed");
  var s=sbSessionFrom(j,email,keep);
  if(!sbValidSession(s))throw new Error("Sign-in answer not from this database");
  sbSaveSession(s);
}
var SB_REFRESHING=null;
async function sbRefresh(){
  if(!SB_SESSION||!SB_SESSION.refresh_token)return false;
  if(SB_REFRESHING)return SB_REFRESHING;
  SB_REFRESHING=(async function(){
    var was=SB_SESSION.refresh_token;
    try{
      var r=await fetch(SB_URL+"/auth/v1/token?grant_type=refresh_token",{method:"POST",
        headers:{"apikey":SB_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:SB_SESSION.refresh_token})});
      var j=await r.json().catch(function(){return {};});
      /* signed in again, out, or password changed meanwhile: that session wins */
      if(!SB_SESSION||SB_SESSION.refresh_token!==was)return sbSignedIn();
      if(!r.ok||!j.access_token){sbSaveSession(null);return false;}
      sbSaveSession(sbSessionFrom(j,SB_SESSION.email,SB_SESSION.keep));
      return true;
    }catch(e){return false;} /* offline: keep the session, try again later */
    finally{SB_REFRESHING=null;}
  })();
  return SB_REFRESHING;
}
/* refresh when less than 5 minutes are left */
async function sbEnsureFresh(){
  if(!SB_SESSION)return false;
  if(SB_SESSION.expires_at-Date.now()>5*60*1000)return true;
  return sbRefresh();
}
/* another tab of this site signed in again or changed the password: use its
   new session, so this tab's old one is not refused and wiped for both */
window.addEventListener("storage",function(ev){
  if(ev.key!==SB_SESSION_KEY||!ev.newValue||!SB_SESSION)return;
  try{var s=JSON.parse(ev.newValue);if(sbValidSession(s)&&s.email===SB_SESSION.email){SB_SESSION=s;sbRenderAuthNav();}}catch(e){}
});
setInterval(function(){sbEnsureFresh();},60*1000);
document.addEventListener("visibilitychange",function(){if(!document.hidden)sbEnsureFresh();});

function sbSignOut(){
  var tok=SB_SESSION&&SB_SESSION.access_token;
  if(tok)fetch(SB_URL+"/auth/v1/logout",{method:"POST",headers:{"apikey":SB_KEY,"Authorization":"Bearer "+tok}}).catch(function(){});
  sbSaveSession(null);
  if(SB_AUTH_REQUIRED)location.reload();
}

/* ---------- sign-in screen ---------- */
function sbLoginHtml(msg){
  return "<div class='sb-login-card'>"+
    "<div class='sb-login-brand'>Hanindo Dashboard</div>"+
    "<h1>Sign in</h1>"+
    (msg?"<div class='sb-login-msg'>"+msg+"</div>":"")+
    "<form onsubmit='return sbLoginSubmit(event)'>"+
      "<label>Email<input id='sb-email' type='email' autocomplete='username' required value='"+String((SB_SESSION&&SB_SESSION.email)||"").replace(/'/g,"&#39;")+"'></label>"+
      "<label>Password<input id='sb-pass' type='password' autocomplete='current-password' required></label>"+
      "<label class='sb-keep'><input id='sb-keep' type='checkbox' checked> Keep me signed in on this device</label>"+
      "<div class='sb-login-err' id='sb-err'></div>"+
      "<button type='submit' class='btn-save' id='sb-go'>Sign in</button>"+
      (SB_AUTH_REQUIRED?"":"<button type='button' class='edit-btn' onclick='sbHideLogin()'>Cancel</button>")+
    "</form>"+
    "<div class='sb-login-foot'>Accounts are added by the admin in Supabase. Forgot your password? Ask them to reset it.</div>"+
  "</div>";
}
var SB_AFTER_LOGIN=null;
var SB_RETURN_HASH="";
function sbShowLogin(msg,after){
  if(after)SB_AFTER_LOGIN=after;
  /* signed out = no page in the address (not "#today"); the page is
     remembered and opened again after signing in */
  if(location.hash){
    SB_RETURN_HASH=location.hash;
    try{history.replaceState(null,"",location.pathname+location.search);}catch(e){}
  }
  var el=document.getElementById("sb-login");
  if(!el){el=document.createElement("div");el.id="sb-login";el.className="sb-login";document.body.appendChild(el);}
  el.innerHTML=sbLoginHtml(msg||"");
  el.style.display="flex";
  setTimeout(function(){var i=document.getElementById(document.getElementById("sb-email").value?"sb-pass":"sb-email");if(i)i.focus();},30);
}
function sbHideLogin(){var el=document.getElementById("sb-login");if(el)el.style.display="none";}
async function sbLoginSubmit(ev){
  ev.preventDefault();
  var btn=document.getElementById("sb-go"),err=document.getElementById("sb-err");
  btn.disabled=true;btn.textContent="Signing in…";err.textContent="";
  try{
    await sbSignIn(document.getElementById("sb-email").value.trim(),document.getElementById("sb-pass").value,document.getElementById("sb-keep").checked);
    sbHideLogin();
    if(SB_RETURN_HASH){try{history.replaceState(null,"",location.pathname+location.search+SB_RETURN_HASH);}catch(e){}SB_RETURN_HASH="";}
    var f=SB_AFTER_LOGIN;SB_AFTER_LOGIN=null;
    /* anything loaded while signed out came back empty: load it all again */
    if(typeof TRK_LOADED!=="undefined")TRK_LOADED=false;
    if(f)f();
    else if(typeof loadFromDB==="function")loadFromDB();
  }catch(e){
    err.textContent=/invalid/i.test(e.message)?"Wrong email or password.":e.message;
    btn.disabled=false;btn.textContent="Sign in";
  }
  return false;
}

/* ---------- account box: who is signed in, change password, sign out ---------- */
function sbEsc(t){return String(t||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
var SB_PW_MIN=10;
var SB_PW_BUSY=false;
function sbAcctBox(html){
  var el=document.getElementById("sb-acct");
  if(!el){el=document.createElement("div");el.id="sb-acct";el.className="sb-login sb-acct";document.body.appendChild(el);}
  el.innerHTML="<div class='sb-login-card' role='dialog' aria-modal='true' aria-labelledby='sb-acct-h'>"+html+"</div>";
  el.style.display="flex";
}
function sbCloseAcct(){
  if(SB_PW_BUSY)return;
  var el=document.getElementById("sb-acct");
  if(el){el.style.display="none";el.innerHTML="";} /* typed passwords do not stay in the page */
}
document.addEventListener("keydown",function(ev){
  var el=document.getElementById("sb-acct");
  if(ev.key==="Escape"&&el&&el.style.display==="flex"){ev.stopPropagation();sbCloseAcct();}
},true);
function sbShowAcct(){
  if(!sbSignedIn())return sbShowLogin();
  sbAcctBox("<h1 id='sb-acct-h'>Your account</h1>"+
    "<div class='sb-acct-mail'>"+sbEsc(SB_SESSION.email)+"</div>"+
    "<div class='sb-acct-btns'>"+
      "<button type='button' class='btn-save' id='sb-acct-pw' onclick='sbShowChangePw()'>Change password</button>"+
      "<button type='button' class='edit-btn' onclick='if(confirm(\"Sign out?\"))sbSignOut();'>Sign out</button>"+
      "<button type='button' class='edit-btn' onclick='sbCloseAcct()'>Close</button>"+
    "</div>");
  document.getElementById("sb-acct-pw").focus();
}
function sbShowChangePw(){
  sbAcctBox("<h1 id='sb-acct-h'>Change password</h1>"+
    "<form onsubmit='return sbChangePwSubmit(event)'>"+
      /* tells the password manager which account this is */
      "<input type='email' autocomplete='username' value='"+sbEsc(SB_SESSION.email)+"' readonly hidden>"+
      "<label>Current password<input id='sb-pw-old' type='password' autocomplete='current-password' required></label>"+
      "<label>New password<input id='sb-pw-new' type='password' autocomplete='new-password' required></label>"+
      "<label>New password again<input id='sb-pw-rep' type='password' autocomplete='new-password' required></label>"+
      "<label class='sb-keep'><input type='checkbox' onchange='sbPwShow(this.checked)'> Show passwords</label>"+
      "<div class='sb-login-err' id='sb-pw-err' role='alert'></div>"+
      "<button type='submit' class='btn-save' id='sb-pw-go'>Change password</button>"+
      "<button type='button' class='edit-btn' onclick='sbCloseAcct()'>Cancel</button>"+
    "</form>"+
    "<div class='sb-login-foot'>At least "+SB_PW_MIN+" characters. Your other devices are signed out, within about an hour.</div>");
  document.getElementById("sb-pw-old").focus();
}
function sbPwShow(on){["sb-pw-old","sb-pw-new","sb-pw-rep"].forEach(function(id){document.getElementById(id).type=on?"text":"password";});}
async function sbAuthCall(method,path,token,body){
  var h={"apikey":SB_KEY,"Content-Type":"application/json"};
  if(token)h.Authorization="Bearer "+token;
  var r=await fetch(SB_URL+"/auth/v1/"+path,{method:method,headers:h,body:body?JSON.stringify(body):undefined});
  var j=await r.json().catch(function(){return {};});
  return {ok:r.ok,status:r.status,j:j,code:j.error_code||j.error||"",msg:j.msg||j.error_description||j.message||("error "+r.status)};
}
/* The current password is checked by signing in with it, so an unlocked
   computer is not enough to take the account over. That fresh sign-in makes
   the change and then replaces the old session. */
async function sbChangePassword(oldPw,newPw){
  var email=SB_SESSION.email,keep=SB_SESSION.keep,a;
  a=await sbAuthCall("POST","token?grant_type=password",null,{email:email,password:oldPw});
  if(!a.ok||!a.j.access_token)
    throw new Error(a.code==="invalid_credentials"||a.code==="invalid_grant"?"The current password is wrong.":a.msg);
  var s=sbSessionFrom(a.j,email,keep);
  if(!sbValidSession(s))throw new Error("Sign-in answer not from this database");
  var u;
  try{u=await sbAuthCall("PUT","user",s.access_token,{password:newPw});}
  catch(e){throw new Error("The connection dropped, so the change could not be confirmed. Try again; if your current password is refused, sign in with the new one.");}
  if(!u.ok){
    sbAuthCall("POST","logout?scope=local",s.access_token).catch(function(){});
    throw new Error(u.code==="same_password"?"The new password must be different from the current one.":u.msg);
  }
  sbSaveSession(s);
  /* sign the other devices out */
  try{return (await sbAuthCall("POST","logout?scope=others",s.access_token)).ok;}catch(e){return false;}
}
async function sbChangePwSubmit(ev){
  ev.preventDefault();
  if(SB_PW_BUSY)return false;
  var o=document.getElementById("sb-pw-old").value,n=document.getElementById("sb-pw-new").value,r=document.getElementById("sb-pw-rep").value;
  var err=document.getElementById("sb-pw-err"),btn=document.getElementById("sb-pw-go");
  var bad=n.length<SB_PW_MIN?"The new password needs at least "+SB_PW_MIN+" characters.":
    n!==r?"The two new passwords are not the same.":
    n===o?"The new password must be different from the current one.":"";
  err.textContent=bad;
  if(bad)return false;
  SB_PW_BUSY=true;btn.disabled=true;btn.textContent="Changing…";
  try{
    var others=await sbChangePassword(o,n);
    SB_PW_BUSY=false;
    sbAcctBox("<h1 id='sb-acct-h'>Password changed</h1>"+
      "<div class='sb-acct-mail'>Use the new password the next time you sign in. "+
      (others?"Your other devices are being signed out.":"Signing out your other devices could not be confirmed.")+"</div>"+
      "<div class='sb-acct-btns'><button type='button' class='btn-save' id='sb-acct-ok' onclick='sbCloseAcct()'>Done</button></div>");
    document.getElementById("sb-acct-ok").focus();
  }catch(e){
    SB_PW_BUSY=false;
    err.textContent=/failed to fetch|networkerror|load failed/i.test(e.message)?"No connection. Your password was not changed.":e.message;
    btn.disabled=false;btn.textContent="Change password";
  }
  return false;
}

/* sidebar: who is signed in; opens the account box, or sign in */
function sbRenderAuthNav(){
  var foot=document.querySelector(".sidebar-foot");
  if(!foot)return;
  var el=document.getElementById("sb-auth-nav");
  if(!el){el=document.createElement("button");el.id="sb-auth-nav";el.className="nav-item";foot.insertBefore(el,foot.firstChild);}
  var ico="<span class='nav-icon'><svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='4'/><path d='M4 21c0-4 4-6 8-6s8 2 8 6'/></svg></span>";
  if(sbSignedIn()){
    el.title="Signed in as "+SB_SESSION.email+" — change password or sign out";
    el.onclick=sbShowAcct;
    el.innerHTML=ico+"<span class='nav-label sidebar-foot-label sb-who'>"+String(SB_SESSION.email).replace(/</g,"&lt;")+"</span>";
  }else{
    el.title="Sign in";
    el.onclick=function(){sbShowLogin();};
    el.innerHTML=ico+"<span class='nav-label sidebar-foot-label'>Sign in</span>";
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sbRenderAuthNav);else sbRenderAuthNav();

/* ===== private files =====
   The "documents" bucket is private: files are fetched with the person's
   sign-in, or opened through a temporary signed link. Stored addresses keep
   the old public form (.../object/public/documents/<path>); everything that
   opens them is translated here, so no saved record has to change. */
var SB_DOC_MARK="/storage/v1/object/public/documents/";
function sbDocPath(url){url=String(url||"");var i=url.indexOf(SB_DOC_MARK);return i<0?null:url.slice(i+SB_DOC_MARK.length).split("#")[0];}
/* a link that works for an hour, for opening in a new tab */
async function sbSignedUrl(url){
  var p=sbDocPath(url);
  if(!p)return url;
  await sbEnsureFresh();
  var r=await SB_NATIVE_FETCH(SB_URL+"/storage/v1/object/sign/documents/"+p.split("?")[0],{method:"POST",
    headers:{"apikey":SB_KEY,"Authorization":"Bearer "+sbToken(),"Content-Type":"application/json"},body:JSON.stringify({expiresIn:3600})});
  var j=await r.json().catch(function(){return {};});
  return j.signedURL?SB_URL+"/storage/v1"+(j.signedURL.charAt(0)==="/"?"":"/")+j.signedURL:url;
}
/* links that leave the page (new tab, Open button, ctrl-click) get a signed
   link; chips that open the built-in viewer are left alone (the viewer
   fetches the file itself, through fetch below) */
document.addEventListener("click",function(ev){
  var a=ev.target&&ev.target.closest&&ev.target.closest("a[href]");
  if(!a||!sbDocPath(a.getAttribute("href")))return;
  var mod=ev.ctrlKey||ev.metaKey||ev.shiftKey||ev.button===1;
  if(!mod&&/trkViewFile/.test(a.getAttribute("onclick")||""))return;
  ev.preventDefault();ev.stopPropagation();
  var w=window.open("about:blank","_blank");
  sbSignedUrl(a.getAttribute("href")).then(function(u){if(w)w.location.href=u;else location.href=u;});
},true);
/* blob URL for an <img> preview of a private file */
async function sbFileObjectUrl(url){
  if(!sbDocPath(url))return url;
  var r=await fetch(url);
  /* one retry with a fresh sign-in before giving up */
  if(!r.ok&&(await sbRefresh()))r=await fetch(url);
  if(!r.ok)throw new Error("the file could not be loaded ("+r.status+")");
  return URL.createObjectURL(await r.blob());
}

/* a request refused for an expired / missing sign-in: refresh once, else
   ask the person to sign in again (only once the database is locked) */
var SB_NATIVE_FETCH=window.fetch.bind(window);
window.fetch=async function(input,init){
  var url=typeof input==="string"?input:(input&&input.url)||"";
  /* a private file asked for by its old public address: fetch it with the sign-in */
  var dp=sbDocPath(url);
  if(dp!==null&&url.indexOf(SB_URL)===0){
    await sbEnsureFresh();
    var h=Object.assign({},(init&&init.headers)||{},{"apikey":SB_KEY,"Authorization":"Bearer "+sbToken()});
    return SB_NATIVE_FETCH(SB_URL+"/storage/v1/object/authenticated/documents/"+dp,Object.assign({},init||{},{headers:h}));
  }
  /* database requests once sign-in is required: a phone waking up has an
     expired token, so refresh it first and send the current one. Without
     a sign-in the locked database answers with an EMPTY list (not an
     error), which made the tracker look empty — so ask to sign in instead. */
  if(SB_AUTH_REQUIRED&&url.indexOf(SB_URL+"/rest/v1/")===0&&init&&init.headers&&init.headers.Authorization){
    await sbEnsureFresh();
    if(!sbSignedIn()){
      sbShowLogin("Please sign in again.");
      return new Response("{}",{status:401,headers:{"Content-Type":"application/json"}});
    }
    init.headers.Authorization="Bearer "+sbToken();
  }
  var res=await SB_NATIVE_FETCH(input,init);
  /* sign-in still optional: a refused personal token must never block the
     site — forget it and repeat the request with the public key */
  /* (no sbSignedIn() check: requests sent together all carry the old token,
     and the first refusal has already cleared the session) */
  if((res.status===401||res.status===403)&&!SB_AUTH_REQUIRED&&url.indexOf(SB_URL)===0&&url.indexOf("/auth/v1/")===-1&&
     init&&init.headers&&init.headers.Authorization&&init.headers.Authorization!=="Bearer "+SB_KEY){
    if(sbSignedIn())sbSaveSession(null);
    init.headers.Authorization="Bearer "+SB_KEY;
    return SB_NATIVE_FETCH(input,init);
  }
  if(res.status===401&&url.indexOf(SB_URL)===0&&url.indexOf("/auth/v1/")===-1&&SB_AUTH_REQUIRED){
    if(await sbRefresh()){
      /* retry once with the new token */
      if(init&&init.headers&&init.headers.Authorization)init.headers.Authorization="Bearer "+sbToken();
      return SB_NATIVE_FETCH(input,init);
    }
    sbShowLogin("Your sign-in has expired. Please sign in again.");
  }
  return res;
};

/* start-up: run the app straight away, or after sign-in when required */
function sbGate(start){
  if(!SB_AUTH_REQUIRED){start();return;}
  if(sbSignedIn()&&SB_SESSION.expires_at-Date.now()>60*1000){start();return;}
  if(sbSignedIn()){
    sbRefresh().then(function(ok){if(ok)start();else sbShowLogin("",start);});
    return;
  }
  sbShowLogin("",start);
}
