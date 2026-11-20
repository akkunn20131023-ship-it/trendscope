/* TrendScope 追加機能 第3弾 */
(function(){
"use strict";
const h=(t,a={},html="")=>{const e=document.createElement(t);Object.assign(e,a);if(html)e.innerHTML=html;return e;};
function modal3(title, html){ $("#mBody").innerHTML=`<h2>${title}</h2>${html}`; $("#modal").classList.add("show"); }
const fmtBig=v=>v>=1e12?(v/1e12).toFixed(2)+"兆":v>=1e8?(v/1e8).toFixed(1)+"億":v>=1e4?(v/1e4).toFixed(0)+"万":Number(v).toLocaleString("ja-JP",{maximumFractionDigits:1});

/* ============ 16. テーマ・文字サイズ ============ */
const VIEW = LS.get("viewPrefs",{theme:"dark",scale:1});
function applyView(){
  document.documentElement.dataset.theme=VIEW.theme;
  document.querySelectorAll("#view-news,#view-digest,#view-compare,#view-archive").forEach(el=>el.style.zoom=VIEW.scale);
}
const themeBtn=h("button",{className:"btn",title:"テーマ・文字サイズ"},"🌓");
document.querySelector(".status").insertBefore(themeBtn, $("#gearBtn"));
themeBtn.onclick=()=>{
  modal3("🌓 表示設定",`<section class="sec"><h3>テーマ</h3><div class="samples"><button class="chip ${VIEW.theme==="dark"?"on":""}" data-th="dark">🌙 ダーク</button><button class="chip ${VIEW.theme==="light"?"on":""}" data-th="light">☀ ライト</button></div></section>
   <section class="sec"><h3>文字の大きさ（地図以外）</h3><div class="samples">${[[0.9,"小"],[1,"標準"],[1.15,"大"],[1.3,"特大"]].map(([v,l])=>`<button class="chip ${VIEW.scale==v?"on":""}" data-sc="${v}">${l}</button>`).join("")}</div></section>`);
  document.querySelectorAll("[data-th]").forEach(b=>b.onclick=()=>{ VIEW.theme=b.dataset.th; LS.set("viewPrefs",VIEW); applyView(); themeBtn.onclick(); });
  document.querySelectorAll("[data-sc]").forEach(b=>b.onclick=()=>{ VIEW.scale=parseFloat(b.dataset.sc); LS.set("viewPrefs",VIEW); applyView(); themeBtn.onclick(); });
};

/* ============ 15. 保存庫ビュー＋6. 続報 ============ */
document.querySelector("#views").appendChild(h("button",{className:"vbtn"},"🗄 保存庫")).dataset.v="archive";
const av=h("section",{className:"view wrap",id:"view-archive"},`
  <div class="dgrid">
    <div class="dcard wide"><h3>🗄 ニュース保存庫 <span class="mtag" id="arStat"></span></h3>
      <div class="row"><input id="arQ" placeholder="キーワード（日本語・英語OK。例: ウクライナ / SpaceX / 地震）" style="flex:1">
      <select id="arCat" class="selx"><option value="">全カテゴリ</option><option value="world">世界ニュース</option><option value="tech">テック</option><option value="trivia">雑学</option><option value="bright">明るい</option><option value="game">ゲーム</option></select>
      <select id="arDays" class="selx"><option value="0">全期間</option><option value="1">24時間</option><option value="7">1週間</option><option value="30">1か月</option></select>
      <button class="btn pri" id="arGo">検索</button></div>
      <div id="arRes" class="mtag">これまでに集めたニュースがすべてここに保存されています。</div></div>
    <div class="dcard wide"><h3>📡 続報を追跡中の話題</h3><p class="mtag">ニュースカードの「🔔 続報」を押すと、その話題の新しい報道を30分ごとに探して通知します（Discord/LINEにも送れます）。</p>
      <div id="flw" class="mtag">読み込み中…</div><button class="btn" id="flwNow" style="margin-top:6px">🔄 今すぐ続報を確認</button></div>
  </div>`);
document.body.insertBefore(av, $("#toast"));
const _ovs=window.onViewShown;
window.onViewShown=v=>{ if(_ovs) _ovs(v); applyView(); if(v==="archive"){ arSearch(); loadFollows(); } };
async function arSearch(){
  const q=$("#arQ").value.trim(), cat=$("#arCat").value, days=$("#arDays").value;
  $("#arRes").innerHTML='<div class="spin" style="margin:10px 0"></div>';
  try{
    const r=await api(`/api/archive?q=${encodeURIComponent(q)}&cat=${cat}&days=${days}`);
    $("#arStat").textContent=`全${r.total.toLocaleString()}件・${r.oldest?new Date(r.oldest*1000).toLocaleDateString("ja-JP"):""}〜${r.fts?"・全文検索":""}`;
    $("#arRes").innerHTML=r.results.length?`<div class="mtag">${r.results.length}件${r.results.length>=100?"（新しい順に100件まで）":""}</div><ul class="dl">${r.results.map(x=>`<li>${esc(x.title_ja||x.title)}${x.title_ja&&x.title_ja!==x.title?`<div class="m">${esc(x.title)}</div>`:""}<div class="m">${esc(x.source)} ・ ${fmtT(x.time)} ・ <a href="${esc(x.url)}" target="_blank" rel="noopener">元記事↗</a></div></li>`).join("")}</ul>`:'<p>見つかりませんでした。日本語は3文字以上だと全文検索、2文字以下は部分一致で探します。</p>';
  }catch(e){ $("#arRes").textContent="検索に失敗: "+e.message; }
}
$("#arGo").onclick=arSearch; $("#arQ").onkeydown=e=>{ if(e.key==="Enter") arSearch(); };
async function loadFollows(){
  try{
    const r=await api("/api/follows");
    $("#flw").innerHTML=r.follows.length? r.follows.map(f=>`<div class="flw"><div class="row" style="justify-content:space-between"><b>📡 ${esc(f.title_ja)}</b><button class="ib" data-unf="${esc(f.id)}">追跡をやめる</button></div>
      <div class="mtag">検索語: ${esc(f.query)} ・ 最終確認 ${f.last_check?fmtT(f.last_check):"未"} ・ 続報 ${f.hits.length}件</div>
      <ul class="dl">${f.hits.slice(0,5).map(x=>`<li>${esc(x.title_ja)}<div class="m">${esc(x.source)} ・ ${fmtT(x.time)} ・ <a href="${esc(x.url)}" target="_blank" rel="noopener">開く↗</a></div></li>`).join("")||'<li class="mtag">まだ続報はありません</li>'}</ul></div>`).join("") : "追跡中の話題はありません";
    document.querySelectorAll("[data-unf]").forEach(b=>b.onclick=async()=>{ await api("/api/unfollow",{id:b.dataset.unf}); loadFollows(); decorate3(); });
    FOLLOWED=new Set(r.follows.map(f=>f.id)); decorate3();
  }catch(e){ $("#flw").textContent="読み込み失敗"; }
}
$("#flwNow").onclick=async()=>{ $("#flwNow").disabled=true; toast("続報を確認しています…"); try{ await api("/api/follow/check",{}); await loadFollows(); toast("確認しました"); }catch{} $("#flwNow").disabled=false; };
let FOLLOWED=new Set(); api("/api/follows").then(r=>{ FOLLOWED=new Set(r.follows.map(f=>f.id)); decorate3(); }).catch(()=>{});

/* ============ カード装飾：続報・信頼メモ・感情・用語 ============ */
let TRUST=LS.get("trust",{}), EMO={}, GL={terms:[],dict:{}};
const TRUST_L={good:["✅","信頼"],warn:["⚠","要注意"],mid:["・","普通"]};
function decorate3(){
  document.querySelectorAll("#grid .card").forEach(c=>{
    const id=c.dataset.id, it=[...S.items,...S.favs].find(x=>x.id===id);
    const acts=c.querySelector(".acts");
    if(acts && !acts.querySelector('[data-act3="follow"]')){
      const sp=acts.querySelector(".sp");
      const f=h("button",{className:"ib",title:"この話題の続報を追跡して通知"},"🔔 続報"); f.dataset.act3="follow";
      const t=h("button",{className:"ib",title:"この発信元に信頼メモを付ける"},"🏷"); t.dataset.act3="trust";
      acts.insertBefore(f,sp); acts.insertBefore(t,sp);
    }
    const fb=c.querySelector('[data-act3="follow"]'); if(fb){ fb.classList.toggle("on",FOLLOWED.has(id)); fb.textContent=FOLLOWED.has(id)?"🔔 追跡中":"🔔 続報"; }
    const src=c.querySelector(".src");
    if(src && it){
      const tr=TRUST[it.source]; src.querySelector(".tb")?.remove();
      if(tr && tr.label!=="mid"){ const b=h("span",{className:"tb "+tr.label,title:tr.note||""},TRUST_L[tr.label][0]); src.appendChild(b); }
      if(EMO[id] && EMO[id]!=="中立" && !c.querySelector(".emo")){ const e=h("span",{className:"emo",title:"見出しの感情（機械的な目安）"},{明るい:"😊",暗い:"😔",怒り:"😠",驚き:"😲",不安:"😟"}[EMO[id]]||""); src.after(e); }
    }
    if(GL.terms.length && !c.dataset.gl){ c.dataset.gl=1; c.querySelectorAll(".tja,.desc").forEach(markTerms); }
  });
}
function markTerms(el){
  const rx=new RegExp("("+GL.terms.map(t=>t.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")+")");
  const walk=[...el.childNodes].filter(n=>n.nodeType===3);
  walk.forEach(n=>{
    const parts=n.textContent.split(rx); if(parts.length<2) return;
    const frag=document.createDocumentFragment(); const used=new Set();
    parts.forEach((p,i)=>{ if(i%2===1 && !used.has(p)){ used.add(p); const s=h("span",{className:"gl",title:GL.dict[p]},p); s.dataset.t=p; frag.appendChild(s); } else frag.appendChild(document.createTextNode(p)); });
    n.replaceWith(frag);
  });
}
new MutationObserver(()=>decorate3()).observe($("#grid"),{childList:true});
api("/api/glossary").then(g=>{ GL=g; decorate3(); }).catch(()=>{});
async function loadEmo(){ try{ const r=await api("/api/emotions"); EMO=Object.fromEntries(r.items.map(x=>[x.id,x.emo])); window._EMO_DATA=r; decorate3(); }catch{} }
loadEmo(); setInterval(loadEmo, 300000);
$("#grid").addEventListener("click", async e=>{
  const b=e.target.closest("[data-act3]"); if(!b) return; e.stopPropagation();
  const it=[...S.items,...S.favs].find(x=>x.id===b.closest(".card").dataset.id); if(!it) return;
  if(b.dataset.act3==="follow"){
    if(FOLLOWED.has(it.id)){ await api("/api/unfollow",{id:it.id}); FOLLOWED.delete(it.id); toast("追跡をやめました"); }
    else { await api("/api/follow",{item:it}); FOLLOWED.add(it.id); toast("🔔 続報の追跡を始めました（保存庫タブで確認できます）"); }
    decorate3();
  }
  if(b.dataset.act3==="trust") trustEdit(it.source);
}, true);
function trustEdit(source){
  const t=TRUST[source]||{label:"mid",note:""};
  modal3("🏷 発信元の信頼メモ",`<p><b>${esc(source)}</b> にあなた自身の評価とメモを付けます（この端末だけに保存）。ニュース一覧の発信元に印が出ます。</p>
    <div class="samples">${Object.entries(TRUST_L).map(([k,[i,l]])=>`<button class="chip ${t.label===k?"on":""}" data-tl="${k}">${i} ${l}</button>`).join("")}</div>
    <div class="row"><input id="tNote" value="${esc(t.note||"")}" placeholder="メモ（例: 見出しは盛るが本文は正確）" style="flex:1"></div>
    <div class="row" style="justify-content:flex-end"><button class="btn pri" id="tSave">保存</button></div>
    <h4>これまでのメモ</h4><ul class="dl">${Object.entries(TRUST).map(([s,v])=>`<li>${TRUST_L[v.label][0]} <b>${esc(s)}</b> ${esc(v.note||"")}</li>`).join("")||'<li class="mtag">なし</li>'}</ul>`);
  let sel=t.label;
  document.querySelectorAll("[data-tl]").forEach(b=>b.onclick=()=>{ sel=b.dataset.tl; document.querySelectorAll("[data-tl]").forEach(x=>x.classList.toggle("on",x===b)); });
  $("#tSave").onclick=()=>{ TRUST[source]={label:sel,note:$("#tNote").value.trim()}; LS.set("trust",TRUST); $("#modal").classList.remove("show"); decorate3(); toast("メモを保存しました"); };
}

/* ============ 5. 選択した言葉を調べる ============ */
const pop=h("div",{id:"defPop"}); document.body.appendChild(pop);
const selBtn=h("button",{id:"selBtn",className:"btn"},"📖 意味を調べる"); document.body.appendChild(selBtn);
document.addEventListener("mouseup",e=>{
  if(e.target.closest("#selBtn,#defPop")) return;
  setTimeout(()=>{
    const s=window.getSelection(), t=(s+"").trim();
    if(t.length>=2 && t.length<=30 && !/\n/.test(t)){ const r=s.getRangeAt(0).getBoundingClientRect(); selBtn.style.left=(r.left+scrollX)+"px"; selBtn.style.top=(r.bottom+scrollY+6)+"px"; selBtn.dataset.t=t; selBtn.classList.add("show"); }
    else selBtn.classList.remove("show");
  },10);
});
async function showDef(term, x, y){
  pop.style.left=Math.min(x, innerWidth+scrollX-340)+"px"; pop.style.top=y+"px"; pop.innerHTML=`<b>${esc(term)}</b><div class="mtag">調べています…</div>`; pop.classList.add("show");
  try{ const d=await api("/api/define?q="+encodeURIComponent(term)); pop.innerHTML=`<b>📖 ${esc(d.term||term)}</b><p>${esc(d.text||d.error||"説明が見つかりませんでした")}</p><div class="mtag">${esc(d.source||"")} ${d.url?`・ <a href="${esc(d.url)}" target="_blank" rel="noopener">詳しく↗</a>`:""}</div>`; }
  catch{ pop.innerHTML="取得できませんでした"; }
}
selBtn.onclick=e=>{ selBtn.classList.remove("show"); showDef(selBtn.dataset.t, e.pageX-20, e.pageY+10); };
document.addEventListener("click",e=>{
  const g=e.target.closest(".gl"); if(g){ e.preventDefault(); e.stopPropagation(); showDef(g.dataset.t, e.pageX-20, e.pageY+12); return; }
  if(!e.target.closest("#defPop,#selBtn")) pop.classList.remove("show");
}, true);

/* ============ 地図レイヤー：ライブカメラ・大気質・ロケット・感情 ============ */
const layersBox=$("#layers");
[["livecam","#ff4081","ライブカメラ（世界の今）"],["air","#9ccc65","空気の質（PM2.5・AQI）"],["launch","#ffab40","ロケット打ち上げ予定"],["emo","#ffd34d","見出しの感情マップ"]].forEach(([k,c,l])=>{
  layersBox.insertBefore(h("label",{},`<input type="checkbox" data-layer="${k}"><span class="lg" style="background:${c}"></span>${l}<span class="c" id="c-${k}"></span>`), $("#mnote"));
});
LOADERS.livecam=async()=>{
  const d=await api("/api/livecams"); LY.livecam.clearLayers();
  d.cams.forEach(c=>L.marker([c.lat,c.lon],{icon:L.divIcon({className:"",html:'<div class="cam">📹</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(LY.livecam)
    .bindTooltip("📹 "+esc(c.name)).on("click",()=>openCam(c)));
  $("#c-livecam").textContent=d.cams.length+"か所";
};
async function openCam(c){
  side(`<h3>📹 ${esc(c.name)} のライブ映像</h3><div id="camBox"><div class="spin" style="margin:20px auto"></div><div class="mtag">YouTubeで配信中のライブを探しています…</div></div>
    <p class="mtag">映像は各配信者がYouTubeで公開しているものです。配信が終わっていることもあります。<a href="${esc(c.search)}" target="_blank" rel="noopener">YouTubeで他のライブを探す↗</a></p>`);
  try{
    const r=await api("/api/livecam?i="+c.id);
    if(!r.videos.length){ $("#camBox").innerHTML='<div class="mtag">いま配信中のライブが見つかりませんでした</div>'; return; }
    const v=r.videos[0];
    $("#camBox").innerHTML=`<div class="camf"><iframe src="https://www.youtube.com/embed/${v.id}?autoplay=1&mute=1" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>
      <div style="font-size:13px;margin-top:4px">${esc(v.title)}</div>
      ${r.videos.slice(1).map(x=>`<div class="mtag">・<a href="#" data-cam="${x.id}">${esc(x.title)}</a></div>`).join("")}
      <div class="mtag"><a href="https://www.youtube.com/watch?v=${v.id}" target="_blank" rel="noopener">YouTubeで開く↗</a>（埋め込みが許可されていない配信はこちらから）</div>`;
    $("#camBox").querySelectorAll("[data-cam]").forEach(a=>a.onclick=ev=>{ ev.preventDefault(); $("#camBox iframe").src=`https://www.youtube.com/embed/${a.dataset.cam}?autoplay=1&mute=1`; });
  }catch(e){ $("#camBox").innerHTML=`<div class="mtag">取得失敗: ${esc(e.message)}</div>`; }
}
const aqiCol=a=>a==null?"#666":a<=50?"#46d39a":a<=100?"#ffd34d":a<=150?"#ff9f43":a<=200?"#ff5d6c":a<=300?"#b44dff":"#7e0023";
LOADERS.air=async()=>{
  try{
    const d=await api("/api/air"); LY.air.clearLayers();
    d.cities.forEach(c=>L.circleMarker([c.lat,c.lon],{radius:9,color:aqiCol(c.aqi),fillColor:aqiCol(c.aqi),fillOpacity:.55,weight:1}).addTo(LY.air)
      .bindPopup(`<b>${esc(c.name)}</b> の空気<br>AQI <b style="color:${aqiCol(c.aqi)}">${c.aqi??"—"}</b>（${esc(c.level)}）<br>PM2.5 ${c.pm25??"—"} µg/m³ ・ PM10 ${c.pm10??"—"}${c.dust?` ・ 黄砂など ${c.dust}`:""}`).bindTooltip(`${esc(c.name)} AQI ${c.aqi??"—"}`));
    $("#c-air").textContent=d.cities.length+"都市"; $("#mnote").textContent="🌫 "+d.note;
  }catch(e){ $("#c-air").textContent="失敗"; }
};
EVERY.air=1800000;
let LAUNCH=null;
LOADERS.launch=async()=>{
  try{
    LAUNCH=await api("/api/launches"); LY.launch.clearLayers();
    LAUNCH.launches.filter(l=>l.lat!=null).forEach(l=>L.marker([l.lat,l.lon],{icon:L.divIcon({className:"",html:'<div class="rkt">🚀</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(LY.launch)
      .bindPopup(`<b>🚀 ${esc(l.name)}</b><br>${esc(l.provider)} ・ ${esc(l.location)}<br>打ち上げ予定: <b>${new Date(l.net).toLocaleString("ja-JP")}</b>（${esc(l.status_name)}）<br><span class="mtag">${esc((l.mission_ja||"").slice(0,140))}</span>`));
    $("#c-launch").textContent=LAUNCH.launches.length+"件";
  }catch(e){ $("#c-launch").textContent="失敗"; }
};
EVERY.launch=3600000;
LOADERS.emo=async()=>{
  try{
    const d=await api("/api/emotions"); LY.emo.clearLayers();
    d.countries.forEach(c=>L.circleMarker([c.lat,c.lon],{radius:7+Math.sqrt(c.n)*4,color:c.color,fillColor:c.color,fillOpacity:.5,weight:1}).addTo(LY.emo)
      .bindTooltip(`${esc(c.ja)}：${esc(c.emo)}（${c.n}件）`));
    $("#c-emo").textContent=d.countries.length+"か国";
    $("#mnote").innerHTML="😊明るい 😔暗い 😠怒り 😲驚き 😟不安 の色で塗っています。"+esc(d.note);
  }catch(e){ $("#c-emo").textContent="失敗"; }
};
EVERY.emo=300000;

/* ============ 4. 国の統計比較 ============ */
window.openCompare=async function(codes){
  codes=codes||LS.get("wbCodes",["JP","US","CN","IN"]);
  const cs=await api("/api/countries");
  const sel=i=>`<select class="selx wbc">${['<option value="">—</option>',...cs.map(c=>`<option value="${c.code}" ${codes[i]===c.code?"selected":""}>${esc(c.ja)}</option>`)].join("")}</select>`;
  modal3("📊 国を比べる",`<div class="row">${[0,1,2,3].map(sel).join("")}<button class="btn pri" id="wbGo">比べる</button></div><div id="wbRes"><div class="spin" style="margin:20px auto"></div></div>`);
  const run=async()=>{
    const cc=[...document.querySelectorAll(".wbc")].map(s=>s.value).filter(Boolean); LS.set("wbCodes",cc);
    $("#wbRes").innerHTML='<div class="spin" style="margin:20px auto"></div>';
    try{
      const r=await api("/api/wb?codes="+cc.join(","));
      $("#wbRes").innerHTML=`<table class="wbt"><tr><th></th>${r.codes.map(c=>`<th>${esc(r.names[c])}</th>`).join("")}</tr>
        ${r.rows.map(row=>{ const mx=Math.max(...r.codes.map(c=>Math.abs(row.values[c]?.v||0)),1e-9);
          return `<tr><td>${esc(row.name)}</td>${r.codes.map(c=>{ const x=row.values[c]; return `<td>${x?`<b>${row.unit==="%"||row.unit==="歳"||row.unit==="人"&&row.ind!=="SP.POP.TOTL"?x.v.toFixed(1):fmtBig(x.v)}</b><span class="mtag"> ${row.unit==="米ドル"?"ドル":row.unit} (${x.year})</span><div class="wbb"><i style="width:${Math.abs(x.v)/mx*100}%"></i></div>`:'<span class="mtag">—</span>'}</td>`; }).join("")}</tr>`; }).join("")}</table>
        <p class="mtag">${esc(r.source)}</p>`;
    }catch(e){ $("#wbRes").textContent="取得失敗: "+e.message; }
  };
  $("#wbGo").onclick=run; run();
};

/* ============ 7. 日本との関係（国プロフィールに追加） ============ */
const _oc=window.openCountry;
window.openCountry=async function(code){
  await _oc(code);
  const box=$("#cty"); if(!box || code==="JP") return;
  const sec=h("div",{className:"jrel"},'<h4 style="margin:12px 0 4px">🗾 日本との関係</h4><div class="mtag">調べています…</div>');
  box.appendChild(sec);
  const cb=h("button",{className:"btn",style:"margin-top:6px"},"📊 日本と統計を比べる"); cb.onclick=()=>openCompare(["JP",code]); box.appendChild(cb);
  try{
    const r=await api("/api/japan_relation?code="+code);
    sec.innerHTML=`<h4 style="margin:12px 0 4px">🗾 日本との関係</h4><table class="ctyt">
      <tr><th>東京からの距離</th><td>約${r.km.toLocaleString()} km（飛行機で約${r.flight_h}時間の目安）</td></tr>
      ${r.time_diff_h!=null?`<tr><th>日本との時差</th><td>${r.time_diff_h===0?"なし":(r.time_diff_h>0?"+":"")+r.time_diff_h+"時間"}</td></tr>`:""}
      ${r.jpy_rate?`<tr><th>為替</th><td>1 ${esc(r.jpy_rate.cur)} ≒ ${r.jpy_rate.jpy.toFixed(2)}円</td></tr>`:""}
      ${r.jp_news?`<tr><th>日本での報道</th><td>日本の主要ニュース${r.jp_news.total}件中 <b>${r.jp_news.count}件</b>${r.jp_news.examples.length?`<div class="mtag">${r.jp_news.examples.map(esc).join("<br>")}</div>`:""}</td></tr>`:""}
      <tr><th>渡航情報</th><td><a href="${esc(r.mofa)}" target="_blank" rel="noopener">外務省 海外安全ホームページ↗</a></td></tr></table>
      ${r.wiki?.extract?`<p style="font-size:13px"><b>${esc(r.wiki.title)}</b>：${esc(r.wiki.extract)} <a href="${esc(r.wiki.url)}" target="_blank" rel="noopener">続き↗</a></p>`:""}`;
  }catch(e){ sec.innerHTML+='<div class="mtag">取得できませんでした</div>'; }
};

/* ============ 13/14. チェッカー：AI量産・数字 ============ */
const chips=document.querySelector(".samples");
chips.appendChild(h("button",{className:"chip",id:"chipAI",title:"長い文章を貼ってから押す"},"🤖 AI量産記事っぽさチェック"));
$("#chipAI").onclick=async()=>{
  const v=$("#inp").value.trim(); if(v.length<200 && !/^https?:/.test(v)) return toast("200文字以上の文章（またはURL）を入力欄に貼ってください");
  if(/^https?:/.test(v)) return runCheck();
  const r=await api("/api/ai_check",{text:v}); const res=$("#res"); res.className="result show"; res.innerHTML=aiBox(r);
};
const aiBox=a=>!a||!a.available?"":`<div class="box ${a.score>=50?"warnb":""}"><h3>🤖 AI量産記事っぽさ：<b style="color:${a.score>=50?"var(--bad)":a.score>=25?"var(--warn)":"var(--good)"}">${esc(a.level)}（${a.score}/100）</b></h3><ul>${a.notes.map(n=>`<li>${esc(n)}</li>`).join("")}</ul><div class="mtag">${esc(a.note)}</div></div>`;
const numBox=n=>!n||!n.available?"":`<div class="box"><h3>🔢 数字のチェック（${n.claims.map(esc).join("、")}）</h3><ul>${n.notes.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`;
const _oc2=window.onCheckResult;
window.onCheckResult=function(r){
  if(_oc2) _oc2(r);
  const g=document.querySelector("#res .rgrid"); if(!g) return;
  const html=aiBox(r.ai_check)+numBox(r.numbers); if(html){ const d=h("div",{className:"full extra3"},html); g.appendChild(d); }
};

/* ============ ダイジェスト：ムード・ロケット・世界人口・ラジオ ============ */
const _od=window.onDigest;
window.onDigest=function(d){
  if(_od) _od(d);
  const g=$("#dgrid");
  const add=html=>{ const c=h("div",{className:"dcard"},html); g.appendChild(c); return c; };
  // ムード
  const ed=window._EMO_DATA;
  if(ed){ const t=Object.entries(ed.total).filter(([k])=>k!=="中立"), sum=t.reduce((a,b)=>a+b[1],0)||1;
    const em={明るい:"😊",暗い:"😔",怒り:"😠",驚き:"😲",不安:"😟"};
    add(`<h3>🌈 今日の世界のムード</h3><div class="mood">${t.map(([k,v])=>`<i style="flex:${v};background:${ed.colors[k]}" title="${k} ${v}件"></i>`).join("")}</div>
      <div class="samples" style="margin-top:6px">${t.sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<span class="chip">${em[k]} ${k} ${Math.round(v/sum*100)}%</span>`).join("")}</div><p class="mtag">${esc(ed.note)}。地図の「見出しの感情マップ」で国ごとに見られます。</p>`); }
  // ラジオ
  const rc=add(`<h3>📻 ニュースラジオ</h3><p class="mtag">選んだ分野のニュースを、BGMつきのラジオ風に読み上げます。</p>
    <div class="samples">${Object.entries(d.categories).map(([k,c])=>`<label class="chip"><input type="checkbox" class="rcat" value="${k}" checked> ${esc(c.label)}</label>`).join("")}</div>
    <div class="row"><button class="btn pri" id="rPlay">▶ ブラウザで再生</button><button class="btn" id="rStop">⏹ 停止</button><button class="btn" id="rWav">💾 音声ファイル(WAV)で保存</button></div><div id="rMsg" class="mtag"></div>`);
  const cats=()=>[...document.querySelectorAll(".rcat:checked")].map(x=>x.value).join(",");
  $("#rPlay").onclick=async()=>{ const r=await api("/api/radio/script?cats="+cats()); startPad(); say(r.script.split("\n")); watchSay(); };
  $("#rStop").onclick=()=>{ stopSay(); stopPad(); };
  $("#rWav").onclick=async()=>{ $("#rMsg").textContent="音声ファイルを作成中…（1〜2分かかります）"; $("#rWav").disabled=true;
    try{ const res=await fetch("/api/radio/file?cats="+cats()); if(!res.ok){ const j=await res.json(); throw new Error(j.error); }
      const blob=await res.blob(); const a=h("a",{href:URL.createObjectURL(blob),download:`news_radio_${new Date().toISOString().slice(0,16).replace(/[-T:]/g,"")}.wav`}); a.click(); $("#rMsg").textContent="保存しました（data/radio フォルダにも残ります）"; }
    catch(e){ $("#rMsg").textContent="作成できませんでした: "+e.message; } $("#rWav").disabled=false; };
  // ロケット
  const lc=add('<h3>🚀 ロケット打ち上げ予定</h3><div id="dLaunch" class="mtag">読み込み中…</div>');
  (LAUNCH?Promise.resolve(LAUNCH):api("/api/launches")).then(r=>{ LAUNCH=r;
    $("#dLaunch").innerHTML=`<ul class="dl">${r.launches.slice(0,5).map(l=>`<li><b>${esc(l.name)}</b><div class="m">${esc(l.provider)} ・ ${esc(l.location)}</div><div class="cd" data-t="${esc(l.net)}"></div></li>`).join("")}</ul>`; tickCD(); }).catch(()=>$("#dLaunch").textContent="取得できませんでした");
  // 世界人口
  const pc=add('<h3>👥 世界の人口（推計）</h3><div id="wpop" class="wpop">—</div><p class="mtag" id="wpopN"></p><button class="btn" id="cmpBtn">📊 国を比べる</button>');
  $("#cmpBtn").onclick=()=>openCompare();
  api("/api/wpop").then(p=>{ const tick=()=>{ const v=p.base_pop+(Date.now()/1000-p.base_time)*p.per_sec; const e=$("#wpop"); if(!e) return; e.textContent=Math.round(v).toLocaleString("ja-JP")+"人"; };
    tick(); clearInterval(window._wpopT); window._wpopT=setInterval(tick,500); $("#wpopN").textContent=`世界銀行の${p.year}年の人口と増加ペース（1秒に約${p.per_sec.toFixed(1)}人）から計算した推計値です`; }).catch(()=>{});
};
function tickCD(){ clearInterval(window._cdT); const f=()=>document.querySelectorAll(".cd[data-t]").forEach(el=>{ const s=(new Date(el.dataset.t)-Date.now())/1000; if(s<0){ el.textContent="打ち上げ時刻を過ぎました（結果は元情報で）"; return; } const d=Math.floor(s/86400),hh=Math.floor(s%86400/3600),m=Math.floor(s%3600/60),ss=Math.floor(s%60); el.textContent=`⏱ あと ${d?d+"日 ":""}${hh}時間${m}分${ss}秒`; }); f(); window._cdT=setInterval(f,1000); }

/* ラジオのBGM（WebAudioで生成） */
let AC=null, padNodes=[];
function startPad(){
  try{ AC=AC||new (window.AudioContext||window.webkitAudioContext)(); stopPad(); const g=AC.createGain(); g.gain.value=0.035; g.connect(AC.destination);
    const chords=[[261.6,329.6,392],[220,261.6,329.6],[174.6,220,261.6],[196,246.9,293.7]]; let t0=AC.currentTime;
    for(let rep=0;rep<40;rep++) chords.forEach((ch,ci)=>{ const st=t0+(rep*4+ci)*4; ch.forEach(f=>{ const o=AC.createOscillator(), e=AC.createGain(); o.type="sine"; o.frequency.value=f; e.gain.setValueAtTime(0,st); e.gain.linearRampToValueAtTime(1,st+1); e.gain.linearRampToValueAtTime(0,st+4); o.connect(e); e.connect(g); o.start(st); o.stop(st+4.1); padNodes.push(o); }); });
    padNodes.push({stop:()=>g.disconnect()});
  }catch{}
}
function stopPad(){ padNodes.forEach(n=>{ try{n.stop();}catch{} }); padNodes=[]; }
function watchSay(){ const t=setInterval(()=>{ if(!document.querySelector("#sayBar.show")){ stopPad(); clearInterval(t); } },1000); }

/* ============ 10/11. 設定画面に Discord/LINE・壁紙を追加 ============ */
new MutationObserver(()=>{
  const b=$("#mBody"); if(!b || !b.querySelector("h2") || !b.querySelector("h2").textContent.includes("⚙ 設定") || b.querySelector("#extSec")) return;
  api("/api/settings").then(s=>{
    const sec=h("section",{className:"sec",id:"extSec"},`
      <h3>💬 Discord・LINE にも通知</h3>
      <div class="row"><input id="sDisc" value="${esc(s.discord_webhook||"")}" placeholder="DiscordのWebhook URL（https://discord.com/api/webhooks/...）" style="flex:1"></div>
      <p class="mtag">Discordのサーバー設定 → 連携サービス → ウェブフック → 新しいウェブフック → URLをコピー して貼り付け。</p>
      <div class="row"><input id="sLineT" value="${esc(s.line_token||"")}" placeholder="LINE Messaging API チャネルアクセストークン" style="flex:1"></div>
      <div class="row"><input id="sLineU" value="${esc(s.line_user_id||"")}" placeholder="送り先のユーザーID（Uから始まる）" style="flex:1"></div>
      <p class="mtag">LINE Developersで無料のMessaging APIチャネルを作り、トークンと自分のユーザーIDを入れます（無料枠は月200通）。</p>
      <h3 style="margin-top:12px">🖼 壁紙モード（Windows）</h3>
      <label class="row"><input type="checkbox" id="sWp" ${s.wallpaper_enabled?"checked":""}> 世界の様子をデスクトップの壁紙にして自動更新する（<input type="number" id="sWpI" value="${s.wallpaper_interval||60}" min="15" style="width:60px">分ごと）</label>
      <p class="mtag">オフにすると元の壁紙に戻します。</p>
      <div class="row"><button class="btn" id="wpPrev">👀 壁紙をプレビュー</button><button class="btn" id="extTest">💬 Discord/LINEにテスト送信</button><button class="btn pri" id="extSave">この欄を保存</button></div><div id="wpImg"></div>`);
    const save=b.querySelector("#sSave")?.closest(".row"); b.insertBefore(sec, save||null);
    $("#wpPrev").onclick=async()=>{ $("#wpImg").innerHTML='<div class="mtag">作成中…</div>'; try{ const r=await fetch("/api/wallpaper/preview"); if(!r.ok) throw new Error((await r.json()).error); $("#wpImg").innerHTML=`<img src="${URL.createObjectURL(await r.blob())}" style="width:100%;border-radius:8px;margin-top:8px">`; }catch(e){ $("#wpImg").innerHTML=`<div class="mtag">${esc(e.message)}</div>`; } };
    $("#extTest").onclick=async()=>{ await api("/api/settings",{discord_webhook:$("#sDisc").value.trim(),line_token:$("#sLineT").value.trim(),line_user_id:$("#sLineU").value.trim()}); const r=await api("/api/notify/test",{}); toast(r.sent.length?`送信しました: ${r.sent.join("・")}`:"送信先が設定されていないか、送信に失敗しました"); };
    $("#extSave").onclick=async()=>{
      await api("/api/settings",{discord_webhook:$("#sDisc").value.trim(),line_token:$("#sLineT").value.trim(),line_user_id:$("#sLineU").value.trim(),wallpaper_interval:parseInt($("#sWpI").value)||60});
      if($("#sWp").checked!==!!s.wallpaper_enabled){ toast($("#sWp").checked?"壁紙を作成して設定しています…":"元の壁紙に戻しています…"); const r=await api("/api/wallpaper",{on:$("#sWp").checked}); toast(r.ok?($("#sWp").checked?"壁紙モードをオンにしました":"壁紙モードをオフにしました"):("失敗: "+r.error)); s.wallpaper_enabled=$("#sWp").checked; }
      else toast("保存しました");
    };
  });
}).observe($("#mBody"),{childList:true});

applyView();
})();
