/* Browser Maps keys are visible to visitors; restrict them by website and API. */
window.TravelMap = (() => {
  let map, provider, markers = [], pendingRows = [], onSelect, pendingView;
  let viewportListener, initPromise, failed = false;
  const home = { lat: 23.75, lng: 121 };
  const cities = {
    '台北': { center: [25.07, 121.55], zoom: 12 },
    '台南': { center: [22.999, 120.205], zoom: 12 },
  };
  const status = text => {
    const element = document.querySelector('#map-status');
    if (element) element.textContent = text;
  };
  function clearMarkers() {
    markers.forEach(marker => provider === 'google' ? marker.map = null : marker.remove());
    markers = [];
  }
  function getBounds() {
    if (!map || failed) return null;
    const bounds = map.getBounds();
    if (!bounds) return null;
    const result = provider === 'google'
      ? { south: bounds.getSouthWest().lat(), west: bounds.getSouthWest().lng(), north: bounds.getNorthEast().lat(), east: bounds.getNorthEast().lng() }
      : { south: bounds.getSouth(), west: bounds.getWest(), north: bounds.getNorth(), east: bounds.getEast() };
    return Object.values(result).every(Number.isFinite) ? result : null;
  }
  function notifyViewport() {
    renderMarkers();
    if (typeof viewportListener === 'function') viewportListener(getBounds());
  }
  function onViewportChanged(callback) {
    viewportListener = callback;
    if (map && !failed && typeof callback === 'function') callback(getBounds());
    return () => { if (viewportListener === callback) viewportListener = null; };
  }
  // Project into Web Mercator pixels so grouping follows the visible zoom level.
  function groupPlaces(rows, zoom) {
    if (zoom >= 15) return rows.map(place => ({ places: [place], lat: place.lat, lng: place.lng }));
    const scale = 256 * Math.pow(2, zoom), cells = new Map();
    rows.forEach(place => {
      const sin = Math.sin(Math.max(-85.0511, Math.min(85.0511, place.lat)) * Math.PI / 180);
      const x = (place.lng + 180) / 360 * scale;
      const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
      const key = `${Math.floor(x / 64)}:${Math.floor(y / 64)}`;
      if (!cells.has(key)) cells.set(key, []);
      cells.get(key).push(place);
    });
    return Array.from(cells.values(), places => ({
      places,
      lat: places.reduce((sum, place) => sum + place.lat, 0) / places.length,
      lng: places.reduce((sum, place) => sum + place.lng, 0) / places.length,
    }));
  }
  function moveTo(center, zoom) {
    if (!map || failed) return;
    if (provider === 'google') {
      map.panTo({ lat: center[0], lng: center[1] });
      map.setZoom(zoom);
    } else map.setView(center, zoom);
  }
  function renderMarkers() {
    if (!map || failed) return;
    clearMarkers();
    const zoom = map.getZoom() || 7;
    markers = groupPlaces(pendingRows, zoom).map(group => {
      const clustered = group.places.length > 1;
      const place = group.places[0];
      const title = clustered ? `${group.places.length} 个地点，点击放大查看` : place.name;
      const label = clustered ? String(group.places.length) : place.type === '美食' ? '食' : place.type === '咖啡馆' ? '咖' : '✦';
      const select = () => {
        if (clustered) moveTo([group.lat, group.lng], Math.min(16, zoom + 2));
        else if (typeof onSelect === 'function') onSelect(place.id);
      };
      if (provider === 'google') {
        const pin = document.createElement('span');
        pin.className = `google-pin${clustered ? ' cluster-pin' : ''}`;
        pin.textContent = label;
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map, position: { lat: group.lat, lng: group.lng }, title, content: pin,
        });
        marker.addListener('click', select);
        return marker;
      }
      return L.marker([group.lat, group.lng], {
        title, keyboard: true,
        icon: L.divIcon({ className: `pin${clustered ? ' cluster-pin' : ''}`, html: label, iconSize: clustered ? [42, 42] : [32, 32] }),
      }).addTo(map).bindTooltip(title).on('click', select);
    });
  }
  function setPlaces(rows, select) {
    pendingRows = (Array.isArray(rows) ? rows : []).filter(place =>
      Number.isFinite(place.lat) && Number.isFinite(place.lng) && Math.abs(place.lat) <= 90 && Math.abs(place.lng) <= 180);
    onSelect = select;
    renderMarkers();
  }
  function applyView() {
    if (pendingView?.kind === 'place') moveTo([pendingView.place.lat, pendingView.place.lng], 16);
    else {
      const city = cities[pendingView?.city];
      moveTo(city ? city.center : [home.lat, home.lng], city ? city.zoom : 7);
    }
  }
  function showPlace(place) {
    if (!place || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) return;
    pendingView = { kind: 'place', place };
    applyView();
  }
  function fitCity(city) {
    pendingView = { kind: 'city', city };
    applyView();
  }
  function reset() { fitCity('全部'); }
  function mapError(message) {
    failed = true;
    clearMarkers();
    status('地图暂时不可用');
    const box = document.createElement('div');
    box.className = 'map-error';
    box.setAttribute('role', 'alert');
    const title = document.createElement('strong');
    title.textContent = '地图加载失败';
    const text = document.createElement('p');
    text.textContent = message;
    const retry = document.createElement('button');
    retry.className = 'primary';
    retry.textContent = '重新加载';
    retry.onclick = () => location.reload();
    box.append(title, text, retry);
    document.querySelector('#map').replaceChildren(box);
    if (typeof viewportListener === 'function') viewportListener(null);
  }
  function mapReady(eventName) {
    if (provider === 'google') map.addListener(eventName, notifyViewport);
    else map.on(eventName, notifyViewport);
    renderMarkers();
    if (pendingView) applyView();
    if (provider !== 'google') notifyViewport();
  }
  async function initialize() {
    const config = window.TRAVEL_CONFIG || {};
    if (!config.googleMapsApiKey) {
      provider = 'osm';
      try {
        map = L.map('map', { zoomControl: false }).setView([home.lat, home.lng], 7);
        const tiles = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors', maxZoom: 19,
        });
        let tileErrors = 0;
        tiles.on('tileerror', () => {
          tileErrors += 1;
          if (tileErrors >= 3) status('地图底图加载较慢 · 地点列表仍可使用');
        });
        tiles.on('load', () => {
          if (tileErrors === 0) status('OpenStreetMap · 台湾旅行地图');
        });
        tiles.addTo(map);
        L.control.zoom({ position: 'topright' }).addTo(map);
        status('OpenStreetMap · 台湾旅行地图');
        mapReady('moveend');
      } catch {
        mapError('地图暂时无法连接。你仍可浏览地点、收藏与编写攻略。');
      }
      return;
    }
    provider = 'google';
    status('正在加载 Google 地图…');
    let timeout, rejectLoad;
    window.gm_authFailure = () => {
      clearTimeout(timeout);
      if (rejectLoad) rejectLoad(new Error('authentication'));
      mapError('暂时无法连接地图服务。你仍可浏览地点与编写攻略。');
    };
    try {
      await new Promise((resolve, reject) => {
        rejectLoad = reject;
        timeout = setTimeout(() => reject(new Error('timeout')), 20000);
        window.initGoogleTravelMap = () => { clearTimeout(timeout); resolve(); };
        const url = new URL('https://maps.googleapis.com/maps/api/js');
        url.search = new URLSearchParams({
          key: config.googleMapsApiKey, callback: 'initGoogleTravelMap', loading: 'async',
          libraries: 'marker', v: 'quarterly', language: 'zh-TW', region: 'TW',
        });
        const script = document.createElement('script');
        script.src = url.href;
        script.async = true;
        script.onerror = () => { clearTimeout(timeout); reject(new Error('network')); };
        document.head.append(script);
      });
      if (failed) return;
      map = new google.maps.Map(document.querySelector('#map'), {
        center: home, zoom: 7, mapId: config.googleMapsMapId || 'DEMO_MAP_ID',
        mapTypeControl: true, streetViewControl: true, fullscreenControl: true,
        gestureHandling: 'cooperative',
      });
      status('Google Maps · 台湾旅行地图');
      mapReady('idle');
    } catch {
      if (!failed) mapError('网络连接暂时不可用。请稍后重试，你仍可浏览地点与编写攻略。');
    }
  }
  function init() {
    if (!initPromise) initPromise = initialize();
    return initPromise;
  }
  return { init, setPlaces, showPlace, reset, fitCity, getBounds, onViewportChanged };
})();
