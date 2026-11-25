/* A browser Maps key is visible to visitors. Restrict it by website and API. */
window.TravelMap = (() => {
  let map, provider, markers = [], pendingRows = [], onSelect, focus;
  let failed = false;
  const home = { lat: 23.75, lng: 121 };
  const status = text => { document.querySelector('#map-status').textContent = text; };
  const clearMarkers = () => {
    markers.forEach(marker => provider === 'google' ? marker.map = null : marker.remove());
    markers = [];
  };
  function setPlaces(rows, select) {
    pendingRows = rows;
    onSelect = select;
    if (!map || failed) return;
    clearMarkers();
    markers = rows.map(place => {
      if (provider === 'google') {
        const pin = document.createElement('span');
        pin.className = 'google-pin';
        pin.textContent = place.type === '美食' ? '食' : '✦';
        const marker = new google.maps.marker.AdvancedMarkerElement({
          map, position: { lat: place.lat, lng: place.lng }, title: place.name,
          content: pin,
        });
        marker.addListener('click', () => onSelect(place.id));
        return marker;
      }
      return L.marker([place.lat, place.lng], {
        icon: L.divIcon({className: 'pin', html: place.type === '美食' ? '食' : '✦', iconSize: [32, 32]}),
      }).addTo(map).bindTooltip(place.name).on('click', () => onSelect(place.id));
    });
  }
  function showPlace(place) {
    focus = place;
    if (!map || failed) return;
    if (provider === 'google') {
      map.panTo({lat: place.lat, lng: place.lng});
      map.setZoom(13);
    } else map.flyTo([place.lat, place.lng], 12);
  }
  function reset() {
    focus = null;
    if (!map || failed) return;
    if (provider === 'google') { map.setCenter(home); map.setZoom(7); }
    else map.setView([home.lat, home.lng], 7);
  }
  function mapError(message) {
    failed = true;
    clearMarkers();
    status('Google 地图暂时不可用');
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
  }
  async function init() {
    const config = window.TRAVEL_CONFIG || {};
    if (!config.googleMapsApiKey) {
      provider = 'osm';
      status('OpenStreetMap · Google 地图待配置');
      map = L.map('map', {zoomControl: false}).setView([home.lat, home.lng], 7);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
      }).addTo(map);
      L.control.zoom({position: 'topright'}).addTo(map);
      setPlaces(pendingRows, onSelect);
      if (focus) showPlace(focus);
      return;
    }
    provider = 'google';
    status('正在加载 Google 地图…');
    let timeout;
    window.gm_authFailure = () => {
      clearTimeout(timeout);
      mapError('暂时无法连接地图服务。你仍可浏览地点与编写攻略。');
    };
    try {
      await new Promise((resolve, reject) => {
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
      status('Google Maps · 探索台湾');
      setPlaces(pendingRows, onSelect);
      if (focus) showPlace(focus);
    } catch {
      if (!failed) mapError('网络连接暂时不可用。请稍后重试，你仍可浏览地点与编写攻略。');
    }
  }
  return { init, setPlaces, showPlace, reset };
})();
