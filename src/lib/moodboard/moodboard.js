export function initMoodboard(DATA){
"use strict";

const CW={white:'--c-white',gray:'--c-gray',blue:'--c-blue',black:'--c-black',wood:'--c-wood'};
const stage=document.getElementById('stage'), crumbs=document.getElementById('crumbs');
const reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
let nav={level:'home',color:null,style:null}; // level: home|color|style
let searchResults=null;

// ---------- renderers ----------
function el(html){const d=document.createElement('div');d.innerHTML=html.trim();return d.firstElementChild;}
function firstImgs(boards,n){return boards.slice(0,n).map(b=>b.img);}

function renderHome(){
  const s=el('<div class="screen"><div class="wrap"></div></div>');
  const w=s.querySelector('.wrap');
  w.appendChild(el(`<div class="screen-head"><div class="htxt">
      <div class="eyebrow">Mood Board Catalog</div>
      <h1>Kitchen Mood Boards</h1>
      <div class="meta">${DATA.total} boards &middot; 5 cabinet colors &middot; click a color to zoom in</div></div></div>`));
  const grid=el('<div class="colorgrid"></div>');
  DATA.colors.forEach(c=>{
    const peek=[];c.styles.forEach(st=>st.boards.forEach(b=>peek.push(b.img)));
    const card=el(`<button class="ccard" style="--cc:var(${CW[c.id]})">
        <div class="band"><div class="peekrow">${peek.slice(0,4).map(i=>`<img src="${i}" alt="">`).join('')}</div><span class="swbig"></span></div>
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
      <div class="htxt"><div class="eyebrow" style="color:var(${CW[c.id]})">Cabinet color</div>
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
        <div class="sgrid ${cls}">${imgs.map(i=>`<img src="${i}" alt="">`).join('')}</div>
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
      <div class="htxt"><div class="eyebrow" style="color:var(${CW[c.id]})">${c.name} cabinets</div>
      <h1>${st.name}</h1>
      <div class="meta">${st.boards.length} board${st.boards.length>1?'s':''} &middot; click any board to enlarge</div></div></div>`);
  head.querySelector('.backbtn').addEventListener('click',()=>go({level:'color',color:cid,style:null},null,true));
  w.appendChild(head);
  const grid=el('<div class="boardgrid"></div>');
  st.boards.forEach((b,i)=>{
    const card=el(`<button class="bcard"><img src="${b.img}" alt="${st.name} board ${i+1}"><span class="bnum">${i+1}</span></button>`);
    card.addEventListener('click',()=>openLightbox(st,i,c.id));
    grid.appendChild(card);
  });
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
      <div class="eyebrow">Search</div><h1>&ldquo;${term}&rdquo;</h1>
      <div class="meta">${matches.length} style${matches.length===1?'':'s'} found</div></div></div>`));
  if(!matches.length){w.appendChild(el('<div class="empty">No styles match that search.</div>'));return s;}
  const grid=el('<div class="stylegrid"></div>');
  matches.forEach(({c,st})=>{
    const n=st.boards.length===1?1:st.boards.length===2?2:4;
    const cls=st.boards.length===1?'one':st.boards.length===2?'two':'';
    const imgs=firstImgs(st.boards,n);
    const card=el(`<button class="scard" style="--cc:var(${CW[c.id]})">
        <div class="sgrid ${cls}">${imgs.map(i=>`<img src="${i}" alt="">`).join('')}</div>
        <div class="sb"><span class="stripe"></span><span class="snm">${st.name}</span>
          <span class="scount">${st.boards.length}</span></div>
      </button>`);
    card.addEventListener('click',()=>go({level:'style',color:c.id,style:st.name},card));
    grid.appendChild(card);
  });
  w.appendChild(grid);
  return s;
}

// ---------- breadcrumbs ----------
function renderCrumbs(){
  crumbs.innerHTML='';
  const add=(label,fn,here,dotVar)=>{
    const b=el(`<button class="cb ${here?'here':''}">${dotVar?`<span class="dot" style="background:var(${dotVar})"></span>`:''}${label}</button>`);
    if(fn&&!here)b.addEventListener('click',fn);crumbs.appendChild(b);
  };
  const sep=()=>crumbs.appendChild(el('<span class="sep">/</span>'));
  add('All colors',()=>go({level:'home'},null,true),nav.level==='home');
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
}
function go(state,originEl,out){
  if(animating)return;
  const cur=stage.querySelector('.screen');
  const next=buildScreen(state);
  stage.appendChild(next);
  nav=state;renderCrumbs();
  if(reduce||!cur){if(cur)cur.remove();return;}
  animating=true;
  // origin point for zoom (center of clicked card, relative to stage)
  const sr=stage.getBoundingClientRect();
  let ox=sr.width/2,oy=sr.height*0.32;
  if(originEl){const r=originEl.getBoundingClientRect();ox=r.left-sr.left+r.width/2;oy=r.top-sr.top+r.height/2;}
  next.style.transformOrigin=`${ox}px ${oy}px`;
  cur.style.transformOrigin=`${ox}px ${oy}px`;
  const dur=340,ease='cubic-bezier(.4,0,.2,1)';
  if(!out){ // zoom IN: old grows & fades, new comes from small
    cur.animate([{transform:'scale(1)',opacity:1},{transform:'scale(1.35)',opacity:0}],{duration:dur,easing:ease}).onfinish=()=>cur.remove();
    next.animate([{transform:'scale(.55)',opacity:0},{transform:'scale(1)',opacity:1}],{duration:dur,easing:ease}).onfinish=()=>{animating=false;};
  }else{ // zoom OUT: old shrinks to point, new fades from slightly big
    cur.style.zIndex=2;
    cur.animate([{transform:'scale(1)',opacity:1},{transform:'scale(.55)',opacity:0}],{duration:dur,easing:ease}).onfinish=()=>cur.remove();
    next.animate([{transform:'scale(1.25)',opacity:0},{transform:'scale(1)',opacity:1}],{duration:dur,easing:ease}).onfinish=()=>{animating=false;};
  }
}

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
  lbCount=document.getElementById('lbCount'),lbSw=document.getElementById('lbSw'),lbWrap=document.getElementById('lbImgWrap');
let curStyle=null,curIdx=0,curColor=null;
function openLightbox(st,i,cid){curStyle=st;curIdx=i;curColor=cid;renderLb();lb.classList.add('on');document.getElementById('lbClose').focus();}
function renderLb(){const b=curStyle.boards[curIdx];
  lbImg.src=b.img;lbTitle.textContent=curStyle.name;lbPage.textContent='p.'+b.page;
  lbSw.style.background='var('+CW[curColor]+')';lbCount.textContent=(curIdx+1)+' / '+curStyle.boards.length;
  document.getElementById('lbPrev').disabled=curIdx===0;
  document.getElementById('lbNext').disabled=curIdx===curStyle.boards.length-1;lbWrap.scrollTop=0;}
function closeLb(){lb.classList.remove('on');}
document.getElementById('lbClose').onclick=closeLb;
document.getElementById('lbPrev').onclick=()=>{if(curIdx>0){curIdx--;renderLb();}};
document.getElementById('lbNext').onclick=()=>{if(curIdx<curStyle.boards.length-1){curIdx++;renderLb();}};
lb.addEventListener('click',e=>{if(e.target===lb)closeLb();});
document.addEventListener('keydown',e=>{
  if(lb.classList.contains('on')){
    if(e.key==='Escape')closeLb();
    else if(e.key==='ArrowLeft')document.getElementById('lbPrev').click();
    else if(e.key==='ArrowRight')document.getElementById('lbNext').click();
    return;
  }
  if(e.key==='Escape'&&nav.level!=='home'){
    if(nav.level==='style')go({level:'color',color:nav.color},null,true);
    else go({level:'home'},null,true);
  }
});

// ---------- theme ----------
const rootEl=document.documentElement,themeBtn=document.getElementById('theme');
function iconFor(dark){document.getElementById('themeIcon').outerHTML=dark
  ?'<svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>'
  :'<svg id="themeIcon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>';}
let dark=matchMedia('(prefers-color-scheme:dark)').matches;
themeBtn.onclick=()=>{dark=!dark;rootEl.setAttribute('data-theme',dark?'dark':'light');iconFor(dark);};
iconFor(dark);

// ---------- boot ----------
stage.appendChild(renderHome());renderCrumbs();
}
