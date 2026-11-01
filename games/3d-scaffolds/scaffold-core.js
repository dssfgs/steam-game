/* Shared 3D scaffold core — Explore + Guided + Exam modes */
const $=s=>document.querySelector(s);
const V={
  sub:(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]],
  add:(a,b)=>[a[0]+b[0],a[1]+b[1],a[2]+b[2]],
  mul:(a,k)=>[a[0]*k,a[1]*k,a[2]*k],
  dot:(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],
  cross:(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],
  len:a=>Math.hypot(a[0],a[1],a[2]),
  mid:(a,b)=>[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2]
};
V.unit=a=>{const l=V.len(a);return l?V.mul(a,1/l):[0,0,0];};
const POOL='KMNRSTUWXYZLJOIV';
const fmt=x=>(Math.round(x*100)/100).toString();
const f2=x=>x.toFixed(2);

function project(p,yaw,pitch,cen,scale,W,H){
  const q=V.sub(p,cen);
  const cy=Math.cos(yaw),sy=Math.sin(yaw),cp=Math.cos(pitch),sp=Math.sin(pitch);
  const x1=q[0]*cy-q[1]*sy;
  const y1=q[0]*sy+q[1]*cy;
  const y2=y1*cp-q[2]*sp;
  const z2=y1*sp+q[2]*cp;
  return [W/2+x1*scale, H/2-z2*scale, y2];
}

function ptsCentroid(ptsMap){
  const keys=Object.keys(ptsMap); if(!keys.length) return [0,0,0];
  let s=[0,0,0]; for(const k of keys){s=V.add(s,ptsMap[k]);}
  return V.mul(s,1/keys.length);
}
function autoScale(ptsMap, yaw, pitch, cen, W, H, fill){
  fill = fill==null ? 0.72 : fill;
  let maxR = 1e-6;
  for (const k in ptsMap){
    const s = project(ptsMap[k], yaw, pitch, cen, 1, W, H);
    const dx = s[0]-W/2, dy = s[1]-H/2;
    maxR = Math.max(maxR, Math.hypot(dx,dy));
  }
  return (Math.min(W,H)*0.5*fill) / maxR;
}

function toast(t,kind){
  const el=$('#toast'); if(!el) return;
  el.textContent=t;el.className='toast show '+(kind||'');
  clearTimeout(toast.h);toast.h=setTimeout(()=>el.className='toast',2600);
}

function makeDrag(stage,svg,getAngles,setAngles,redraw){
  let down=null;
  const onDown=e=>{
    const p=e.touches?e.touches[0]:e;
    down={x:p.clientX,y:p.clientY,yaw:getAngles().yaw,pitch:getAngles().pitch};
    svg.classList.add('drag');
  };
  const onMove=e=>{
    if(!down)return;
    const p=e.touches?e.touches[0]:e;
    setAngles(down.yaw+(p.clientX-down.x)*0.008, Math.max(-1.2,Math.min(1.2,down.pitch+(p.clientY-down.y)*0.008)));
    redraw();
    e.preventDefault();
  };
  const onUp=()=>{down=null;svg.classList.remove('drag');};
  stage.addEventListener('mousedown',onDown);
  window.addEventListener('mousemove',onMove);
  window.addEventListener('mouseup',onUp);
  stage.addEventListener('touchstart',onDown,{passive:true});
  window.addEventListener('touchmove',onMove,{passive:false});
  window.addEventListener('touchend',onUp);
}

const TOOLS={
  foot:{n:3,sym:'⊥',name:'Foot on a line',sub:'point → line',how:'Tap the point, then 2 points on the line.'},
  footp:{n:4,sym:'⊥',name:'Foot on a plane',sub:'point → plane',how:'Tap the point, then 3 points in the plane.'},
  mid:{n:2,sym:'M',name:'Midpoint',sub:'of a segment',how:'Tap the 2 endpoints.'},
  centroid:{n:3,sym:'G',name:'Centroid of △',sub:'average of 3 pts',how:'Tap the 3 vertices of the triangle.'},
  meet:{n:4,sym:'×',name:'Extend 2 lines',sub:'find where they meet',how:'Tap 2 points on each line.'},
  par:{n:3,sym:'∥',name:'Parallel',sub:'through a point',how:'Tap the point, then 2 points on the line to copy.'},
  join:{n:2,sym:'—',name:'Join / Draw',sub:'segment between pts',how:'Tap 2 existing points to draw the segment.'},
  onedge:{n:3,sym:'·',name:'Point on edge',sub:'label a point on AB',how:'Tap endpoint A, endpoint B, then a guide point near where you want it (projection onto AB).'},
  angle:{n:3,sym:'∠',name:'Measure angle',sub:'3 points A–V–B',how:'Tap arm end, vertex, other arm end. Shows the angle at the vertex.'}
};

const EXPLORE_TOOL_KEYS=['foot','footp','meet','par','mid','join','onedge','angle','centroid'];

function construct(type,names,pts){
  const P=names.map(n=>pts[n]);
  let X,desc,segs=[],mark=null,joinOnly=false,angleOnly=false,deg=null;
  if(type==='foot'){
    const [p,l1,l2]=P;
    if(V.len(V.cross(V.sub(p,l1),V.unit(V.sub(l2,l1))))<1e-6)
      return {err:`${names[0]} is already on line ${names[1]}${names[2]}.`};
    const u=V.unit(V.sub(l2,l1));
    const t=V.dot(V.sub(p,l1),u);
    X=V.add(l1,V.mul(u,t));
    segs.push([names[0],'@']);
    mark={to:names[0],along:V.len(V.sub(l1,X))>V.len(V.sub(l2,X))?names[1]:names[2]};
    const L=V.len(V.sub(l2,l1));
    const out=t<-1e-6||t>L+1e-6;
    desc=`foot of ⊥ from ${names[0]} to ${names[1]}${names[2]}${out?' produced':''}`;
  }else if(type==='footp'){
    const [p,a1,a2,a3]=P;
    const nn=V.cross(V.sub(a2,a1),V.sub(a3,a1));
    if(V.len(nn)<1e-6)return {err:`${names[1]}, ${names[2]}, ${names[3]} don't fix a plane.`};
    const n=V.unit(nn),dd=V.dot(V.sub(p,a1),n);
    if(Math.abs(dd)<1e-5)return {err:`${names[0]} already lies in that plane.`};
    X=V.sub(p,V.mul(n,dd));
    segs.push([names[0],'@']);
    desc=`foot of ⊥ from ${names[0]} to plane ${names[1]}${names[2]}${names[3]}`;
  }else if(type==='mid'){
    X=V.mid(P[0],P[1]);
    desc=`midpoint of ${names[0]}${names[1]}`;
  }else if(type==='centroid'){
    X=V.mul(V.add(V.add(P[0],P[1]),P[2]),1/3);
    desc=`centroid of △${names[0]}${names[1]}${names[2]}`;
  }else if(type==='meet'){
    const [l1,l2,m1,m2]=P,d=V.sub(l2,l1),e=V.sub(m2,m1),c=V.cross(d,e),w=V.sub(m1,l1);
    if(V.len(c)<1e-6*V.len(d)*V.len(e))return {err:'Those lines are parallel.'};
    if(Math.abs(V.dot(w,c))/V.len(c)>1e-4)return {err:'Those lines are skew.'};
    const cc=V.dot(c,c),s=V.dot(V.cross(w,e),c)/cc;
    X=V.add(l1,V.mul(d,s));
    desc=`intersection of ${names[0]}${names[1]} & ${names[2]}${names[3]}`;
  }else if(type==='par'){
    const [p,l1,l2]=P;
    const u=V.unit(V.sub(l2,l1));
    if(V.len(V.cross(V.sub(p,l1),u))<1e-6)
      return {err:`${names[0]} already lies on ${names[1]}${names[2]}.`};
    X=V.add(p,V.mul(u, Math.max(4, V.len(V.sub(l2,l1))*0.45)));
    segs.push([names[0],'@','par']);
    desc=`point on line through ${names[0]} ∥ ${names[1]}${names[2]}`;
  }else if(type==='join'){
    joinOnly=true;
    X=null;
    segs.push([names[0],names[1]]);
    desc=`segment ${names[0]}${names[1]}`;
  }else if(type==='onedge'){
    const [a,b,g]=P;
    const u=V.unit(V.sub(b,a));
    const L=V.len(V.sub(b,a));
    let t=V.dot(V.sub(g,a),u);
    t=Math.max(0.08*L, Math.min(0.92*L, t));
    X=V.add(a,V.mul(u,t));
    desc=`point on ${names[0]}${names[1]}`;
  }else if(type==='angle'){
    angleOnly=true;
    const [A,B,C]=P;
    const u=V.unit(V.sub(A,B)), v=V.unit(V.sub(C,B));
    const c=Math.max(-1,Math.min(1,V.dot(u,v)));
    deg=Math.acos(c)*180/Math.PI;
    X=null;
    segs.push([names[0],names[1]],[names[1],names[2]]);
    desc=`∠${names[0]}${names[1]}${names[2]} = ${f2(deg)}°`;
  }else return {err:'Unknown tool'};
  return {X,desc,segs,mark,joinOnly,angleOnly,deg};
}

function ensurePoint(type,args,st){
  const r=construct(type,args,st.pts);
  if(r.err)return r;
  if(r.angleOnly){
    st.measured={names:args.slice(),deg:r.deg,desc:r.desc};
    st.cons.push({name:null,type:'angle',args:args.slice(),desc:r.desc,segs:r.segs,mark:null,angleOnly:true,deg:r.deg});
    return {name:'∠',measured:true,deg:r.deg};
  }
  if(r.joinOnly){
    const a=args[0],b=args[1];
    const exists=st.cons.some(c=>c.type==='join'&&((c.args[0]===a&&c.args[1]===b)||(c.args[0]===b&&c.args[1]===a)));
    if(exists)return {name:a+b,existed:true};
    st.cons.push({name:null,type:'join',args:args.slice(),desc:r.desc,segs:r.segs,mark:null,joinOnly:true});
    // also track as free edge for redraw
    if(!st.joins) st.joins=[];
    st.joins.push([a,b]);
    return {name:a+b,joined:true};
  }
  for(const k in st.pts)if(V.len(V.sub(st.pts[k],r.X))<1e-4)return {name:k,existed:true};
  const name=POOL.split('').find(c=>!(c in st.pts));
  if(!name)return {err:'No letters left. Undo a construction.'};
  st.pts[name]=r.X;st.kind[name]='c';
  const segs=(r.segs||[]).map(s=>s.map(x=>x==='@'?name:x));
  st.cons.push({name,type,args:args.slice(),desc:r.desc,segs,mark:r.mark?{at:name,to:r.mark.to,along:r.mark.along}:null});
  return {name};
}

function undoLastCons(st){
  if(!st.cons.length)return null;
  const c=st.cons.pop();
  if(c.name && st.kind[c.name]==='c'){
    delete st.pts[c.name];
    delete st.kind[c.name];
  }
  if(c.type==='join' && st.joins){
    const [a,b]=c.args;
    st.joins=st.joins.filter(([x,y])=>!((x===a&&y===b)||(x===b&&y===a)));
  }
  if(c.type==='angle'){
    st.measured=null;
  }
  return c;
}

function clearCons(st){
  while(st.cons.length) undoLastCons(st);
  st.joins=[];
  st.measured=null;
}

function rightAngleMark(A,B,C,scale=0.35){
  const u=V.unit(V.sub(A,B)), v=V.unit(V.sub(C,B));
  const p1=V.add(B,V.mul(u,scale)), p2=V.add(B,V.add(V.mul(u,scale),V.mul(v,scale))), p3=V.add(B,V.mul(v,scale));
  return [p1,p2,p3];
}

function polyPath(pts){return pts.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+','+p[1].toFixed(1)).join(' ')+'Z';}
function linePath(a,b){return `M${a[0].toFixed(1)},${a[1].toFixed(1)}L${b[0].toFixed(1)},${b[1].toFixed(1)}`;}

function angleDegrees(A,B,C){
  const u=V.unit(V.sub(A,B)), v=V.unit(V.sub(C,B));
  const c=Math.max(-1,Math.min(1,V.dot(u,v)));
  return Math.acos(c)*180/Math.PI;
}

/** SVG snippets for free constructions + measured angle */
function consOverlayHtml(st, Pj, projFn){
  if(st.uiMode==='exam') return '';
  let html='';
  const joins=st.joins||[];
  joins.forEach(([a,b])=>{
    if(Pj[a]&&Pj[b]) html+=`<path class="cs" d="${linePath(Pj[a],Pj[b])}"/>`;
  });
  (st.cons||[]).forEach(c=>{
    (c.segs||[]).forEach(s=>{
      if(s.length>=2 && s[0] in Pj && s[1] in Pj){
        const cls=s[2]==='par'?'cs':'cs';
        html+=`<path class="${cls}" d="${linePath(Pj[s[0]],Pj[s[1]])}"/>`;
      }
    });
    if(c.mark && c.mark.at in st.pts && c.mark.to in st.pts && c.mark.along in st.pts){
      const rm=rightAngleMark(st.pts[c.mark.to], st.pts[c.mark.at], st.pts[c.mark.along], 0.4);
      const pp=rm.map(p=>projFn(p));
      html+=`<path class="ra" d="${linePath(pp[0],pp[1])} ${linePath(pp[1],pp[2]).replace(/^M/,'L')}"/>`;
    }
  });
  if(st.measured && st.measured.names){
    const [A,B,C]=st.measured.names;
    if(Pj[A]&&Pj[B]&&Pj[C]){
      html+=`<path class="arm" d="${linePath(Pj[A],Pj[B])}"/><path class="arm" d="${linePath(Pj[B],Pj[C])}"/>`;
      const mid=[(Pj[A][0]+Pj[B][0]+Pj[C][0])/3,(Pj[A][1]+Pj[B][1]+Pj[C][1])/3];
      html+=`<text class="lab t" x="${mid[0]}" y="${mid[1]}">${f2(st.measured.deg)}°</text>`;
    }
  }
  return html;
}

function modePrefix(st){
  if(st.uiMode==='exam') return 'Exam · ';
  if(st.uiMode==='scaffold') return 'Guided · ';
  return 'Explore · ';
}

function applyUiModeClass(st){
  document.body.classList.toggle('exam', st.uiMode==='exam');
}

function ensureExamStyles(){
  if(document.getElementById('exam-mode-css')) return;
  const s=document.createElement('style');
  s.id='exam-mode-css';
  s.textContent=`
body.exam .cs, body.exam .cl, body.exam .arm, body.exam .arc, body.exam .ra{display:none!important}
body.exam .hl, body.exam .hl2{fill:rgba(180,180,180,.10)!important;stroke:#8a8a8a!important}
body.exam .face{fill:rgba(180,180,180,.12)!important}
body.exam .lab.c, body.exam .lab.t{fill:var(--ink)!important}
body.exam #svg circle:not(.hit){fill:var(--ink)!important}
body.exam .chip.c{color:var(--ink);border-color:var(--line)}
body.exam .panel .tools, body.exam .howto, body.exam .cons, body.exam [data-tool]{display:none!important}
body.exam .mode-card .prompt{color:var(--ink2)}
`;
  document.head.appendChild(s);
}

function modeToggleHtml(st){
  const m=st.uiMode||'explore';
  const prompt = m==='explore'
    ? 'Try your own construction — which line makes the right angle / dihedral clear?'
    : m==='scaffold'
      ? 'Follow the steps, or switch back to Explore anytime. Your free points stay.'
      : 'Exam — monochrome figure only. No tools or coloured hints.';
  return `<div class="card mode-card">
    <div class="sec">Work mode</div>
    <div class="mode-row">
      <button class="mode ${m==='explore'?'on':''}" data-uimode="explore" aria-pressed="${m==='explore'}"><b>Explore</b>Free constructions</button>
      <button class="mode ${m==='scaffold'?'on':''}" data-uimode="scaffold" aria-pressed="${m==='scaffold'}"><b>Guided</b>Steps if you need help</button>
      <button class="mode ${m==='exam'?'on':''}" data-uimode="exam" aria-pressed="${m==='exam'}"><b>Exam</b>Figure only</button>
    </div>
    <p class="prompt">${prompt}</p>
  </div>`;
}

function exploreToolsHtml(st, keys){
  if(st.uiMode==='exam') return '';
  const list=keys||EXPLORE_TOOL_KEYS;
  let html=`<div class="card"><div class="sec">Explore tools · draw your own</div><div class="tools">`;
  list.forEach(k=>{
    const T=TOOLS[k]; if(!T) return;
    html+=`<button class="btn ${st.tool===k?'on':''}" data-tool="${k}"><span class="sym">${T.sym}</span>${T.name}<small>${T.sub}</small></button>`;
  });
  html+=`</div>`;
  if(st.tool&&TOOLS[st.tool]) html+=`<div class="howto">${TOOLS[st.tool].how} · <span class="mth">${(st.tsel||[]).join(', ')||'—'}</span> ${(st.tsel||[]).length}/${TOOLS[st.tool].n}</div>`;
  html+=`<ul class="cons">${(st.cons||[]).map(c=>`<li>${c.name?`<b>${c.name}</b> — `:''}${c.desc}</li>`).join('')}</ul>`;
  if(st.measured) html+=`<div class="msg">${st.measured.desc}</div>`;
  html+=`<div class="actions" style="margin-top:8px">
    <button class="btn" id="undoCons" ${(st.cons&&st.cons.length)?'':'disabled'}>Undo last</button>
    <button class="btn warn" id="clearCons" ${(st.cons&&st.cons.length)?'':'disabled'}>Clear constructions</button>
  </div></div>`;
  return html;
}

function scaffoldStepsHtml(st, STEPS){
  if(st.uiMode!=='scaffold') return '';
  const stepsHtml=STEPS.map((s,i)=>`<div class="step ${i<st.step?'ok':(i===st.step?'on':'')}"><div class="n">${i<st.step?'✓':(i+1)}</div><div class="t">${s.t}</div></div>`).join('');
  return `<div class="card"><div class="sec">Guided scaffold · optional</div>${stepsHtml}
  <div class="actions"><button class="btn" id="nextStep">Next step</button>
  <button class="btn" id="backExplore">← Back to Explore</button></div></div>`;
}

function wireDualMode(st, redraw, extra){
  extra=extra||{};
  ensureExamStyles();
  applyUiModeClass(st);
  const panel=$('#panel'); if(!panel) return;
  panel.querySelectorAll('[data-uimode]').forEach(b=>b.onclick=()=>{
    const m=b.dataset.uimode;
    if(m===st.uiMode) return;
    st.uiMode=m; st.tool=null; st.tsel=[];
    const msg=m==='explore'?'Explore mode — build freely'
      : m==='scaffold'?'Guided steps on'
      : 'Exam mode — figure only';
    toast(msg);
    applyUiModeClass(st);
    redraw();
  });
  panel.querySelectorAll('[data-tool]').forEach(b=>b.onclick=()=>{
    st.tool=st.tool===b.dataset.tool?null:b.dataset.tool; st.tsel=[]; redraw();
  });
  const u=$('#undoCons'); if(u) u.onclick=()=>{const c=undoLastCons(st); if(c) toast('Undid: '+(c.desc||c.name)); redraw();};
  const cl=$('#clearCons'); if(cl) cl.onclick=()=>{
    if(!st.cons.length) return;
    if(!confirm('Clear all free constructions? Guided progress is kept.')) return;
    clearCons(st); toast('Constructions cleared'); redraw();
  };
  const be=$('#backExplore'); if(be) be.onclick=()=>{st.uiMode='explore';toast('Back to Explore');redraw();};
  const ns=$('#nextStep'); if(ns) ns.onclick=()=>{
    const max = (typeof STEPS!=='undefined' && STEPS.length) ? STEPS.length : (st.stepMax||4);
    if(st.step < max){ st.step++; if(st.step>=3) st.unlocked=true; redraw(); }
  };
  if(extra.after) extra.after();
}

function handleToolTap(st, n, redraw){
  if(!st.tool) return false;
  const i=st.tsel.indexOf(n); if(i>=0) st.tsel.splice(i,1); else st.tsel.push(n);
  const T=TOOLS[st.tool];
  if(st.tsel.length===T.n){
    const r=ensurePoint(st.tool, st.tsel, st);
    if(r.err) toast(r.err,'bad');
    else if(r.existed) toast('Already '+r.name);
    else if(r.measured) toast(r.deg!=null?`∠ = ${f2(r.deg)}°`:'Angle measured','good');
    else if(r.joined) toast('Drew '+r.name,'good');
    else toast('New '+r.name,'good');
    st.tsel=[]; st.tool=null;
  }
  redraw();
  return true;
}

/** Soft gate: Explore can always answer; Guided may still prefer steps but Unlock always works */
function canSubmit(st){
  return true; // pedagogy: never block exploration of answers after try
}
