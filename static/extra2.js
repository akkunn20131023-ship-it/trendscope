/* TrendScope 追加機能 第2弾 */
(function(){
"use strict";
const h=(t,a={},html="")=>{const e=document.createElement(t);Object.assign(e,a);if(html)e.innerHTML=html;return e;};
const now=()=>Date.now()/1000;
function modal2(title, html){ $("#mBody").innerHTML=`<h2>${title}</h2>${html}`; $("#modal").classList.add("show"); }
const closeModal=()=>$("#modal").classList.remove("show");
const fmtN=(v,d=2)=>v==null?"—":Number(v).toLocaleString("ja-JP",{maximumFractionDigits:d,minimumFractionDigits:v>=1000?0:d});
const spark=(arr,w=70,h=20,col)=>{ if(!arr||arr.length<2) return ""; const mn=Math.min(...arr),mx=Math.max(...arr),r=mx-mn||1;
  const pts=arr.map((v,i)=>`${(i/(arr.length-1)*w).toFixed(1)},${(h-(v-mn)/r*h).toFixed(1)}`).join(" ");
  return `<svg width="${w}" height="${h}" class="spk"><polyline points="${pts}" fill="none" stroke="${col||(arr[arr.length-1]>=arr[0]?"#46d39a":"#ff5d6c")}" stroke-width="1.6"/></svg>`; };

/* ============ 統計（偏り度・バッジ用）ローカル保存 ============ */
const ST = LS.get("stats", {reads:[], days:[], quiz:{played:0,perfect:0,best:0}, game:{played:0,best:0}, used:{}});
const saveST=()=>LS.set("stats",ST);
function useFeature(k){ ST.used[k]=(ST.used[k]||0)+1; saveST(); checkBadges(); }
function markDay(){ const d=new Date().toISOString().slice(0,10); if(!ST.days.includes(d)){ ST.days.push(d); ST.days=ST.days.slice(-400); saveST(); } }
markDay();
const READ = new Set(LS.get("readIds",[]));
function markRead(it){
  if(!it || READ.has(it.id)) return;
  READ.add(it.id); LS.set("readIds",[...READ].slice(-3000));
  ST.reads.push({id:it.id, s:it.source, c:it.cat, g:(it.geo||[])[0]||"", t:now()}); ST.reads=ST.reads.slice(-2000); saveST();
  document.querySelectorAll(`.card[data-id="${CSS.escape(it.id)}"]`).forEach(c=>c.classList.add("read"));
  checkBadges();
}
const itemById = id => [...S.items, ...S.favs, ...LATER].find(x=>x.id===id);

/* ============ 後で読む（12） ============ */
let LATER = LS.get("later", []);
CATS.splice(CATS.length-1, 0, ["later","📌 後で読む"]);
const _list = list;
list = function(){
  if(S.tab!=="later") return _list();
  let L=[...LATER]; if(S.q){ const q=S.q.toLowerCase(); L=L.filter(i=>(i.title+" "+i.title_ja).toLowerCase().includes(q)); } return L;
};
const _renderTabs = renderTabs;
renderTabs = function(){ _renderTabs(); const t=document.querySelector('.tab[data-k="later"] .n'); if(t) t.textContent=LATER.length; };
function toggleLater(it){
  const i=LATER.findIndex(x=>x.id===it.id);
  if(i>=0){ LATER.splice(i,1); toast("「後で読む」から外しました"); } else { LATER.unshift({...it, later_at:now()}); toast("📌 後で読むに追加しました"); }
  LS.set("later",LATER); renderTabs(); decorateCards(); if(S.tab==="later") render();
}

/* ============ カード装飾：既読・追加ボタン ============ */
function decorateCards(){
  document.querySelectorAll("#grid .card").forEach(c=>{
    const id=c.dataset.id; c.classList.toggle("read", READ.has(id));
    const acts=c.querySelector(".acts");
    if(acts && !acts.querySelector('[data-act2="later"]')){
      const sp=acts.querySelector(".sp");
      const b1=h("button",{className:"ib",title:"同じ出来事を各国メディアがどう報じたか比較"},"🌐 報じ方"); b1.dataset.act2="frame";
      const b2=h("button",{className:"ib",title:"後で読む (L)"},"📌"); b2.dataset.act2="later";
      acts.insertBefore(b1, sp); acts.insertBefore(b2, sp);
    }
    const lb=c.querySelector('[data-act2="later"]'); if(lb) lb.classList.toggle("on", LATER.some(x=>x.id===id));
  });
}
new MutationObserver(()=>decorateCards()).observe($("#grid"),{childList:true});
$("#grid").addEventListener("click", e=>{
  const card=e.target.closest(".card"); if(!card) return;
  const it=itemById(card.dataset.id); if(!it) return;
  const a2=e.target.closest("[data-act2]");
  if(a2){ e.stopPropagation(); if(a2.dataset.act2==="later") toggleLater(it); if(a2.dataset.act2==="frame") openFraming(it); return; }
  if(e.target.closest('a[href^="http"]') || e.target.closest('[data-act="sum"]')){ markRead(it); if(e.target.closest('[data-act="sum"]')) useFeature("summary"); }
}, true);
// 未読のみ
const tools=document.querySelector(".tools");
const unreadLab=h("label",{},'<input type="checkbox" id="onlyUnread"> 未読のみ');
tools.insertBefore(unreadLab, $("#cnt"));
$("#onlyUnread").checked = LS.get("onlyUnread",false); $("#grid").classList.toggle("hideRead", $("#onlyUnread").checked);
$("#onlyUnread").onchange=e=>{ LS.set("onlyUnread",e.target.checked); $("#grid").classList.toggle("hideRead",e.target.checked); };

/* ============ マーケット（2） ============ */
const ticker=h("div",{id:"ticker"},'<span class="mtag">マーケット読み込み中…</span>');
document.querySelector("header").appendChild(ticker);
let MKT=null;
async function loadMarkets(){
  try{
    MKT=await api("/api/markets");
    ticker.innerHTML=MKT.markets.filter(m=>m.price!=null).map(m=>`<span class="tk" title="${esc(m.note||"")} 1か月の推移">${esc(m.name)} <b>${fmtN(m.price, m.price>1000?0:2)}${esc(m.unit==="円"?"円":"")}</b> <i class="${m.pct>=0?"up":"dn"}">${m.pct>=0?"▲":"▼"}${Math.abs(m.pct).toFixed(2)}%</i>${spark(m.spark,46,14)}</span>`).join("")
      + `<button class="ib tkx" title="非表示">×</button>`;
    ticker.querySelector(".tkx").onclick=()=>{ ticker.classList.add("off"); LS.set("tickerOff",true); };
  }catch(e){ ticker.innerHTML='<span class="mtag">マーケット情報を取得できませんでした</span>'; }
}
if(LS.get("tickerOff",false)) ticker.classList.add("off");
loadMarkets(); setInterval(loadMarkets, 300000);

/* ============ 国のプロフィール（1） ============ */
let COUNTRIES=[];
api("/api/countries").then(c=>{ COUNTRIES=c; const sel=$("#ctySel"); if(sel) sel.innerHTML='<option value="">🏳 国を選んでプロフィール…</option>'+c.map(x=>`<option value="${x.code}">${esc(x.ja)}</option>`).join(""); }).catch(()=>{});
const REGION = {アジア:"JP CN KR KP TW MN HK VN TH KH MM MY SG ID PH IN PK BD LK NP AF KZ".split(" "),
  中東:"IL PS LB SY IQ IR SA AE QA YE JO TR".split(" "), ヨーロッパ:"GB IE FR DE IT ES PT NL BE CH AT SE NO FI DK IS PL CZ HU RO GR RS UA RU BY GE GL".split(" "),
  アフリカ:"EG LY TN DZ MA SD SS ET ER SO KE UG TZ RW CD NG GH ML BF NE SN CM ZA ZW MZ MG".split(" "),
  北米:"US CA MX CU HT".split(" "), 南米:"BR AR CL PE CO VE EC BO".split(" "), オセアニア:"AU NZ AQ".split(" ")};
let _dn=null; try{ _dn=new Intl.DisplayNames(["ja"],{type:"region"}); }catch{}
const ctyName = (name, code) => (/^[A-Z]{2}$/.test(name) && _dn)? (_dn.of(code||name)||name) : name;
const regionOf = code => Object.keys(REGION).find(r=>REGION[r].includes(code)) || "その他";
window.openCountry = async function(code){
  useFeature("country");
  const target=(curView==="map")? side : (html=>modal2("", html));
  target(`<div id="cty"><div class="spin" style="margin:20px auto"></div></div>`);
  try{
    const p=await api("/api/country?code="+code);
    const lt = p.weather? (()=>{ const d=new Date(Date.now()+p.weather.utc_offset*1000); return `${String(d.getUTCHours()).padStart(2,"0")}:${String(d.getUTCMinutes()).padStart(2,"0")}`; })() : "";
    $("#cty").innerHTML=`
      <div class="ctyhead">${p.flag?`<img src="${esc(p.flag)}" alt="">`:""}<div><h3 style="margin:0">${esc(p.ja)}</h3><div class="mtag">${esc(p.official_ja||p.name_en||"")} ・ ${esc(p.region||"")}</div></div></div>
      <table class="ctyt">
        ${p.capital?`<tr><th>首都</th><td>${esc(p.capital)}</td></tr>`:""}
        ${p.population?`<tr><th>人口</th><td>${(p.population/1e4).toLocaleString("ja-JP",{maximumFractionDigits:0})}万人</td></tr>`:""}
        ${p.area?`<tr><th>面積</th><td>${Number(p.area).toLocaleString("ja-JP")} km²（日本の約${(p.area/377975).toFixed(p.area<377975?2:1)}倍）</td></tr>`:""}
        ${p.languages?.length?`<tr><th>言語</th><td>${p.languages.map(esc).join("、")}</td></tr>`:""}
        ${p.currencies?.length?`<tr><th>通貨</th><td>${p.currencies.map(esc).join("、")}${p.jpy_rate?`<br><span class="mtag">1 ${esc(p.jpy_rate.cur)} ≒ ${fmtN(p.jpy_rate.jpy)}円（${esc(p.jpy_rate.date)}）</span>`:""}</td></tr>`:""}
        ${p.weather?`<tr><th>いまの首都</th><td>${p.weather.icon} ${esc(p.weather.desc)} ${p.weather.temp}℃ ・ 現地 <b>${lt}</b></td></tr>`:""}
        ${p.drive?`<tr><th>車線</th><td>${p.drive==="left"?"左側通行":"右側通行"}</td></tr>`:""}
        ${p.phone?`<tr><th>国番号</th><td>${esc(p.phone)}</td></tr>`:""}
      </table>
      ${p.wiki?.extract?`<p style="font-size:13.5px">${esc(p.wiki.extract)} <a href="${esc(p.wiki.url)}" target="_blank" rel="noopener">Wikipedia↗</a></p>`:""}
      ${p.conflicts?.length?`<div class="mtag">⚔ 関連する紛争・対立: ${p.conflicts.map(esc).join(" / ")}</div>`:""}
      <h4 style="margin:12px 0 4px">📰 この国の最新ニュース</h4>
      <ul class="dl">${p.news.map(n=>`<li>${esc(n.title_ja)}<div class="m">${esc(n.source)} ・ <a href="${esc(n.url)}" target="_blank" rel="noopener">元記事↗</a></div></li>`).join("")||'<li class="mtag">収集したニュースには出てきていません</li>'}</ul>
      ${M?`<button class="btn" id="ctyGo">🗺 地図でこの国へ移動</button>`:""}`;
    const g=$("#ctyGo"); if(g) g.onclick=()=>{ closeModal(); showView("map"); setTimeout(()=>M.flyTo([p.lat,p.lon],5),300); };
  }catch(e){ $("#cty").innerHTML=`<div class="mtag">取得失敗: ${esc(e.message)}</div>`; }
};
// 地図パネルに国セレクト
const layersBox=$("#layers"); const selWrap=h("div",{className:"ctysel"},'<select id="ctySel" class="selx" style="width:100%"><option>読み込み中…</option></select>');
layersBox.insertBefore(selWrap, layersBox.querySelector("label"));
$("#ctySel").onchange=e=>{ if(e.target.value){ openCountry(e.target.value); e.target.value=""; } };
// ニュース話題地パネルにプロフィールボタンを追加
const _side = side;
side = function(html){
  _side(html);
  const m=html.match(/📍 (.+?) の話題/);
  if(m){ const c=COUNTRIES.find(x=>x.ja===m[1]); if(c){ const b=h("button",{className:"btn",style:"margin:6px 0"},"🏳 国のプロフィールを見る"); b.onclick=()=>openCountry(c.code); $("#sideBody").insertBefore(b, $("#sideBody").children[1]); } }
};

/* ============ 祝日レイヤー（3） ============ */
const holLab=h("label",{},'<input type="checkbox" data-layer="holiday"><span class="lg" style="background:#ffeb3b"></span>今日が祝日の国<span class="c" id="c-holiday"></span>');
layersBox.insertBefore(holLab, $("#mnote"));
LOADERS.holiday = async ()=>{
  try{
    const d=await api("/api/holidays"); LY.holiday.clearLayers();
    const byC={}; d.today.forEach(x=>{ if(x.lat!=null) (byC[x.code]=byC[x.code]||[]).push(x); });
    Object.values(byC).forEach(list=>{ const x=list[0];
      L.marker([x.lat,x.lon],{icon:L.divIcon({className:"",html:'<div class="hol">🎌</div>',iconSize:[22,22],iconAnchor:[11,11]})}).addTo(LY.holiday)
        .bindPopup(`<b>🎌 ${esc(x.country)} は今日祝日</b><br>${list.map(y=>`${esc(y.name)}（${esc(y.local)}）`).join("<br>")}<br><span class="mtag">現地のニュースや市場が静かになりがちです</span>`); });
    $("#c-holiday").textContent=`${Object.keys(byC).length}か国`;
  }catch(e){ $("#c-holiday").textContent="失敗"; }
};
EVERY.holiday=3600000;

/* ============ 報じ方の比較（5） ============ */
async function openFraming(it){
  useFeature("framing"); markRead(it);
  modal2("🌐 報じ方の比較", `<div class="mtag">「${esc(it.title_ja||it.title)}」と同じ出来事を、世界のメディアがどう見出しにしたかを並べます</div><div id="frm"><div class="spin" style="margin:20px auto"></div></div>`);
  try{
    const r=await api(`/api/framing?id=${encodeURIComponent(it.id)}`);
    $("#frm").innerHTML = `<div class="mtag">検索語: ${esc(r.query)}</div>
      ${r.loaded_summary.length?`<div class="orig" style="margin:8px 0">${r.loaded_summary.map(([w,n])=>`<span class="ldw">${esc(w)} ×${n}</span>`).join("")}</div>`:""}
      <table class="frt"><tr><th>メディア</th><th>見出し</th><th>注目語</th></tr>
      ${r.rows.map(x=>`<tr><td><b>${esc(x.outlet)}</b><div class="mtag">${esc(x.country||"")}</div></td>
        <td><a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title_ja)}</a>${x.lang==="en"?`<div class="mtag">${esc(x.title)}</div>`:""}${x.bait>=30?`<span class="bait">煽り${x.bait}</span>`:""}</td>
        <td>${x.loaded.map(w=>`<span class="ldw">${esc(w)}</span>`).join(" ")||'<span class="mtag">—</span>'}</td></tr>`).join("")||'<tr><td colspan=3 class="mtag">同じ出来事を報じた記事が見つかりませんでした</td></tr>'}</table>
      <p class="mtag">${esc(r.note)}</p>`;
  }catch(e){ $("#frm").innerHTML=`<div class="mtag">比較できませんでした: ${esc(e.message)}</div>`; }
}
window.openFraming=openFraming;

/* ============ チェッカー拡張：ファクトチェック（6）・画像（7） ============ */
const chipsBox=document.querySelector(".samples");
chipsBox.appendChild(h("button",{className:"chip",id:"chipImg",title:"画像そのもののURLを貼ってから押す"},"🖼 画像の出どころチェック"));
chipsBox.appendChild(h("button",{className:"chip",id:"chipFc"},"🔍 ファクトチェック記事を探す"));
$("#chipImg").onclick=()=>{ const v=$("#inp").value.trim(); if(!/^https?:\/\//.test(v)) return toast("画像のURL（https://〜.jpg など）を入力欄に貼ってください"); imageCheck(v); };
$("#chipFc").onclick=()=>{ const v=$("#inp").value.trim(); if(!v) return toast("調べたい話・見出しを入力欄に入れてください"); factCheck(v); };
const IMG_RE=/^https?:\/\/\S+\.(jpe?g|png|gif|webp)(\?\S*)?$|^https?:\/\/pbs\.twimg\.com\/media\//i;
const _runCheck = runCheck;
runCheck = async function(){ const v=$("#inp").value.trim(); useFeature("check"); if(IMG_RE.test(v)) return imageCheck(v); return _runCheck(); };
$("#go").onclick=()=>runCheck();
async function imageCheck(url){
  useFeature("image");
  const res=$("#res"); res.className="result show"; res.innerHTML='<div class="spin" style="margin:0 0 8px"></div>画像を調べています…';
  try{
    const r=await api("/api/image_check?url="+encodeURIComponent(url));
    if(r.error){ res.innerHTML=`<div style="color:var(--warn)">⚠ ${esc(r.error)}</div>`; return; }
    res.innerHTML=`<div class="thumbrow"><img src="/api/image_proxy?url=${encodeURIComponent(url)}" style="max-height:260px">
      <div style="flex:1;min-width:240px"><h3 style="margin:0 0 6px">🖼 画像の出どころチェック</h3>
      <div class="mtag">${esc(r.format)} ・ ${r.size?r.size.join("×")+"px":""} ・ ${(r.bytes/1024).toFixed(0)}KB</div>
      <h4 style="margin:10px 0 4px">🔎 この画像が過去に出回っていないか調べる</h4>
      <div class="samples">${r.search.map(s=>`<a class="chip" href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.name)} ↗</a>`).join("")}</div>
      <h4 style="margin:10px 0 4px">📷 撮影情報（EXIF）</h4>
      ${Object.keys(r.exif).length?`<table class="ctyt">${Object.entries(r.exif).map(([k,v])=>`<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table>`:'<div class="mtag">記録なし</div>'}
      <h4 style="margin:10px 0 4px">💡 見るポイント</h4><ul style="margin:0;padding-left:18px;font-size:13.5px">${r.hints.map(x=>`<li>${esc(x)}</li>`).join("")}
      <li>検索結果で、もっと古い日付に同じ画像が出てきたら「使い回し」の可能性が高いです</li></ul></div></div>`;
  }catch(e){ res.innerHTML=`<div style="color:var(--bad)">エラー: ${esc(e.message)}</div>`; }
}
async function factCheck(text){
  useFeature("factcheck");
  modal2("🔍 ファクトチェック記事を探す", `<div class="mtag">「${esc(text.slice(0,80))}」</div><div id="fcr"><div class="spin" style="margin:20px auto"></div></div>`);
  try{
    const r=await api("/api/factcheck?q="+encodeURIComponent(text));
    if(r.error){ $("#fcr").innerHTML=`<div class="mtag">${esc(r.error)}</div>`; return; }
    $("#fcr").innerHTML=`<div class="mtag">検索語: ${esc(r.query_ja)} / ${esc(r.query_en)}</div>
      <ul class="dl">${r.results.map(x=>`<li>${x.verdict?`<span class="vd ${x.verdict==="誤り"?"ng":"ok"}">${esc(x.verdict)}</span> `:""}<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title_ja)}</a><div class="m">${esc(x.source)} ・ ${fmtT(x.time)}${x.lang==="en"?" ・ 英語記事":""}</div></li>`).join("")||'<li>関連する検証記事は見つかりませんでした。</li>'}</ul>
      <p class="mtag">${esc(r.note)}</p>`;
  }catch(e){ $("#fcr").innerHTML=`<div class="mtag">検索に失敗: ${esc(e.message)}</div>`; }
}
const _onCheck = window.onCheckResult;
window.onCheckResult = function(r){
  if(_onCheck) _onCheck(r);
  const top=document.querySelector("#res .rtop > div:last-child");
  if(top && !top.querySelector(".fcb")){ const b=h("button",{className:"btn fcb",style:"margin-top:8px"},"🔍 この話のファクトチェック記事を探す"); b.onclick=()=>factCheck(r.title); top.appendChild(b); }
};

/* ============ ダイジェスト拡張：マーケット・祝日/今日は何の日・Wiki急上昇・偏り度・バッジ・週報 ============ */
const _onDigest = window.onDigest;
window.onDigest = function(d){
  if(_onDigest) _onDigest(d);
  useFeature("digest");
  const g=$("#dgrid"), bar=g.querySelector(".sayrow");
  if(bar){ const wb=h("a",{className:"btn",href:"/report/weekly",target:"_blank"},"📄 週間レポート（PDF保存）"); bar.appendChild(wb); wb.onclick=()=>useFeature("report"); }
  const add=(html,cls="dcard")=>{ const c=h("div",{className:cls},html); g.appendChild(c); return c; };
  // マーケット
  const mc=add('<h3>📈 マーケット</h3><div id="dmkt" class="mtag">読み込み中…</div>');
  const drawM=()=>{ if(!MKT) return; $("#dmkt").innerHTML=`<table class="mkt">${MKT.markets.map(m=>`<tr><td>${esc(m.name)}</td><td class="r">${m.price!=null?fmtN(m.price,m.price>1000?0:2):"—"}</td><td class="r ${m.pct>=0?"up":"dn"}">${m.price!=null?(m.pct>=0?"+":"")+m.pct.toFixed(2)+"%":esc(m.error||"")}</td><td>${spark(m.spark,90,22)}</td></tr>`).join("")}</table><p class="mtag">${esc(MKT.note)}</p>`; };
  MKT? drawM() : loadMarkets().then(drawM);
  // 祝日・今日は何の日
  const hc=add('<h3>🎌 今日は何の日・世界の祝日</h3><div id="dhol" class="mtag">読み込み中…</div>');
  api("/api/holidays").then(x=>{
    $("#dhol").innerHTML=`${x.today.length?`<div style="color:var(--text)"><b>今日が祝日:</b> ${[...new Map(x.today.map(t=>[t.code,t])).values()].map(t=>`${esc(ctyName(t.country,t.code))}（${esc(t.name)}）`).join("、")}</div>`:'<div>今日が祝日の国はありません</div>'}
      ${x.upcoming.length?`<div style="margin-top:4px">この先: ${x.upcoming.slice(0,8).map(t=>`${esc(t.date.slice(5))} ${esc(ctyName(t.country,t.code))}「${esc(t.name)}」`).join(" / ")}</div>`:""}
      <h4 style="margin:10px 0 4px;color:var(--text)">📅 過去の今日のできごと</h4>
      <ul class="dl">${(x.onthisday||[]).slice(0,6).map(e=>`<li><b>${e.year}年</b> ${esc(e.text)}</li>`).join("")||"<li>取得できませんでした</li>"}</ul>`;
  }).catch(()=>$("#dhol").textContent="取得できませんでした");
  // Wiki急上昇
  const wc=add('<h3>📚 ウィキペディア急上昇 <span class="mtag" id="wdate"></span></h3><div class="samples"><button class="chip on" data-w="ja">日本語版</button><button class="chip" data-w="en">英語版（世界）</button></div><div id="dwiki" class="mtag">読み込み中…</div>');
  let WK=null; const drawW=lang=>{ const L=(WK[lang]||[]).filter(a=>!/^(メインページ|Main Page|特別:|Special:)/.test(a.title)).slice(0,12);
    $("#dwiki").innerHTML=`<ol class="wk">${L.map(a=>`<li><a href="${esc(a.url)}" target="_blank" rel="noopener"><b>${esc(a.title_ja||a.title)}</b></a>${a.title_ja&&a.title_ja!==a.title?` <span class="mtag">${esc(a.title)}</span>`:""} <span class="mtag">${a.views.toLocaleString()}回</span>${spark(a.trend,40,12,"#5b9dff")}<div class="m">${esc(a.desc||"")}</div></li>`).join("")||"<li>取得できませんでした</li>"}</ol>`; };
  wc.querySelectorAll("[data-w]").forEach(b=>b.onclick=()=>{ wc.querySelectorAll("[data-w]").forEach(x=>x.classList.toggle("on",x===b)); WK&&drawW(b.dataset.w); });
  api("/api/wiki_trending").then(x=>{ WK=x; $("#wdate").textContent=`${x.date} の閲覧数`; drawW("ja"); }).catch(()=>$("#dwiki").textContent="取得できませんでした");
  // 偏り度メーター
  add(biasHTML(), "dcard");
  // バッジ
  const bc=add(`<h3>🏅 実績バッジ <span class="mtag">${unlockedCount()}/${BADGES.length}</span></h3><div class="bdg">${BADGES.map(b=>`<span class="b ${isUnlocked(b)?"on":""}" title="${esc(b.desc)}">${b.icon}<small>${esc(b.name)}</small></span>`).join("")}</div><div class="samples" style="margin-top:8px"><button class="btn" id="dQuiz">🧠 今日のクイズ</button><button class="btn" id="dGame">🎣 釣りか本物かゲーム</button></div>`);
  $("#dQuiz").onclick=startQuiz; $("#dGame").onclick=startGame;
};

/* ============ 偏り度メーター（8） ============ */
function biasHTML(){
  const wk=ST.reads.filter(r=>r.t>now()-7*86400);
  if(wk.length<3) return `<h3>📊 あなたの読書傾向（7日間）</h3><p class="mtag">記事を開いたり要約したりすると、どの国・分野をよく読んでいるかがここに表示されます（この端末だけに保存）。いま ${wk.length}件。</p>`;
  const cnt=(arr)=>{ const m={}; arr.forEach(k=>{ if(k) m[k]=(m[k]||0)+1; }); return Object.entries(m).sort((a,b)=>b[1]-a[1]); };
  const catJa={world:"世界ニュース",tech:"テック",trivia:"雑学",bright:"明るい",game:"ゲーム"};
  const byCat=cnt(wk.map(r=>catJa[r.c]||r.c)), byReg=cnt(wk.map(r=>r.g?regionOf(r.g):"国の特定なし")), bySrc=cnt(wk.map(r=>r.s));
  const bars=(arr)=>{ const t=arr.reduce((a,b)=>a+b[1],0); return arr.slice(0,6).map(([k,v])=>`<div class="bar"><span class="l">${esc(k)}</span><span class="b" style="width:${v/t*60}%"></span><span class="mtag">${Math.round(v/t*100)}%</span></div>`).join(""); };
  const missing=Object.keys(REGION).filter(r=>!byReg.some(([k])=>k===r));
  const top=byCat[0], topShare=top? top[1]/wk.length : 0;
  return `<h3>📊 あなたの読書傾向（7日間・${wk.length}件）</h3>
    <div class="mtag">分野</div>${bars(byCat)}<div class="mtag" style="margin-top:6px">地域</div>${bars(byReg)}<div class="mtag" style="margin-top:6px">メディア</div>${bars(bySrc)}
    <p style="font-size:13.5px;margin:8px 0 0">${topShare>.6?`⚠ 「${esc(top[0])}」に${Math.round(topShare*100)}%偏っています。`:"✅ 分野のバランスは良好です。"}${missing.length?` 最近 <b>${missing.slice(0,3).join("・")}</b> のニュースを読んでいません。`:""}</p>`;
}

/* ============ クイズ（9） ============ */
const shuffle=a=>{ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; };
function makeQuiz(){
  const qs=[], items=shuffle(S.items.filter(i=>i.geo&&i.geo.length&&i.title_ja));
  const allC=[...new Set(S.items.flatMap(i=>i.geo||[]))];
  for(const it of items){
    if(qs.length>=3) break;
    const c=COUNTRIES.find(x=>x.code===it.geo[0]); if(!c) continue;
    let t=it.title_ja; const names=[c.ja,...(c.ja==="アメリカ"?["米国","米"]:c.ja==="イギリス"?["英国"]:c.ja==="ロシア"?["露"]:[])];
    names.forEach(n=>t=t.split(n).join("〇〇"));
    const others=shuffle(allC.filter(x=>x!==c.code)).slice(0,3).map(x=>COUNTRIES.find(y=>y.code===x)?.ja).filter(Boolean);
    while(others.length<3){ const r=COUNTRIES[Math.floor(Math.random()*COUNTRIES.length)]; if(r.ja!==c.ja && !others.includes(r.ja)) others.push(r.ja); }
    qs.push({q:`このニュースはどの国の話？\n「${t}」`, a:c.ja, ch:shuffle([c.ja,...others]), it});
  }
  const srcs=[...new Set(S.items.map(i=>i.source))];
  for(const it of shuffle([...S.items]).slice(0,10)){
    if(qs.length>=5) break;
    if(srcs.length<4) break;
    qs.push({q:`この見出しを配信したのはどこ？\n「${it.title_ja}」`, a:it.source, ch:shuffle([it.source,...shuffle(srcs.filter(s=>s!==it.source)).slice(0,3)]), it});
  }
  return shuffle(qs);
}
function startQuiz(){
  const qs=makeQuiz(); if(qs.length<3) return toast("ニュースが少なくてクイズを作れませんでした");
  let i=0, score=0;
  const show=()=>{
    if(i>=qs.length){
      ST.quiz.played++; if(score===qs.length) ST.quiz.perfect++; ST.quiz.best=Math.max(ST.quiz.best,score); saveST(); checkBadges();
      modal2("🧠 今日のクイズ 結果", `<div class="qres">${score} / ${qs.length} 問正解！</div><p>${score===qs.length?"🎉 満点！世界のニュースをよく見ていますね":score>=3?"👍 なかなかの世界通です":"📰 ダイジェストを読むと点数が上がるかも"}</p><button class="btn pri" id="qAgain">もう一度</button>`);
      $("#qAgain").onclick=startQuiz; return;
    }
    const q=qs[i];
    modal2(`🧠 今日のクイズ（${i+1}/${qs.length}）`, `<p class="qq">${esc(q.q).replace(/\n/g,"<br>")}</p><div class="qch">${q.ch.map(c=>`<button class="btn" data-c="${esc(c)}">${esc(c)}</button>`).join("")}</div><div id="qfb"></div>`);
    document.querySelectorAll(".qch [data-c]").forEach(b=>b.onclick=()=>{
      const ok=b.dataset.c===q.a; if(ok) score++;
      document.querySelectorAll(".qch [data-c]").forEach(x=>{ x.disabled=true; if(x.dataset.c===q.a) x.classList.add("pri"); });
      $("#qfb").innerHTML=`<p>${ok?"⭕ 正解！":"❌ 残念、正解は「"+esc(q.a)+"」"}</p><div class="mtag">${esc(q.it.title_ja)}（${esc(q.it.source)}）</div><button class="btn pri" id="qNext" style="margin-top:8px">次へ →</button>`;
      $("#qNext").onclick=()=>{ i++; show(); };
    });
  };
  show();
}

/* ============ 釣りか本物かゲーム（10） ============ */
const BAITS=[t=>`【衝撃】${t}…`, t=>`${t}、専門家も驚愕`, t=>`【悲報】${t}`, t=>`${t}がヤバすぎる`, t=>`まさかの展開…${t}`, t=>`99%が知らない${t}の真実`,
  t=>`${t}→結果ｗｗｗ`, t=>`【朗報】${t}！！`, t=>`${t}…その理由がとんでもなかった`, t=>`閲覧注意：${t}`, t=>`${t}、ネット騒然`];
function startGame(){
  const pool=shuffle(S.items.filter(i=>(i.bait?.stars||1)<=1 && i.title_ja && i.title_ja.length<70)).slice(0,5);
  if(pool.length<3) return toast("ニュースが少なくてゲームを作れませんでした");
  let i=0, score=0;
  const show=async()=>{
    if(i>=pool.length){
      ST.game.played++; ST.game.best=Math.max(ST.game.best,score); saveST(); checkBadges();
      modal2("🎣 釣りか本物か 結果",`<div class="qres">${score} / ${pool.length}</div><p>${score===pool.length?"🎯 完璧！釣りへの耐性バッチリ":"煽りワードに注目すると見抜きやすくなります"}</p><button class="btn pri" id="gAgain">もう一度</button>`);
      $("#gAgain").onclick=startGame; return;
    }
    const real=pool[i].title_ja, fake=BAITS[Math.floor(Math.random()*BAITS.length)](real.replace(/[。！!]$/,""));
    const opts=shuffle([{t:real,real:true},{t:fake,real:false}]);
    modal2(`🎣 本物の見出しはどっち？（${i+1}/${pool.length}）`, `<p class="mtag">片方は実際のニュース、もう片方は煽り表現を足した“釣り版”です</p><div class="gch">${opts.map((o,k)=>`<button class="btn gopt" data-k="${k}">${esc(o.t)}</button>`).join("")}</div><div id="gfb"></div>`);
    document.querySelectorAll(".gopt").forEach(b=>b.onclick=async()=>{
      const o=opts[+b.dataset.k]; if(o.real) score++;
      document.querySelectorAll(".gopt").forEach(x=>{ x.disabled=true; x.classList.add(opts[+x.dataset.k].real?"pri":"fake"); });
      let why=""; try{ const s=await api("/api/score_text",{text:fake}); why=s.reasons.slice(0,2).map(esc).join("<br>"); }catch{}
      $("#gfb").innerHTML=`<p>${o.real?"⭕ 正解！":"❌ そっちが釣り版でした"}</p><div class="mtag">釣り版の見分けポイント：<br>${why}</div><button class="btn pri" id="gNext" style="margin-top:8px">次へ →</button>`;
      $("#gNext").onclick=()=>{ i++; show(); };
    });
  };
  show();
}

/* ============ 実績バッジ（11） ============ */
const uniq=a=>new Set(a).size;
const streak=()=>{ let s=0; const d=new Date(); for(;;){ const k=d.toISOString().slice(0,10); if(ST.days.includes(k)){ s++; d.setDate(d.getDate()-1); } else break; } return s; };
const BADGES=[
  {id:"r10",icon:"📖",name:"読書家",desc:"記事を10本読む",ok:()=>ST.reads.length>=10},
  {id:"r100",icon:"📚",name:"ニュースの虫",desc:"記事を100本読む",ok:()=>ST.reads.length>=100},
  {id:"c10",icon:"🌍",name:"世界旅行者",desc:"10か国のニュースを読む",ok:()=>uniq(ST.reads.map(r=>r.g).filter(Boolean))>=10},
  {id:"reg",icon:"🧭",name:"全大陸制覇",desc:"6つの地域のニュースを読む",ok:()=>uniq(ST.reads.filter(r=>r.g).map(r=>regionOf(r.g)))>=6},
  {id:"s3",icon:"🔥",name:"3日連続",desc:"3日連続で開く",ok:()=>streak()>=3},
  {id:"s7",icon:"🏆",name:"1週間皆勤",desc:"7日連続で開く",ok:()=>streak()>=7},
  {id:"chk",icon:"🧊",name:"冷静な目",desc:"釣り判定を10回使う",ok:()=>(ST.used.check||0)>=10},
  {id:"img",icon:"🖼",name:"画像探偵",desc:"画像の出どころチェックを使う",ok:()=>(ST.used.image||0)>=1},
  {id:"fc",icon:"🔍",name:"ファクトチェッカー",desc:"ファクトチェック検索を3回使う",ok:()=>(ST.used.factcheck||0)>=3},
  {id:"frm",icon:"🌐",name:"多角的視点",desc:"報じ方の比較を5回使う",ok:()=>(ST.used.framing||0)>=5},
  {id:"sum",icon:"📝",name:"要約マスター",desc:"3行要約を20回使う",ok:()=>(ST.used.summary||0)>=20},
  {id:"q",icon:"🧠",name:"クイズ王",desc:"クイズで満点を取る",ok:()=>ST.quiz.perfect>=1},
  {id:"g",icon:"🎣",name:"釣られない人",desc:"釣りゲームで全問正解",ok:()=>ST.game.best>=5},
  {id:"cty",icon:"🏳",name:"国マニア",desc:"国のプロフィールを10回見る",ok:()=>(ST.used.country||0)>=10},
  {id:"dg",icon:"☀",name:"朝の習慣",desc:"ダイジェストを10回見る",ok:()=>(ST.used.digest||0)>=10},
  {id:"rep",icon:"📄",name:"レポーター",desc:"週間レポートを作る",ok:()=>(ST.used.report||0)>=1},
];
const GOT=new Set(LS.get("badges",[]));
const isUnlocked=b=>GOT.has(b.id);
const unlockedCount=()=>BADGES.filter(isUnlocked).length;
function checkBadges(){
  BADGES.forEach(b=>{ if(!GOT.has(b.id) && b.ok()){ GOT.add(b.id); LS.set("badges",[...GOT]); toast(`🏅 実績解除: ${b.icon} ${b.name}`); } });
}
setTimeout(checkBadges, 3000);

/* ============ その他メニュー：常駐・自動起動（15）・ショートカット（14） ============ */
const more=h("button",{className:"btn",title:"クイズ・ゲーム・実績・レポート・常駐設定"},"🧰");
document.querySelector(".status").insertBefore(more, $("#gearBtn"));
more.onclick=async()=>{
  const a=await api("/api/autostart").catch(()=>({supported:false}));
  modal2("🧰 その他", `
    <div class="samples"><button class="btn" id="mQuiz">🧠 今日のクイズ</button><button class="btn" id="mGame">🎣 釣りか本物かゲーム</button><button class="btn" id="mBadge">🏅 実績バッジ（${unlockedCount()}/${BADGES.length}）</button><a class="btn" href="/report/weekly" target="_blank" id="mRep">📄 週間レポート</a><button class="btn" id="mKeys">⌨ ショートカット一覧</button></div>
    <section class="sec"><h3>🖥 タスクトレイ常駐・自動起動</h3>
      ${a.supported?`<label class="row"><input type="checkbox" id="autoOn" ${a.enabled?"checked":""}> PCの起動時に TrendScope を自動で起動する（黒い画面なし・タスクトレイに常駐）</label>
      <p class="mtag">黒いウィンドウなしで今すぐ動かしたいときは、フォルダの <b>start_background.bat</b> をダブルクリック。画面右下のタスクトレイに 🌐 アイコンが出て、クリックで開く・右クリックで終了できます。</p>`
      :`<p class="mtag">この機能はWindows専用です。</p>`}
    </section>`);
  $("#mQuiz").onclick=startQuiz; $("#mGame").onclick=startGame; $("#mKeys").onclick=showKeys; $("#mRep").onclick=()=>useFeature("report");
  $("#mBadge").onclick=()=>modal2("🏅 実績バッジ",`<div class="bdg big">${BADGES.map(b=>`<span class="b ${isUnlocked(b)?"on":""}">${b.icon}<small>${esc(b.name)}</small><em>${esc(b.desc)}</em></span>`).join("")}</div><p class="mtag">連続 ${streak()}日 ・ 読んだ記事 ${ST.reads.length}本 ・ クイズ最高 ${ST.quiz.best}点</p>`);
  const ao=$("#autoOn"); if(ao) ao.onchange=async()=>{ const r=await api("/api/autostart",{on:ao.checked}); toast(r.enabled?"PC起動時に自動で起動するようにしました":"自動起動をオフにしました"); };
};

const KEYS=[["J / K","次 / 前のニュースへ"],["O / Enter","選んだニュースを開く"],["R","3行要約"],["S","お気に入り保存"],["L","後で読む"],["F","報じ方の比較"],["B","釣り判定"],
  ["/","キーワード検索"],["N / M / D / C","ニュース / 地図 / ダイジェスト / 温度差"],["Q","クイズ"],["Esc","閉じる・読み上げ停止"],["?","この一覧"]];
function showKeys(){ modal2("⌨ キーボードショートカット", `<table class="ctyt">${KEYS.map(([k,v])=>`<tr><th><kbd>${k}</kbd></th><td>${v}</td></tr>`).join("")}</table>`); }
let kIdx=-1;
function focusCard(d){
  const cards=[...document.querySelectorAll("#grid .card")].filter(c=>c.offsetParent); if(!cards.length) return;
  kIdx=Math.max(0,Math.min(cards.length-1,kIdx+d)); cards.forEach(c=>c.classList.remove("kf")); const c=cards[kIdx]; c.classList.add("kf"); c.scrollIntoView({block:"center",behavior:"smooth"});
}
const curCard=()=>document.querySelector("#grid .card.kf");
document.addEventListener("keydown",e=>{
  if(e.ctrlKey||e.metaKey||e.altKey) return;
  const tag=(e.target.tagName||"").toLowerCase(); if(["input","textarea","select"].includes(tag)){ if(e.key==="Escape") e.target.blur(); return; }
  const k=e.key;
  if(k==="Escape"){ closeModal(); $("#side")&&$("#side").classList.remove("show"); window.stopSay&&stopSay(); return; }
  if(k==="?"){ showKeys(); return; }
  if(k==="/"){ e.preventDefault(); showView("news"); $("#q").focus(); return; }
  const v={n:"news",m:"map",d:"digest",c:"compare"}[k.toLowerCase()]; if(v){ showView(v); return; }
  if(k.toLowerCase()==="q"){ startQuiz(); return; }
  if(curView!=="news") return;
  if(k==="j"){ focusCard(1); return; } if(k==="k"){ focusCard(-1); return; }
  const c=curCard(); if(!c) return;
  const click=sel=>{ const b=c.querySelector(sel); if(b) b.click(); };
  if(k==="o"||k==="Enter") click('a.ib[href]');
  if(k==="r") click('[data-act="sum"]'); if(k==="s") click('[data-act="fav"]'); if(k==="l") click('[data-act2="later"]');
  if(k==="f") click('[data-act2="frame"]'); if(k==="b") click('[data-act="check"]');
});
})();
