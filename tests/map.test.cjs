const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ key = '', leafletFails = false } = {}) {
  const created = [], scripts = [], tiles = [], status = {}, panel = {};
  const events = {}, tileEvents = {};
  const viewport = { south: 24.9, west: 121.4, north: 25.2, east: 121.7 };
  const map = {
    zoom: 7,
    setView(center, zoom) { this.center = center; this.zoom = zoom; return this; },
    panTo(center) { this.center = center; },
    setCenter(center) { this.center = center; },
    setZoom(zoom) { this.zoom = zoom; },
    getZoom() { return this.zoom; },
    getBounds() {
      return {
        getSouth: () => viewport.south, getWest: () => viewport.west,
        getNorth: () => viewport.north, getEast: () => viewport.east,
        getSouthWest: () => ({ lat: () => viewport.south, lng: () => viewport.west }),
        getNorthEast: () => ({ lat: () => viewport.north, lng: () => viewport.east }),
      };
    },
    on(name, handler) { events[name] = handler; return this; },
    addListener(name, handler) { events[name] = handler; },
  };
  const context = {
    URL, URLSearchParams, setTimeout, clearTimeout,
    document: {
      querySelector: selector => selector === '#map-status' ? status : panel,
      createElement: () => ({ setAttribute() {}, append() {} }),
      head: { append(script) { scripts.push(script); } },
    },
    google: { maps: {
      Map: function () { return map; },
      marker: { AdvancedMarkerElement: class {
        constructor(options) { Object.assign(this, options); created.push(this); }
        addListener(_, handler) { this.click = handler; }
      } },
    } },
    L: {
      map: () => { if (leafletFails) throw new Error('network'); return map; },
      tileLayer: (url, options) => {
        const tile = { url, options, on(name, handler) { tileEvents[name] = handler; return this; }, addTo() {} };
        tiles.push(tile); return tile;
      },
      control: { zoom: () => ({ addTo() {} }) },
      divIcon: options => options,
      marker: (position, options) => ({
        position, options,
        addTo() { created.push(this); return this; },
        bindTooltip(title) { this.title = title; return this; },
        on(_, handler) { this.click = handler; return this; },
        remove() { this.removed = true; },
      }),
    },
  };
  panel.replaceChildren = node => { context.error = node; };
  context.window = context;
  context.TRAVEL_CONFIG = { googleMapsApiKey: key };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('map.js', 'utf8'), context);
  return { context, api: context.TravelMap, map, created, scripts, status, tiles, viewport,
    emit(name) { events[name]?.(); }, tileError() { tileEvents.tileerror?.(); } };
}
const rows = [{ id: 'taipei-1', name: '台北', city: '台北', type: '美食', lat: 25.04, lng: 121.52 }];
const nearby = [...rows, { id: 'taipei-2', name: '另一地点', city: '台北', type: '景点', lat: 25.04001, lng: 121.52001 }];

test('OSM needs no key, has linked attribution, and individual markers select stable IDs', async () => {
  const s = setup(); let selected;
  s.api.setPlaces(rows, id => selected = id);
  await s.api.init();
  assert.equal(s.scripts.length, 0);
  assert.equal(s.tiles[0].url, 'https://tile.openstreetmap.org/{z}/{x}/{y}.png');
  assert.ok(s.tiles[0].options.attribution.includes('https://www.openstreetmap.org/copyright'));
  assert.ok(s.status.textContent.includes('OpenStreetMap'));
  assert.ok(!s.status.textContent.includes('待配置'));
  s.created.at(-1).click(); assert.equal(selected, 'taipei-1');
  const previous = s.created.at(-1);
  s.api.setPlaces([], () => {}); assert.equal(previous.removed, true);
});

test('close places cluster at island scale and separate at street zoom', async () => {
  const s = setup(); let selected;
  s.api.setPlaces(nearby, id => selected = id); await s.api.init();
  const cluster = s.created.at(-1);
  assert.equal(cluster.options.icon.html, '2');
  assert.ok(cluster.options.title.includes('2 个地点'));
  cluster.click(); assert.equal(s.map.zoom, 9); assert.equal(selected, undefined);
  s.map.zoom = 15; const count = s.created.length; s.emit('moveend');
  const newMarkers = s.created.slice(count);
  assert.equal(newMarkers.length, 2);
  newMarkers[1].click(); assert.equal(selected, 'taipei-2');
});

test('viewport notifications return independent bounds snapshots and can unsubscribe', async () => {
  const s = setup(), bounds = [];
  assert.equal(s.api.getBounds(), null);
  const off = s.api.onViewportChanged(value => bounds.push(value)); await s.api.init();
  assert.equal(bounds.length, 1);
  assert.equal(bounds[0].south, 24.9);
  s.viewport.south = 23; s.emit('moveend');
  assert.equal(bounds.length, 2); assert.equal(bounds[0].south, 24.9); assert.equal(bounds[1].south, 23);
  off(); s.emit('moveend'); assert.equal(bounds.length, 2);
});

test('city shortcuts and selected location work before map readiness', async () => {
  const s = setup(); s.api.fitCity('台南'); await s.api.init();
  assert.equal(s.map.center[0], 22.999); assert.equal(s.map.zoom, 12);
  s.api.fitCity('台北'); assert.equal(s.map.center[0], 25.07);
  s.api.showPlace(rows[0]); assert.equal(s.map.zoom, 16); assert.equal(s.map.center[0], 25.04);
  s.api.reset(); assert.equal(s.map.zoom, 7); assert.equal(s.map.center[0], 23.75);
});

test('Google async loading uses latest filters and focus, and emits idle bounds', async () => {
  const s = setup({ key: 'test-key' }); let selected, bounds;
  s.api.onViewportChanged(value => bounds = value);
  const init = s.api.init();
  assert.equal(new URL(s.scripts[0].src).hostname, 'maps.googleapis.com');
  s.api.setPlaces(nearby, () => {});
  s.api.setPlaces(rows, id => selected = id); s.api.showPlace(rows[0]);
  s.context.initGoogleTravelMap(); await init;
  assert.equal(s.created.length, 1); assert.equal(s.map.zoom, 16);
  s.created[0].click(); assert.equal(selected, 'taipei-1');
  s.emit('idle'); assert.equal(bounds.north, 25.2);
  s.api.setPlaces([], () => {}); assert.equal(s.created.at(-1).map, null);
  assert.equal(s.scripts.length, 1); await s.api.init(); assert.equal(s.scripts.length, 1);
});

test('Google network failure and absent Leaflet show a recoverable error', async () => {
  const s = setup({ key: 'test-key' });
  const init = s.api.init(); s.scripts[0].onerror(); await init;
  assert.ok(s.status.textContent.includes('不可用')); assert.ok(s.context.error);
  assert.equal(s.api.getBounds(), null);
  const noLeaflet = setup({ leafletFails: true }); await noLeaflet.api.init();
  assert.ok(noLeaflet.context.error);
});

test('invalid coordinates are skipped and repeated tile errors preserve the list', async () => {
  const s = setup(); s.api.setPlaces([...rows, { id: 'invalid', lat: null, lng: 0 }], () => {});
  await s.api.init();
  assert.ok(s.created.every(marker => marker.position[0] === 25.04));
  s.tileError(); s.tileError(); s.tileError();
  assert.ok(s.status.textContent.includes('地点列表仍可使用'));
  assert.equal(s.api.getBounds().south, 24.9);
});

test('Google authentication failure settles initialization and ignores a late callback', async () => {
  const s = setup({ key: 'invalid-key' });
  const init = s.api.init(); s.context.gm_authFailure(); await init;
  s.context.initGoogleTravelMap();
  assert.ok(s.context.error); assert.equal(s.api.getBounds(), null);
  assert.equal(s.created.length, 0);
});
