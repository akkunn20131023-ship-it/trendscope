/* TrendScope 公開版（閲覧専用） */
(function(){
"use strict";
const $=s=>document.querySelector(s);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const DATA_URL = location.pathname.startsWith("/pub/") ? "/pub/api/data" : "/api/data";
const API = location.pathname.startsWith("/pub/") ? "/api" : "/api";   // ローカルプレビューでは本体のAPIを使う
const stars=n=>"★".repeat(n)+"☆".repeat(5-n);
const color=n=>["#46d39a","#7ee0c3","#ffb547","#ff7a5c","#ff5d6c"][n-1];
const ago=t=>{ if(!t) return ""; const s=Date.now()/1000-t; if(s<3600) return Math.max(1,Math.floor(s/60))+"分前"; if(s<86400) return Math.floor(s/3600)+"時間前"; return Math.floor(s/86400)+"日前"; };
const fmtT=t=>t?new Date(t*1000).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"}):"";
function toast(m){ const t=$("#toast"); t.textContent=m; t.classList.add("show"); clearTimeout(t._t); t._t=setTimeout(()=>t.classList.remove("show"),2200); }
const LS={get(k,d){try{return JSON.parse(localStorage.getItem(k))??d}catch{return d}},set(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch{}}};
let D=null, S={tab:"all",q:"",hide:false}, M=null, LY={}, curView="news";
const CATS=[["all","すべて"],["trivia","世界の雑学・へぇ〜"],["tech","テック・未来"],["game","ゲーム・エンタメ"],["bright","明るいニュース"],["world","世界ニュース"]];
const EMOJI={明るい:"😊",暗い:"😔",怒り:"😠",驚き:"😲",不安:"😟"};

/* ---------- データ読み込み ---------- */
async function load(){
  try{
    const r=await fetch(DATA_URL,{cache:"no-cache"}); if(!r.ok) throw new Error(r.status);
    D=await r.json(); D.emoMap=Object.fromEntries((D.emotions?.items||[]).map(x=>[x.id,x.emo]));
    $("#upd").textContent=`${fmtT(D.meta.updated)} 更新・${D.meta.count}件`;
    $("#metaInfo").textContent=`最終更新 ${fmtT(D.meta.built)} ・ 情報源 ${D.meta.sources.filter(s=>s.ok).length}/${D.meta.sources.length} ・ ${D.meta.translate?"見出しは機械翻訳":"翻訳なし（原文表示）"}`;
    buildAnalyzer(D.patterns); render();
    if(curView==="digest") renderDigest(); if(curView==="compare") renderCompare(); if(M) refreshMapData();
  }catch(e){ $("#grid").innerHTML=`<div class="empty">データを読み込めませんでした（${esc(e.message)}）。しばらくしてから再読み込みしてください。</div>`; }
}

/* ---------- ニュース ---------- */
function renderTabs(){
  const cnt=k=>k==="all"?D.news.length:D.news.filter(i=>i.cat===k).length;
  $("#tabs").innerHTML=CATS.map(([k,l])=>`<button class="tab ${S.tab===k?"on":""}" data-k="${k}">${l}<span class="n">${cnt(k)}</span></button>`).join("");
}
function render(){
  if(!D) return; renderTabs();
  let L=S.tab==="all"?D.news:D.news.filter(i=>i.cat===S.tab);
  if(S.q){ const q=S.q.toLowerCase(); L=L.filter(i=>(i.title+" "+i.title_ja+" "+i.source).toLowerCase().includes(q)); }
  if(S.hide) L=L.filter(i=>(i.bait?.stars||1)<4);
  $("#cnt").textContent=L.length+"件";
  $("#grid").innerHTML=L.map(i=>{ const b=i.bait||{stars:1}; const e=D.emoMap[i.id];
    return `<article class="card"><div class="cb">
      <div class="meta"><span class="src">${esc(i.source)}</span>${e&&e!=="中立"?`<span class="emo" title="見出しの感情（機械的な目安）">${EMOJI[e]||""}</span>`:""}<span>${ago(i.time)}</span><span class="badge b${b.stars}" title="${esc(b.label||"")}">煽り ${stars(b.stars)}</span></div>
      <h3 class="tja">${esc(i.title_ja||i.title)}</h3>${i.title_ja&&i.title_ja!==i.title?`<p class="ten">${esc(i.title)}</p>`:""}
      <div class="acts"><a class="ib" href="${esc(i.url)}" target="_blank" rel="noopener nofollow">元記事 ↗</a>${i.disc&&i.disc!==i.url?`<a class="ib" href="${esc(i.disc)}" target="_blank" rel="noopener nofollow">議論 ↗</a>`:""}<button class="ib" data-chk="${esc(i.title)}">🧊 判定</button></div>
    </div></article>`; }).join("")||'<div class="empty">該当するニュースがありません</div>';
}
$("#tabs").onclick=e=>{ const t=e.target.closest(".tab"); if(t){ S.tab=t.dataset.k; render(); } };
$("#q").oninput=e=>{ S.q=e.target.value.trim(); render(); };
$("#hideBait").onchange=e=>{ S.hide=e.target.checked; render(); };
$("#grid").onclick=e=>{ const b=e.target.closest("[data-chk]"); if(b){ $("#inp").value=b.dataset.chk; scrollTo({top:0,behavior:"smooth"}); check(); } };

/* ---------- 釣り判定（ブラウザ内で完結） ---------- */
let RX=[], LABELS={}, CAPS_OK=new Set();
function buildAnalyzer(p){
  if(!p) return; LABELS=p.labels; CAPS_OK=new Set(p.caps_ok);
  RX=p.patterns.map(([pat,w,cat,rem,lang])=>{ try{ return {rx:new RegExp(pat.replace(/\(\?i\)/g,""), lang==="en"?"gi":"g"), w, cat, rem, lang}; }catch{ return null; } }).filter(Boolean);
}
const isJa=t=>/[぀-ヿ一-鿿]/.test(t);
function score(text){
  const spans=[], cats={}, used=[]; let sc=0;
  const order=isJa(text)? [...RX.filter(r=>r.lang==="ja"),...RX.filter(r=>r.lang==="en")] : [...RX.filter(r=>r.lang==="en"),...RX.filter(r=>r.lang==="ja")];
  for(const r of order){ r.rx.lastIndex=0; let m; while((m=r.rx.exec(text))){ if(!m[0]){ r.rx.lastIndex++; continue; } const s=m.index,e=s+m[0].length;
      if(!used.some(([a,b])=>s<b&&a<e)){ used.push([s,e]); spans.push({s,e,cat:r.cat}); sc+=r.w; cats[r.cat]=(cats[r.cat]||0)+r.w; } } }
  const reasons=[];
  const ex=(text.match(/[!！]/g)||[]).length, qu=(text.match(/[?？]/g)||[]).length;
  if(ex>=2){ sc+=Math.min(20,ex*4); reasons.push(`感嘆符「!」が${ex}個（感情をあおる記号の多用）`); } else if(ex===1) sc+=3;
  if(qu>=2){ sc+=Math.min(14,qu*4); reasons.push(`疑問符「?」が${qu}個`); }
  const caps=(text.match(/\b[A-Z]{4,}\b/g)||[]).filter(c=>!CAPS_OK.has(c)); if(caps.length){ sc+=Math.min(18,6*caps.length); reasons.push("全部大文字の強調語: "+caps.slice(0,4).join(", ")); }
  const emo=(text.match(/[\u{1F300}-\u{1FAFF}☀-➿]/gu)||[]).length; if(emo>=2){ sc+=Math.min(15,4*emo); reasons.push(`絵文字が${emo}個`); }
  const br=text.match(/【[^】]{1,30}】|\[[^\]]{1,30}\]/g)||[]; if(br.length){ sc+=Math.min(16,8*br.length); reasons.push("隅付き括弧で強調: "+br.slice(0,3).join(" ")); }
  if(/(…|\.\.\.|・・・)\s*$/.test(text)){ sc+=10; reasons.push("「…」で終わる（続きが気になる寸止め型）"); }
  Object.entries(cats).sort((a,b)=>b[1]-a[1]).forEach(([c])=>{ const w=[...new Set(spans.filter(x=>x.cat===c).map(x=>text.slice(x.s,x.e)))]; reasons.unshift(`${c}: 「${w.join("」「")}」`); });
  sc=Math.max(0,Math.min(100,sc)); const st=sc<12?1:sc<30?2:sc<50?3:sc<70?4:5;
  return {score:sc, stars:st, spans, reasons};
}
function highlight(t,spans){ let o="",last=0; spans.sort((a,b)=>a.s-b.s).forEach(x=>{ if(x.s<last) return; o+=esc(t.slice(last,x.s))+`<mark title="${esc(x.cat)}">${esc(t.slice(x.s,x.e))}</mark>`; last=x.e; }); return o+esc(t.slice(last)); }
function check(){
  const v=$("#inp").value.trim(); if(!v) return; if(!RX.length) return toast("判定ルールを読み込み中です");
  const r=score(v), c=color(r.stars);
  $("#res").className="result show";
  $("#res").innerHTML=`<div class="rtop"><div class="meter" style="background:conic-gradient(${c} ${r.score*3.6}deg,#222b3a 0)"><div style="position:absolute;inset:7px;background:#121822;border-radius:50%;display:grid;place-items:center"><div style="color:${c}">${r.score}<small>釣り度/100</small></div></div></div>
    <div style="flex:1;min-width:220px"><div class="stars" style="color:${c}">${stars(r.stars)} <span style="font-size:15px;font-weight:700">${esc(LABELS[r.stars]||"")}</span></div></div></div>
    <div class="rgrid"><div class="box full"><h3>誇張されている箇所</h3><div class="hl">${highlight(v,r.spans)}</div></div>
    <div class="box full"><h3>判定の理由</h3><ul>${(r.reasons.length?r.reasons:["目立った煽り表現は見つかりませんでした"]).map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div></div>`;
}
$("#go").onclick=check; $("#inp").onkeydown=e=>{ if(e.key==="Enter"&&(e.ctrlKey||e.metaKey)) check(); };

/* ---------- 画面切り替え ---------- */
function showView(v){
  curView=v; document.querySelectorAll(".vbtn").forEach(b=>b.classList.toggle("on",b.dataset.v===v));
  document.querySelectorAll(".view").forEach(el=>el.classList.toggle("on",el.id==="view-"+v));
  if(v==="map") initMap(); if(v==="digest"&&D) renderDigest(); if(v==="compare"&&D) renderCompare();
  history.replaceState(null,"",v==="news"?location.pathname:`#${v}`);
}
$("#views").onclick=e=>{ const b=e.target.closest(".vbtn"); if(b) showView(b.dataset.v); };

/* ---------- ダイジェスト ---------- */
const spark=(arr,w=80,h=20)=>{ if(!arr||arr.length<2) return ""; const mn=Math.min(...arr),mx=Math.max(...arr),r=mx-mn||1; return `<svg width="${w}" height="${h}" class="spk"><polyline points="${arr.map((v,i)=>`${(i/(arr.length-1)*w).toFixed(1)},${(h-(v-mn)/r*h).toFixed(1)}`).join(" ")}" fill="none" stroke="${arr[arr.length-1]>=arr[0]?"#46d39a":"#ff5d6c"}" stroke-width="1.6"/></svg>`; };
function renderDigest(){
  const d=D.digest, three=["world","tech","trivia"].map(k=>d.categories?.[k]?.items?.[0]).filter(Boolean);
  const mx=Math.max(1,...(d.top_countries||[]).map(c=>c.count));
  const em=D.emotions; const et=Object.entries(em?.total||{}).filter(([k])=>k!=="中立"); const es=et.reduce((a,b)=>a+b[1],0)||1;
  const mk=D.markets?.markets||[]; const wk=(D.wiki?.ja||[]).filter(a=>!/メインページ|特別:/.test(a.title)).slice(0,10);
  const hol=D.holidays||{}; const lc=(D.launches?.launches||[]).slice(0,4);
  $("#dgrid").innerHTML=`
    <div class="dcard wide"><h3>🌏 いまの世界を3行で <span class="mtag">${fmtT(D.meta.updated)} 時点</span></h3><ol style="margin:0;padding-left:22px;font-size:15.5px;line-height:1.9">${three.map(i=>`<li><a href="${esc(i.url)}" target="_blank" rel="noopener nofollow">${esc(i.title_ja||i.title)}</a> <span class="mtag">（${esc(i.source)}）</span></li>`).join("")}</ol></div>
    <div class="dcard"><h3>📍 話題になっている国</h3>${(d.top_countries||[]).map(c=>`<div class="bar"><span class="l">${esc(c.ja)}</span><span class="b" style="width:${c.count/mx*60}%"></span><span class="mtag">${c.count}</span></div>`).join("")}</div>
    <div class="dcard"><h3>🌈 今日の世界のムード</h3><div class="mood">${et.map(([k,v])=>`<i style="flex:${v};background:${em.colors[k]}" title="${k}"></i>`).join("")}</div><div class="samples" style="margin-top:6px">${et.sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="chip">${EMOJI[k]} ${k} ${Math.round(v/es*100)}%</span>`).join("")}</div><p class="mtag">英語見出しの言葉から機械的に分類した目安です</p></div>
    <div class="dcard"><h3>⚔ 紛争関連の報道</h3><ul class="dl">${(d.conflicts_in_news||[]).map(c=>`<li><b>${esc(c.name)}</b> <span class="mtag">${esc(c.level_ja)}・${c.count}件</span>${c.headline?`<div class="m">${esc(c.headline)}</div>`:""}</li>`).join("")||'<li class="mtag">該当なし</li>'}</ul></div>
    ${mk.length?`<div class="dcard"><h3>📈 マーケット</h3><table class="mkt">${mk.filter(m=>m.price!=null).map(m=>`<tr><td>${esc(m.name)}</td><td class="r">${Number(m.price).toLocaleString("ja-JP",{maximumFractionDigits:2})}</td><td class="r ${m.pct>=0?"up":"dn"}">${m.pct>=0?"+":""}${m.pct.toFixed(2)}%</td><td>${spark(m.spark)}</td></tr>`).join("")}</table><p class="mtag">公開データの遅延値です。投資判断には使わないでください</p></div>`:""}
    ${wk.length?`<div class="dcard"><h3>📚 ウィキペディア急上昇（日本語版）</h3><ol class="wk">${wk.map(a=>`<li><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.title)}</a> <span class="mtag">${a.views.toLocaleString()}回</span><div class="m mtag">${esc(a.desc||"")}</div></li>`).join("")}</ol><p class="mtag">出典: Wikipedia（閲覧数）</p></div>`:""}
    ${(hol.today||hol.onthisday)?`<div class="dcard"><h3>🎌 今日は何の日</h3><div class="mtag">${(hol.today||[]).length?"今日が祝日: "+[...new Map(hol.today.map(t=>[t.code,t])).values()].map(t=>`${esc(t.country)}（${esc(t.name)}）`).join("、"):"今日が祝日の国はありません"}</div><ul class="dl">${(hol.onthisday||[]).slice(0,5).map(e=>`<li><b>${e.year}年</b> ${esc(e.text)}</li>`).join("")}</ul><p class="mtag">出典: Wikipedia「On this day」（CC BY-SA）・Nager.Date</p></div>`:""}
    ${lc.length?`<div class="dcard"><h3>🚀 ロケット打ち上げ予定</h3><ul class="dl">${lc.map(l=>`<li><b>${esc(l.name)}</b><div class="m mtag">${esc(l.provider)} ・ ${esc(l.location)} ・ ${new Date(l.net).toLocaleString("ja-JP")}</div></li>`).join("")}</ul><p class="mtag">出典: Launch Library 2</p></div>`:""}`;
}

/* ---------- 温度差 ---------- */
function renderCompare(){
  const c=D.compare||{}; const bars=r=>{ const mx=Math.max(r.foreign_pct||0,r.japan_pct||0,1); return `<div class="tbar"><span>海外</span><i style="width:${(r.foreign_pct||0)/mx*100}%;background:var(--acc)"></i><em class="mtag">${r.foreign}件</em></div><div class="tbar"><span>日本</span><i style="width:${(r.japan_pct||0)/mx*100}%;background:#ff8fd1"></i><em class="mtag">${r.japan}件</em></div>`; };
  $("#cmp").innerHTML=`<div class="dcard wide"><h3>🗾 海外と日本の「温度差」</h3><p style="margin:0;font-size:14px">海外ニュース${c.foreign_total||0}件と日本の主要ニュース${c.jp_total||0}件の見出しを比べ、取り上げられ方の差を件数で示しています。</p></div>
    <div class="dcard"><h3>🔇 海外で話題・日本ではほぼ報じられていない</h3>${(c.quiet_in_japan||[]).map(r=>`<div class="trow"><b>${esc(r.topic)}</b>${bars(r)}</div>`).join("")||'<p class="mtag">データなし</p>'}</div>
    <div class="dcard"><h3>📢 海外でも日本でも報じられている</h3>${(c.both||[]).map(r=>`<div class="trow"><b>${esc(r.topic)}</b>${bars(r)}</div>`).join("")||'<p class="mtag">データなし</p>'}</div>
    <div class="dcard"><h3>🗾 日本でだけ話題の国</h3>${(c.japan_only||[]).map(r=>`<div class="trow"><b>${esc(r.topic)}</b> <span class="mtag">日本${r.japan}件</span></div>`).join("")||'<p class="mtag">データなし</p>'}</div>`;
}

/* ---------- 世界マップ ---------- */
const LAYERS=[["conflicts","#ff5d6c","紛争・対立地域",true],["news","#5b9dff","ニュースの話題地",true],["quakes","#ff9f43","地震（24時間・M2.5+）",false],
  ["weather","#90caf9","世界の天気と現地時刻",false],["air","#9ccc65","空気の質（AQI）",false],["iss","#b18cff","国際宇宙ステーション",false],
  ["planes","#ffd34d","飛行機（地図の中心付近）",false],["launch","#ffab40","ロケット打ち上げ予定",false],["night","#3949ab","昼と夜の境界線",true]];
const LVC={war:"#ff3b4f",high:"#ff6b3d",mid:"#ffb547",tension:"#c9a6ff"};
const CITIES=[["東京",35.68,139.69],["ソウル",37.57,126.98],["北京",39.9,116.4],["シンガポール",1.35,103.82],["ニューデリー",28.61,77.21],["ドバイ",25.2,55.27],["モスクワ",55.75,37.62],["キーウ",50.45,30.52],["カイロ",30.04,31.24],["ナイロビ",-1.29,36.82],["パリ",48.86,2.35],["ロンドン",51.51,-0.13],["ニューヨーク",40.71,-74.0],["ロサンゼルス",34.05,-118.24],["メキシコシティ",19.43,-99.13],["サンパウロ",-23.55,-46.63],["シドニー",-33.87,151.21],["ヨハネスブルグ",-26.2,28.05]];
const side=html=>{ $("#sideBody").innerHTML=html; $("#side").classList.add("show"); };
$("#sideX").onclick=()=>$("#side").classList.remove("show");
$("#fold").onclick=()=>$("#layers").classList.toggle("folded");
function initMap(){
  if(M){ setTimeout(()=>M.invalidateSize(),50); return; }
  M=L.map("map",{worldCopyJump:true,zoomControl:false,minZoom:2}).setView([30,40],3);
  L.control.zoom({position:"bottomright"}).addTo(M);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}",{attribution:"Tiles &copy; Esri",maxZoom:16}).addTo(M);
  L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}",{maxZoom:16}).addTo(M);
  const saved=LS.get("pubLayers",{});
  $("#layerList").innerHTML=LAYERS.map(([k,c,l,def])=>`<label><input type="checkbox" data-layer="${k}" ${(saved[k]??def)?"checked":""}><span class="lg" style="background:${c}"></span>${l}<span class="c" id="c-${k}"></span></label>`).join("");
  LAYERS.forEach(([k])=>LY[k]=L.layerGroup());
  document.querySelectorAll("#layerList input").forEach(cb=>{ cb.onchange=()=>{ toggle(cb.dataset.layer,cb.checked); saved[cb.dataset.layer]=cb.checked; LS.set("pubLayers",saved); }; toggle(cb.dataset.layer,cb.checked); });
  M.on("moveend",()=>{ if(M.hasLayer(LY.planes)) loadPlanes(); });
  if(innerWidth<720) $("#layers").classList.add("folded");
}
const timers={};
function toggle(k,on){
  clearInterval(timers[k]); if(!on){ M.removeLayer(LY[k]); $("#c-"+k).textContent=""; return; }
  LY[k].addTo(M); LOAD[k](); const every={quakes:120000,iss:5000,planes:20000,night:60000,weather:900000,air:1800000}[k];
  if(every) timers[k]=setInterval(()=>{ if(curView==="map" && !document.hidden) LOAD[k](); }, every);
}
function refreshMapData(){ ["conflicts","news","launch"].forEach(k=>{ if(M.hasLayer(LY[k])) LOAD[k](); }); }
const getJ=async u=>{ const r=await fetch(u); if(!r.ok) throw new Error(r.status); return r.json(); };
const LOAD={
  conflicts(){ if(!D) return; LY.conflicts.clearLayers(); (D.conflicts?.conflicts||[]).forEach(c=>{ const col=LVC[c.level];
    L.circleMarker([c.lat,c.lon],{radius:{war:11,high:9,mid:7,tension:6}[c.level],color:col,fillColor:col,fillOpacity:.55,weight:2}).addTo(LY.conflicts)
     .on("click",()=>side(`<h3>⚔ ${esc(c.name)}</h3><span class="lv" style="background:${col}33;color:${col}">${esc(c.level_ja)}</span><span class="mtag">${esc(c.since)}</span><p style="font-size:14px">${esc(c.desc)}</p><div><b>対立している勢力：</b>${c.parties.map(esc).join(" ⇄ ")}</div><h4>📰 関連ニュース</h4><ul class="dl">${(c.news||[]).map(n=>`<li><a href="${esc(n.url)}" target="_blank" rel="noopener nofollow">${esc(n.title_ja||"記事を開く")}</a><div class="m mtag">${esc(n.source)}</div></li>`).join("")||'<li class="mtag">収集したニュースにはありません</li>'}</ul><p class="mtag">${esc(D.conflicts.note||"")}</p>`)).bindTooltip(`⚔ ${esc(c.name)}`);
    if(c.arc) L.polyline(c.arc,{color:col,weight:2,opacity:.7,dashArray:"8 6"}).addTo(LY.conflicts); });
    $("#c-conflicts").textContent=(D.conflicts?.conflicts||[]).length+"地域"; },
  news(){ if(!D) return; LY.news.clearLayers(); (D.geo?.countries||[]).forEach(c=>{
    L.circleMarker([c.lat,c.lon],{radius:6+Math.sqrt(c.items.length)*4,color:"#5b9dff",weight:2,fillOpacity:.3}).addTo(LY.news).bindTooltip(`${esc(c.ja)}：${c.items.length}件`)
     .on("click",()=>side(`<h3>📍 ${esc(c.ja)} の話題</h3><ul class="dl">${c.items.map(i=>`<li><a href="${esc(i.url)}" target="_blank" rel="noopener nofollow">${esc(i.title_ja||i.title)}</a><div class="m mtag">${esc(i.source)} ・ ${fmtT(i.time)}</div></li>`).join("")}</ul>`)); });
    $("#c-news").textContent=(D.geo?.countries||[]).length+"か国"; },
  async quakes(){ try{ const j=await getJ("https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson"); LY.quakes.clearLayers();
    j.features.forEach(f=>{ const p=f.properties,g=f.geometry.coordinates,m=p.mag||0; L.circleMarker([g[1],g[0]],{radius:3+m*2,color:m>=6?"#ff3b4f":m>=4.5?"#ff9f43":"#ffd34d",weight:1.5,fillOpacity:.3}).addTo(LY.quakes).bindPopup(`<b>M${m.toFixed(1)}</b> ${esc(p.place)}<br>${new Date(p.time).toLocaleString("ja-JP")}`); });
    $("#c-quakes").textContent=j.features.length+"件"; }catch{ $("#c-quakes").textContent="失敗"; } },
  async weather(){ try{ const j=await getJ("https://api.open-meteo.com/v1/forecast?latitude="+CITIES.map(c=>c[1]).join(",")+"&longitude="+CITIES.map(c=>c[2]).join(",")+"&current=temperature_2m,weather_code&timezone=auto"); LY.weather.clearLayers();
    const W={0:"☀",1:"🌤",2:"⛅",3:"☁",45:"🌫",61:"🌧",63:"🌧",65:"🌧",71:"🌨",80:"🌦",95:"⛈"};
    (Array.isArray(j)?j:[j]).forEach((w,i)=>{ const d=new Date(Date.now()+w.utc_offset_seconds*1000); const t=`${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`;
      L.marker([CITIES[i][1],CITIES[i][2]],{icon:L.divIcon({className:"",html:`<div class="wx"><b>${W[w.current.weather_code]||"🌡"} ${Math.round(w.current.temperature_2m)}°</b><span>${CITIES[i][0]} ${t}</span></div>`,iconSize:[86,34],iconAnchor:[43,17]})}).addTo(LY.weather); });
    $("#c-weather").textContent=CITIES.length+"都市"; }catch{ $("#c-weather").textContent="失敗"; } },
  async air(){ try{ const j=await getJ("https://air-quality-api.open-meteo.com/v1/air-quality?latitude="+CITIES.map(c=>c[1]).join(",")+"&longitude="+CITIES.map(c=>c[2]).join(",")+"&current=us_aqi,pm2_5"); LY.air.clearLayers();
    const col=a=>a==null?"#666":a<=50?"#46d39a":a<=100?"#ffd34d":a<=150?"#ff9f43":a<=200?"#ff5d6c":"#b44dff";
    (Array.isArray(j)?j:[j]).forEach((w,i)=>{ const a=w.current?.us_aqi; L.circleMarker([CITIES[i][1],CITIES[i][2]],{radius:9,color:col(a),fillColor:col(a),fillOpacity:.55,weight:1}).addTo(LY.air).bindTooltip(`${CITIES[i][0]} AQI ${a??"—"} / PM2.5 ${w.current?.pm2_5??"—"}`); });
    $("#c-air").textContent=CITIES.length+"都市"; }catch{ $("#c-air").textContent="失敗"; } },
  async iss(){ try{ const d=await getJ("https://api.wheretheiss.at/v1/satellites/25544"); LY.iss.clearLayers(); L.marker([d.latitude,d.longitude],{icon:L.divIcon({className:"",html:'<div style="font-size:22px">🛰</div>',iconSize:[24,24],iconAnchor:[12,12]})}).addTo(LY.iss).bindPopup(`ISS 高度${Math.round(d.altitude)}km`); $("#c-iss").textContent=`高度${Math.round(d.altitude)}km`; }catch{ $("#c-iss").textContent="失敗"; } },
  planes(){ loadPlanes(); },
  launch(){ if(!D) return; LY.launch.clearLayers(); (D.launches?.launches||[]).filter(l=>l.lat!=null).forEach(l=>L.marker([l.lat,l.lon],{icon:L.divIcon({className:"",html:'<div style="font-size:18px">🚀</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(LY.launch).bindPopup(`<b>${esc(l.name)}</b><br>${esc(l.provider)}<br>${new Date(l.net).toLocaleString("ja-JP")}`)); $("#c-launch").textContent=(D.launches?.launches||[]).length+"件"; },
  night(){ LY.night.clearLayers(); L.polygon(nightPolygon(new Date()),{stroke:false,fillColor:"#000814",fillOpacity:.38,interactive:false}).addTo(LY.night); },
};
function nightPolygon(date){
  const R=Math.PI/180, n=date/86400000+2440587.5-2451545.0, gst=(18.697374558+24.06570982441908*n)%24;
  const Lm=(280.46+0.9856474*n)%360, g=(357.528+0.9856003*n)%360, lam=Lm+1.915*Math.sin(g*R)+0.02*Math.sin(2*g*R), eps=23.4393-0.0000004*n;
  const alpha=Math.atan2(Math.cos(eps*R)*Math.sin(lam*R),Math.cos(lam*R))/R, delta=Math.asin(Math.sin(eps*R)*Math.sin(lam*R))/R, pts=[];
  for(let lng=-360;lng<=360;lng+=2){ const ha=(gst*15+lng)-alpha; pts.push([Math.atan(-Math.cos(ha*R)/Math.tan(delta*R))/R,lng]); }
  const pole=delta<0?90:-90; return [[pole,-360],...pts,[pole,360]];
}

/* ---------- 飛行機：回数制限＋ロボット対策（Turnstile）つき ---------- */
let TS=null, tsOk=false, planeBusy=false;
async function ensureHuman(){
  if(tsOk) return true;
  if(!TS){ try{ TS=await getJ(API+"/config"); }catch{ TS={}; } }
  if(!TS.turnstile_sitekey){ tsOk=true; return true; }
  if(!window.turnstile) await new Promise((ok,ng)=>{ const s=document.createElement("script"); s.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.onload=ok; s.onerror=ng; document.head.appendChild(s); });
  const token=await new Promise(res=>{ $("#tsBox").innerHTML=""; window.turnstile.render("#tsBox",{sitekey:TS.turnstile_sitekey, callback:res, "error-callback":()=>res(null)}); });
  if(!token) return false;
  const r=await fetch(API+"/verify",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({token})});
  tsOk=r.ok; setTimeout(()=>$("#tsBox").innerHTML="",1500); return tsOk;
}
async function loadPlanes(){
  if(planeBusy||!M) return; planeBusy=true;
  try{
    if(!(await ensureHuman())){ $("#c-planes").textContent="確認に失敗"; return; }
    const c=M.getCenter(); const lat=c.lat.toFixed(1), lon=((((c.lng+180)%360)+360)%360-180).toFixed(1);
    const r=await fetch(`${API}/planes?lat=${lat}&lon=${lon}`);
    if(r.status===429){ $("#c-planes").textContent="少し待って"; toast("アクセスが集中しています。少し待ってから地図を動かしてください"); return; }
    if(r.status===403){ tsOk=false; return; }
    const d=await r.json(); LY.planes.clearLayers();
    (d.planes||[]).slice(0,800).forEach(p=>L.marker([p.lat,p.lon],{icon:L.divIcon({className:"",html:`<svg class="plane" width="16" height="16" viewBox="0 0 24 24" style="transform:rotate(${p.track||0}deg)"><path fill="currentColor" d="M12 2c.8 0 1.3.9 1.3 2v5.2l7.7 4.6v2l-7.7-2.3v4.3l2.2 1.6V21L12 20l-3.5 1v-1.6l2.2-1.6v-4.3L3 15.8v-2l7.7-4.6V4c0-1.1.5-2 1.3-2z"/></svg>`,iconSize:[16,16],iconAnchor:[8,8]})}).addTo(LY.planes).bindPopup(`✈ ${esc(p.call||"")}<br>高度 ${p.alt_m} m ・ ${p.spd_kmh} km/h`));
    $("#c-planes").textContent=(d.planes||[]).length+"機"; $("#mnote").textContent="飛行機は地図の中心から半径約460km（データ: adsb.lol）";
  }catch(e){ $("#c-planes").textContent="失敗"; }
  finally{ planeBusy=false; }
}

/* ---------- 起動 ---------- */
load(); setInterval(()=>{ if(!document.hidden) load(); }, 10*60*1000);
const h0=location.hash.slice(1); if(["map","digest","compare"].includes(h0)) showView(h0);
})();
