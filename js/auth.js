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
var SB_AUTH_REQUIRED=false;
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
var SB_SESSION=(function(){try{var s=JSON.parse(localStorage.getItem(SB_SESSION_KEY)||"null");return sbValidSession(s)?s:null;}catch(e){return null;}})();

function sbSaveSession(s){
  SB_SESSION=s;
  try{if(s)localStorage.setItem(SB_SESSION_KEY,JSON.stringify(s));else localStorage.removeItem(SB_SESSION_KEY);}catch(e){}
  sbRenderAuthNav();
}
/* the token requests send: the person's session, else the anon key */
function sbToken(){return SB_SESSION&&SB_SESSION.access_token?SB_SESSION.access_token:SB_KEY;}
function sbSignedIn(){return !!(SB_SESSION&&SB_SESSION.access_token);}

function sbSessionFrom(j,email){
  return {access_token:j.access_token,refresh_token:j.refresh_token,
    expires_at:Date.now()+((j.expires_in||3600)*1000),
    email:(j.user&&j.user.email)||email||""};
}
async function sbSignIn(email,password){
  var r=await fetch(SB_URL+"/auth/v1/token?grant_type=password",{method:"POST",
    headers:{"apikey":SB_KEY,"Content-Type":"application/json"},body:JSON.stringify({email:email,password:password})});
  var j=await r.json().catch(function(){return {};});
  if(!r.ok||!j.access_token)throw new Error(j.error_description||j.msg||j.error||"Sign-in failed");
  var s=sbSessionFrom(j,email);
  if(!sbValidSession(s))throw new Error("Sign-in answer not from this database");
  sbSaveSession(s);
}
var SB_REFRESHING=null;
async function sbRefresh(){
  if(!SB_SESSION||!SB_SESSION.refresh_token)return false;
  if(SB_REFRESHING)return SB_REFRESHING;
  SB_REFRESHING=(async function(){
    try{
      var r=await fetch(SB_URL+"/auth/v1/token?grant_type=refresh_token",{method:"POST",
        headers:{"apikey":SB_KEY,"Content-Type":"application/json"},body:JSON.stringify({refresh_token:SB_SESSION.refresh_token})});
      var j=await r.json().catch(function(){return {};});
      if(!r.ok||!j.access_token){sbSaveSession(null);return false;}
      sbSaveSession(sbSessionFrom(j,SB_SESSION.email));
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
      "<div class='sb-login-err' id='sb-err'></div>"+
      "<button type='submit' class='btn-save' id='sb-go'>Sign in</button>"+
      (SB_AUTH_REQUIRED?"":"<button type='button' class='edit-btn' onclick='sbHideLogin()'>Cancel</button>")+
    "</form>"+
    "<div class='sb-login-foot'>Accounts are added by the admin in Supabase. Forgot your password? Ask them to reset it.</div>"+
  "</div>";
}
var SB_AFTER_LOGIN=null;
function sbShowLogin(msg,after){
  if(after)SB_AFTER_LOGIN=after;
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
    await sbSignIn(document.getElementById("sb-email").value.trim(),document.getElementById("sb-pass").value);
    sbHideLogin();
    var f=SB_AFTER_LOGIN;SB_AFTER_LOGIN=null;
    if(f)f();
    else if(typeof renderContent==="function"){if(typeof TRK_LOADED!=="undefined")TRK_LOADED=false;if(typeof loadFromDB==="function")loadFromDB();}
  }catch(e){
    err.textContent=/invalid/i.test(e.message)?"Wrong email or password.":e.message;
    btn.disabled=false;btn.textContent="Sign in";
  }
  return false;
}

/* sidebar: who is signed in, with sign in / sign out */
function sbRenderAuthNav(){
  var foot=document.querySelector(".sidebar-foot");
  if(!foot)return;
  var el=document.getElementById("sb-auth-nav");
  if(!el){el=document.createElement("button");el.id="sb-auth-nav";el.className="nav-item";foot.insertBefore(el,foot.firstChild);}
  var ico="<span class='nav-icon'><svg viewBox='0 0 24 24' width='16' height='16' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='8' r='4'/><path d='M4 21c0-4 4-6 8-6s8 2 8 6'/></svg></span>";
  if(sbSignedIn()){
    el.title="Signed in as "+SB_SESSION.email+" — click to sign out";
    el.onclick=function(){if(confirm("Sign out of "+SB_SESSION.email+"?"))sbSignOut();};
    el.innerHTML=ico+"<span class='nav-label sidebar-foot-label sb-who'>"+String(SB_SESSION.email).replace(/</g,"&lt;")+"</span>";
  }else{
    el.title="Sign in";
    el.onclick=function(){sbShowLogin();};
    el.innerHTML=ico+"<span class='nav-label sidebar-foot-label'>Sign in</span>";
  }
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",sbRenderAuthNav);else sbRenderAuthNav();

/* a request refused for an expired / missing sign-in: refresh once, else
   ask the person to sign in again (only once the database is locked) */
var SB_NATIVE_FETCH=window.fetch.bind(window);
window.fetch=async function(input,init){
  var url=typeof input==="string"?input:(input&&input.url)||"";
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
