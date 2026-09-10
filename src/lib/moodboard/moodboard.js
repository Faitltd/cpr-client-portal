export function initMoodboard(DATA){
"use strict";

const CW={white:'--c-white',gray:'--c-gray',blue:'--c-blue',black:'--c-black',wood:'--c-wood'};
const stage=document.getElementById('stage'), crumbs=document.getElementById('crumbs');
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
let nav={level:'home',color:null,style:null}; // level: home|color|style|search|favorites

function escapeHTML(s){return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

// ---------- client link + cloud sync ----------
// With ?c=<key> the picks save to Supabase (sync across the client's devices,
// visible to the CPR team). Without it, picks stay local to this browser.
const clientKey=((new URLSearchParams(location.search)).get('c')||'').trim().toLowerCase().replace(/[^a-z0-9_-]/g,'').slice(0,60);
const online=!!clientKey;
const SUPA_URL='https://dhjbpebtjtdicevnkjpd.supabase.co';
const SUPA_ANON='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRoamJwZWJ0anRkaWNldm5ranBkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAwNDE5MDYsImV4cCI6MjA4NTYxNzkwNn0.p9D-N4C8Hpqe5mdD7cHB3VHCZ746spywLP7a3ciuqVo';
function supaHeaders(extra){return Object.assign({'apikey':SUPA_ANON,'Authorization':'Bearer '+SUPA_ANON,'Content-Type':'application/json'},extra||{});}
function supaWrite(id){const body=JSON.stringify({client_key:clientKey,board_id:id,favorite:isFav(id),note:getNote(id)});
  fetch(SUPA_URL+'/rest/v1/moodboard_selections',{method:'POST',headers:supaHeaders({'Prefer':'resolution=merge-duplicates'}),body}).catch(()=>{});}
function supaDelete(id){fetch(SUPA_URL+'/rest/v1/moodboard_selections?client_key=eq.'+encodeURIComponent(clientKey)+'&board_id=eq.'+encodeURIComponent(id),{method:'DELETE',headers:supaHeaders()}).catch(()=>{});}
function persist(id){if(!online)return;if(isFav(id)||getNote(id))supaWrite(id);else supaDelete(id);}
async function supaLoad(){try{
  const r=await fetch(SUPA_URL+'/rest/v1/moodboard_selections?client_key=eq.'+encodeURIComponent(clientKey)+'&select=board_id,favorite,note',{headers:supaHeaders()});
  if(!r.ok)return false;const rows=await r.json();
  favs=new Set();notes={};
  rows.forEach(x=>{if(x.favorite)favs.add(x.board_id);if(x.note)notes[x.board_id]=x.note;});
  saveFavs();saveNotes();return true;
}catch(e){return false;}}

// ---------- favorites (localStorage cache; cloud when ?c=) ----------
const FAV_KEY=online?('cpr_mb_favs_'+clientKey):'cpr_moodboard_favs';
function loadFavs(){try{return new Set(JSON.parse(localStorage.getItem(FAV_KEY)||'[]'));}catch(e){return new Set();}}
let favs=loadFavs();
function saveFavs(){try{localStorage.setItem(FAV_KEY,JSON.stringify([...favs]));}catch(e){}}
function isFav(id){return favs.has(id);}
function toggleFav(id){if(favs.has(id))favs.delete(id);else favs.add(id);saveFavs();persist(id);updateFavBadge();}
function updateFavBadge(){const b=document.getElementById('favCount');if(b){b.textContent=favs.size;b.hidden=favs.size===0;}
  const btn=document.getElementById('favBtn');if(btn)btn.classList.toggle('on',nav.level==='favorites');}
function heartSVG(f){return `<svg viewBox="0 0 24 24" width="17" height="17" fill="${f?'currentColor':'none'}" stroke="currentColor" stroke-width="2"><path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/></svg>`;}

// ---------- notes (localStorage cache; cloud when ?c=) ----------
const NOTE_KEY=online?('cpr_mb_notes_'+clientKey):'cpr_moodboard_notes';
function loadNotes(){try{return JSON.parse(localStorage.getItem(NOTE_KEY)||'{}');}catch(e){return {};}}
let notes=loadNotes();
function saveNotes(){try{localStorage.setItem(NOTE_KEY,JSON.stringify(notes));}catch(e){}}
function getNote(id){return notes[id]||'';}
function hasNote(id){return !!notes[id];}
function setNote(id,txt){txt=txt.trim();if(txt)notes[id]=txt;else delete notes[id];saveNotes();}

// index: board id -> {c, st, i}
const pageIndex={};
DATA.colors.forEach(c=>c.styles.forEach(st=>st.boards.forEach((b,i)=>{pageIndex[b.id]={c,st,i};})));

// ---------- helpers ----------
function el(html){const d=document.createElement('div');d.innerHTML=html.trim();return d.firstElementChild;}
function firstImgs(boards,n){return boards.slice(0,n).map(b=>b.img);}
// resized thumbnail via Supabase image transformation (full-res stays for the lightbox)
function thumb(url,w){return url.indexOf('/object/public/')<0?url:url.replace('/object/public/','/render/image/public/')+'?width='+w+'&quality=72&resize=contain';}
function imgTag(url,w,alt,cls){const t=thumb(url,w);return `<img${cls?` class="${cls}"`:''} src="${t}" onerror="this.onerror=null;this.src='${url}'" alt="${alt||''}" loading="lazy" decoding="async">`;}

function boardCard(st,i,cid,opts){
  opts=opts||{};
  const b=st.boards[i];
  const fav=isFav(b.id), note=hasNote(b.id);
  const card=el(`<div class="bcard">
      <button class="bthumb" aria-label="Enlarge board ${b.src}${b.tag}">${imgTag(b.img,400,st.name+' board '+b.src+b.tag)}<span class="bnum">${b.src}${b.tag}</span>${note?'<span class="notedot" title="Has a note">&#9998;</span>':''}</button>
      <button class="fav ${fav?'on':''}" aria-label="Save to favorites" aria-pressed="${fav}">${heartSVG(fav)}</button>
    </div>`);
  card.querySelector('.bthumb').addEventListener('click',()=>openLightbox(st,i,cid));
  const fb=card.querySelector('.fav');
  fb.addEventListener('click',e=>{e.stopPropagation();toggleFav(b.id);
    const on=isFav(b.id);fb.classList.toggle('on',on);fb.setAttribute('aria-pressed',on);fb.innerHTML=heartSVG(on);
    if(nav.level==='favorites'&&!on){const scr=stage.querySelector('.screen');scr.replaceWith(renderFavorites());}
  });
  if(opts.note&&note){card.appendChild(el(`<div class="bnote">${escapeHTML(getNote(b.id))}</div>`));}
  return card;
}

// ---------- renderers ----------
function renderHome(){
  const s=el('<div class="screen"><div class="wrap"></div></div>');
  const w=s.querySelector('.wrap');
  w.appendChild(el(`<div class="screen-head"><div class="htxt">
      <div class="eyebrow">Mood Board Catalog</div>
      <h1>Kitchen Mood Boards</h1>
      <div class="meta">${DATA.total} boards &middot; 5 cabinet colors &middot; tap a color to zoom in</div></div></div>`));
  const grid=el('<div class="colorgrid"></div>');
  DATA.colors.forEach(c=>{
    const peek=[];c.styles.forEach(st=>st.boards.forEach(b=>peek.push(b.img)));
    const card=el(`<button class="ccard" style="--cc:var(${CW[c.id]})">
        <div class="band"><div class="peekrow">${peek.slice(0,4).map(i=>imgTag(i,240,'')).join('')}</div><span class="swbig"></span></div>
        <div class="body"><div class="cnm">${c.name}</div>
          <div class="cmeta">${c.count} boards &middot; ${c.styles.length} style${c.styles.length>1?'s':''}</div></div>
        <span class="go"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg></span>
      </button>`);
    card.addEventListener('click',()=>go({level:'color',color:c.id,style:null},card));
    grid.appendChild(card);
  });
  w.appendChild(grid);
  return s;
}

function colorObj(id){return DATA.colors.find(c=>c.id===id);}
function renderColor(id){
  const c=colorObj(id);
  const s=el('<div class="screen"><div class="wrap"></div></div>');
  const w=s.querySelector('.wrap');
  const head=el(`<div class="screen-head">
      <button class="backbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> All colors</button>
      <div class="htxt"><div class="eyebrow">Cabinet color</div>
      <h1>${c.name}</h1>
      <div class="meta">${c.count} boards &middot; ${c.styles.length} style${c.styles.length>1?'s':''}</div></div></div>`);
  head.querySelector('.backbtn').addEventListener('click',()=>go({level:'home'},null,true));
  w.appendChild(head);
  const grid=el('<div class="stylegrid"></div>');
  c.styles.forEach(st=>{
    const n=st.boards.length===1?1:st.boards.length===2?2:4;
    const cls=st.boards.length===1?'one':st.boards.length===2?'two':'';
    const imgs=firstImgs(st.boards,n);
    const card=el(`<button class="scard" style="--cc:var(${CW[c.id]})">
        <div class="sgrid ${cls}">${imgs.map(i=>imgTag(i,240,'')).join('')}</div>
        <div class="sb"><span class="stripe"></span><span class="snm">${st.name}</span>
          <span class="scount">${st.boards.length}</span></div>
      </button>`);
    card.addEventListener('click',()=>go({level:'style',color:c.id,style:st.name},card));
    grid.appendChild(card);
  });
  w.appendChild(grid);
  return s;
}

function styleObj(cid,name){return colorObj(cid).styles.find(s=>s.name===name);}
function renderStyle(cid,name){
  const c=colorObj(cid),st=styleObj(cid,name);
  const s=el('<div class="screen"><div class="wrap"></div></div>');
  const w=s.querySelector('.wrap');
  const head=el(`<div class="screen-head">
      <button class="backbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> ${c.name}</button>
      <div class="htxt"><div class="eyebrow">${c.name} cabinets</div>
      <h1>${st.name}</h1>
      <div class="meta">${st.boards.length} board${st.boards.length>1?'s':''} &middot; tap any board to enlarge</div></div></div>`);
  head.querySelector('.backbtn').addEventListener('click',()=>go({level:'color',color:cid,style:null},null,true));
  w.appendChild(head);
  const grid=el('<div class="boardgrid"></div>');
  st.boards.forEach((b,i)=>grid.appendChild(boardCard(st,i,c.id)));
  w.appendChild(grid);
  return s;
}

function renderSearch(term){
  const s=el('<div class="screen"><div class="wrap"></div></div>');
  const w=s.querySelector('.wrap');
  const matches=[];
  DATA.colors.forEach(c=>c.styles.forEach(st=>{
    if(st.name.toLowerCase().includes(term)||c.name.toLowerCase().includes(term))matches.push({c,st});
  }));
  w.appendChild(el(`<div class="screen-head"><div class="htxt">
      <div class="eyebrow">Search</div><h1>&ldquo;${escapeHTML(term)}&rdquo;</h1>
      <div class="meta">${matches.length} style${matches.length===1?'':'s'} found</div></div></div>`));
  if(!matches.length){w.appendChild(el('<div class="empty">No styles match that search.</div>'));return s;}
  const grid=el('<div class="stylegrid"></div>');
  matches.forEach(({c,st})=>{
    const n=st.boards.length===1?1:st.boards.length===2?2:4;
    const cls=st.boards.length===1?'one':st.boards.length===2?'two':'';
    const imgs=firstImgs(st.boards,n);
    const card=el(`<button class="scard" style="--cc:var(${CW[c.id]})">
        <div class="sgrid ${cls}">${imgs.map(i=>imgTag(i,240,'')).join('')}</div>
        <div class="sb"><span class="stripe"></span><span class="snm">${st.name}</span>
          <span class="scount">${st.boards.length}</span></div>
      </button>`);
    card.addEventListener('click',()=>go({level:'style',color:c.id,style:st.name},card));
    grid.appendChild(card);
  });
  w.appendChild(grid);
  return s;
}

function renderFavorites(){
  const s=el('<div class="screen"><div class="wrap"></div></div>');
  const w=s.querySelector('.wrap');
  const items=[...favs].map(id=>pageIndex[id]).filter(Boolean);
  const head=el(`<div class="screen-head">
      <button class="backbtn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 18l-6-6 6-6"/></svg> All colors</button>
      <div class="htxt"><div class="eyebrow" style="color:var(--accent)">Saved</div>
      <h1>Favorites</h1>
      <div class="meta">${items.length} board${items.length===1?'':'s'} saved</div></div></div>`);
  head.querySelector('.backbtn').addEventListener('click',()=>go({level:'home'},null,true));
  w.appendChild(head);
  if(!items.length){w.appendChild(el('<div class="empty">No favorites yet. Tap the heart on any board — or add a note — to save it here.</div>'));return s;}
  const grid=el('<div class="boardgrid"></div>');
  items.forEach(({st,i,c})=>grid.appendChild(boardCard(st,i,c.id,{note:true})));
  w.appendChild(grid);
  return s;
}

// ---------- breadcrumbs ----------
function renderCrumbs(){
  crumbs.innerHTML='';
  const add=(label,fn,here,dotVar)=>{
    const b=el(`<button class="cb ${here?'here':''}">${dotVar?`<span class="dot" style="background:var(${dotVar})"></span>`:''}${escapeHTML(label)}</button>`);
    if(fn&&!here)b.addEventListener('click',fn);crumbs.appendChild(b);
  };
  const sep=()=>crumbs.appendChild(el('<span class="sep">/</span>'));
  add('All colors',()=>go({level:'home'},null,true),nav.level==='home');
  if(nav.level==='favorites'){sep();add('Favorites',null,true);}
  if(nav.level==='color'||nav.level==='style'){
    sep();const c=colorObj(nav.color);
    add(c.name,()=>go({level:'color',color:nav.color,style:null},null,true),nav.level==='color',CW[c.id]);
  }
  if(nav.level==='style'){sep();add(nav.style,null,true);}
}

// ---------- navigation with zoom transition ----------
let animating=false;
function buildScreen(state){
  if(state.level==='home')return renderHome();
  if(state.level==='color')return renderColor(state.color);
  if(state.level==='style')return renderStyle(state.color,state.style);
  if(state.level==='search')return renderSearch(state.term);
  if(state.level==='favorites')return renderFavorites();
}
function go(state,originEl,out){
  if(animating)return;
  const cur=stage.querySelector('.screen');
  const next=buildScreen(state);
  stage.appendChild(next);
  nav=state;renderCrumbs();updateFavBadge();
  if(reduce||!cur){if(cur)cur.remove();return;}
  animating=true;
  const sr=stage.getBoundingClientRect();
  let ox=sr.width/2,oy=sr.height*0.32;
  if(originEl){const r=originEl.getBoundingClientRect();ox=r.left-sr.left+r.width/2;oy=r.top-sr.top+r.height/2;}
  next.style.transformOrigin=`${ox}px ${oy}px`;
  cur.style.transformOrigin=`${ox}px ${oy}px`;
  const dur=340,ease='cubic-bezier(.4,0,.2,1)';
  if(!out){
    cur.animate([{transform:'scale(1)',opacity:1},{transform:'scale(1.35)',opacity:0}],{duration:dur,easing:ease}).onfinish=()=>cur.remove();
    next.animate([{transform:'scale(.55)',opacity:0},{transform:'scale(1)',opacity:1}],{duration:dur,easing:ease}).onfinish=()=>{animating=false;};
  }else{
    cur.style.zIndex=2;
    cur.animate([{transform:'scale(1)',opacity:1},{transform:'scale(.55)',opacity:0}],{duration:dur,easing:ease}).onfinish=()=>cur.remove();
    next.animate([{transform:'scale(1.25)',opacity:0},{transform:'scale(1)',opacity:1}],{duration:dur,easing:ease}).onfinish=()=>{animating=false;};
  }
}

// ---------- toolbar: favorites ----------
document.getElementById('favBtn').addEventListener('click',()=>{
  if(nav.level==='favorites')return;
  go({level:'favorites'},null,nav.level!=='home');
});

// ---------- search ----------
const q=document.getElementById('q');
let searchTimer=null;
q.addEventListener('input',()=>{
  clearTimeout(searchTimer);
  searchTimer=setTimeout(()=>{
    const v=q.value.trim().toLowerCase();
    if(!v){if(nav.level==='search')go({level:'home'},null,true);return;}
    go({level:'search',term:v},null,nav.level==='style');
  },220);
});

// ---------- lightbox ----------
const lb=document.getElementById('lb'),lbImg=document.getElementById('lbImg'),
  lbTitle=document.getElementById('lbTitle'),lbPage=document.getElementById('lbPage'),
  lbCount=document.getElementById('lbCount'),lbSw=document.getElementById('lbSw'),lbWrap=document.getElementById('lbImgWrap'),
  lbFav=document.getElementById('lbFav'),lbDownload=document.getElementById('lbDownload'),lbNote=document.getElementById('lbNote');
let curStyle=null,curIdx=0,curColor=null;
function curBoard(){return curStyle.boards[curIdx];}
function openLightbox(st,i,cid){curStyle=st;curIdx=i;curColor=cid;renderLb();lb.classList.add('on');document.getElementById('lbClose').focus();}
function slug(t){return t.replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'');}
function renderLbFav(){const on=isFav(curBoard().id);
  lbFav.classList.toggle('on',on);lbFav.setAttribute('aria-pressed',on);lbFav.innerHTML=heartSVG(on);}
function renderLb(){const b=curBoard();
  lbWrap.classList.remove('zoom');
  lbImg.src=b.img;lbTitle.textContent=curStyle.name;lbPage.textContent=b.src+b.tag;
  lbSw.style.background='var('+CW[curColor]+')';lbCount.textContent=(curIdx+1)+' / '+curStyle.boards.length;
  const fname=slug(curStyle.name)+'-'+b.src+b.tag+'.jpg';
  lbDownload.href=b.img+(b.img.includes('?')?'&':'?')+'download='+encodeURIComponent(fname);
  lbDownload.setAttribute('download',fname);
  document.getElementById('lbPrev').disabled=curIdx===0;
  document.getElementById('lbNext').disabled=curIdx===curStyle.boards.length-1;
  lbWrap.scrollTop=0;renderLbFav();
  if(lbNote)lbNote.value=getNote(b.id);}
function closeLb(){lb.classList.remove('on');lbWrap.classList.remove('zoom');
  if(nav.level==='favorites'){const scr=stage.querySelector('.screen');if(scr)scr.replaceWith(renderFavorites());}}
document.getElementById('lbClose').onclick=closeLb;
document.getElementById('lbPrev').onclick=()=>{if(curIdx>0){curIdx--;renderLb();}};
document.getElementById('lbNext').onclick=()=>{if(curIdx<curStyle.boards.length-1){curIdx++;renderLb();}};
lbFav.onclick=()=>{toggleFav(curBoard().id);renderLbFav();};
let noteTimer=null;
if(lbNote)lbNote.addEventListener('input',()=>{const id=curBoard().id;setNote(id,lbNote.value);
  if(lbNote.value.trim()&&!isFav(id)){favs.add(id);saveFavs();updateFavBadge();renderLbFav();}
  if(online){clearTimeout(noteTimer);noteTimer=setTimeout(()=>persist(id),600);}});
lbImg.addEventListener('click',()=>lbWrap.classList.toggle('zoom'));
lb.addEventListener('click',e=>{if(e.target===lb)closeLb();});
document.addEventListener('keydown',e=>{
  if(lb.classList.contains('on')){
    if(document.activeElement===lbNote)return;
    if(e.key==='Escape')closeLb();
    else if(e.key==='ArrowLeft')document.getElementById('lbPrev').click();
    else if(e.key==='ArrowRight')document.getElementById('lbNext').click();
    else if(e.key==='f'||e.key==='F')lbFav.click();
    return;
  }
  if(e.key==='Escape'&&nav.level!=='home'){
    if(nav.level==='style')go({level:'color',color:nav.color},null,true);
    else go({level:'home'},null,true);
  }
});

// ---------- go back one level ----------
function goBack(){
  if(lb.classList.contains('on')){closeLb();return;}
  if(nav.level==='style')go({level:'color',color:nav.color},null,true);
  else if(nav.level!=='home')go({level:'home'},null,true);
}

// ---------- touch gestures ----------
// On a screen: swipe left to go back a level.
// In the enlarged view: swipe left/right = next/prev board, swipe down = close.
let _tx=0,_ty=0,_tmulti=false;
stage.addEventListener('touchstart',e=>{_tmulti=e.touches.length>1;if(_tmulti)return;const t=e.touches[0];_tx=t.clientX;_ty=t.clientY;},{passive:true});
stage.addEventListener('touchend',e=>{
  if(_tmulti||lb.classList.contains('on'))return;
  const t=e.changedTouches[0],dx=t.clientX-_tx,dy=t.clientY-_ty;
  if(dx<-60&&Math.abs(dx)>Math.abs(dy)*1.6)goBack();
},{passive:true});

let _lx=0,_ly=0,_lmulti=false,_lnote=false;
lb.addEventListener('touchstart',e=>{_lmulti=e.touches.length>1;if(_lmulti)return;
  const t=e.touches[0];_lx=t.clientX;_ly=t.clientY;
  _lnote=!!(e.target&&e.target.closest&&e.target.closest('.lb-notes'));},{passive:true});
lb.addEventListener('touchend',e=>{
  if(_lmulti||_lnote||!lb.classList.contains('on')||lbWrap.classList.contains('zoom'))return;
  const t=e.changedTouches[0],dx=t.clientX-_lx,dy=t.clientY-_ly;
  if(Math.abs(dx)>Math.abs(dy)){
    if(dx<-45)document.getElementById('lbNext').click();
    else if(dx>45)document.getElementById('lbPrev').click();
  }else if(dy>90)closeLb();
},{passive:true});

// ---------- theme ----------
const rootEl=document.documentElement,themeBtn=document.getElementById('theme');
function iconFor(dark){document.getElementById('themeIcon').outerHTML=dark
  ?'<svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  :'<svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>';}
// Default to the light paper theme (readable dark text) regardless of the
// viewer's OS setting; the toggle still switches to dark on demand.
let dark=false;
rootEl.setAttribute('data-theme','light');
themeBtn.onclick=()=>{dark=!dark;rootEl.setAttribute('data-theme',dark?'dark':'light');iconFor(dark);};
iconFor(dark);

// ---------- client chip ----------
function addClientChip(){
  const favB=document.getElementById('favBtn');if(!favB||!favB.parentNode)return;
  const chip=el(`<span class="clientchip" title="Your favorites and notes are saved and shared with the CPR team">
      <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6 9 17l-5-5"/></svg>
      Saving for ${escapeHTML(clientKey)}</span>`);
  favB.parentNode.insertBefore(chip,favB);
}

// ---------- boot ----------
stage.appendChild(renderHome());renderCrumbs();updateFavBadge();
if(online){
  addClientChip();
  supaLoad().then(ok=>{updateFavBadge();
    if(ok&&(nav.level==='favorites'||nav.level==='style')){const scr=stage.querySelector('.screen');if(scr)scr.replaceWith(buildScreen(nav));}});
}
}
