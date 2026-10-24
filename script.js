"use strict";
const $ = id => document.getElementById(id);
const STORAGE_KEY = "wayfinder.savedPlaces.v3";
const DEFAULT_CENTER = [35.6812,139.7671];
let map, savedPlaces = loadSaved(), searchResults = [], startPlace = null, endPlace = null, currentLocation = null;
let startMarker = null, endMarker = null, locationMarker = null, accuracyCircle = null, routeLayer = null, searchMarker = null, savedMarkers = [];
let pendingPin = null, currentMode = "transit", searchSerial = 0, routeSerial = 0, toastTimer;

function setText(id,v){$(id).textContent=v}
function esc(v){return String(v).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function makePlace(name,lat,lon,address=""){return{name:String(name),lat:Number(lat),lon:Number(lon),address:String(address||"")}}
function validPlace(p){return p&&typeof p.name==="string"&&Number.isFinite(p.lat)&&Number.isFinite(p.lon)&&Math.abs(p.lat)<=90&&Math.abs(p.lon)<=180}
function loadSaved(){try{const a=JSON.parse(localStorage.getItem(STORAGE_KEY)||"[]");return Array.isArray(a)?a.filter(validPlace):[]}catch{return[]}}
function persist(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(savedPlaces));return true}catch(e){console.error(e);toast("保存できませんでした。ブラウザの保存設定を確認してください。");return false}}
function toast(msg){const el=$("toast");el.textContent=msg;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3200)}
function fmtDist(m){return m<1000?`${Math.round(m)} m`:`${(m/1000).toLocaleString("ja-JP",{maximumFractionDigits:1})} km`}
function fmtTime(s){const m=Math.round(s/60);if(m<60)return`約${m}分`;const h=Math.floor(m/60),r=m%60;return r?`約${h}時間${r}分`:`約${h}時間`}
function uniqueName(n){const names=new Set(savedPlaces.map(p=>p.name));if(!names.has(n))return n;let i=2;while(names.has(`${n} (${i})`))i++;return`${n} (${i})`}
function icon(color){return L.divIcon({className:"custom-pin-wrapper",html:`<div style="width:27px;height:27px;border:3px solid white;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:${color};box-shadow:0 3px 10px #223b5b35"><div style="width:7px;height:7px;margin:7px;border-radius:50%;background:white"></div></div>`,iconSize:[27,27],iconAnchor:[13,27],popupAnchor:[0,-25]})}
const originIcon=icon("#4779f5"),destinationIcon=icon("#f17479"),savedIcon=icon("#31b89a"),currentIcon=icon("#8769e8");
function initMap(){
 if(!window.L){toast("地図ライブラリを読み込めません。インターネット接続を確認してください。");return}
 map=L.map("map",{zoomControl:false}).setView(DEFAULT_CENTER,13);
 L.control.zoom({position:"bottomright"}).addTo(map);
 L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}).addTo(map);
 map.on("click",e=>openSaveDialog(e.latlng));
 renderSaved();renderSavedMarkers();mapPopupHandler();setTimeout(()=>map.invalidateSize(),150);
}
function showPlace(p){if(!map)return;map.setView([p.lat,p.lon],16);if(searchMarker)map.removeLayer(searchMarker);searchMarker=L.marker([p.lat,p.lon]).addTo(map).bindPopup(esc(p.name)).openPopup()}
function setEndpoint(which,p){if(!validPlace(p))return;const v=makePlace(p.name,p.lat,p.lon,p.address);if(which==="start"){startPlace=v;$("startInput").value=v.name}else{endPlace=v;$("endInput").value=v.name}renderEndpoints();setText("mapSubtitle",`${which==="start"?"出発地":"目的地"}：${v.name}`)}
function renderEndpoints(){if(!map)return;if(startMarker)map.removeLayer(startMarker);if(endMarker)map.removeLayer(endMarker);startMarker=endMarker=null;
 if(startPlace)startMarker=L.marker([startPlace.lat,startPlace.lon],{icon:originIcon}).addTo(map).bindPopup(`<b>出発地</b><br>${esc(startPlace.name)}`);
 if(endPlace)endMarker=L.marker([endPlace.lat,endPlace.lon],{icon:destinationIcon}).addTo(map).bindPopup(`<b>目的地</b><br>${esc(endPlace.name)}`);
}
function setMode(mode){currentMode=mode;document.querySelectorAll(".mode").forEach(b=>b.classList.toggle("active",b.dataset.mode===mode));setText("mapSubtitle",mode==="transit"?"電車・公共交通の行き方":mode==="driving"?"車のルート":"徒歩ルート")}
document.querySelectorAll(".mode").forEach(b=>b.addEventListener("click",()=>setMode(b.dataset.mode)));
document.querySelectorAll("[data-query]").forEach(b=>b.addEventListener("click",()=>{$("searchInput").value=b.dataset.query;$("searchForm").requestSubmit()}));

// Public Nominatim is rate-limited. Try exact query first, then common Japanese address variants.
async function geocode(query){
 const qs=[query.trim()];
 const normalized=query.trim().replace(/丁目/g,"-").replace(/番地|番/g,"-").replace(/号/g,"").replace(/[〒,、]/g," ").replace(/\s+/g," ").trim();
 if(normalized&&normalized!==qs[0])qs.push(normalized);
 const noBlock=query.trim().replace(/([0-9０-９]+丁目)[0-9０-９番地号\-－丁目]*/g,"$1").trim();
 if(noBlock&&noBlock!==qs[0]&&!qs.includes(noBlock))qs.push(noBlock);
 for(const q of qs){
  const params=new URLSearchParams({q,format:"jsonv2",addressdetails:"1",limit:"5",countrycodes:"jp","accept-language":"ja"});
  const res=await fetch(`https://nominatim.openstreetmap.org/search?${params}`);
  if(!res.ok)throw new Error(`検索サービスの応答 ${res.status}`);
  const data=await res.json();if(data.length)return data;
 }
 return[];
}
$("searchForm").addEventListener("submit",async e=>{
 e.preventDefault();const q=$("searchInput").value.trim();if(!q)return;const serial=++searchSerial;
 setText("searchStatus","場所を探しています…");$("searchResults").replaceChildren();
 try{
  const data=await geocode(q);if(serial!==searchSerial)return;
  searchResults=data.map(r=>makePlace(r.name||r.display_name.split(",")[0],Number(r.lat),Number(r.lon),r.display_name)).filter(validPlace);
  renderSearchResults();
  if(!searchResults.length)setText("searchStatus","見つかりませんでした。番地を省略して「有明3丁目 東京都江東区」などでも試してください。");
  else{setText("searchStatus",`${searchResults.length}件見つかりました。候補を選択してください。`);showPlace(searchResults[0])}
 }catch(err){if(serial!==searchSerial)return;console.error(err);setText("searchStatus","検索サービスに接続できません。時間をおいて再試行してください。")}
});
function renderSearchResults(){ $("searchResults").innerHTML=searchResults.map((p,i)=>`<div class="result-item"><div class="result-name">${esc(p.name)}</div><div class="result-address">${esc(p.address)}</div><div class="result-actions"><button class="small-btn" data-action="show" data-index="${i}">地図で見る</button><button class="small-btn" data-action="start" data-index="${i}">出発地</button><button class="small-btn accent" data-action="end" data-index="${i}">目的地</button><button class="small-btn" data-action="save" data-index="${i}">＋ 保存</button></div></div>`).join("")}
$("searchResults").addEventListener("click",e=>{const b=e.target.closest("button[data-action]");if(!b)return;const p=searchResults[+b.dataset.index];if(p)action(b.dataset.action,p)});
function action(a,p){if(a==="show")showPlace(p);if(a==="start"||a==="end"){setEndpoint(a,p);showPlace(p)}if(a==="save")savePlace(p)}
function savePlace(p){const n=uniqueName(p.name.trim()||"保存した場所");savedPlaces.push(makePlace(n,p.lat,p.lon,p.address));if(persist()){renderSaved();renderSavedMarkers();toast(`「${n}」を保存しました`)}else savedPlaces.pop()}
function openSaveDialog(latlng){pendingPin=latlng;$("saveCoords").textContent=`緯度 ${latlng.lat.toFixed(5)} · 経度 ${latlng.lng.toFixed(5)}`;$("saveName").value=`保存した場所 ${savedPlaces.length+1}`;$("saveDialog").showModal();setTimeout(()=>$("saveName").select(),50)}
$("saveForm").addEventListener("submit",e=>{if(e.submitter&&e.submitter.value==="save"){e.preventDefault();const n=$("saveName").value.trim();if(!n){toast("場所の名前を入力してください");return}if(pendingPin)savePlace(makePlace(n,pendingPin.lat,pendingPin.lng));$("saveDialog").close();pendingPin=null}else{pendingPin=null}});
function renderSaved(){setText("savedCount",savedPlaces.length);$("savedPlaces").innerHTML=savedPlaces.length?savedPlaces.map((p,i)=>`<div class="saved-item"><div class="saved-name">${esc(p.name)}</div><div class="saved-coords">${p.lat.toFixed(5)}, ${p.lon.toFixed(5)}</div><div class="saved-actions"><button class="small-btn" data-action="show" data-index="${i}">地図で見る</button><button class="small-btn" data-action="start" data-index="${i}">出発地</button><button class="small-btn accent" data-action="end" data-index="${i}">目的地</button><button class="small-btn" data-action="delete" data-index="${i}">削除</button></div></div>`).join(""):'<div class="empty-state">保存した場所はまだありません。<br>検索結果の「＋ 保存」や地図クリックで追加できます。</div>'}
$("savedPlaces").addEventListener("click",e=>{const b=e.target.closest("button[data-action]");if(!b)return;const i=+b.dataset.index,p=savedPlaces[i];if(!p)return;if(b.dataset.action==="delete"){if(!confirm(`「${p.name}」を削除しますか？`))return;const old=savedPlaces;savedPlaces=savedPlaces.filter((_,j)=>j!==i);if(persist()){renderSaved();renderSavedMarkers()}else savedPlaces=old;return}action(b.dataset.action,p)});
function renderSavedMarkers(){if(!map)return;savedMarkers.forEach(m=>map.removeLayer(m));savedMarkers=[];savedPlaces.forEach((p,i)=>{const m=L.marker([p.lat,p.lon],{icon:savedIcon}).addTo(map);m.bindPopup(`<b>${esc(p.name)}</b><br><button class="popup-action" data-index="${i}" data-set="start">出発地にする</button> <button class="popup-action" data-index="${i}" data-set="end">目的地にする</button>`);savedMarkers.push(m)})}
function mapPopupHandler(){if(!map)return;map.on("popupopen",e=>{const el=e.popup.getElement();if(!el)return;el.querySelectorAll("button[data-set]").forEach(b=>b.addEventListener("click",()=>{const p=savedPlaces[+b.dataset.index];if(p)setEndpoint(b.dataset.set,p);e.popup.remove()}))});}
$("clearSavedBtn").addEventListener("click",()=>{if(!savedPlaces.length)return;if(!confirm("保存した場所をすべて削除しますか？"))return;const old=savedPlaces;savedPlaces=[];if(persist()){renderSaved();renderSavedMarkers();toast("お気に入りを削除しました")}else savedPlaces=old});
$("clearStart").addEventListener("click",()=>{startPlace=null;$("startInput").value="";renderEndpoints()});
$("clearEnd").addEventListener("click",()=>{endPlace=null;$("endInput").value="";renderEndpoints()});
$("startInput").addEventListener("change",()=>{const v=$("startInput").value.trim();const p=savedPlaces.find(x=>x.name===v)||searchResults.find(x=>x.name===v);if(p)setEndpoint("start",p);else if(v)toast("出発地は検索結果か保存した場所から選んでください")});
$("endInput").addEventListener("change",()=>{const v=$("endInput").value.trim();const p=savedPlaces.find(x=>x.name===v)||searchResults.find(x=>x.name===v);if(p)setEndpoint("end",p);else if(v)toast("目的地は検索結果か保存した場所から選んでください")});

function locate(){
 if(!navigator.geolocation){toast("このブラウザでは位置情報を使えません");return}
 toast("現在地を取得しています…");
 navigator.geolocation.getCurrentPosition(pos=>{
  const {latitude:lat,longitude:lon,accuracy}=pos.coords;currentLocation=makePlace("現在地",lat,lon);
  if(locationMarker)map.removeLayer(locationMarker);if(accuracyCircle)map.removeLayer(accuracyCircle);
  locationMarker=L.marker([lat,lon],{icon:currentIcon}).addTo(map).bindPopup("現在地").openPopup();
  if(Number.isFinite(accuracy))accuracyCircle=L.circle([lat,lon],{radius:accuracy,color:"#8769e8",fillColor:"#8769e8",fillOpacity:.08,weight:1}).addTo(map);
  map.setView([lat,lon],16);setText("mapSubtitle","現在地を表示中");toast("現在地を表示しました");
 },err=>{const m={1:"位置情報が許可されていません。ブラウザ設定を確認してください。",2:"現在地を取得できません。",3:"取得がタイムアウトしました。もう一度お試しください。"};toast(m[err.code]||"現在地を取得できませんでした")},{enableHighAccuracy:true,timeout:15000,maximumAge:10000})
}
$("locateBtn").addEventListener("click",locate);
$("useCurrentBtn").addEventListener("click",()=>{if(currentLocation)setEndpoint("start",currentLocation);else{locate();toast("取得後、もう一度このボタンを押してください")}});

function googleMapsTransitURL(from,to,mode){
 const params=new URLSearchParams({api:"1",origin:`${from.lat},${from.lon}`,destination:`${to.lat},${to.lon}`,travelmode:mode==="driving"?"driving":mode==="walking"?"walking":"transit"});
 return `https://www.google.com/maps/dir/?${params.toString()}`;
}
const TRANSIT_API = "https://api.transit.ls8h.com";

(function addTransitStyles(){
 const style=document.createElement("style");
 style.textContent=`
 .transit-option{border:1px solid #e7edf6;border-radius:16px;padding:14px;margin:12px 0;background:#fff;box-shadow:0 5px 18px #263b5b08}
 .transit-option.selected{border-color:#4779f5;box-shadow:0 0 0 2px #4779f51a}
 .transit-option-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}
 .transit-option-head h3{font-size:18px;margin:8px 0 0}
 .transit-duration{font-size:13px;color:#4779f5;white-space:nowrap}
 .time-arrow{color:#94a3b8;font-weight:400;padding:0 4px}
 .transit-legs{margin:12px 0;border-top:1px solid #edf1f7}
 .transit-leg{display:flex;gap:10px;padding:11px 2px;border-bottom:1px solid #edf1f7}
 .transit-leg .leg-icon{width:30px;height:30px;display:grid;place-items:center;border-radius:10px;background:#eff4ff;flex-shrink:0}
 .transit-leg b{font-size:13px;display:block}
 .transit-leg p{font-size:12px;margin:4px 0;color:#43516a}
 .transit-leg small{font-size:11px;color:#7a879b;display:block;margin-top:3px}
 .walk-leg .leg-icon{background:#f2f4f8}
 .transit-show-route{display:block;width:100%;text-align:center;cursor:pointer;box-sizing:border-box}
 .transit-disclaimer{font-size:11px;color:#7a879b;line-height:1.7;margin:12px 2px 6px}
 .transit-attribution{display:block;color:#8a96a8;font-size:10px;margin-top:8px}
 `;
 document.head.appendChild(style);
})();

function transitTime(secs){
  if(!Number.isFinite(secs)) return "時刻不明";
  // Transit API returns seconds from service-day midnight; may cross midnight.
  const d = new Date();
  d.setHours(0,0,0,0);
  d.setSeconds(secs);
  return d.toLocaleTimeString("ja-JP",{hour:"2-digit",minute:"2-digit"});
}
function transitDuration(secs){
  if(!Number.isFinite(secs)) return "時間不明";
  return fmtTime(secs);
}
function transitFare(fare){
  if(!fare || !Number.isFinite(fare.ticket)) return "運賃情報なし";
  const ticket = `${fare.ticket.toLocaleString("ja-JP")}円`;
  return fare.ic != null && Number.isFinite(fare.ic)
    ? `きっぷ ${ticket} / IC ${fare.ic.toLocaleString("ja-JP")}円`
    : `きっぷ ${ticket}`;
}
function transitLegText(leg){
  const fromName = leg.from?.name || "出発";
  const toName = leg.to?.name || "到着";
  if(leg.kind === "walk") {
    return `<div class="transit-leg walk-leg"><span class="leg-icon">🚶</span><div><b>徒歩</b><p>${esc(fromName)} → ${esc(toName)}</p><small>${transitDuration((leg.arrivalSecs||0)-(leg.departureSecs||0))}</small></div></div>`;
  }
  const line = leg.routeName || "路線名不明";
  const type = leg.trainType ? ` · ${esc(leg.trainType)}` : "";
  const dep = transitTime(leg.departureSecs);
  const arr = transitTime(leg.arrivalSecs);
  const platform = leg.from?.platformCode ? ` · ${esc(leg.from.platformCode)}番線` : "";
  const headsign = leg.headsign ? `<small>行先：${esc(leg.headsign)}</small>` : "";
  return `<div class="transit-leg"><span class="leg-icon">🚆</span><div><b>${esc(line)}${type}</b><p>${esc(fromName)}${platform} → ${esc(toName)}</p><small>${dep} 発 → ${arr} 着</small>${headsign}</div></div>`;
}
function drawTransitOption(option){
  if(routeLayer){map.removeLayer(routeLayer);routeLayer=null}
  const segments = option?.map?.segments || [];
  const layers = [];
  segments.forEach(seg=>{
    const pts=(seg.polyline||[]).filter(p=>Number.isFinite(p.lat)&&Number.isFinite(p.lon)).map(p=>[p.lat,p.lon]);
    if(pts.length>1){
      layers.push(L.polyline(pts,{color:seg.color|| (seg.kind==="walk"?"#9aa8bc":"#4779f5"),weight:seg.kind==="walk"?4:6,opacity:.9,dashArray:seg.kind==="walk"?"6 7":null,lineCap:"round",lineJoin:"round"}));
    }
  });
  if(layers.length){
    routeLayer=L.featureGroup(layers).addTo(map);
    map.fitBounds(routeLayer.getBounds(),{padding:[40,40],maxZoom:15});
  } else {
    map.fitBounds(L.latLngBounds([[startPlace.lat,startPlace.lon],[endPlace.lat,endPlace.lon]]).pad(.2),{maxZoom:13});
  }
}
function renderTransitOptions(data,from,to){
  const options = Array.isArray(data.options) ? data.options : [];
  if(!options.length){
    $("routePanel").innerHTML=`<div class="empty"><span>!</span><div><b>電車の経路が見つかりませんでした</b><p>この区間の時刻表データがないか、検索範囲外の可能性があります。駅名を指定して再検索してみてください。</p></div></div>`;
    setText("routeStatus","経路候補がありません。データの対象範囲や駅名を確認してください。");
    if(routeLayer){map.removeLayer(routeLayer);routeLayer=null}
    return;
  }
  const recommended = options.find(o=>o.recommended) || options[0];
  const cards = options.map((o,i)=>{
    const j=o.journey||{};
    const legs=Array.isArray(j.legs)?j.legs:[];
    const fare=j.fare||o.metrics?.fare;
    const transfer=Number.isFinite(j.transferCount)?j.transferCount:(o.metrics?.transferCount||0);
    const duration=Number.isFinite(j.durationSecs)?j.durationSecs:o.metrics?.durationSecs;
    const dep=transitTime(j.departureSecs), arr=transitTime(j.arrivalSecs);
    const selected=o.id===recommended.id;
    return `<article class="transit-option ${selected?"selected":""}">
      <div class="transit-option-head"><div><span class="route-badge">${selected?"おすすめ":`候補 ${i+1}`}</span><h3>${dep} <span class="time-arrow">→</span> ${arr}</h3></div><b class="transit-duration">${transitDuration(duration)}</b></div>
      <div class="metrics"><div><b>${transfer}回</b><small>乗換</small></div><div><b>${esc(transitFare(fare))}</b><small>運賃</small></div></div>
      <div class="transit-legs">${legs.map(transitLegText).join("")}</div>
      <button type="button" class="route-link transit-show-route" data-transit-option="${i}">このルートを地図に表示</button>
    </article>`;
  }).join("");
  $("routePanel").innerHTML=`<div class="route-summary"><div class="summary-top"><div><h3>電車・公共交通の経路</h3><p>${esc(from.name)} → ${esc(to.name)}</p></div><span class="route-badge">無料API</span></div>${cards}<p class="transit-disclaimer">経路・時刻は公開交通データに基づく参考情報です。運行状況や運賃の正確性は保証されません。</p><small class="transit-attribution">経路データ：Transit API（非公式）</small></div>`;
  $("routePanel").querySelectorAll("[data-transit-option]").forEach(btn=>{
    btn.addEventListener("click",()=>{
      const option=options[Number(btn.dataset.transitOption)];
      if(!option)return;
      $("routePanel").querySelectorAll(".transit-option").forEach((el,i)=>el.classList.toggle("selected",i===Number(btn.dataset.transitOption)));
      drawTransitOption(option);
    });
  });
  drawTransitOption(recommended);
  setText("routeStatus",`${options.length}件の経路候補を表示しました。`);
}
async function renderTransit(from,to,serial){
  const params=new URLSearchParams({
    from:`geo:${from.lat},${from.lon}`,
    to:`geo:${to.lat},${to.lon}`,
    fromLabel:from.name,
    toLabel:to.name,
    allowModes:"rail,subway,tram,monorail",
    numItineraries:"3",
    strategy:"balanced"
  });
  const res=await fetch(`${TRANSIT_API}/api/v1/guidance/plan?${params}`);
  if(!res.ok)throw new Error(`電車経路APIの応答 ${res.status}`);
  const data=await res.json();
  if(serial!==routeSerial)return;
  renderTransitOptions(data,from,to);
}

async function renderRoadRoute(from,to,mode,serial){
 const profile="driving";
 const coords=`${from.lon},${from.lat};${to.lon},${to.lat}`;
 const url=`https://router.project-osrm.org/route/v1/${profile}/${coords}?overview=full&geometries=geojson&steps=true`;
 const res=await fetch(url);if(!res.ok)throw new Error(`ルートサービス ${res.status}`);
 const data=await res.json();if(serial!==routeSerial)return;
 if(data.code!=="Ok"||!data.routes?.length)throw new Error("道路ルートが見つかりませんでした");
 const r=data.routes[0];if(routeLayer)map.removeLayer(routeLayer);
 routeLayer=L.geoJSON(r.geometry,{style:{color:"#4779f5",weight:6,opacity:.86,lineCap:"round",lineJoin:"round"}}).addTo(map);
 map.fitBounds(routeLayer.getBounds(),{padding:[40,40],maxZoom:16});
 const title=mode==="driving"?"車のルート":"徒歩の参考ルート";
 const note=mode==="walking"?"注意：このサービスは車向け道路ルートを返すため、徒歩用の正確な道順ではありません。徒歩ルートはGoogle マップで確認してください。":"道路データに基づく推定です。リアルタイム渋滞は反映されません。";
 const google=googleMapsTransitURL(from,to,mode);
 $("routePanel").innerHTML=`<div class="route-summary"><div class="summary-top"><div><h3>${title}</h3><p>${esc(from.name)} → ${esc(to.name)}</p></div><span class="route-badge">${mode==="driving"?"車":"参考"}</span></div><div class="metrics"><div><b>${fmtDist(r.distance)}</b><small>ルート距離</small></div><div><b>${fmtTime(r.duration)}</b><small>推定所要時間</small></div></div><p style="margin-top:10px">${note}</p><a class="route-link" href="${google}" target="_blank" rel="noopener noreferrer">${mode==="walking"?"正確な徒歩ルートを開く":"Google マップで道順を開く"} ↗</a></div>`;
 setText("routeStatus",mode==="walking"?"地図の線は車向け道路データによる参考表示です。徒歩案内はリンク先を確認してください。":"車のルートを表示しました。");
}
$("routeBtn").addEventListener("click",async()=>{
 if(!startPlace||!endPlace){setText("routeStatus","出発地と目的地を両方設定してください。検索結果のボタンから選べます。");return}
 if(startPlace.lat===endPlace.lat&&startPlace.lon===endPlace.lon){setText("routeStatus","出発地と目的地が同じ場所です。別の場所を選んでください。");return}
 const serial=++routeSerial;setText("routeStatus","行き方を調べています…");
 try{
  if(currentMode==="transit"){await renderTransit(startPlace,endPlace,serial);return}
  await renderRoadRoute(startPlace,endPlace,currentMode,serial);
 }catch(err){
  if(serial!==routeSerial)return;
  console.error(err);
  setText("routeStatus",currentMode==="transit"?"電車の経路を取得できませんでした。少し時間をおいて再試行してください。":"ルートを取得できませんでした。外部の道順検索をお試しください。");
  $("routePanel").innerHTML=`<div class="empty"><span>!</span><div><b>ルートを取得できませんでした</b><p>${currentMode==="transit"?"APIが混み合っているか、出発地・目的地の交通データがない可能性があります。":"サービスが混み合っているか、道路データがない可能性があります。"}</p><a class="route-link" target="_blank" rel="noopener noreferrer" href="${googleMapsTransitURL(startPlace,endPlace,currentMode)}">外部サービスで道順を開く ↗</a></div></div>`;
 }
});
initMap();