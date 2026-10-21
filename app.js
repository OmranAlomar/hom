window.startApp=function(blob,username){
/* ===== الإعدادات والتخزين ===== */
const SETTINGS={minutes:90,warnHour:8,earlyHour:4};
const KEY={start:'start_date',mode:'play_mode',log:'done_log',apikey:'yt_api_key_'+username,series:'series_v3',course:'course_',notes:'notes_',done:'completed_days'};
const DAY_NAMES=['الأحد','الإثنين','الثلاثاء','الأربعاء','الخميس','الجمعة','السبت'];
const DAY_ORDER=[6,0,1,2,3,4,5];
const $=id=>document.getElementById(id);
let mem=blob||{},saveT=null,saving=false,dirty=false;
function setSync(t){const e=document.getElementById('syncState');if(e)e.textContent=t}
async function flush(keep){
  if(saving){saveT=setTimeout(flush,400);return}
  saving=true;dirty=false;
  try{
    const body=JSON.stringify({mem});
    const r=await fetch('/api/data',{method:'PUT',headers:{'Content-Type':'application/json'},body,keepalive:!!keep&&body.length<60000});
    if(r.status===401){location.reload();return}
    if(!r.ok)throw new Error('save');
    setSync('تم الحفظ ✓');
  }catch(e){dirty=true;setSync('تعذّر الحفظ، سأعيد المحاولة…');clearTimeout(saveT);saveT=setTimeout(flush,5000)}
  finally{saving=false}
}
function queueSave(){dirty=true;setSync('جارٍ الحفظ…');clearTimeout(saveT);saveT=setTimeout(flush,700)}
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&dirty){clearTimeout(saveT);flush(true)}});
const store={
  get(k,d){
    if(k===KEY.apikey){try{const v=localStorage.getItem(k);return v===null?d:JSON.parse(v)}catch(e){return d}}
    return k in mem?mem[k]:d;
  },
  set(k,v){
    if(k===KEY.apikey){try{localStorage.setItem(k,JSON.stringify(v));return true}catch(e){return false}}
    mem[k]=v;queueSave();return true;
  }
};
function h(tag,props={},...kids){
  const e=document.createElement(tag);
  for(const k in props){
    if(k==='class')e.className=props[k];
    else if(k.startsWith('on'))e.addEventListener(k.slice(2),props[k]);
    else if(props[k]!==false&&props[k]!==null&&props[k]!==undefined)e.setAttribute(k,props[k]===true?'':props[k]);
  }
  kids.flat().forEach(c=>e.append(c instanceof Node?c:document.createTextNode(c)));
  return e;
}
function uid(){return 's'+Date.now().toString(36)+Math.random().toString(36).slice(2,5)}

const DEFAULTS=[
 {id:'mahawir',title:'العقيدة للجيل الصاعد',subject:'العقيدة والبناء الفكري',days:[6,0],
  playlist:'https://youtube.com/playlist?list=PLZmiPrHYOIsTqE2zBxZU24nOn1VvNhkVz',episodes:[]},
 {id:'fiqh',title:'التأصيل الفقهي',subject:'الفقه والقواعد الفقهية',days:[1,2],
  playlist:'https://youtube.com/playlist?list=PLZmiPrHYOIsTOFqP2PWgJIYbISVjbBLPz',episodes:[]},
 {id:'sira',title:'السيرة النبوية',subject:'السيرة النبوية والتاريخ',days:[3,4],
  playlist:'https://youtube.com/playlist?list=PLbTaPRF6tsYY',episodes:[]},
 {id:'tazkiya',title:'التزكية للمصلحين',subject:'التزكية وأعمال القلوب',days:[5],
  playlist:'https://youtube.com/playlist?list=PLEfNlVyROc8YbTNkYR2F0QQq4XFedbQUX',episodes:[]}
];
let data=store.get(KEY.series,null);
if(!Array.isArray(data))data=[];

const now=new Date();
const dayKey=`${now.getFullYear()}-${now.getMonth()+1}-${now.getDate()}`;
const today=now.getDay();
let activeId=null;

/* ===== أدوات الروابط ===== */
function isHttp(u){try{const x=new URL(u);return x.protocol==='https:'||x.protocol==='http:'}catch(e){return false}}
function listId(u){const m=(u||'').match(/[?&]list=([\w-]+)/);return m?m[1]:''}
function playlistLink(s,n){
  const id=listId(s.playlist);
  if(!id)return '';
  return `https://www.youtube.com/watch?list=${id}&index=${n}`;
}
function progress(id){const v=store.get(KEY.course+id,0);return Number.isInteger(v)&&v>=0?v:0}
function setProgress(id,v){store.set(KEY.course+id,Math.max(0,v))}
function videoId(u){
  try{
    const x=new URL(u);
    if(x.hostname==='youtu.be')return x.pathname.slice(1).split('/')[0];
    if(x.searchParams.get('v'))return x.searchParams.get('v');
    const m=x.pathname.match(/\/(?:embed|shorts|live)\/([\w-]{6,})/);
    return m?m[1]:'';
  }catch(e){return ''}
}
function embedSrc(s,ep,i){
  const list=listId(s.playlist),vid=videoId(ep.url||'');
  if(vid)return `https://www.youtube.com/embed/${encodeURIComponent(vid)}?rel=0&playsinline=1`; 
  if(list)return `https://www.youtube.com/embed/videoseries?list=${encodeURIComponent(list)}&index=${i}&rel=0&playsinline=1`;
  return '';
}
function episodeAt(s,i){
  if(s.episodes.length){
    const e=s.episodes[i];
    return e?{name:e.name||`المقطع ${i+1}`,url:e.url||playlistLink(s,i+1)}:null;
  }
  return {name:`المقطع ${i+1}`,url:playlistLink(s,i+1)};
}

/* ===== جلب مقاطع القائمة تلقائياً (YouTube Data API v3) ===== */
const STALE_MS=24*60*60*1000;
function apiKey(){return store.get(KEY.apikey,'')||''}
async function fetchPlaylist(id,key){
  const out=[];let token='';
  for(let page=0;page<40;page++){
    const q=new URLSearchParams({part:'snippet',maxResults:'50',playlistId:id,key});
    if(token)q.set('pageToken',token);
    let r,j;
    try{r=await fetch('https://www.googleapis.com/youtube/v3/playlistItems?'+q);j=await r.json()}
    catch(e){throw new Error('تعذّر الاتصال بيوتيوب، تحقق من الإنترنت.')}
    if(!r.ok){
      const er=(j.error&&j.error.errors&&j.error.errors[0]&&j.error.errors[0].reason)||'';
      const map={keyInvalid:'مفتاح API غير صحيح.',playlistNotFound:'القائمة غير موجودة أو خاصة.',quotaExceeded:'انتهت الحصة اليومية للمفتاح.',accessNotConfigured:'فعّل YouTube Data API v3 في مشروع المفتاح.',forbidden:'القائمة غير متاحة لهذا المفتاح.',playlistItemsNotAccessible:'القائمة خاصة ولا يمكن قراءتها.'};
      throw new Error(map[er]||(j.error&&j.error.message)||('خطأ '+r.status));
    }
    (j.items||[]).forEach(it=>{
      const sn=it.snippet||{},vid=sn.resourceId&&sn.resourceId.videoId,t=sn.title||'';
      if(!vid||t==='Private video'||t==='Deleted video')return;
      out.push({name:t,url:`https://www.youtube.com/watch?v=${vid}&list=${id}`});
    });
    token=j.nextPageToken;if(!token)break;
  }
  return out;
}
/* ===== بديل بلا مفتاح: خوادم Invidious المفتوحة ===== */
const INVIDIOUS=[
  'https://invidious.nerdvpn.de',
  'https://yewtu.be',
  'https://inv.nadeko.net'
];
async function getJson(url,ms=12000){
  const ctl=new AbortController(),t=setTimeout(()=>ctl.abort(),ms);
  try{
    const r=await fetch(url,{signal:ctl.signal});
    if(!r.ok)throw new Error('HTTP '+r.status);
    return await r.json();
  }finally{clearTimeout(t)}
}
async function getPlaylistVideos(playlistId){
  let lastErr=null;
  for(const base of INVIDIOUS){
    try{
      const out=[];let total=Infinity;
      for(let page=1;page<=30&&out.length<total;page++){
        const d=await getJson(`${base}/api/v1/playlists/${encodeURIComponent(playlistId)}?page=${page}`);
        if(typeof d.videoCount==='number')total=d.videoCount;
        const vids=(d.videos||[]).filter(v=>v&&v.videoId&&v.title!=='[Private video]'&&v.title!=='[Deleted video]');
        if(!(d.videos||[]).length)break;
        vids.forEach(v=>out.push({name:v.title,url:`https://www.youtube.com/watch?v=${v.videoId}&list=${playlistId}`}));
      }
      if(out.length)return out;
      lastErr=new Error('القائمة فارغة أو غير عامة.');
    }catch(e){lastErr=e}
  }
  throw new Error('تعذّر الجلب من خوادم Invidious'+(lastErr?` (${lastErr.message})`:'')+'. جرّب لاحقاً أو استخدم مفتاح API.');
}

async function syncSeries(s){
  const key=apiKey(),id=listId(s.playlist);
  if(!id)throw new Error('رابط القائمة لا يحوي list=.');
  let eps=[];
  if(key){
    try{eps=await fetchPlaylist(id,key)}
    catch(e){
      try{eps=await getPlaylistVideos(id)}
      catch(e2){throw new Error(e.message+' | '+e2.message)}
    }
  }else{
    eps=await getPlaylistVideos(id);
  }
  if(!eps.length)throw new Error('لم أجد مقاطع عامة في هذه القائمة.');
  s.episodes=eps;s.synced=Date.now();
  return eps.length;
}
async function autoRefresh(){
  let changed=false;
  for(const s of data){
    if(!s.playlist||!listId(s.playlist))continue;
    if(s.episodes.length&&Date.now()-(s.synced||0)<STALE_MS)continue;
    try{await syncSeries(s);changed=true}catch(e){}
  }
  if(changed){store.set(KEY.series,data);if(!$('mgr').hidden||true)renderMain()}
}

/* ===== العرض ===== */
function scheduledToday(){return data.filter(s=>s.days.includes(today))}
function current(){return data.find(s=>s.id===activeId)||data[0]}

/* ===== التاريخ والإحصاء ===== */
const midnight=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
const pad=n=>String(n).padStart(2,'0');
const iso=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
function getStart(){
  const v=store.get(KEY.start,''),t0=midnight(now);
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)){
    const [y,m,d]=v.split('-').map(Number),s=new Date(y,m-1,d);
    if(s<=t0)return s;
  }
  store.set(KEY.start,iso(t0));return t0;
}
function statsInfo(){
  const start=getStart(),done=store.get(KEY.done,[]),days=Math.round((midnight(now)-start)/864e5)+1;
  let sched=0,okS=0,ok=0,miss=0,run=0,best=0;const cells=[];
  for(let i=0;i<days;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);
    const has=data.some(s=>s.days.includes(d.getDay())),isDone=done.includes(dk(d)),isToday=i===days-1;
    let state='off';
    if(isDone){ok++;run++;best=Math.max(best,run);state='ok';if(has){sched++;okS++}}
    else if(has){sched++;if(isToday)state='now';else{miss++;run=0;state='miss'}}
    cells.push({state,label:`${DAY_NAMES[d.getDay()]} ${fmt(d,{day:'numeric',month:'short'})}`});
  }
  return{days,sched,okS,ok,miss,streak:run,best,cells};
}
function renderStats(){
  const st=statsInfo(),box=$('tiles');box.innerHTML='';
  [['اليوم رقم',st.days],['أيام منجزة',st.ok],['أيام فائتة',st.miss],
   ['نسبة الالتزام',st.sched?Math.round(st.okS/st.sched*100)+'%':'—'],['المتتابعة الحالية',st.streak],['أطول متتابعة',st.best]]
   .forEach(([k,v])=>box.append(h('div',{class:'tile'},h('b',{},String(v)),h('span',{class:'msg'},k))));
  const map=$('stMap');map.innerHTML='';
  st.cells.forEach(c=>map.append(h('i',{class:'cell '+c.state,title:c.label})));
  $('startDate').value=iso(getStart());$('startDate').max=iso(midnight(now));
}
$('startDate').onchange=()=>{
  const v=$('startDate').value;
  if(/^\d{4}-\d{2}-\d{2}$/.test(v)){store.set(KEY.start,v);renderWeek();renderStats()}
};

/* ===== مهام اليوم ===== */
const extra=new Set();
const playMode=()=>store.get(KEY.mode,'embed');
function nextHint(){
  for(let i=1;i<=7;i++){
    const d=(today+i)%7,l=data.filter(s=>s.days.includes(d));
    if(l.length)return `الورد القادم: ${i===1?'غداً':DAY_NAMES[d]} — ${l.map(s=>s.title).join('، ')}`;
  }
  return '';
}
function renderHero(){
  const t=scheduledToday();
  $('subject').textContent=t.length?(t.length===1?`اليوم عليك درس في ${t[0].title}`:`اليوم عليك ${t.length} دروس`):'لا ورد مجدول اليوم';
  $('subjectDesc').textContent=t.length?t.map(s=>s.subject||s.title).join(' · '):nextHint();
}
function pickList(s,p){
  const det=h('details',{class:'msg'},h('summary',{},'اختيار مقطع آخر'));
  if(!s.episodes.length){
    const inp=h('input',{type:'number',min:1,value:p+1,style:'width:90px'});
    inp.addEventListener('change',()=>{const n=parseInt(inp.value,10);if(n>=1){setProgress(s.id,n-1);renderMain()}});
    det.append(h('div',{class:'row'},h('label',{},'رقم المقطع: '),inp));
  }else{
    const list=h('div',{class:'eps'});
    s.episodes.forEach((e,i)=>list.append(h('div',{class:'ep'+(i===p?' cur':'')+(i<p?' done':'')},
      h('span',{class:'n'},i<p?'✓':String(i+1)),
      h('span',{class:'nm',title:e.name,onclick:()=>{setProgress(s.id,i);renderMain()}},e.name||`المقطع ${i+1}`))));
    det.append(list);
  }
  return det;
}
function taskCard(s){
  const p=progress(s.id),ep=episodeAt(s,p),log=store.get(KEY.log,{}),did=(log[dayKey]||{})[s.id]||0;
  const card=h('section',{class:'current'},h('p',{class:'msg'},s.title));
  if(!ep||(did&&!extra.has(s.id))){
    const last=p>0?episodeAt(s,p-1):null;
    card.append(h('p',{class:'t ok'},!ep&&!did?'أتممتَ كل مقاطع هذه السلسلة، بارك الله فيك':'✓ أتممتَ درس اليوم'+(last?`: ${last.name}`:'')));
    card.append(!ep?h('button',{onclick:()=>{setProgress(s.id,0);renderMain()}},'ابدأ من جديد')
      :h('button',{onclick:()=>{extra.add(s.id);renderMain()}},'شاهد المقطع التالي الآن'));
    return card;
  }
  card.append(h('p',{class:'t'},`${ep.name} (${s.episodes.length?`${p+1} من ${s.episodes.length}`:`المقطع ${p+1}`})`));
  const src=embedSrc(s,ep,p),url=ep.url&&isHttp(ep.url)?ep.url:'',inPage=playMode()==='embed'&&src;
  if(inPage){
    card.append(h('div',{class:'video'},h('iframe',{src,title:ep.name,loading:'lazy',allowfullscreen:true,
      allow:'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
      referrerpolicy:'strict-origin-when-cross-origin'})));
    card.append(h('p',{class:'msg'},'إن طلب المشغّل تسجيل الدخول أو لم يعمل المقطع، اضغط «شاهد على يوتيوب».'));
  }
  const row=h('div',{class:'row'});
  if(url)row.append(h('a',{class:'btn'+(inPage?'':' main'),href:url,target:'_blank',rel:'noopener noreferrer'},inPage?'شاهد على يوتيوب ↗':'شاهد المقطع على يوتيوب ↗'));
  else if(!src)row.append(h('span',{class:'errs'},'لا يوجد رابط لهذا المقطع. أضفه من «إدارة السلاسل والروابط».'));
  row.append(h('button',{class:'main',onclick:()=>markDone(s)},'أتممتُ المقطع'));
  card.append(row,pickList(s,p));
  return card;
}
function renderMain(){
  renderHero();
  $('modeBtn').textContent=playMode()==='embed'?'التشغيل: داخل الصفحة':'التشغيل: تبويب جديد';
  const body=$('body'),t=scheduledToday();body.innerHTML='';
  if(!t.length)body.append(h('div',{class:'current'},h('p',{class:'t'},'لا ورد مجدول اليوم'),h('p',{class:'msg'},nextHint()||'لم تضف سلسلة بعد.'),!data.length?h('button',{class:'main',onclick:openMgr},'أضف أول سلسلة'):''));
  t.forEach(s=>body.append(taskCard(s)));
  renderWeek();renderStats();
}
$('modeBtn').onclick=()=>{store.set(KEY.mode,playMode()==='embed'?'tab':'embed');renderMain()};
function markDone(s){
  const total=s.episodes.length;
  setProgress(s.id,total?Math.min(progress(s.id)+1,total):progress(s.id)+1);
  const d=store.get(KEY.done,[]);
  if(!d.includes(dayKey)){d.push(dayKey);store.set(KEY.done,d)}
  const log=store.get(KEY.log,{});
  (log[dayKey]=log[dayKey]||{})[s.id]=(log[dayKey][s.id]||0)+1;
  store.set(KEY.log,log);
  renderMain();
}
/* ===== التتبّع الأسبوعي (الأسبوع يبدأ يوم السبت) ===== */
let weekOffset=0;
const SHORT=['أحد','اثنين','ثلاثاء','أربعاء','خميس','جمعة','سبت'];
const dk=d=>`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`;
const fmt=(d,o)=>d.toLocaleDateString('ar',o);
function weekStart(base){
  const d=new Date(base.getFullYear(),base.getMonth(),base.getDate());
  d.setDate(d.getDate()-((d.getDay()+1)%7));return d;
}
function streakCount(done){
  let n=0;const d=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  for(let i=0;i<400;i++,d.setDate(d.getDate()-1)){
    if(!data.some(s=>s.days.includes(d.getDay()))&&!done.includes(dk(d)))continue;
    if(done.includes(dk(d)))n++;
    else if(i===0)continue;
    else break;
  }
  return n;
}
function renderWeek(){
  const start=weekStart(now);start.setDate(start.getDate()+weekOffset*7);
  const end=new Date(start);end.setDate(end.getDate()+6);
  const done=store.get(KEY.done,[]),log=store.get(KEY.log,{});
  const t0=new Date(now.getFullYear(),now.getMonth(),now.getDate()).getTime(),startT=getStart().getTime();

  $('wkLabel').textContent=weekOffset===0?'هذا الأسبوع':weekOffset===-1?'الأسبوع الماضي':`قبل ${-weekOffset} أسابيع`;
  $('wkRange').textContent=`${fmt(start,{day:'numeric',month:'long'})} – ${fmt(end,{day:'numeric',month:'long'})}`;
  $('wkNext').disabled=weekOffset>=0;
  $('wkPrev').disabled=weekOffset<=-52;

  const box=$('wkDays');box.innerHTML='';
  let sched=0,ok=0;const counts={};
  for(let i=0;i<7;i++){
    const d=new Date(start);d.setDate(start.getDate()+i);
    const wd=d.getDay(),key=dk(d),list=data.filter(s=>s.days.includes(wd));
    const isDone=done.includes(key),t=d.getTime();
    let state='off',icon='–';
    if(list.length&&t>=startT){
      sched++;if(isDone)ok++;
      if(isDone){state='ok';icon='✓'}
      else if(t<t0){state='miss';icon='✕'}
      else if(t===t0){state='now';icon='●'}
      else{state='soon';icon='○'}
    }else if(isDone){state='ok';icon='✓'}
    if(t===t0&&!(state==='ok'))state=list.length?'now':state;
    const dl=log[key]||{};
    for(const id in dl)counts[id]=(counts[id]||0)+dl[id];
    box.append(h('div',{class:'dc '+state,role:'listitem',title:list.map(s=>s.title).join('، ')},
      h('div',{class:'dn'},h('span',{class:'f'},DAY_NAMES[wd]),h('span',{class:'s'},SHORT[wd])),
      h('div',{class:'dd'},fmt(d,{day:'numeric'})),
      h('div',{class:'st','aria-label':{ok:'منجز',miss:'فائت',now:'اليوم',soon:'قادم',off:'لا ورد'}[state]},icon),
      h('div',{class:'sv'},list.map(s=>s.title).join('، '))));
  }
  const pct=sched?Math.round(ok/sched*100):0;
  $('wkFill').style.width=pct+'%';
  $('wkFill').parentElement.classList.toggle('ok',sched>0&&ok===sched);
  $('wkText').textContent=sched?`${ok} من ${sched} أيام (${pct}%)`:'لا أيام مجدولة';

  const sr=$('wkSeries');sr.innerHTML='';
  data.forEach(s=>{
    const c=counts[s.id]||0,target=Math.max(1,s.days.length),p=progress(s.id);
    const row=h('div',{class:'sr'},
      h('span',{class:'nm',title:s.title},s.title),
      h('div',{class:'bar'+(c>=target?' ok':'')},h('span',{style:`width:${Math.min(100,c/target*100)}%`})),
      h('span',{class:'msg'},`${c}/${target} هذا الأسبوع · ${s.episodes.length?`${Math.min(p,s.episodes.length)}/${s.episodes.length}`:`تقدّم ${p}`}`));
    sr.append(row);
  });
  const st=statsInfo().streak;
  $('streak').textContent=`إجمالي أيام الإنجاز: ${done.length}`+(st?` · متتابعة حالياً: ${st}`:'')+(done.includes(dayKey)?' · واظبتَ اليوم ✓':'');
}
$('wkPrev').onclick=()=>{weekOffset--;renderWeek()};
$('wkNext').onclick=()=>{if(weekOffset<0){weekOffset++;renderWeek()}};

/* ===== المؤقت ===== */
const full=SETTINGS.minutes*60;let left=full,timer=null;
function drawClock(){
  $('clock').textContent=`${Math.floor(left/60)}:${String(left%60).padStart(2,'0')}`;
  const p=(full-left)/full,a=Math.PI*(1-p);
  $('arcDone').setAttribute('stroke-dasharray',`${p*100} 100`);
  $('sun').setAttribute('cx',260+210*Math.cos(a));
  $('sun').setAttribute('cy',150-120*Math.sin(a));
}
$('tStart').onclick=()=>{
  if(timer){clearInterval(timer);timer=null;$('tStart').textContent='استئناف';return}
  if(left<=0)left=full;
  $('tStart').textContent='إيقاف مؤقت';$('hourMsg').textContent='';
  timer=setInterval(()=>{
    left--;drawClock();
    if(left<=0){clearInterval(timer);timer=null;$('tStart').textContent='ابدأ';$('hourMsg').textContent='انتهى وقت الورد، تقبّل الله منك'}
  },1000);
};
$('tReset').onclick=()=>{clearInterval(timer);timer=null;left=full;drawClock();$('tStart').textContent='ابدأ';hourHint()};
function hourHint(){
  const hr=new Date().getHours();
  $('hourMsg').textContent=hr<SETTINGS.earlyHour?'ما زال الليل، فاغتنم السحر':(hr>=SETTINGS.warnHour?'تجاوزتَ وقت البكور، لكن ما فات يُدرك':'');
}

/* ===== الملاحظات ===== */
const noteKey=KEY.notes+dayKey;
$('notes').value=store.get(noteKey,'');
let nt;$('notes').addEventListener('input',()=>{
  clearTimeout(nt);
  nt=setTimeout(()=>{$('saved').textContent=store.set(noteKey,$('notes').value)?'تم الحفظ تلقائياً':'تعذّر الحفظ في هذا المتصفح'},400);
});

/* ===== الإدارة ===== */
let draft=null,editId=null;
function openMgr(){
  draft=JSON.parse(JSON.stringify(data));editId=activeId&&draft.find(s=>s.id===activeId)?activeId:(draft[0]?draft[0].id:null);
  $('mgr').hidden=false;renderMgr();$('mgr').scrollIntoView({behavior:'smooth'});
}
function renderMgr(){
  const sl=$('slist');sl.innerHTML='';
  draft.forEach(s=>sl.append(h('button',{class:s.id===editId?'on':'',onclick:()=>{pullEditor();editId=s.id;renderMgr()}},s.title||'(بلا اسم)')));
  const s=draft.find(x=>x.id===editId),ed=$('editor');ed.innerHTML='';
  if(!s){ed.append(h('p',{class:'msg'},'لا توجد سلاسل. أضف سلسلة جديدة.'));return}

  ed.append(h('label',{class:'f',for:'f_title'},'اسم السلسلة'),h('input',{type:'text',id:'f_title',value:s.title}));
  ed.append(h('label',{class:'f',for:'f_subject'},'العنوان الكبير (يظهر أعلى الصفحة)'),h('input',{type:'text',id:'f_subject',value:s.subject||''}));
  ed.append(h('label',{class:'f'},'أيام السلسلة'));
  const days=h('div',{class:'days'});
  DAY_ORDER.forEach(d=>days.append(h('label',{},h('input',{type:'checkbox','data-day':d,checked:s.days.includes(d)}),' '+DAY_NAMES[d])));
  ed.append(days);
  ed.append(h('label',{class:'f',for:'f_pl'},'رابط قائمة التشغيل (اختياري)'),h('input',{type:'url',id:'f_pl',value:s.playlist||'',dir:'ltr',placeholder:'https://www.youtube.com/playlist?list=...'}));

  ed.append(h('div',{class:'row',style:'margin-top:8px'},
    h('button',{class:'main',onclick:()=>syncDraft(s)},'جلب المقاطع من القائمة'),
    h('span',{class:'msg',id:'syncMsg'},s.synced?`آخر جلب: ${new Date(s.synced).toLocaleString('ar')} (${s.episodes.length} مقطع)`:'')));
  ed.append(h('label',{class:'f'},'المقاطع (تُجلب تلقائياً من القائمة، أو أضف وعدّل يدوياً)'));
  const eps=h('div',{id:'eps'});
  const collapsed=s.synced&&s.episodes.length>40&&!s._open;
  if(collapsed){
    eps.append(h('p',{class:'msg'},`${s.episodes.length} مقطعاً مُدارة تلقائياً. تُحدَّث بزر الجلب أو يومياً عند فتح الصفحة.`),
      h('button',{onclick:()=>{pullEditor();s._open=true;renderMgr()}},'عرض وتعديل يدوي'));
  }
  else s.episodes.forEach((e,i)=>eps.append(h('div',{class:'edrow'},
    h('span',{class:'msg'},String(i+1)),
    h('input',{type:'text','data-f':'name',value:e.name,placeholder:'اسم المقطع'}),
    h('input',{type:'url','data-f':'url',class:'u',value:e.url,dir:'ltr',placeholder:'https://youtu.be/...'}),
    h('button',{class:'danger','aria-label':'حذف',onclick:()=>{pullEditor();s.episodes.splice(i,1);renderMgr()}},'✕'))));
  ed.append(eps);
  ed.append(h('button',{onclick:()=>{pullEditor();s.episodes.push({name:'',url:''});renderMgr()}},'+ مقطع جديد'));

  ed.append(h('label',{class:'f',for:'f_bulk'},'إضافة روابط دفعة واحدة (سطر لكل مقطع: «الاسم | الرابط» أو الرابط وحده)'));
  ed.append(h('textarea',{id:'f_bulk',dir:'ltr',placeholder:'المقطع 1 | https://youtu.be/xxxx\nhttps://youtu.be/yyyy'}));
  ed.append(h('button',{onclick:addBulk},'أضف الأسطر'));

  ed.append(h('div',{class:'errs',id:'errs'}));
  ed.append(h('div',{class:'row',style:'margin-top:14px'},
    h('button',{class:'main',onclick:saveMgr},'حفظ التعديلات'),
    h('button',{onclick:()=>{$('mgr').hidden=true;draft=null}},'إلغاء'),
    h('button',{class:'danger',onclick:()=>{
      if(!confirm('حذف هذه السلسلة وتقدّمها؟'))return;
      draft=draft.filter(x=>x.id!==s.id);editId=draft[0]?draft[0].id:null;renderMgr();
    }},'حذف السلسلة')));
}
function pullEditor(){
  const s=draft&&draft.find(x=>x.id===editId);if(!s||!$('f_title'))return;
  s.title=$('f_title').value.trim();
  s.subject=$('f_subject').value.trim();
  s.playlist=$('f_pl').value.trim();
  s.days=[...document.querySelectorAll('[data-day]')].filter(c=>c.checked).map(c=>+c.dataset.day);
  if(document.querySelector('#eps .edrow')||!s.episodes.length){
    s.episodes=[...document.querySelectorAll('#eps .edrow')].map(r=>({
      name:r.querySelector('[data-f=name]').value.trim(),
      url:r.querySelector('[data-f=url]').value.trim()
    }));
  }
}
async function syncDraft(s){
  pullEditor();
  const m=$('syncMsg');
  if(!s.playlist){m.textContent='ضع رابط القائمة أولاً.';m.className='msg errs';return}
  m.className='msg';m.textContent='جارٍ الجلب…';
  try{const n=await syncSeries(s);const keep=editId;renderMgr();editId=keep;$('syncMsg').textContent=`تم جلب ${n} مقطعاً. اضغط «حفظ التعديلات» لتثبيتها.`;$('syncMsg').className='msg ok'}
  catch(e){m.textContent=e.message;m.className='msg errs'}
}
function addBulk(){
  pullEditor();
  const s=draft.find(x=>x.id===editId);
  $('f_bulk').value.split('\n').map(l=>l.trim()).filter(Boolean).forEach(line=>{
    let name='',url='';
    if(line.includes('|')){const i=line.indexOf('|');name=line.slice(0,i).trim();url=line.slice(i+1).trim()}
    else if(/^https?:\/\//i.test(line))url=line;
    else name=line;
    s.episodes.push({name,url});
  });
  renderMgr();
}
$('addSeries').onclick=()=>{
  if(!draft)return;
  pullEditor();
  const s={id:uid(),title:'سلسلة جديدة',subject:'',days:[],playlist:'',episodes:[]};
  draft.push(s);editId=s.id;renderMgr();
  $('f_title').focus();$('f_title').select();
};
async function saveMgr(){
  pullEditor();
  const errs=[];
  draft.forEach(s=>{
    if(!s.title)errs.push('كل سلسلة تحتاج اسماً.');
    if(s.playlist&&!isHttp(s.playlist))errs.push(`رابط القائمة غير صالح في «${s.title}».`);
    if(s.playlist&&isHttp(s.playlist)&&!listId(s.playlist))errs.push(`رابط القائمة في «${s.title}» لا يحوي معرّف list=.`);
    s.episodes.forEach((e,i)=>{if(e.url&&!isHttp(e.url))errs.push(`رابط المقطع ${i+1} في «${s.title}» غير صالح.`)});
  });
  if(errs.length){const e=$('errs');if(e)e.textContent=[...new Set(errs)].join(' ');return}
  const notes=[];
  for(const s of draft){
    const old=data.find(x=>x.id===s.id);
    const changed=!old||old.playlist!==s.playlist;
    if(s.playlist&&listId(s.playlist)&&(changed||!s.episodes.length)){
      try{await syncSeries(s)}catch(e){notes.push(`«${s.title}»: ${e.message}`)}
    }
    s.episodes=s.episodes.filter(e=>e.name||e.url);delete s._open;
  }
  if(notes.length)alert('حُفظت السلاسل، لكن تعذّر جلب المقاطع تلقائياً:\n'+notes.join('\n'));
  data=draft;draft=null;
  store.set(KEY.series,data);
  if(!data.find(s=>s.id===activeId))activeId=(scheduledToday()[0]||data[0]||{}).id;
  $('mgr').hidden=true;
  renderMain();
}
$('mgrBtn').onclick=()=>{$('mgr').hidden?openMgr():($('mgr').hidden=true)};

/* مفتاح API */
$('apiKey').value=apiKey();
$('keySave').onclick=()=>{
  const v=$('apiKey').value.trim();
  store.set(KEY.apikey,v);
  $('keyMsg').textContent=v?'تم حفظ المفتاح. أضف رابط قائمة واضغط «جلب المقاطع».':'تم حذف المفتاح.';
  if(v)autoRefresh();
};

/* نسخة احتياطية */
$('exportBtn').onclick=()=>{
  pullEditor();
  const blob=new Blob([JSON.stringify({series:data,progress:Object.fromEntries(data.map(s=>[s.id,progress(s.id)])),done:store.get(KEY.done,[]),log:store.get(KEY.log,{}),start:store.get(KEY.start,'')},null,2)],{type:'application/json'});
  const a=h('a',{href:URL.createObjectURL(blob),download:'albukur-backup.json'});
  document.body.append(a);a.click();a.remove();
};
$('importBtn').onclick=()=>$('importFile').click();
$('importFile').onchange=e=>{
  const f=e.target.files[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{
    try{
      const j=JSON.parse(r.result);
      if(!Array.isArray(j.series))throw 0;
      data=j.series.map(s=>({id:s.id||uid(),title:String(s.title||''),subject:String(s.subject||''),days:(s.days||[]).filter(d=>d>=0&&d<=6),playlist:String(s.playlist||''),episodes:(s.episodes||[]).map(x=>({name:String(x.name||''),url:String(x.url||'')}))}));
      store.set(KEY.series,data);
      Object.entries(j.progress||{}).forEach(([k,v])=>setProgress(k,+v||0));
      if(Array.isArray(j.done))store.set(KEY.done,j.done);
      if(j.log&&typeof j.log==='object')store.set(KEY.log,j.log);
      if(/^\d{4}-\d{2}-\d{2}$/.test(j.start||''))store.set(KEY.start,j.start);
      $('mgr').hidden=true;activeId=(scheduledToday()[0]||data[0]||{}).id;renderMain();
    }catch(_){alert('الملف غير صالح')}
  };
  r.readAsText(f);e.target.value='';
};

$('userChip').textContent='👤 '+username;
$('logoutBtn').onclick=async()=>{
  clearTimeout(saveT);if(dirty)await flush();
  try{await fetch('/api/logout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})}catch(e){}
  location.reload();
};
/* ===== البدء ===== */
$('dateLine').textContent=`${DAY_NAMES[today]} ${now.toLocaleDateString('ar',{day:'numeric',month:'long',year:'numeric'})}`;
{const f=scheduledToday()[0]||data[0];activeId=f?f.id:null}
drawClock();hourHint();renderMain();autoRefresh();
};
