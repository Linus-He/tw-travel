const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createClient, normalizeApiUrl, mountPlace, mountHub } = require('../community.js');

const BASE = 'https://community.example.workers.dev';
const TOKEN = 'a'.repeat(64);
const AUTHOR = { id: 'author-1', nickname: '旅行的人' };
const response = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const tick = () => new Promise(resolve => setImmediate(resolve));
function storage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { data, getItem: key => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}

test('community configuration rejects credentials, insecure remote URLs and embedded queries', () => {
  assert.equal(normalizeApiUrl('https://community.example.workers.dev/'), BASE);
  assert.equal(normalizeApiUrl('http://127.0.0.1:8787/'), 'http://127.0.0.1:8787');
  for (const value of ['', undefined, 'javascript:alert(1)', 'http://remote.example', 'https://user:secret@example.org', `${BASE}?token=secret`, `${BASE}#key`]) assert.equal(normalizeApiUrl(value), '');
});

test('reading is anonymous; publishing identity is created once only when requested and saved separately from notebooks', async () => {
  const calls = [], store = storage({ 'island-notes': '{"private":"never upload"}' });
  const client = createClient({ baseUrl: BASE, storage: store, fetch: async (url, options) => {
    calls.push({ url, options });
    return response(url.endsWith('/v1/session') ? { token: TOKEN, author: AUTHOR } : { guides: [] });
  } });
  await client.guides('台南');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.headers.Authorization, undefined);
  assert.equal(calls[0].options.credentials, 'omit');
  await assert.rejects(client.saveGuide({ title: '私密内容' }), error => error.status === 401);
  assert.equal(calls.length, 1, 'a write cannot silently invent an author');
  const [a, b] = await Promise.all([client.ensureSession('旅行的人'), client.ensureSession('另一昵称')]);
  assert.equal(a, b);
  assert.equal(calls.filter(call => call.url.endsWith('/v1/session')).length, 1);
  assert.equal(JSON.parse(store.getItem('island-community-session')).token, TOKEN);
  assert.equal(store.getItem('island-notes'), '{"private":"never upload"}');
  await client.saveGuide({ title: '台南的一天', body: '原创内容' });
  const write = calls.at(-1);
  assert.equal(write.options.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!write.url.includes(TOKEN));
  assert.ok(!write.options.body.includes('never upload'));
  assert.equal(write.options.headers['Content-Type'], 'application/json');
  await client.guides();
  assert.equal(calls.at(-1).options.headers.Authorization, undefined, 'public reads never send a private posting key');
});

test('sessions are scoped to the configured service and rejection does not pretend a local save succeeded', async () => {
  const session = JSON.stringify({ baseUrl: BASE, token: TOKEN, author: AUTHOR });
  const store = storage({ 'island-community-session': session });
  const other = createClient({ baseUrl: 'https://other.example', storage: store, fetch: async () => { throw new Error('should not send token'); } });
  assert.equal(other.getSession(), null);
  let code = 429, calls = 0;
  const client = createClient({ baseUrl: BASE, storage: store, fetch: async () => { calls += 1; return response({ error: 'internal SQL with secret details' }, code); } });
  await assert.rejects(client.saveReview({ stars: 5, text: 'draft' }), error => error.status === 429 && !error.message.includes('SQL'));
  assert.equal(client.getSession().token, TOKEN, 'rate limits do not discard ownership');
  code = 401;
  await assert.rejects(client.remove('review', 'a'), error => error.status === 401);
  assert.equal(client.getSession(), null);
  assert.equal(store.getItem('island-community-session'), null);
  await assert.rejects(client.remove('review', 'a'), error => error.status === 401);
  assert.equal(calls, 2, 'invalid identity must be cleared before another write');
});

test('content and place IDs are encoded as single path segments; transport and malformed-success errors remain failures', async () => {
  const store = storage({ 'island-community-session': JSON.stringify({ baseUrl: BASE, token: TOKEN, author: AUTHOR }) });
  const calls = [];
  const client = createClient({ baseUrl: BASE, storage: store, fetch: async (url, options) => { calls.push({ url, options }); return response({ reviews: [], guides: [] }); } });
  await client.place('a/b?admin=true'); await client.restore('guide', '../private?token=x');
  assert.equal(calls[0].url, `${BASE}/v1/places/a%2Fb%3Fadmin%3Dtrue/community`);
  assert.equal(calls[1].url, `${BASE}/v1/guides/..%2Fprivate%3Ftoken%3Dx/restore`);
  assert.equal(calls[1].options.method, 'POST');
  assert.equal(calls[1].options.body, '{}');
  await assert.rejects(client.request('//elsewhere.example'), error => error.status === 400);
  const offline = createClient({ baseUrl: BASE, storage: store, fetch: async () => { throw new Error('offline'); } });
  await assert.rejects(offline.saveReview({ text: 'still a draft' }), error => error.status === 0);
  const malformed = createClient({ baseUrl: BASE, storage: store, fetch: async () => ({ ok: true, status: 200, json: async () => { throw new Error('not JSON'); } }) });
  await assert.rejects(malformed.saveReview({ text: 'still a draft' }), error => error.status === 502);
});

// A deliberately small DOM supports the real mounting code without an HTML parser.
function fakeDocument() {
  const created = [];
  const document = { createElement(tag) {
    const node = {
      tagName: tag.toUpperCase(), ownerDocument: document, children: [], attrs: {}, dataset: {}, events: {}, className: '', value: '', _text: '',
      setAttribute(name, value) { this.attrs[name] = String(value); },
      getAttribute(name) { return this.attrs[name] || null; },
      append(...nodes) { for (const child of nodes) { this.children.push(child); child.parentNode = this; } },
      replaceChildren(...nodes) { this._text = ''; this.children = []; this.append(...nodes); },
      addEventListener(name, callback) { (this.events[name] ||= []).push(callback); },
      emit(name) { const event = { preventDefault() {}, currentTarget: this, target: this }; for (const callback of this.events[name] || []) callback(event); },
      querySelectorAll(selector) {
        const matches = value => selector.startsWith('.') ? value.className.split(' ').includes(selector.slice(1)) : selector.startsWith('[data-') ? Object.keys(value.dataset).some(key => `data-${key.replace(/[A-Z]/g, char => `-${char.toLowerCase()}`)}` === selector.slice(1, -1)) : value.tagName.toLowerCase() === selector;
        const result = []; const walk = value => { for (const child of value.children) { if (matches(child)) result.push(child); walk(child); } }; walk(this); return result;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); },
      reportValidity: () => true, focus() {},
    };
    node.classList = {
      add(value) { node.className = [...new Set([...node.className.split(' ').filter(Boolean), value])].join(' '); },
      toggle(value, active) { const classes = new Set(node.className.split(' ').filter(Boolean)); active ? classes.add(value) : classes.delete(value); node.className = [...classes].join(' '); },
    };
    Object.defineProperty(node, 'textContent', { get() { return this._text + this.children.map(child => child.textContent).join(''); }, set(value) { this._text = String(value); this.children = []; } });
    created.push(node); return node;
  } };
  return { document, created, container: document.createElement('div') };
}
function useBrowser(t, base, fetcher, store = storage()) {
  const before = { config: global.TRAVEL_CONFIG, fetch: global.fetch, storage: global.localStorage };
  global.TRAVEL_CONFIG = { communityApiUrl: base }; global.fetch = fetcher; global.localStorage = store;
  t.after(() => { global.TRAVEL_CONFIG = before.config; global.fetch = before.fetch; global.localStorage = before.storage; });
}
const placeA = { id: 'place-a', name: '甲店', city: '台南' }, placeB = { id: 'place-b', name: '乙店', city: '台北' };
const payload = text => ({ rating: { average: 4, count: 1 }, reviews: [{ id: 'review-1', placeId: 'place-b', authorId: 'someone', nickname: '<script>作者</script>', stars: 4, text, createdAt: '2026-11-26T00:00:00Z' }], guides: [] });

test('remounting cannot display a stale place response; public text remains text rather than executable markup', async t => {
  const pending = [];
  useBrowser(t, `${BASE}/stale-test`, (url, options) => new Promise(resolve => pending.push({ url, options, resolve })));
  const dom = fakeDocument();
  mountPlace(dom.container, { place: placeA, places: [placeA, placeB] });
  const cleanup = mountPlace(dom.container, { place: placeB, places: [placeA, placeB] });
  assert.equal(pending.length, 2);
  assert.equal(pending[0].options.signal.aborted, true);
  const malicious = '<img src=x onerror=alert(1)> fresh second-place review';
  pending[1].resolve(response(payload(malicious))); await tick();
  pending[0].resolve(response(payload('stale first-place content'))); await tick();
  assert.ok(dom.container.textContent.includes(malicious));
  assert.ok(!dom.container.textContent.includes('stale first-place content'));
  assert.ok(!dom.created.some(node => ['IMG', 'SCRIPT'].includes(node.tagName)));
  assert.ok(dom.container.textContent.includes('<script>作者</script>'));
  cleanup();
});

test('unconfigured community disables publication and makes no network request or fake empty-success claim', t => {
  let calls = 0; useBrowser(t, '', async () => { calls += 1; throw Error('not configured'); });
  const dom = fakeDocument(), cleanup = mountHub(dom.container, { places: [placeA], initialPlaceId: placeA.id });
  assert.equal(calls, 0);
  assert.ok(dom.container.textContent.includes('公共社区正在连接，暂不能发表。'));
  assert.equal(dom.container.querySelector('.community-submit').disabled, true);
  assert.equal(dom.container.querySelector('select').value, placeA.id);
  assert.equal(dom.container.querySelector('details').open, true);
  cleanup();
});

test('a failed refresh keeps previously read public content visible and offers a retry', async t => {
  let calls = 0;
  useBrowser(t, `${BASE}/refresh-test`, async () => {
    if (++calls > 1) throw new Error('offline');
    return response({ guides: [{ id: 'guide-1', authorId: 'other', nickname: '旅友', city: '台南', title: '已经读到的笔记', body: '应当保留的公开内容', createdAt: '2026-11-26' }] });
  });
  const dom = fakeDocument(), cleanup = mountHub(dom.container, { places: [placeA] }); await tick();
  assert.ok(dom.container.textContent.includes('应当保留的公开内容'));
  dom.container.querySelector('.community-feed-filter').emit('submit'); await tick();
  assert.ok(dom.container.textContent.includes('应当保留的公开内容'));
  assert.ok(dom.container.textContent.includes('重新读取'));
  assert.ok(dom.container.querySelectorAll('.community-status').some(node => node.className.includes('is-error')));
  cleanup();
});

test('double-clicking publish sends one mutation, and a rejected submission preserves the draft', async t => {
  const writes = [];
  useBrowser(t, `${BASE}/publish-test`, async (url, options) => {
    if (url.endsWith('/v1/session')) return response({ token: TOKEN, author: AUTHOR });
    if (url.endsWith('/v1/reviews')) return new Promise(resolve => writes.push({ options, resolve }));
    return response({ rating: { average: null, count: 0 }, reviews: [], guides: [] });
  });
  const dom = fakeDocument(), cleanup = mountPlace(dom.container, { place: placeA, places: [placeA] }); await tick();
  const form = dom.container.querySelector('.community-form'), inputs = form.querySelectorAll('input'), text = form.querySelector('textarea');
  inputs[0].value = '旅行的人'; text.value = '这是一段需要保留的真实体验草稿。';
  form.emit('submit'); form.emit('submit'); await tick();
  assert.equal(writes.length, 1);
  assert.equal(form.querySelector('.community-submit').disabled, true);
  writes[0].resolve(response({ error: 'rejected' }, 400)); await tick();
  assert.equal(text.value, '这是一段需要保留的真实体验草稿。');
  assert.ok(form.textContent.includes('内容格式不正确'));
  assert.equal(form.querySelector('.community-submit').disabled, false);
  assert.ok(!form.textContent.includes('评价已公开发表'));
  form.emit('submit'); await tick();
  writes[1].resolve(response({ review: { id: 'existing', hiddenAt: '2026-11-26' } })); await tick();
  assert.ok(form.textContent.includes('目前处于隐藏状态'));
  assert.ok(!form.textContent.includes('评价已公开发表'), 'editing hidden content must not claim it is public');
  cleanup();
});
