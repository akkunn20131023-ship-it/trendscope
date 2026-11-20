/* TrendScope 追加機能（index.html の関数を利用） */
(function(){
"use strict";
const SET = {data:null};
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const h = (tag, attrs={}, html="") => { const e=document.createElement(tag); Object.assign(e,attrs); if(html) e.innerHTML=html; return e; };

/* ============ ヘッダー：通知ベル・設定・温度差タブ ============ */
const status = document.querySelector(".status");
const bell = h("button",{className:"btn",id:"bellBtn",title:"アラート通知"},'🔔<span id="bellN" class="badge0"></span>');
const gear = h("button",{className:"btn",id:"gearBtn",title:"設定"},"⚙");
status.insertBefore(gear, status.firstChild); status.insertBefore(bell, status.firstChild);
document.querySelector("#views").insertBefore(h("button",{className:"vbtn"},"🗾 温度差"), null).dataset.v="compare";
document.body.insertBefore(h("section",{className:"view wrap",id:"view-compare"},'<div id="cmp"><div class="loading"><div class="spin"></div>日本のニュースと見比べています…</div></div>'), document.querySelector("#toast"));

/* ============ 読み上げ（8） ============ */
let sayQueue=[], saying=false;
function voiceJa(){ return speechSynthesis.getVoices().find(v=>/ja/i.test(v.lang) && /Nanami|Haruka|Ayumi|Google/i.test(v.name)) || speechSynthesis.getVoices().find(v=>/ja/i.test(v.lang)); }
window.say = function(texts){
  if(!("speechSynthesis" in window)){ toast("このブラウザは読み上げに対応していません"); return; }
  stopSay(); sayQueue = (Array.isArray(texts)?texts:[texts]).filter(Boolean); saying=true; nextSay(); showSayBar(true);
};
function nextSay(){
  if(!saying || !sayQueue.length){ saying=false; showSayBar(false); return; }
  const u = new SpeechSynthesisUtterance(sayQueue.shift());
  u.lang="ja-JP"; u.rate = (SET.data?.tts_rate)||1.1; const v=voiceJa(); if(v) u.voice=v;
  u.onend = ()=>setTimeout(nextSay, 350); u.onerror = ()=>setTimeout(nextSay, 100);
  $("#sayNow").textContent = u.text.slice(0,60);
  speechSynthesis.speak(u);
}
window.stopSay = function(){ saying=false; sayQueue=[]; try{speechSynthesis.cancel();}catch{} showSayBar(false); };
const sayBar = h("div",{id:"sayBar"},'🔊 <span id="sayNow"></span> <button class="ib" id="sayStop">⏹ 停止</button>');
document.body.appendChild(sayBar);
$("#sayStop").onclick = stopSay;
function showSayBar(on){ sayBar.classList.toggle("show",on); }
// ニュース一覧の読み上げボタン
const tools = document.querySelector(".tools");
const sayList = h("button",{className:"ib",title:"表示中のニュース見出しを順番に読み上げ"},"🔊 一覧を読み上げ");
tools.insertBefore(sayList, $("#cnt"));
sayList.onclick = ()=>{
  const cards=[...document.querySelectorAll("#grid .card .tja")].slice(0,30).map((e,i)=>`${i+1}件目。${e.textContent}`);
  if(!cards.length) return toast("読み上げるニュースがありません");
  say(["表示中のニュースを読み上げます。", ...cards]);
};
// 要約ボックスに読み上げボタンを自動追加
new MutationObserver(()=>{
  document.querySelectorAll(".sumbox ol:not([data-say])").forEach(ol=>{
    ol.dataset.say=1;
    const b=h("button",{className:"ib",style:"margin-top:4px"},"🔊 読み上げ");
    b.onclick=(e)=>{ e.preventDefault(); say([...ol.querySelectorAll("li")].map(li=>li.textContent)); };
    ol.after(b);
  });
}).observe(document.body,{childList:true,subtree:true});

/* ============ ダイジェスト：読み上げ・ブリーフィング（7,8） ============ */
window.onDigest = function(d){
  const g=$("#dgrid"); const qp=new URLSearchParams(location.search);
  const three=["world","tech","trivia"].map(k=>d.categories[k]?.items[0]).filter(Boolean);
  const bar=h("div",{className:"dcard wide sayrow"});
  const hr=new Date().getHours(), greet = hr<11?"おはようございます":hr<18?"こんにちは":"こんばんは";
  bar.innerHTML = `${qp.get("brief")?`<div class="brief">☀ ${greet}！今朝の世界ブリーフィングです</div>`:""}
    <button class="btn pri" id="sayDigest">🔊 世界のまとめを読み上げ</button>
    <button class="btn" id="sayAll">🔊 ピックアップを全部読み上げ</button>
    <button class="btn" id="mkBrief">☀ ブリーフィングを今すぐ保存</button>
    <select id="pastBrief" class="selx"><option value="">過去のブリーフィング…</option></select>`;
  g.insertBefore(bar, g.firstChild);
  $("#sayDigest").onclick=()=>say([`${greet}。いまの世界のまとめです。`, ...three.map((i,n)=>`${n+1}つめ。${i.title_ja}`),
    d.top_countries.length?`いま話題の国は、${d.top_countries.slice(0,3).map(c=>c.ja).join("、")}です。`:"",
    d.conflicts_in_news.length?`紛争関連では、${d.conflicts_in_news[0].name}の報道が${d.conflicts_in_news[0].count}件ありました。`:""]);
  $("#sayAll").onclick=()=>say(Object.values(d.categories).flatMap(c=>[c.label+"。", ...c.items.map(i=>i.title_ja)]));
  $("#mkBrief").onclick=async()=>{ $("#mkBrief").disabled=true; try{ const r=await api("/api/briefing/run",{}); toast(`${r.date} のブリーフィングを保存しました`); loadPast(); }catch(e){ toast("失敗: "+e.message); } $("#mkBrief").disabled=false; };
  async function loadPast(){
    const r=await api("/api/briefings").catch(()=>({dates:[]}));
    $("#pastBrief").innerHTML='<option value="">過去のブリーフィング…</option>'+r.dates.map(x=>`<option>${x}</option>`).join("");
  }
  loadPast();
  $("#pastBrief").onchange=async e=>{
    if(!e.target.value) return;
    const b=await api("/api/briefing?date="+e.target.value);
    side2(`☀ ${e.target.value} のブリーフィング`, Object.values(b.categories||{}).map(c=>`<h4>${esc(c.label)}</h4><ul class="dl">${c.items.map(i=>`<li>${esc(i.title_ja)}<div class="m">${esc(i.source)} ・ <a href="${esc(i.url)}" target="_blank" rel="noopener">元記事↗</a></div></li>`).join("")}</ul>`).join(""));
  };
};

/* ============ モーダル共通 ============ */
const modal = h("div",{id:"modal"},'<div class="mbox"><button class="x" id="mX">×</button><div id="mBody"></div></div>');
document.body.appendChild(modal);
$("#mX").onclick=()=>modal.classList.remove("show");
modal.onclick=e=>{ if(e.target===modal) modal.classList.remove("show"); };
function side2(title, html){ $("#mBody").innerHTML=`<h2>${title}</h2>${html}`; modal.classList.add("show"); }

/* ============ 設定（1,7,9 + ODPT・読み上げ速度） ============ */
async function loadSettings(){ SET.data = await api("/api/settings"); return SET.data; }
gear.onclick = async ()=>{
  const s = await loadSettings();
  const lanUrl = `http://${s.lan_ip}:${s.port}`;
  side2("⚙ 設定", `
  <section class="sec"><h3>🔔 アラート（キーワード・地震）</h3>
    <p class="mtag">新しいニュースや地震が条件に合うと、Windowsの通知とこの画面のベルでお知らせします。</p>
    <div id="rules"></div>
    <div class="row"><input id="newKw" placeholder="キーワード（例: Nintendo / ウクライナ / SpaceX）"><button class="btn" id="addKw">＋ キーワード</button></div>
    <div class="row">地震 M<input id="newQ" type="number" step="0.1" value="6.0" style="width:70px"> 以上 地域<input id="newQr" placeholder="例: Japan（空欄=全世界）" style="width:160px"><button class="btn" id="addQ">＋ 地震</button></div>
    <label class="row"><input type="checkbox" id="sNotify" ${s.notify_desktop?"checked":""}> Windows/Macのデスクトップ通知を出す</label>
    <div class="row"><button class="btn" id="testN">通知テスト</button><button class="btn" id="permN">ブラウザ通知を許可</button></div>
  </section>
  <section class="sec"><h3>☀ 朝のブリーフィング</h3>
    <label class="row"><input type="checkbox" id="sBrief" ${s.briefing_enabled?"checked":""}> 毎日 <input type="time" id="sBriefT" value="${esc(s.briefing_time)}"> に最新ニュースでダイジェストを作る</label>
    <label class="row"><input type="checkbox" id="sBriefO" ${s.briefing_open_browser?"checked":""}> 作成したらブラウザで自動的に開く</label>
    <p class="mtag">※ サーバー（start.bat）が起動している間だけ動きます。保存したブリーフィングはダイジェスト画面から見返せます。</p>
  </section>
  <section class="sec"><h3>📱 スマホから見る</h3>
    <label class="row"><input type="checkbox" id="sLan" ${s.lan_access?"checked":""}> 同じWi-Fiのスマホ・タブレットからアクセスできるようにする</label>
    ${s.lan_active?`<div class="qrrow"><div id="qr"></div><div>スマホのカメラでQRを読むか、<br><b style="font-size:16px">${lanUrl}</b><br>をブラウザで開いてください。<p class="mtag">初回はWindowsのファイアウォール確認が出るので「許可」を押してください。家のWi-Fiなど信頼できるネットワークでだけ使ってください。</p></div></div>`
      :`<p class="mtag">オンにして保存すると、サーバーが自動で再起動してスマホ用のURLとQRコードが表示されます。</p>`}
  </section>
  <section class="sec"><h3>🚆 日本の電車（任意）</h3>
    <div class="row"><input id="sOdpt" value="${esc(s.odpt_key||"")}" placeholder="ODPTのアクセストークン" style="flex:1"></div>
    <p class="mtag"><a href="https://developer.odpt.org/" target="_blank" rel="noopener">公共交通オープンデータセンター</a>で無料登録するとキーがもらえ、東京メトロ・都営の列車位置が地図に出ます。</p>
  </section>
  <section class="sec"><h3>🔊 読み上げ</h3>
    <div class="row">速さ <input type="range" id="sRate" min="0.6" max="2" step="0.1" value="${s.tts_rate}"><span id="rateV">${s.tts_rate}</span> <button class="btn" id="tTest">テスト</button></div>
  </section>
  <div class="row" style="justify-content:flex-end"><button class="btn pri" id="sSave">保存</button></div>`);
  let rules = JSON.parse(JSON.stringify(s.alerts||[]));
  const drawRules=()=>{ $("#rules").innerHTML = rules.length? rules.map((r,i)=>`<div class="rule"><label><input type="checkbox" data-i="${i}" ${r.on!==false?"checked":""}> ${r.type==="keyword"?`🔑 キーワード「${esc(r.value)}」`:`📳 地震 M${r.min}以上${r.region?`（${esc(r.region)}）`:""}`}</label><button class="ib" data-del="${i}">削除</button></div>`).join("") : '<p class="mtag">ルールがありません</p>'; };
  drawRules();
  $("#rules").onclick=e=>{ const d=e.target.closest("[data-del]"); if(d){ rules.splice(+d.dataset.del,1); drawRules(); } };
  $("#rules").onchange=e=>{ const i=e.target.dataset.i; if(i!=null) rules[+i].on=e.target.checked; };
  $("#addKw").onclick=()=>{ const v=$("#newKw").value.trim(); if(!v) return; rules.push({type:"keyword",value:v,on:true}); $("#newKw").value=""; drawRules(); };
  $("#addQ").onclick=()=>{ rules.push({type:"quake",min:parseFloat($("#newQ").value)||6,region:$("#newQr").value.trim(),on:true}); drawRules(); };
  $("#testN").onclick=async()=>{ await api("/api/alerts/test",{}); browserNotify("🔔 TrendScope テスト","ブラウザ通知はこのように表示されます"); toast("テスト通知を送りました"); };
  $("#permN").onclick=async()=>{ if(!("Notification" in window)) return toast("このブラウザは通知に未対応です"); const p=await Notification.requestPermission(); toast(p==="granted"?"ブラウザ通知を許可しました":"許可されませんでした"); };
  $("#sRate").oninput=e=>$("#rateV").textContent=e.target.value;
  $("#tTest").onclick=()=>{ SET.data.tts_rate=parseFloat($("#sRate").value); say("これは読み上げのテストです。世界のニュースをお届けします。"); };
  if(s.lan_active && window.qrcode){ const q=qrcode(0,"M"); q.addData(lanUrl); q.make(); $("#qr").innerHTML=q.createSvgTag(4,8); }
  $("#sSave").onclick=async()=>{
    const body={alerts:rules, notify_desktop:$("#sNotify").checked, briefing_enabled:$("#sBrief").checked, briefing_time:$("#sBriefT").value||"07:30",
      briefing_open_browser:$("#sBriefO").checked, lan_access:$("#sLan").checked, odpt_key:$("#sOdpt").value.trim(), tts_rate:parseFloat($("#sRate").value)};
    const lanChanged = body.lan_access !== s.lan_active;
    await api("/api/settings", body); SET.data={...SET.data,...body};
    if(lanChanged){
      if(location.hostname!=="localhost" && location.hostname!=="127.0.0.1"){ toast("保存しました。PC側でrestart.batを実行すると反映されます"); return; }
      toast("保存しました。サーバーを再起動しています…");
      await api("/api/restart",{}).catch(()=>{});
      for(let i=0;i<30;i++){ await sleep(700); try{ await api("/api/ping"); break; }catch{} }
      gear.onclick();
    } else { toast("保存しました"); modal.classList.remove("show"); }
  };
};

/* ============ アラート受信（1） ============ */
function browserNotify(t,b,url){
  if(!("Notification" in window) || Notification.permission!=="granted") return;
  try{ const n=new Notification(t,{body:b}); if(url) n.onclick=()=>window.open(url,"_blank"); }catch{}
}
let alertSince = LS.get("alertSince", Date.now()/1000 - 3600), unread = LS.get("alertUnread", 0), alertLog = LS.get("alertLog", []);
function drawBell(){ $("#bellN").textContent = unread? unread : ""; $("#bellN").className = unread? "badge":"badge0"; }
drawBell();
async function pollAlerts(){
  try{
    const r = await api("/api/alerts?since="+alertSince);
    if(r.events.length){
      r.events.forEach(e=>{ browserNotify("🔔 "+e.rule, e.title, e.url); alertLog.unshift(e); });
      alertLog = alertLog.slice(0,80); unread += r.events.length; alertSince = Math.max(...r.events.map(e=>e.time));
      LS.set("alertLog",alertLog); LS.set("alertSince",alertSince); LS.set("alertUnread",unread); drawBell();
      toast(`🔔 ${r.events[0].rule}: ${r.events[0].title.slice(0,40)}`);
    }
  }catch{}
}
pollAlerts(); setInterval(pollAlerts, 60000);
bell.onclick=()=>{
  unread=0; LS.set("alertUnread",0); drawBell();
  side2("🔔 アラート", `<p class="mtag">条件は ⚙設定 で変更できます。サーバーは1分ごとに新着を確認しています。</p>
    <ul class="dl">${alertLog.map(e=>`<li>${e.kind==="quake"?"📳":"📰"} <b>${esc(e.title)}</b><div class="m">${esc(e.rule)} ・ ${fmtT(e.time)} ${e.body?"・"+esc(e.body):""} ${e.url?`・ <a href="${esc(e.url)}" target="_blank" rel="noopener">開く↗</a>`:""}</div></li>`).join("") || '<li class="mtag">まだ通知はありません</li>'}</ul>`);
};

/* ============ 温度差ビュー（2） ============ */
window.onViewShown = v => { if(v==="compare") loadCompare(); };
async function loadCompare(){
  try{
    const d = await api("/api/compare");
    const bars = r => { const mx=Math.max(r.foreign_pct, r.japan_pct, 1);
      return `<div class="tbar"><span>海外</span><i style="width:${r.foreign_pct/mx*100}%;background:var(--acc)"></i><em>${r.foreign}件</em></div>
              <div class="tbar"><span>日本</span><i style="width:${r.japan_pct/mx*100}%;background:#ff8fd1"></i><em>${r.japan}件</em></div>`; };
    const okN = d.jp_status.filter(s=>s.ok).length;
    $("#cmp").innerHTML = `
    <div class="dgrid">
      <div class="dcard wide"><h3>🗾 海外と日本の「温度差」</h3>
        <p style="margin:0;font-size:14px">海外ニュース <b>${d.foreign_total}</b>件と、日本のニュース <b>${d.jp_total}</b>件（${okN}/${d.jp_status.length}サイト）の見出しを比べて、取り上げられ方の差を出しています。</p>
        <p class="mtag">日本側: ${d.jp_status.map(s=>`${s.ok?"✅":"⚪"}${esc(s.name)}`).join(" ")}</p></div>
      <div class="dcard"><h3>🔇 海外で話題なのに、日本ではほぼ報じられていない</h3>
        ${d.quiet_in_japan.map(r=>`<div class="trow"><b>${esc(r.topic)}</b> <span class="mtag">${esc(r.kind)}</span>${bars(r)}<div class="m">例: ${esc(r.foreign_example||"")}</div></div>`).join("")||'<p class="mtag">該当なし</p>'}</div>
      <div class="dcard"><h3>📢 海外でも日本でも報じられている</h3>
        ${d.both.map(r=>`<div class="trow"><b>${esc(r.topic)}</b>${bars(r)}<div class="m">日本: ${esc((r.japan_examples||[])[0]||"")}</div></div>`).join("")||'<p class="mtag">該当なし</p>'}</div>
      <div class="dcard"><h3>🗾 日本でだけ話題になっている国</h3>
        ${d.japan_only.map(r=>`<div class="trow"><b>${esc(r.topic)}</b> <span class="mtag">日本${r.japan}件</span><div class="m">${(r.japan_examples||[]).map(esc).join("<br>")}</div></div>`).join("")||'<p class="mtag">該当なし</p>'}</div>
      <div class="dcard"><h3>📰 日本の最新見出し</h3><ul class="dl">${d.jp_latest.map(i=>`<li><a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.title)}</a><div class="m">${esc(i.feed)}${i.source?" / "+esc(i.source):""}</div></li>`).join("")}</ul></div>
    </div>`;
  }catch(e){ $("#cmp").innerHTML=`<div class="empty">比較できませんでした：${esc(e.message)}</div>`; }
}

/* ============ 時系列グラフ（3） ============ */
window.renderTimeline = async function(sel, kind, id){
  const box=document.querySelector(sel); if(!box) return;
  box.innerHTML='<div class="mtag" style="margin-top:10px">📈 報道件数の推移を集計中…</div>';
  try{
    const t=await api(`/api/timeline?kind=${kind}&id=${id}`);
    const f=t.foreign||[], j=t.japan||[]; const mx=Math.max(1,...f,...j);
    box.innerHTML=`<h4 style="margin:12px 0 4px;font-size:14px">📈 報道件数の推移（7日間）${t.trend?` <span class="lv" style="background:${t.trend==="急増中"?"#ff5d6c33;color:#ff5d6c":"#46d39a33;color:#46d39a"}">${t.trend}</span>`:""}</h4>
      <div class="tl">${t.days.map((d,i)=>`<div class="tlc"><div class="tlb"><i style="height:${(f[i]||0)/mx*100}%" title="海外 ${f[i]||0}件"></i><i class="j" style="height:${(j[i]||0)/mx*100}%" title="日本 ${j[i]||0}件"></i></div><span>${d.slice(3)}</span></div>`).join("")}</div>
      <div class="mtag"><span class="lgd"></span>海外（英語） <span class="lgd j"></span>日本語 ・ ${esc(t.note)}</div>`;
  }catch(e){ box.innerHTML=`<div class="mtag">推移を取得できませんでした（${esc(e.message)}）</div>`; }
};

/* ============ 地図レイヤー追加（4,5,6） ============ */
const layersBox=$("#layers"), note=$("#mnote");
[["ships","#4fc3f7","船（バルト海・リアルタイム）"],["choke","#00bcd4","海の要衝（運河・海峡）"],["disasters","#ff7043","災害（山火事・台風・火山）"],
 ["weather","#90caf9","世界の天気と現地時刻"],["night","#3949ab","昼と夜の境界線"]].forEach(([k,c,l])=>{
  const lab=h("label",{},`<input type="checkbox" data-layer="${k}" ${k==="night"?"checked":""}><span class="lg" style="background:${c}"></span>${l}<span class="c" id="c-${k}"></span>`);
  layersBox.insertBefore(lab, note);
});
const fold=h("button",{className:"ib",id:"layFold",title:"レイヤー一覧をたたむ"},"⇕"); layersBox.querySelector("h4").appendChild(fold);
fold.onclick=()=>layersBox.classList.toggle("folded");
if(innerWidth<720) layersBox.classList.add("folded");

LOADERS.ships = async ()=>{
  try{
    $("#c-ships").textContent="取得中…";
    const d=await api("/api/ships"); LY.ships.clearLayers();
    d.ships.forEach(s=>{
      const col = s.kind==="タンカー"?"#ff8a65":s.kind==="貨物船"?"#4fc3f7":s.kind==="旅客船"?"#ce93d8":"#b0bec5";
      const moving = s.sog>0.5;
      const ic = L.divIcon({className:"",html:moving?`<div class="ship" style="--c:${col};transform:rotate(${s.cog}deg)"></div>`:`<div class="shipd" style="background:${col}"></div>`,iconSize:[10,10],iconAnchor:[5,5]});
      L.marker([s.lat,s.lon],{icon:ic}).addTo(LY.ships).bindPopup(`<b>🚢 ${esc(s.name||"(船名不明)")}</b><br>${esc(s.kind)} ・ MMSI ${s.id}<br>速度 ${(s.sog*1.852).toFixed(1)} km/h（${s.sog} ノット）・針路 ${Math.round(s.cog)}°${s.dest?`<br>目的地: ${esc(s.dest)}`:""}`);
    });
    $("#c-ships").textContent=`${d.ships.length}隻`;
    note.innerHTML=`🚢 ${esc(d.area)}。世界全体の船舶データは有料サービスが中心のため、無料公開されている海域を表示しています。`;
  }catch(e){ $("#c-ships").textContent="失敗"; }
};
EVERY.ships=60000;

LOADERS.choke = async ()=>{
  const d=await api("/api/chokepoints"); LY.choke.clearLayers();
  d.chokepoints.forEach(c=>{
    L.marker([c.lat,c.lon],{icon:L.divIcon({className:"",html:'<div class="choke">⚓</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(LY.choke)
      .bindTooltip(`⚓ ${esc(c.name)}`).on("click",()=>openChoke(c));
  });
  $("#c-choke").textContent=d.chokepoints.length+"か所";
};
async function openChoke(c){
  side(`<h3>⚓ ${esc(c.name)}</h3><p style="font-size:14px;margin:6px 0">${esc(c.desc)}</p><div id="ktl"></div>
    <h4 style="margin:14px 0 2px;font-size:14px">🛰 最新の報道（直近3日）</h4><div id="knews"><div class="spin" style="margin:10px 0"></div></div>`);
  renderTimeline("#ktl","choke",c.id);
  try{
    const r=await api("/api/topic_news?id="+c.id);
    const o=Object.entries(r.origins||{}).sort((a,b)=>b[1]-a[1]);
    $("#knews").innerHTML=(o.length?`<div class="orig">${o.map(([k,v])=>`<span>${esc(k)} ${v}</span>`).join("")}</div>`:"")+
      (r.articles.length?`<ul>${r.articles.map(a=>`<li>${esc(a.title_ja||a.title)}<div class="m">${esc(a.domain||"")} ・ <a href="${esc(a.url)}" target="_blank" rel="noopener">元記事↗</a> ・ <a href="#" data-sum="${esc(a.url)}">📝要約</a></div><div class="sumbox"></div></li>`).join("")}</ul>`:'<div class="mtag">直近の報道はありません</div>');
  }catch(e){ $("#knews").innerHTML=`<div class="mtag">取得失敗: ${esc(e.message)}</div>`; }
}

LOADERS.disasters = async ()=>{
  try{
    const d=await api("/api/disasters"); LY.disasters.clearLayers();
    d.events.forEach(e=>{
      if(e.track.length>1) L.polyline(e.track,{color:"#ff7043",weight:2,opacity:.7,dashArray:"2 5"}).addTo(LY.disasters);
      const big = e.cat==="severeStorms"||e.cat==="volcanoes";
      L.marker([e.lat,e.lon],{icon:L.divIcon({className:"",html:`<div class="dis ${big?"big":""}">${e.icon}</div>`,iconSize:[big?24:16,big?24:16],iconAnchor:[big?12:8,big?12:8]})}).addTo(LY.disasters)
       .bindPopup(`<b>${e.icon} ${esc(e.cat_ja)}</b><br>${esc(e.title_ja||e.title)}${e.title_ja&&e.title_ja!==e.title?`<br><span class="mtag">${esc(e.title)}</span>`:""}<br>${esc((e.date||"").slice(0,16).replace("T"," "))}${e.mag?` ・ ${e.mag} ${esc(e.mag_unit)}`:""}${e.url?`<br><a href="${esc(e.url)}" target="_blank" rel="noopener">詳細↗</a>`:""}`);
    });
    $("#c-disasters").textContent=d.events.length+"件";
    note.innerHTML="🔥🌀🌋 NASA EONET の進行中の自然災害（直近30日）。"+Object.entries(d.counts).map(([k,v])=>{ const m={wildfires:"山火事",severeStorms:"台風・暴風雨",volcanoes:"火山",seaLakeIce:"海氷"}; return `${m[k]||k} ${v}`; }).join(" / ");
  }catch(e){ $("#c-disasters").textContent="失敗"; }
};
EVERY.disasters=1200000;

let wxCities=[];
const localTime = off => { const d=new Date(Date.now()+off*1000); return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`; };
function drawWeather(){
  if(!LY.weather) return; LY.weather.clearLayers();
  wxCities.forEach(c=>{
    L.marker([c.lat,c.lon],{icon:L.divIcon({className:"",html:`<div class="wx ${c.is_day?"":"night"}"><b>${c.icon} ${Math.round(c.temp)}°</b><span>${esc(c.name)} ${localTime(c.utc_offset)}</span></div>`,iconSize:[86,34],iconAnchor:[43,17]})}).addTo(LY.weather)
     .bindPopup(`<b>${esc(c.name)}</b>（現地 ${localTime(c.utc_offset)} ${esc(c.tz)}）<br>${c.icon} ${esc(c.desc)} ・ ${c.temp}℃ ・ 風 ${c.wind} km/h`);
  });
}
LOADERS.weather = async ()=>{
  try{ const d=await api("/api/weather"); wxCities=d.cities; drawWeather(); $("#c-weather").textContent=d.cities.length+"都市"; }
  catch(e){ $("#c-weather").textContent="失敗"; }
};
EVERY.weather=900000;
setInterval(()=>{ if(curView==="map" && M && M.hasLayer(LY.weather)) drawWeather(); }, 30000);

// 昼夜の境界線（太陽位置から計算）
function nightPolygon(date){
  const R=Math.PI/180, jd=date/86400000+2440587.5, n=jd-2451545.0;
  const gst=(18.697374558+24.06570982441908*n)%24;
  const Lm=(280.46+0.9856474*n)%360, g=(357.528+0.9856003*n)%360;
  const lam=Lm+1.915*Math.sin(g*R)+0.02*Math.sin(2*g*R), eps=23.4393-0.0000004*n;
  let alpha=Math.atan2(Math.cos(eps*R)*Math.sin(lam*R),Math.cos(lam*R))/R; const delta=Math.asin(Math.sin(eps*R)*Math.sin(lam*R))/R;
  const pts=[];
  for(let lng=-360;lng<=360;lng+=2){ const ha=(gst*15+lng)-alpha; pts.push([Math.atan(-Math.cos(ha*R)/Math.tan(delta*R))/R, lng]); }
  const pole = delta<0? 90 : -90;
  return [[pole,-360],...pts,[pole,360]];
}
LOADERS.night = ()=>{ LY.night.clearLayers(); L.polygon(nightPolygon(new Date()),{stroke:false,fillColor:"#000814",fillOpacity:.38,interactive:false}).addTo(LY.night); $("#c-night").textContent="毎分更新"; };
EVERY.night=60000;

/* ============ YouTubeサムネ判定（10） ============ */
window.onCheckResult = function(r){
  loadHistory();
  if(!r.yt_id) return;
  const grid=document.querySelector("#res .rgrid"); if(!grid) return;
  const box=h("div",{className:"box full"},`<h3>🖼 サムネイルの釣り度</h3><div class="thumbrow"><img id="thImg" src="/api/thumb?id=${r.yt_id}" crossorigin="anonymous"><div id="thRes"><div class="mtag">画像を解析中…</div></div></div>`);
  grid.appendChild(box);
  const img=$("#thImg");
  img.onload=()=>analyzeThumb(img);
  img.onerror=()=>$("#thRes").innerHTML='<div class="mtag">サムネイルを取得できませんでした</div>';
};
async function analyzeThumb(img){
  const W=192,H=108, cv=h("canvas",{width:W,height:H}), cx=cv.getContext("2d"); cx.drawImage(img,0,0,W,H);
  const px=cx.getImageData(0,0,W,H).data; let sat=0,red=0,yel=0,edge=0,lum=[],n=W*H;
  for(let i=0;i<px.length;i+=4){
    const r=px[i]/255,g=px[i+1]/255,b=px[i+2]/255, mx=Math.max(r,g,b), mn=Math.min(r,g,b), s=mx? (mx-mn)/mx:0;
    let hh=0; if(mx!==mn){ hh = mx===r? (g-b)/(mx-mn)%6 : mx===g? (b-r)/(mx-mn)+2 : (r-g)/(mx-mn)+4; hh*=60; if(hh<0) hh+=360; }
    sat+=s; if((hh<14||hh>346)&&s>.55&&mx>.45) red++; if(hh>42&&hh<66&&s>.55&&mx>.65) yel++;
    lum.push(.299*r+.587*g+.114*b);
  }
  for(let y=0;y<H;y++) for(let x=1;x<W;x++){ if(Math.abs(lum[y*W+x]-lum[y*W+x-1])>.25) edge++; }
  sat/=n; red/=n; yel/=n; edge/=n;
  const mean=lum.reduce((a,b)=>a+b,0)/n, sd=Math.sqrt(lum.reduce((a,b)=>a+(b-mean)**2,0)/n);
  let faces=null;
  if("FaceDetector" in window){ try{ const fd=new FaceDetector({fastMode:true}); const f=await fd.detect(img); faces=f.length; }catch{} }
  const score=Math.min(100,Math.round(sat*32+red*280+yel*240+edge*150+sd*20+(faces?8:0)));
  const st=score<15?1:score<32?2:score<50?3:score<68?4:5;
  const pct=v=>Math.round(v*100)+"%";
  $("#thRes").innerHTML=`<div class="stars" style="color:${color(st)};font-size:18px">${stars(st)} <span style="font-size:14px">${score}/100</span></div>
    <ul style="margin:6px 0;padding-left:18px;font-size:13px">
      <li>色の派手さ（彩度）: ${pct(sat)} ${sat>.45?"⚠ かなり派手":""}</li>
      <li>真っ赤な部分（矢印・丸囲み等）: ${pct(red)} ${red>.06?"⚠ 多い":""}</li>
      <li>黄色い部分（強調文字等）: ${pct(yel)} ${yel>.05?"⚠ 多い":""}</li>
      <li>文字・輪郭の多さ: ${pct(edge)} ${edge>.14?"⚠ 文字が多い可能性":""}</li>
      <li>明暗のコントラスト: ${pct(sd)}</li>
      ${faces!=null?`<li>顔の検出: ${faces}人</li>`:""}
    </ul>
    <button class="btn" id="ocrBtn">🔤 サムネの文字を読んで判定（OCR）</button><div id="ocrRes" class="mtag"></div>`;
  $("#ocrBtn").onclick=()=>runOCR(img);
}
async function runOCR(img){
  const out=$("#ocrRes"); $("#ocrBtn").disabled=true;
  out.textContent="文字認識エンジンを読み込み中…（初回は日本語データ約15MBのダウンロードで1分ほどかかります）";
  try{
    if(!window.Tesseract){ await new Promise((ok,ng)=>{ const s=h("script",{src:"https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js"}); s.onload=ok; s.onerror=ng; document.head.appendChild(s); }); }
    const r=await Tesseract.recognize(img.src,"jpn+eng",{logger:m=>{ if(m.status==="recognizing text") out.textContent=`文字を認識中… ${Math.round(m.progress*100)}%`; }});
    const text=r.data.text.replace(/\s+/g," ").trim();
    if(!text){ out.textContent="サムネイルから文字は見つかりませんでした"; return; }
    const s=await api("/api/score_text",{text});
    out.innerHTML=`<div style="color:var(--text);margin-top:6px">読み取った文字: 「${esc(text.slice(0,120))}」</div><div class="stars" style="color:${color(s.stars)}">${stars(s.stars)} 文字の釣り度 ${s.score}/100</div>${s.reasons.slice(0,3).map(x=>"・"+esc(x)).join("<br>")}`;
  }catch(e){ out.textContent="文字認識に失敗しました: "+(e.message||e); }
  finally{ $("#ocrBtn").disabled=false; }
}

/* ============ 判定履歴・釣りランキング（11） ============ */
const hist=h("details",{className:"hist"},'<summary>📜 判定履歴・釣りランキング <span class="mtag" id="hN"></span></summary><div id="hBody" class="mtag">読み込み中…</div>');
document.querySelector(".checker").appendChild(hist);
hist.addEventListener("toggle",()=>{ if(hist.open) loadHistory(); });
async function loadHistory(){
  try{
    const d=await api("/api/history"); $("#hN").textContent=`${d.total}件`;
    if(!hist.open) return;
    $("#hBody").innerHTML=`<div class="hgrid">
      <div><h4>🏆 釣りランキング（サイト・チャンネル別の平均釣り度）</h4>
        ${d.ranking.length?`<table class="rk"><tr><th>#</th><th>サイト/チャンネル</th><th>平均</th><th>判定数</th></tr>${d.ranking.map((r,i)=>`<tr title="最も釣り度が高かった見出し: ${esc(r.worst)}"><td>${i+1}</td><td>${esc(r.site)}</td><td style="color:${color(r.avg<12?1:r.avg<30?2:r.avg<50?3:r.avg<70?4:5)}">${r.avg}</td><td>${r.count}</td></tr>`).join("")}</table>`:'<p>URLを判定するとここにランキングが溜まっていきます</p>'}</div>
      <div><h4>🕘 最近の判定</h4><ul class="dl">${d.history.slice(0,30).map(x=>`<li><span style="color:${color(x.stars)}">${stars(x.stars)}</span> ${esc(x.title_ja||x.title)}<div class="m">${esc(x.site)} ・ ${fmtT(x.time)} ・ <a href="#" data-re="${esc(x.input)}">再判定</a></div></li>`).join("")||"<li>まだ履歴がありません</li>"}</ul>
        ${d.total?'<button class="ib" id="hClr">履歴を消去</button>':""}</div></div>`;
    const c=$("#hClr"); if(c) c.onclick=async()=>{ if(!confirm("判定履歴をすべて消去しますか？")) return; await api("/api/history/clear",{}); loadHistory(); };
  }catch(e){ $("#hBody").textContent="履歴を読み込めませんでした"; }
}
$("#hBody").addEventListener("click",e=>{ const a=e.target.closest("[data-re]"); if(!a) return; e.preventDefault(); $("#inp").value=a.dataset.re; window.scrollTo({top:0,behavior:"smooth"}); $("#go").click(); });
loadHistory();
loadSettings().catch(()=>{});
})();
