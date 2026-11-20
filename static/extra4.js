/* TrendScope 第4弾：画面整理(A)・軽量化(B)・安定化(C)・ガイド(D)・公開版 */
(function(){
"use strict";
const h=(t,a={},html="")=>{const e=document.createElement(t);Object.assign(e,a);if(html)e.innerHTML=html;return e;};
function modal4(title, html){ $("#mBody").innerHTML=`<h2>${title}</h2>${html}`; $("#modal").classList.add("show"); }

/* ============ B. 画面が見えていない間は自動更新を止める / C. 通信エラーをまとめて通知 ============ */
const _api = api; let lastErr=0;
const waitVisible=()=>new Promise(r=>{ if(!document.hidden) return r(); const f=()=>{ if(!document.hidden){ document.removeEventListener("visibilitychange",f); r(); } }; document.addEventListener("visibilitychange",f); });
api = async function(path, body){
  if(document.hidden && !body) await waitVisible();
  try{ return await _api(path, body); }
  catch(e){
    if(/Failed to fetch|NetworkError|502|503/.test(String(e.message)) && Date.now()-lastErr>30000){
      lastErr=Date.now(); toast(/Failed to fetch|NetworkError/.test(e.message)?"⚠ サーバーに接続できません（再起動中かもしれません）":"⚠ 外部サービスが応答していません。しばらくして自動で再試行します");
    }
    throw e;
  }
};

/* ============ A. ヘッダーのボタンを「☰ メニュー」にまとめる ============ */
const status=document.querySelector(".status");
const findBtn=t=>[...status.querySelectorAll("button")].find(b=>b.textContent.trim().startsWith(t));
const gear=$("#gearBtn"), tool=findBtn("🧰"), theme=findBtn("🌓");
[gear,tool,theme].forEach(b=>b&&(b.style.display="none"));
const menuBtn=h("button",{className:"btn",id:"menuBtn",title:"メニュー"},"☰");
status.appendChild(menuBtn);
const menu=h("div",{id:"menuPop"});
document.body.appendChild(menu);
const ITEMS=[
  ["⚙","設定（アラート・朝ブリーフィング・スマホ・通知・壁紙）",()=>gear&&gear.click()],
  ["🧰","クイズ・ゲーム・実績・レポート・常駐",()=>tool&&tool.click()],
  ["🌓","表示（テーマ・文字サイズ）",()=>theme&&theme.click()],
  ["🧩","表示する機能を選ぶ",()=>featurePicker()],
  ["🌍","公開サイト（Cloudflare Pages）",()=>publishPanel()],
  ["❓","使い方ガイド",()=>helpPage()],
  ["🧭","はじめてツアーをもう一度",()=>startTour(true)],
  ["📜","動作ログ",()=>logPanel()],
  ["⬆","アップデート（zipから更新）",()=>updatePanel()],
];
menu.innerHTML=ITEMS.map((x,i)=>`<button data-mi="${i}"><span>${x[0]}</span>${x[1]}</button>`).join("");
menuBtn.onclick=e=>{ e.stopPropagation(); const r=menuBtn.getBoundingClientRect(); menu.style.top=(r.bottom+6)+"px"; menu.style.right=(innerWidth-r.right)+"px"; menu.classList.toggle("show"); };
menu.onclick=e=>{ const b=e.target.closest("[data-mi]"); if(!b) return; menu.classList.remove("show"); ITEMS[+b.dataset.mi][2](); };
document.addEventListener("click",e=>{ if(!e.target.closest("#menuPop,#menuBtn")) menu.classList.remove("show"); });
// 更新時刻・ソース表示はコンパクトに
const upd=$("#upd"); if(upd) upd.classList.add("compact");

/* ============ A. カードのボタンを整理（よく使う3つ＋「⋯」） ============ */
function tidyCards(){
  document.querySelectorAll("#grid .card .acts").forEach(acts=>{
    let more=acts.querySelector(".moreBox");
    if(!more){
      more=h("div",{className:"moreBox"}); const tg=h("button",{className:"ib moreT",title:"その他の操作"},"⋯");
      tg.onclick=e=>{ e.stopPropagation(); document.querySelectorAll(".moreBox.show").forEach(m=>{ if(m!==more) m.classList.remove("show"); }); more.classList.toggle("show"); };
      acts.append(tg, more);
    }
    [...acts.children].forEach(b=>{
      if(b===more || b.classList.contains("moreT")) return;
      const keep = (b.tagName==="A" && !b.textContent.includes("記事本体")) || b.dataset.act==="sum" || b.dataset.act==="fav";
      if(!keep){ if([...b.textContent.trim()].length<=2 && b.title) b.textContent=b.textContent.trim()+" "+b.title.replace(/\s*\(.\)$/,""); more.appendChild(b); }
    });
  });
}
new MutationObserver(()=>setTimeout(tidyCards,0)).observe($("#grid"),{childList:true});
document.addEventListener("click",e=>{ if(!e.target.closest(".moreBox,.moreT")) document.querySelectorAll(".moreBox.show").forEach(m=>m.classList.remove("show")); });
setTimeout(tidyCards,800);

/* ============ A. 表示する機能を選ぶ（使わないタブ・ボタンを隠す） ============ */
const HIDE=LS.get("hiddenFeatures",{});
const FEATURES=[
  ["view:map","🗺 世界マップ タブ"],["view:digest","📋 ダイジェスト タブ"],["view:compare","🗾 温度差 タブ"],["view:archive","🗄 保存庫 タブ"],
  ["ticker","📈 マーケットの帯"],["checker","🧊 冷静判定チェッカー"],["bell","🔔 アラートのベル"],
];
function applyHide(){
  FEATURES.forEach(([k])=>{
    const on=!HIDE[k];
    if(k.startsWith("view:")){ const b=document.querySelector(`.vbtn[data-v="${k.slice(5)}"]`); if(b) b.style.display=on?"":"none"; }
    if(k==="ticker"){ const t=$("#ticker"); if(t) t.style.display=on?"":"none"; }
    if(k==="checker"){ const c=document.querySelector(".checker"); if(c) c.style.display=on?"":"none"; }
    if(k==="bell"){ const b=$("#bellBtn"); if(b) b.style.display=on?"":"none"; }
  });
}
function featurePicker(){
  modal4("🧩 表示する機能を選ぶ",`<p class="mtag">使わない機能を隠すと画面がすっきりします（いつでも戻せます）。地図のレイヤーは地図の左パネルで選べます。</p>
    ${FEATURES.map(([k,l])=>`<label class="row"><input type="checkbox" data-fk="${k}" ${HIDE[k]?"":"checked"}> ${l}</label>`).join("")}`);
  document.querySelectorAll("[data-fk]").forEach(cb=>cb.onchange=()=>{ if(cb.checked) delete HIDE[cb.dataset.fk]; else HIDE[cb.dataset.fk]=1; LS.set("hiddenFeatures",HIDE); applyHide(); });
}
setTimeout(applyHide, 500);

/* ============ C. 動作ログ ============ */
async function logPanel(){
  modal4("📜 動作ログ",`<div class="row"><button class="btn" id="lgR">🔄 再読み込み</button><label class="row"><input type="checkbox" id="lgE"> エラー・失敗だけ</label></div><pre id="lgBox" class="logbox">読み込み中…</pre>`);
  const load=async()=>{ const r=await api("/api/logs"); let L=r.lines; if($("#lgE").checked) L=L.filter(x=>/NG|失敗|エラー|Error|error/.test(x)); $("#lgBox").textContent=L.slice(-250).join("\n")||"（ログはまだありません）"; $("#lgBox").scrollTop=1e9; };
  $("#lgR").onclick=load; $("#lgE").onchange=load; load();
}

/* ============ C. アップデート（zipから） ============ */
function updatePanel(){
  modal4("⬆ アップデート",`<p>新しい <b>TrendScope.zip</b> を選ぶと、中身を入れ替えて自動で再起動します。</p>
    <ul class="mtag"><li>あなたのデータ（お気に入り・履歴・保存庫・設定）は消えません</li><li>入れ替え前のファイルは data フォルダに自動バックアップされます</li></ul>
    <div class="row"><input type="file" id="upZip" accept=".zip"><button class="btn pri" id="upGo">アップデート</button></div><div id="upMsg" class="mtag"></div>`);
  $("#upGo").onclick=async()=>{
    const f=$("#upZip").files[0]; if(!f) return toast("zipファイルを選んでください");
    $("#upMsg").textContent="アップデート中…";
    try{ const r=await fetch("/api/update",{method:"POST",body:await f.arrayBuffer()}); const j=await r.json();
      if(!j.ok) throw new Error(j.error); $("#upMsg").textContent=`${j.files}個のファイルを更新しました。再起動しています…`;
      for(let i=0;i<40;i++){ await new Promise(r=>setTimeout(r,800)); try{ await _api("/api/ping"); break; }catch{} }
      location.reload();
    }catch(e){ $("#upMsg").textContent="失敗: "+e.message; }
  };
}

/* ============ 公開サイト（Cloudflare Pages） ============ */
async function publishPanel(){
  const s=await api("/api/settings"); const st=await api("/api/publish/status");
  modal4("🌍 公開サイト（Cloudflare Pages）",`
    <p class="mtag">誰でも見られる「閲覧専用」の公開版にニュースを送ります。公開版には <b>見出し（翻訳）・リンク・分析結果だけ</b>が載り、あなたの設定・履歴・メモは送られません。最初の準備は <b>CLOUDFLARE_GUIDE.md</b> を見てください。GitHub Actions を設定済みなら、PCを起動していなくても1時間ごとに自動更新されます。</p>
    <div class="row"><input id="pbUrl" value="${esc(s.public_site_url||"")}" placeholder="公開サイトのURL（https://〜.pages.dev）" style="flex:1"></div>
    <div class="row"><input id="pbSec" type="password" value="${esc(s.public_upload_secret||"")}" placeholder="アップロード用の合言葉（CloudflareのUPLOAD_SECRETと同じ・16文字以上）" style="flex:1"><button class="btn" id="pbGen" title="安全な合言葉を自動で作ってコピー">🎲 合言葉を作る</button></div>
    <label class="row"><input type="checkbox" id="pbTr" ${s.public_translate?"checked":""}> 見出しの日本語訳も公開する（Google翻訳の無料窓口を使うため、公開サイトではグレーゾーンです）</label>
    <label class="row"><input type="checkbox" id="pbAuto" ${s.public_auto?"checked":""}> サーバー起動中は1時間ごとに自動で公開版を更新する</label>
    <div class="row"><button class="btn" id="pbSave">保存</button><a class="btn" href="/pub/" target="_blank">👀 公開版をこのPCでプレビュー</a><button class="btn pri" id="pbGo">📤 今すぐ公開版を更新</button></div>
    <div id="pbMsg" class="mtag">${st.last?`前回の更新: ${fmtT(st.last)} ・ ${st.result?.ok?"成功":"失敗 "+esc(st.result?.error||"")}`:"まだ更新していません"}</div>`);
  $("#pbGen").onclick=async()=>{ const a=new Uint8Array(24); crypto.getRandomValues(a); const v=[...a].map(x=>x.toString(16).padStart(2,"0")).join(""); $("#pbSec").value=v; $("#pbSec").type="text"; try{ await navigator.clipboard.writeText(v); toast("合言葉を作ってコピーしました。CloudflareとGitHubのUPLOAD_SECRETに貼り付けてください"); }catch{ toast("合言葉を作りました。CloudflareとGitHubのUPLOAD_SECRETに同じ値を設定してください"); } };
  const save=()=>api("/api/settings",{public_site_url:$("#pbUrl").value.trim(),public_upload_secret:$("#pbSec").value.trim(),public_translate:$("#pbTr").checked,public_auto:$("#pbAuto").checked});
  $("#pbSave").onclick=async()=>{ await save(); toast("保存しました"); };
  $("#pbGo").onclick=async()=>{ await save(); $("#pbMsg").textContent="送信中…"; const r=await api("/api/publish",{}); $("#pbMsg").textContent=r.ok?`✅ 更新しました（${Math.round(r.bytes/1024)}KB）`:`❌ ${r.error}`; };
}

/* ============ D. 使い方ガイド ============ */
const HELP=[
  ["📰 ニュース","世界の面白ニュース・流行を自動で集めて日本語に翻訳。カードの「📝3行要約」「🌐報じ方」「🔔続報」「📌後で読む」「🏷信頼メモ」が便利。"],
  ["🧊 冷静判定","怪しい見出し・SNS投稿・URLを貼ると、釣り度★1〜5、誇張箇所、本文とのズレ、AI量産っぽさ、数字の怪しさを判定。画像URLなら出どころチェック。"],
  ["🗺 世界マップ","紛争地域、ニュースの話題地、飛行機・電車・船、地震・災害・天気・空気、ライブカメラ、ロケット、昼夜線などを重ねて表示。左のパネルでON/OFF。"],
  ["📋 ダイジェスト","いまの世界を3行で、話題の国、マーケット、Wikipedia急上昇、ムード、ラジオ、クイズ。朝のブリーフィングもここに保存。"],
  ["🗾 温度差","海外で話題なのに日本では静かなニュースを発見。"],
  ["🗄 保存庫","集めたニュースを全部保存して全文検索。続報を追跡中の話題もここ。"],
  ["⌨ ショートカット","J/Kで移動、Oで開く、Rで要約、Sで保存、/で検索、?で一覧。"],
  ["🔔 通知","⚙設定でキーワードや地震を登録すると、Windows通知・Discord・LINEに届きます。"],
];
function helpPage(){
  modal4("❓ 使い方ガイド",`${HELP.map(([t,d])=>`<div class="help"><b>${t}</b><p>${d}</p></div>`).join("")}<p class="mtag">細かい説明はフォルダの README.md にあります。</p>`);
}

/* ============ D. はじめてツアー ============ */
const TOUR=[
  ["#views","画面の切り替え","ニュース・世界マップ・ダイジェスト・温度差・保存庫をここで切り替えます。"],
  [".checker","冷静判定チェッカー","怪しい見出しやURLを貼ると、釣り度と本当の中身を判定します。"],
  ["#tabs","カテゴリ","雑学・テック・ゲーム・明るいニュースなどで絞り込めます。"],
  ["#grid","ニュースカード","日本語の見出しと英語の原文。ボタンで要約・報じ方の比較・続報の追跡ができます。"],
  ["#bellBtn","アラート","登録したキーワードや大きな地震があるとここに届きます。"],
  ["#menuBtn","メニュー","設定・表示・ゲーム・公開サイト・使い方などはここにまとめてあります。"],
];
function startTour(force){
  if(!force && LS.get("tourDone",false)) return;
  let i=0; const ov=h("div",{id:"tourOv"}), box=h("div",{id:"tourBox"}); document.body.append(ov,box);
  const end=()=>{ ov.remove(); box.remove(); document.querySelectorAll(".tourHi").forEach(e=>e.classList.remove("tourHi")); LS.set("tourDone",true); };
  const show=()=>{
    document.querySelectorAll(".tourHi").forEach(e=>e.classList.remove("tourHi"));
    if(i>=TOUR.length) return end();
    const [sel,t,d]=TOUR[i]; const el=document.querySelector(sel);
    if(!el || !el.offsetParent){ i++; return show(); }
    if(curView!=="news" && ["#tabs","#grid",".checker"].includes(sel)) showView("news");
    el.classList.add("tourHi"); el.scrollIntoView({block:"center",behavior:"smooth"});
    setTimeout(()=>{ const r=el.getBoundingClientRect(); box.style.top=Math.min(innerHeight-170, r.bottom+10)+"px"; box.style.left=Math.max(10,Math.min(innerWidth-330, r.left))+"px"; },350);
    box.innerHTML=`<div class="mtag">${i+1} / ${TOUR.length}</div><b>${t}</b><p>${d}</p><div class="row"><button class="btn" id="tSkip">スキップ</button><button class="btn pri" id="tNext">${i===TOUR.length-1?"はじめる！":"次へ →"}</button></div>`;
    $("#tNext").onclick=()=>{ i++; show(); }; $("#tSkip").onclick=end;
  };
  show();
}
setTimeout(()=>startTour(false), 2500);
})();
