const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup({ loading = false, initiallySaved = false, mobile = false } = {}) {
  const events = new Map(), frames = [], observers = [];
  const media = { matches: mobile };
  let focused = null, resized = 0, iconsRendered = 0;
  function element(id) {
    const attrs = {}, classes = new Set(), handlers = new Map(), properties = {};
    const node = {
      id, attrs, handlers, properties, dataset: {}, disabled: false, open: false,
      offsetLeft: 0, offsetTop: 4, offsetWidth: 96, offsetHeight: 40,
      style: { setProperty(name, value) { properties[name] = value; } },
      classList: { toggle(name, value) { value ? classes.add(name) : classes.delete(name); }, contains: name => classes.has(name) },
      setAttribute(name, value) { attrs[name] = value; },
      getAttribute(name) { return attrs[name] ?? null; },
      addEventListener(name, callback) {
        if (!handlers.has(name)) handlers.set(name, []);
        handlers.get(name).push(callback);
      },
      emit(name, event = {}) { (handlers.get(name) || []).forEach(callback => callback({ target: node, ...event })); },
      closest(selector) { return selector === 'button' ? node : null; },
      focus() { focused = id; },
      showModal() { node.open = true; node.opens = (node.opens || 0) + 1; },
    };
    return node;
  }
  const ids = ['main-tabs', 'explore', 'saved', 'write', 'editor', 'backup-open', 'backup-dialog', 'mobile-map-toggle'];
  const nodes = Object.fromEntries(ids.map(id => [id, element(id)]));
  nodes.explore.offsetLeft = 4;
  nodes.saved.offsetLeft = 100;
  nodes.write.offsetLeft = 196;
  if (initiallySaved) nodes.saved.setAttribute('aria-pressed', 'true');
  const document = {
    readyState: loading ? 'loading' : 'complete', body: { dataset: {} },
    querySelector: selector => nodes[selector.slice(1)] || null,
    addEventListener(name, callback) { events.set(`document:${name}`, callback); },
  };
  const window = {
    Event: class { constructor(type) { this.type = type; } },
    matchMedia(query) { assert.equal(query, '(max-width: 700px)'); return media; },
    requestAnimationFrame(callback) { frames.push(callback); },
    addEventListener(name, callback) { events.set(`window:${name}`, callback); },
    dispatchEvent(event) { if (event.type === 'resize') resized += 1; events.get(`window:${event.type}`)?.(event); },
    ResizeObserver: class {
      constructor(callback) { this.callback = callback; this.observed = []; observers.push(this); }
      observe(node) { this.observed.push(node); }
    },
    lucide: { createIcons() { iconsRendered += 1; } },
  };
  vm.runInNewContext(fs.readFileSync('ui.js', 'utf8'), { window, document });
  const flush = () => {
    for (let i = 0; frames.length && i < 10; i++) frames.shift()();
    assert.equal(frames.length, 0, 'UI work settles without a resize loop');
  };
  const pressed = () => ['explore', 'saved', 'write'].filter(id => nodes[id].attrs['aria-pressed'] === 'true');
  return { window, document, nodes, media, api: window.TravelUI, flush, pressed, observers,
    ready() { document.readyState = 'complete'; events.get('document:DOMContentLoaded')?.(); },
    focused: () => focused, resized: () => resized, iconsRendered: () => iconsRendered };
}

test('editor selection is temporary and restores the underlying saved view after Escape or close', () => {
  const s = setup({ initiallySaved: true });
  assert.deepEqual(s.pressed(), ['saved']);
  assert.equal(s.nodes['main-tabs'].dataset.view, 'saved');
  s.nodes.editor.open = true; s.api.syncNavigation();
  assert.deepEqual(s.pressed(), ['write']);
  assert.equal(s.nodes['main-tabs'].dataset.view, 'saved');
  s.nodes.editor.emit('cancel');
  s.nodes.editor.open = false;
  s.nodes.editor.emit('close'); s.flush();
  assert.deepEqual(s.pressed(), ['saved']);
  assert.equal(s.nodes['main-tabs'].dataset.active, 'saved');
  s.nodes['main-tabs'].dataset.view = 'explore'; s.api.syncNavigation();
  assert.deepEqual(s.pressed(), ['explore']);
});

test('arrow keys, Home and End move focus without activating a different view', () => {
  const s = setup(); let prevented = 0;
  const key = (id, name) => s.nodes['main-tabs'].emit('keydown', {
    target: s.nodes[id], key: name, preventDefault() { prevented += 1; },
  });
  key('explore', 'ArrowRight'); assert.equal(s.focused(), 'saved');
  key('write', 'ArrowRight'); assert.equal(s.focused(), 'explore');
  key('saved', 'Home'); assert.equal(s.focused(), 'explore');
  key('explore', 'End'); assert.equal(s.focused(), 'write');
  s.nodes.saved.disabled = true;
  key('explore', 'ArrowRight'); assert.equal(s.focused(), 'write');
  assert.equal(prevented, 5);
  assert.deepEqual(s.pressed(), ['explore']);
});

test('selection and lens geometry follow the application view and resize without creating new controls', () => {
  const s = setup();
  s.nodes['main-tabs'].dataset.view = 'saved';
  s.nodes['main-tabs'].emit('click'); s.flush();
  assert.deepEqual(s.pressed(), ['saved']);
  assert.equal(s.nodes['main-tabs'].properties['--tab-x'], '100px');
  s.nodes.saved.offsetLeft = 86; s.nodes.saved.offsetWidth = 82;
  s.observers[0].callback(); s.flush();
  assert.equal(s.nodes['main-tabs'].properties['--tab-x'], '86px');
  assert.equal(s.nodes['main-tabs'].properties['--tab-w'], '82px');
  assert.equal(s.nodes['main-tabs'].properties['--tab-h'], '40px');
});

test('mobile view toggle exposes the next action and dispatches a layout resize', () => {
  const s = setup(); const button = s.nodes['mobile-map-toggle'];
  assert.equal(s.document.body.dataset.mobileView, 'map');
  assert.equal(button.attrs['aria-label'], '查看列表');
  button.emit('click'); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'list');
  assert.equal(button.attrs['aria-pressed'], 'true');
  assert.equal(button.attrs['aria-label'], '查看地图');
  assert.equal(s.resized(), 1);
  button.emit('click'); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'map');
  assert.equal(button.attrs['aria-pressed'], 'false');
  assert.equal(s.resized(), 2);
  assert.deepEqual(s.pressed(), ['explore']);
});

test('mobile saved navigation reveals the list and explore returns to the map', () => {
  const s = setup({ mobile: true });
  const nav = s.nodes['main-tabs'];
  nav.dataset.view = 'saved';
  nav.emit('click', { target: s.nodes.saved }); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'list');
  assert.equal(s.nodes['mobile-map-toggle'].attrs['aria-label'], '查看地图');
  assert.deepEqual(s.pressed(), ['saved']);

  s.nodes.editor.open = true;
  nav.emit('click', { target: s.nodes.write }); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'list');
  assert.deepEqual(s.pressed(), ['write']);
  s.nodes.editor.open = false; s.nodes.editor.emit('close'); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'list');
  assert.deepEqual(s.pressed(), ['saved']);

  nav.dataset.view = 'explore';
  nav.emit('click', { target: s.nodes.explore }); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'map');
  assert.equal(s.nodes['mobile-map-toggle'].attrs['aria-label'], '查看列表');
  assert.deepEqual(s.pressed(), ['explore']);
  assert.equal(s.resized(), 2);
});

test('desktop navigation is unchanged and responds to a later narrow viewport', () => {
  const s = setup(); const nav = s.nodes['main-tabs'];
  nav.dataset.view = 'saved';
  nav.emit('click', { target: s.nodes.saved }); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'map');
  assert.equal(s.resized(), 0);
  assert.deepEqual(s.pressed(), ['saved']);

  s.media.matches = true;
  nav.emit('click', { target: s.nodes.saved }); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'list');
  assert.equal(s.resized(), 1);
  s.window.matchMedia = undefined;
  nav.dataset.view = 'explore';
  assert.doesNotThrow(() => nav.emit('click', { target: s.nodes.explore })); s.flush();
  assert.equal(s.document.body.dataset.mobileView, 'list');
  assert.deepEqual(s.pressed(), ['explore']);
});

test('backup opens once, icon markup rejects injection, and initialization can wait for the DOM', () => {
  const s = setup({ loading: true });
  assert.equal(s.nodes['main-tabs'].dataset.active, undefined);
  s.ready();
  s.nodes['backup-open'].emit('click'); s.nodes['backup-open'].emit('click');
  assert.equal(s.nodes['backup-dialog'].opens, 1);
  assert.equal(s.api.icon('bookmark'), '<i data-lucide="bookmark" aria-hidden="true"></i>');
  assert.equal(s.api.icon('map"><script>alert(1)</script>'), '');
  assert.equal(s.api.icon(null), '');
  assert.ok(s.iconsRendered() > 0);
  s.window.lucide = undefined;
  assert.doesNotThrow(() => s.api.refreshIcons());
});
