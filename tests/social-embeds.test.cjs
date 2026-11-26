const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { normalizePostUrl, validEntries } = require('../social-embeds.js');

function setup() {
  const timers = new Map(); let timerId = 0;
  const doc = {};
  class Element {
    constructor(tag) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.dataset = {}; this.attrs = {}; this.hidden = false; this.className = ''; this.textContent = ''; }
    get isConnected() { return this === doc.body || this === doc.head || Boolean(this.parentNode?.isConnected); }
    append(...nodes) { nodes.forEach(node => { node.remove(); node.parentNode = this; this.children.push(node); }); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
    replaceChildren(...nodes) { this.children.slice().forEach(node => node.remove()); this.append(...nodes); }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
  }
  doc.createElement = tag => new Element(tag);
  doc.head = new Element('head'); doc.body = new Element('body');
  const context = {
    URL, URLSearchParams,
    document: doc,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  context.window = context;
  vm.createContext(context); vm.runInContext(fs.readFileSync('social-embeds.js', 'utf8'), context);
  const container = new Element('section'); doc.body.append(container);
  const descendants = parent => parent.children.flatMap(node => [node, ...descendants(node)]);
  const byClass = name => descendants(container).filter(node => node.className.split(' ').includes(name));
  return { api: context.SocialEmbeds, context, doc, container, byClass, descendants, timers };
}
const entries = [
  { placeId: 'tainan-1', url: 'https://www.threads.net/@Traveler/post/Ab_cd12/?utm_source=x', curatedAt: '2026-11-26', kind: 'traveler', label: '旅友分享链接' },
  { placeId: 'tainan-1', url: 'https://www.facebook.com/shop/posts/123456789/', curatedAt: '2026-11-25', kind: 'official', label: '店家公开动态' },
  { placeId: 'other-place', url: 'https://www.instagram.com/p/Abc123_/', curatedAt: '2026-11-26', kind: 'traveler' },
];

test('post normalization accepts specific public post routes and removes tracking without losing IDs', () => {
  assert.deepEqual(normalizePostUrl(entries[0].url), { platform: 'threads', url: 'https://www.threads.com/@traveler/post/Ab_cd12/' });
  assert.deepEqual(normalizePostUrl('https://threads.com/t/Abc123_#reply'), { platform: 'threads', url: 'https://www.threads.com/t/Abc123_/' });
  assert.deepEqual(normalizePostUrl('https://instagram.com/reel/AbC123_/?igsh=x'), { platform: 'instagram', url: 'https://www.instagram.com/reel/AbC123_/' });
  assert.deepEqual(normalizePostUrl('https://m.facebook.com/permalink.php?story_fbid=pfbidAbc123&id=12345&ref=share'), { platform: 'facebook', url: 'https://www.facebook.com/permalink.php?story_fbid=pfbidAbc123&id=12345' });
  assert.equal(normalizePostUrl('https://facebook.com/watch/?v=123456&ref=watch').url, 'https://www.facebook.com/watch/?v=123456');
  assert.equal(normalizePostUrl('https://www.facebook.com/person/videos/123456/').platform, 'facebook');
  assert.equal(normalizePostUrl('https://www.facebook.com/reel/123456/').platform, 'facebook');
});

test('URL allowlist rejects credentials, ports, encoded authorities, profiles, groups and executable or redirect URLs', () => {
  const bad = [
    'javascript:alert(1)', 'http://instagram.com/p/Abc123/', 'https://www.instagram.com.evil.test/p/Abc123/',
    'https://www.instagram.com@evil.test/p/Abc123/', 'https://evil.test@www.instagram.com/p/Abc123/',
    'https://www.instagram.com:443/p/Abc123/', 'https://www.instagram.com:444/p/Abc123/',
    'https://%69nstagram.com/p/Abc123/', 'https://www.instagram.com\\@evil.test/p/Abc123/',
    'https://www.instag\nram.com/p/Abc123/', 'https://www.instagram.com/person/',
    'https://www.instagram.com/stories/person/12345/', 'https://www.threads.com/@person',
    'https://www.facebook.com/groups/123/posts/456/', 'https://www.facebook.com/share/p/Abc123/',
    'https://www.facebook.com/groups/posts/12345/', 'https://www.facebook.com/profile.php?id=12345',
    'https://www.facebook.com/watch/?v=12345&v=67890', 'https://www.facebook.com/permalink.php?id=12345&story_fbid=<script>',
    'https://www.instagram.com/p/abc%2F123/', 'https://constructor/shop/posts/123456/',
    'https://__proto__/shop/posts/123456/', '', null, { url: entries[0].url },
  ];
  bad.forEach(url => assert.equal(normalizePostUrl(url), null, String(url)));
});

test('curated records require a real date, place, kind and canonical URL, deduplicate and drop copied content fields', () => {
  const result = validEntries([...entries, { ...entries[0], url: 'https://www.threads.com/@traveler/post/Ab_cd12/?other=1', body: 'Do not copy this' },
    { ...entries[0], curatedAt: '2026-02-30' }, { ...entries[0], kind: 'review' },
    { ...entries[1], platform: 'instagram' }, { ...entries[1], label: { html: 'unsafe' } },
  ], new Set(['tainan-1']));
  assert.equal(result.length, 2);
  assert.ok(result.every(row => row.placeId === 'tainan-1' && !Object.hasOwn(row, 'body')));
  assert.equal(validEntries(null).length, 0);
  const published = JSON.parse(fs.readFileSync('social-posts.json', 'utf8'));
  const ids = new Set(JSON.parse(fs.readFileSync('places.json', 'utf8')).map(place => place.id));
  assert.deepEqual(validEntries(published, ids).map(({ platform, ...row }) => row), published);
});

test('read-only place display separates official posts from travelers, filters platforms and never auto-loads embeds', () => {
  const s = setup();
  assert.equal(s.api.renderPlace(s.container, { placeId: 'absent', posts: entries }).count, 0);
  assert.equal(s.byClass('social-empty')[0].textContent, '还没有关联的公开帖子');
  const rendered = s.api.renderPlace(s.container, { placeId: 'tainan-1', posts: entries });
  assert.equal(rendered.count, 2);
  assert.deepEqual(s.byClass('social-post-kind').map(node => node.textContent), ['旅友原帖', '官方动态']);
  assert.equal(s.byClass('social-original').length, 2);
  assert.ok(!s.descendants(s.container).some(node => ['INPUT', 'TEXTAREA', 'FORM', 'IFRAME'].includes(node.tagName)));
  assert.equal(s.doc.head.children.length, 0);
  const buttons = s.byClass('social-platform-button');
  buttons.find(button => button.dataset.socialPlatform === 'facebook').onclick();
  assert.deepEqual(s.byClass('social-post').map(node => node.hidden), [true, false]);
  assert.equal(buttons.find(button => button.dataset.socialPlatform === 'facebook').getAttribute('aria-pressed'), 'true');
  buttons.find(button => button.dataset.socialPlatform === 'instagram').onclick();
  assert.ok(s.byClass('social-post').every(node => node.hidden));
  assert.equal(s.byClass('social-empty')[0].hidden, false);
  rendered.destroy(); assert.equal(s.container.children.length, 0);
});

test('mount restricts Facebook frames and shares fixed Threads/Instagram SDKs without processing detached mounts', async () => {
  const s = setup();
  const cleanup = await s.api.mount(s.container, entries[1]);
  const frame = s.container.children[0], frameUrl = new URL(frame.src);
  assert.equal(frame.tagName, 'IFRAME');
  assert.equal(frameUrl.origin + frameUrl.pathname, 'https://www.facebook.com/plugins/post.php');
  assert.equal(frameUrl.searchParams.get('href'), 'https://www.facebook.com/shop/posts/123456789/');
  assert.equal(frame.title, 'Facebook 官方原帖'); assert.equal(frame.loading, 'lazy');
  cleanup(); assert.equal(s.container.children.length, 0);
  await assert.rejects(s.api.mount(s.container, { url: 'https://evil.test/post/12345' }), /无效/);
  await assert.rejects(s.api.mount(s.container, { ...entries[1], platform: 'instagram' }), /无效/);
  let threadsProcessed = 0, instagramProcessed = 0;
  s.context.instgrm = { Embeds: { process() { threadsProcessed += 1; } } };
  const host = s.doc.createElement('div'); s.doc.body.append(host);
  const first = s.api.mount(s.container, entries[0]), second = s.api.mount(host, entries[0]);
  assert.equal(s.doc.head.children.length, 1);
  assert.equal(s.doc.head.children[0].src, 'https://www.threads.com/embed.js');
  assert.equal(s.container.children[0].getAttribute('data-text-post-permalink'), 'https://www.threads.com/@traveler/post/Ab_cd12/');
  host.remove(); s.doc.head.children[0].onload();
  await Promise.all([first, second]); assert.equal(threadsProcessed, 1);
  const third = s.api.mount(s.container, entries[2]);
  assert.equal(s.doc.head.children.length, 2);
  assert.equal(s.doc.head.children[1].src, 'https://www.instagram.com/embed.js');
  s.context.instgrm.Embeds.process = () => { instagramProcessed += 1; };
  s.doc.head.children[1].onload(); await third;
  assert.equal(instagramProcessed, 1);
  await s.api.mount(s.container, entries[0]);
  assert.equal(threadsProcessed, 2); assert.equal(instagramProcessed, 1);
  assert.equal(s.doc.head.children.length, 2);
  assert.equal(s.timers.size, 0);
});

test('failed SDK loads keep the original link and safe text, and retry loads a new fixed SDK', async () => {
  const s = setup();
  s.api.renderPlace(s.container, { placeId: 'tainan-1', posts: [{ ...entries[0], label: '<img src=x onerror=alert(1)>' }] });
  assert.equal(s.byClass('social-post-label')[0].textContent, '<img src=x onerror=alert(1)>');
  const button = s.byClass('social-load')[0], loading = button.onclick();
  assert.equal(s.doc.head.children.length, 1);
  s.doc.head.children[0].onerror(); await loading;
  assert.equal(button.textContent, '重试显示'); assert.equal(button.disabled, false);
  assert.equal(s.byClass('social-original')[0].href, 'https://www.threads.com/@traveler/post/Ab_cd12/');
  assert.equal(s.doc.head.children.length, 0);
  const retry = button.onclick();
  s.context.threads = { Embeds: { process() {} } };
  s.doc.head.children[0].onload(); await retry;
  assert.equal(button.hidden, true);
  assert.match(s.byClass('social-embed-status')[0].textContent, /打开原帖/);
});
