
"use strict";

// ======================================
// Wayfinder - Map Application
// ======================================

const $ = (id) => document.getElementById(id);

const STORAGE_KEY = "wayfinder.savedPlaces.v1";

const DEFAULT_CENTER = [35.6812, 139.7671]; // 東京駅付近

// ---- 地図の初期化 ----

const map = L.map("map", {
  zoomControl: false
}).setView(DEFAULT_CENTER, 13);

L.control.zoom({ position: "bottomright" }).addTo(map);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution:
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
}).addTo(map);

// ---- アプリの状態 ----

let savedPlaces = loadSavedPlaces();
let searchMarker = null;
let searchResults = [];
let startPlace = null;
let endPlace = null;
let currentLocation = null;
let routeLayer = null;
let locationMarker = null;
let locationAccuracy = null;
let savedMarkers = [];
let routeRequestId = 0;
let searchRequestId = 0;

// ---- 共通関数 ----

function setText(id, value) {
  $(id).textContent = value;
}

function showMapMessage(message) {
  setText("mapMessage", message);
}

function setStatus(id, message) {
  setText(id, message);
}

function formatDistance(meters) {
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }

  return `${(meters / 1000).toLocaleString("ja-JP", {
    maximumFractionDigits: 1
  })} km`;
}

function formatDuration(seconds) {
  const minutes = Math.round(seconds / 60);

  if (minutes < 60) {
    return `約${minutes}分`;
  }

  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;

  return remaining
    ? `約${hours}時間${remaining}分`
    : `約${hours}時間`;
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[char]);
}

function makePlace(name, lat, lon, address = "") {
  return {
    name: String(name),
    lat: Number(lat),
    lon: Number(lon),
    address: String(address)
  };
}

function validPlace(place) {
  return place &&
    typeof place.name === "string" &&
    Number.isFinite(place.lat) &&
    Number.isFinite(place.lon) &&
    Math.abs(place.lat) <= 90 &&
    Math.abs(place.lon) <= 180;
}

function loadSavedPlaces() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");

    if (!Array.isArray(data)) return [];

    return data.filter(validPlace);
  } catch (error) {
    console.warn("保存データを読み込めませんでした", error);
    return [];
  }
}

function persistSavedPlaces() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(savedPlaces));
    return true;
  } catch (error) {
    console.error(error);
    alert("保存できませんでした。ブラウザの保存容量や設定を確認してください。");
    return false;
  }
}

function uniqueName(baseName) {
  const existing = new Set(savedPlaces.map((p) => p.name));

  if (!existing.has(baseName)) return baseName;

  let number = 2;
  while (existing.has(`${baseName} (${number})`)) {
    number++;
  }

  return `${baseName} (${number})`;
}

// ---- ピンのアイコン ----

function makePinIcon(color) {
  return L.divIcon({
    className: "custom-pin-wrapper",
    html: `
      <div style="
        width: 28px;
        height: 28px;
        border: 3px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        background: ${color};
        box-shadow: 0 2px 9px #1c2b4530;
      ">
        <div style="
          width: 7px;
          height: 7px;
          margin: 7.5px;
          border-radius: 50%;
          background: white;
        "></div>
      </div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 28],
    popupAnchor: [0, -27]
  });
}

const startIcon = makePinIcon("#3978ed");
const endIcon = makePinIcon("#e65c67");
const savedIcon = makePinIcon("#29a77a");
const currentIcon = makePinIcon("#8359e8");

// ---- 場所の表示・保存 ----

function showPlaceOnMap(place, zoom = 16) {
  map.setView([place.lat, place.lon], zoom);
}

function savePlace(place) {
  if (!validPlace(place)) return;

  const name = uniqueName(place.name);
  const item = makePlace(name, place.lat, place.lon, place.address);

  savedPlaces.push(item);

  if (persistSavedPlaces()) {
    renderSavedPlaces();
    renderSavedMarkers();
    showMapMessage(`「${name}」を保存しました。`);
  }
}

function addPlaceFromMap(latlng) {
  const rawName = prompt(
    "この場所の名前を入力してください。",
    `保存した場所 ${savedPlaces.length + 1}`
  );

  if (rawName === null) return;

  const name = rawName.trim();

  if (!name) {
    alert("場所の名前を入力してください。");
    return;
  }

  savePlace(makePlace(name, latlng.lat, latlng.lng));
}

function renderSavedMarkers() {
  savedMarkers.forEach((marker) => map.removeLayer(marker));
  savedMarkers = [];

  savedPlaces.forEach((place, index) => {
    const marker = L.marker([place.lat, place.lon], {
      icon: savedIcon
    }).addTo(map);

    marker.bindPopup(`
      <strong>${escapeHTML(place.name)}</strong><br>
      <span>${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}</span><br>
      <button type="button" class="popup-route-start"
        data-index="${index}">出発地にする</button>
      <button type="button" class="popup-route-end"
        data-index="${index}">目的地にする</button>
    `);

    savedMarkers.push(marker);
  });
}

function renderSavedPlaces() {
  const container = $("savedPlaces");

  setText("savedCount", savedPlaces.length);

  if (savedPlaces.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        保存した場所はまだありません。<br>
        地図をクリックして登録してみましょう。
      </div>
    `;

    return;
  }

  container.innerHTML = savedPlaces.map((place, index) => `
    <div class="saved-item">
      <div class="saved-name">${escapeHTML(place.name)}</div>
      <div class="saved-coords">
        ${place.lat.toFixed(5)}, ${place.lon.toFixed(5)}
      </div>
      <div class="saved-actions">
        <button class="small-btn" data-action="show"
          data-index="${index}">地図で見る</button>
        <button class="small-btn" data-action="start"
          data-index="${index}">出発地</button>
        <button class="small-btn accent" data-action="end"
          data-index="${index}">目的地</button>
        <button class="small-btn" data-action="delete"
          data-index="${index}">削除</button>
      </div>
    </div>
  `).join("");
}

// ---- 出発地・目的地 ----

function setStart(place) {
  if (!validPlace(place)) return;

  startPlace = makePlace(place.name, place.lat, place.lon, place.address);

  $("startInput").value = startPlace.name;
  renderEndpointMarkers();

  showMapMessage(`出発地を「${startPlace.name}」に設定しました。`);
}

function setEnd(place) {
  if (!validPlace(place)) return;

  endPlace = makePlace(place.name, place.lat, place.lon, place.address);

  $("endInput").value = endPlace.name;
  renderEndpointMarkers();

  showMapMessage(`目的地を「${endPlace.name}」に設定しました。`);
}

let startMarker = null;
let endMarker = null;

function renderEndpointMarkers() {
  if (startMarker) map.removeLayer(startMarker);
  if (endMarker) map.removeLayer(endMarker);

  startMarker = null;
  endMarker = null;

  if (startPlace) {
    startMarker = L.marker(
      [startPlace.lat, startPlace.lon],
      { icon: startIcon }
    ).addTo(map);

    startMarker.bindPopup(
      `<strong>出発地</strong><br>${escapeHTML(startPlace.name)}`
    );
  }

  if (endPlace) {
    endMarker = L.marker(
      [endPlace.lat, endPlace.lon],
      { icon: endIcon }
    ).addTo(map);

    endMarker.bindPopup(
      `<strong>目的地</strong><br>${escapeHTML(endPlace.name)}`
    );
  }
}

// ---- 場所検索（Nominatim） ----

$("searchForm").addEventListener("submit", async (event) => {
  event.preventDefault();

  const query = $("searchInput").value.trim();

  if (!query) return;

  const requestId = ++searchRequestId;

  setStatus("searchStatus", "検索しています...");
  $("searchResults").replaceChildren();

  try {
    const params = new URLSearchParams({
      q: query,
      format: "jsonv2",
      limit: "5",
      "accept-language": "ja"
    });

    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?${params}`
    );

    if (!response.ok) {
      throw new Error(`検索サービスの応答: ${response.status}`);
    }

    const results = await response.json();

    if (requestId !== searchRequestId) return;

    searchResults = results
      .filter((item) =>
        Number.isFinite(Number(item.lat)) &&
        Number.isFinite(Number(item.lon))
      )
      .map((item) => makePlace(
        item.name || item.display_name.split(",")[0],
        Number(item.lat),
        Number(item.lon),
        item.display_name
      ));

    renderSearchResults();

    if (searchResults.length === 0) {
      setStatus("searchStatus", "場所が見つかりませんでした。別のキーワードを試してください。");
    } else {
      setStatus("searchStatus", `${searchResults.length}件の候補が見つかりました。`);
    }
  } catch (error) {
    if (requestId !== searchRequestId) return;

    console.error(error);
    setStatus(
      "searchStatus",
      "検索に失敗しました。通信状況やサービスの利用制限を確認してください。"
    );
  }
});

function renderSearchResults() {
  const container = $("searchResults");

  container.innerHTML = searchResults.map((place, index) => `
    <div class="result-item">
      <div class="result-name">${escapeHTML(place.name)}</div>
      <div class="result-address">${escapeHTML(place.address)}</div>
      <div class="result-actions">
        <button class="small-btn" data-action="show"
          data-index="${index}">地図で見る</button>
        <button class="small-btn" data-action="start"
          data-index="${index}">出発地</button>
        <button class="small-btn accent" data-action="end"
          data-index="${index}">目的地</button>
        <button class="small-btn" data-action="save"
          data-index="${index}">＋ 保存</button>
      </div>
    </div>
  `).join("");
}

// 検索結果のボタン
$("searchResults").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const place = searchResults[Number(button.dataset.index)];
  if (!place) return;

  handlePlaceAction(button.dataset.action, place);
});

// 保存済みの場所のボタン
$("savedPlaces").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const index = Number(button.dataset.index);
  const place = savedPlaces[index];

  if (!place) return;

  if (button.dataset.action === "delete") {
    if (!confirm(`「${place.name}」を削除しますか？`)) return;

    savedPlaces.splice(index, 1);

    if (persistSavedPlaces()) {
      renderSavedPlaces();
      renderSavedMarkers();
    }

    return;
  }

  handlePlaceAction(button.dataset.action, place);
});

function handlePlaceAction(action, place) {
  switch (action) {
    case "show":
      if (searchMarker) map.removeLayer(searchMarker);

      searchMarker = L.marker([place.lat, place.lon])
        .addTo(map)
        .bindPopup(escapeHTML(place.name))
        .openPopup();

      showPlaceOnMap(place);
      break;

    case "start":
      setStart(place);
      showPlaceOnMap(place);
      break;

    case "end":
      setEnd(place);
      showPlaceOnMap(place);
      break;

    case "save":
      savePlace(place);
      break;
  }
}

// ---- 地図クリックでピンを登録 ----

map.on("click", (event) => {
  addPlaceFromMap(event.latlng);
});

// ---- 現在地 ----

function getCurrentLocation() {
  if (!navigator.geolocation) {
    showMapMessage("このブラウザでは位置情報を利用できません。");
    return;
  }

  showMapMessage("現在地を取得しています...");

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const lat = position.coords.latitude;
      const lon = position.coords.longitude;

      currentLocation = makePlace("現在地", lat, lon);

      if (locationMarker) map.removeLayer(locationMarker);
      if (locationAccuracy) map.removeLayer(locationAccuracy);

      locationMarker = L.marker([lat, lon], {
        icon: currentIcon
      }).addTo(map).bindPopup("現在地").openPopup();

      if (Number.isFinite(position.coords.accuracy)) {
        locationAccuracy = L.circle([lat, lon], {
          radius: position.coords.accuracy,
          color: "#8359e8",
          fillColor: "#8359e8",
          fillOpacity: 0.08,
          weight: 1
        }).addTo(map);
      }

      map.setView([lat, lon], 16);
      showMapMessage("現在地を表示しました。");

      return;
    },
    (error) => {
      const messages = {
        1: "位置情報の利用が許可されていません。ブラウザの設定を確認してください。",
        2: "現在地を取得できませんでした。位置情報が利用できるか確認してください。",
        3: "現在地の取得がタイムアウトしました。もう一度お試しください。"
      };

      showMapMessage(messages[error.code] || "現在地を取得できませんでした。");
    },
    {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 10000
    }
  );
}

$("locateBtn").addEventListener("click", getCurrentLocation);

$("useCurrentBtn").addEventListener("click", () => {
  if (currentLocation) {
    setStart(currentLocation);
  } else {
    getCurrentLocation();
    showMapMessage(
      "現在地を取得中です。取得できたら、もう一度「現在地を出発地に」を押してください。"
    );
  }
});

// ---- ルート検索（OSRM） ----

$("routeBtn").addEventListener("click", findRoute);

async function findRoute() {
  if (!startPlace || !endPlace) {
    setStatus("routeStatus", "出発地と目的地の両方を設定してください。");
    return;
  }

  const requestId = ++routeRequestId;

  setStatus("routeStatus", "ルートを検索しています...");
  setText("routeDistance", "計算中...");
  setText("routeDuration", "しばらくお待ちください。");

  const coordinates =
    `${startPlace.lon},${startPlace.lat};${endPlace.lon},${endPlace.lat}`;

  const url =
    `https://router.project-osrm.org/route/v1/driving/${coordinates}` +
    "?overview=full&geometries=geojson&steps=true";

  try {
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`ルートサービスの応答: ${response.status}`);
    }

    const data = await response.json();

    if (requestId !== routeRequestId) return;

    if (data.code !== "Ok" || !data.routes?.length) {
      throw new Error("ルートが見つかりませんでした。");
    }

    const route = data.routes[0];

    if (routeLayer) map.removeLayer(routeLayer);

    routeLayer = L.geoJSON(route.geometry, {
      style: {
        color: "#3978ed",
        weight: 6,
        opacity: 0.85,
        lineCap: "round",
        lineJoin: "round"
      }
    }).addTo(map);

    map.fitBounds(routeLayer.getBounds(), {
      padding: [45, 45],
      maxZoom: 16
    });

    setText("routeDistance", formatDistance(route.distance));
    setText(
      "routeDuration",
      `${formatDuration(route.duration)}（車での推定時間）`
    );

    setStatus(
      "routeStatus",
      "ルートを表示しました。交通状況によって所要時間は変わります。"
    );

    showMapMessage("ルートを表示しました。");

  } catch (error) {
    if (requestId !== routeRequestId) return;

    console.error(error);

    setText("routeDistance", "検索できませんでした");
    setText("routeDuration", "出発地や目的地、通信状況を確認してください。");

    setStatus(
      "routeStatus",
      "ルート検索に失敗しました。道路データの有無やサービスの利用状況を確認してください。"
    );
  }
}

// ---- ルートをクリア ----

$("clearRouteBtn").addEventListener("click", () => {
  routeRequestId++;

  if (routeLayer) {
    map.removeLayer(routeLayer);
    routeLayer = null;
  }

  startPlace = null;
  endPlace = null;

  $("startInput").value = "";
  $("endInput").value = "";

  renderEndpointMarkers();

  setText("routeDistance", "ルート未設定");
  setText("routeDuration", "出発地と目的地を選択してください");
  setStatus("routeStatus", "");

  showMapMessage("ルートをクリアしました。");
});

// 手入力も可能
$("startInput").addEventListener("change", () => {
  const value = $("startInput").value.trim();

  if (!value) {
    startPlace = null;
    renderEndpointMarkers();
    return;
  }

  const matches = savedPlaces.find((place) => place.name === value);

  if (matches) {
    setStart(matches);
  } else {
    setStatus(
      "routeStatus",
      "出発地は検索結果、保存した場所、または現在地から選択してください。"
    );
  }
});

$("endInput").addEventListener("change", () => {
  const value = $("endInput").value.trim();

  if (!value) {
    endPlace = null;
    renderEndpointMarkers();
    return;
  }

  const matches = savedPlaces.find((place) => place.name === value);

  if (matches) {
    setEnd(matches);
  } else {
    setStatus(
      "routeStatus",
      "目的地は検索結果または保存した場所から選択してください。"
    );
  }
});

// ---- 保存データの一括削除 ----

$("clearSavedBtn").addEventListener("click", () => {
  if (savedPlaces.length === 0) return;

  if (!confirm("保存した場所をすべて削除しますか？")) return;

  const previous = savedPlaces;
  savedPlaces = [];

  if (persistSavedPlaces()) {
    renderSavedPlaces();
    renderSavedMarkers();
    showMapMessage("保存した場所をすべて削除しました。");
  } else {
    savedPlaces = previous;
    renderSavedPlaces();
    renderSavedMarkers();
  }
});

// ---- 保存したピンのポップアップ ----

map.on("popupopen", (event) => {
  const popup = event.popup;
  const element = popup.getElement();

  if (!element) return;

  element.querySelectorAll(".popup-route-start").forEach((button) => {
    button.addEventListener("click", () => {
      const place = savedPlaces[Number(button.dataset.index)];
      if (place) setStart(place);
      popup.remove();
    });
  });

  element.querySelectorAll(".popup-route-end").forEach((button) => {
    button.addEventListener("click", () => {
      const place = savedPlaces[Number(button.dataset.index)];
      if (place) setEnd(place);
      popup.remove();
    });
  });
});

// ---- 起動 ----

renderSavedPlaces();
renderSavedMarkers();

showMapMessage(
  "地図をクリックするとピンを追加できます。検索してルートを作成しましょう。"
);
