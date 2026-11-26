import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/index.js';

const ORIGIN = 'https://linus-he.github.io';
const PLACES = JSON.parse(readFileSync(new URL('../../places.json', import.meta.url)));
const PLACE = PLACES[0].id;
const TAINAN = PLACES.find(row => row.city === '台南').id;
const LONG = '沿着这条路线慢慢走，分享亲身体验与交通安排，实际花费以出发当天为准。'.repeat(3);

function storage({schema = true} = {}) {
  const sqlite = new DatabaseSync(':memory:');
  if (schema) sqlite.exec(readFileSync(new URL('../migrations/0001_init.sql', import.meta.url), 'utf8'));
  return {
    sqlite,
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      let params = [];
      return {
        bind(...values) { params = values; return this; },
        async first() { return statement.get(...params) || null; },
        async all() { return {success: true, results: statement.all(...params)}; },
        async run() { const result = statement.run(...params); return {success: true, meta: {changes: Number(result.changes)}}; },
      };
    },
  };
}
function client(db = storage(), overrides = {}) {
  const env = {DB: db, RATE_LIMIT_SALT: 'private-test-salt', ...overrides};
  async function request(path, {method = 'GET', body, token, origin = ORIGIN, ip = '192.0.2.4', headers = {}, rawBody} = {}) {
    const allHeaders = {'CF-Connecting-IP': ip, ...headers};
    if (origin) allHeaders.Origin = origin;
    if (token) allHeaders.Authorization = `Bearer ${token}`;
    if (body !== undefined || rawBody !== undefined) allHeaders['Content-Type'] ??= 'application/json';
    const response = await worker.fetch(new Request(`https://community.example${path}`, {method, headers: allHeaders, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body))}), env);
    return {response, status: response.status, data: response.status === 204 ? null : await response.json()};
  }
  async function session(nickname = '旅行朋友', ip = '192.0.2.4') {
    const value = await request('/v1/session', {method: 'POST', body: {nickname}, ip});
    assert.equal(value.status, 201, JSON.stringify(value.data));
    return value.data;
  }
  return {db, env, request, session};
}

test('health verifies actual schema and missing storage never reports success', async () => {
  const c = client();
  assert.deepEqual((await c.request('/health')).data, {ok: true, storage: 'ready'});
  assert.equal((await client(storage({schema: false})).request('/health')).status, 503);
  assert.equal((await client(undefined, {DB: undefined}).request('/health')).status, 503);
  c.db.sqlite.exec('DROP TABLE reports');
  assert.equal((await c.request('/health')).status, 503);
});

test('CORS only allows configured sites and cross-site or originless writes fail', async () => {
  const c = client();
  const preflight = await c.request('/v1/session', {method: 'OPTIONS'});
  assert.equal(preflight.status, 204);
  assert.equal(preflight.response.headers.get('Access-Control-Allow-Origin'), ORIGIN);
  assert.ok(preflight.response.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
  const evil = await c.request('/v1/session', {method: 'POST', origin: 'https://linus-he.github.io.attacker.test', body: {nickname: '旅行朋友'}});
  assert.equal(evil.status, 403);
  assert.equal(evil.response.headers.get('Access-Control-Allow-Origin'), null);
  assert.equal((await c.request('/v1/session', {method: 'POST', origin: null, body: {nickname: '旅行朋友'}})).status, 403);
  assert.equal((await c.request('/health', {method: 'PUT'})).status, 405);
  assert.equal((await c.request('/unknown')).status, 404);
  const local = client(undefined, {ALLOWED_ORIGIN: 'http://127.0.0.1:8000'});
  assert.equal((await local.request('/health', {origin: 'http://127.0.0.1:8000'})).status, 200);
  assert.equal((await c.request('/health', {origin: null})).status, 200);
});

test('session capability is random, hashed at rest, and cannot be guessed from public author ID', async () => {
  const c = client(), one = await c.session(), two = await c.session('另一位朋友');
  assert.match(one.token, /^[0-9a-f]{64}$/);
  assert.notEqual(one.token, two.token);
  const author = c.db.sqlite.prepare('SELECT * FROM authors WHERE id=?').get(one.author.id);
  assert.notEqual(author.token_hash, one.token);
  assert.equal(JSON.stringify(author).includes(one.token), false);
  assert.equal((await c.request('/v1/me', {token: one.token})).data.author.id, one.author.id);
  assert.equal((await c.request('/v1/me', {token: '0'.repeat(64)})).status, 401);
  assert.equal((await c.request('/v1/me', {token: one.author.id})).status, 401);
  assert.equal((await c.request('/v1/me')).status, 401);
  assert.equal(c.db.sqlite.prepare('SELECT count(*) AS n FROM authors').get().n, 2);
});

test('review publication, one-per-author upsert, ownership, aggregates, removal and restore work across clients', async () => {
  const c = client(), owner = await c.session(), other = await c.session('其他旅友');
  const create = await c.request('/v1/reviews', {method: 'POST', token: owner.token, body: {placeId: PLACE, stars: 5, text: '这是我亲身到访之后留下的完整真实评价。'}});
  assert.equal(create.status, 201);
  const id = create.data.review.id;
  const publicClient = client(c.db);
  const view = await publicClient.request(`/v1/places/${PLACE}/community`, {origin: null});
  assert.equal(view.data.reviews[0].authorId, owner.author.id);
  assert.equal(JSON.stringify(view.data).includes('token'), false);
  assert.deepEqual(view.data.rating, {average: 5, count: 1});
  const update = await c.request('/v1/reviews', {method: 'POST', token: owner.token, body: {placeId: PLACE, stars: 3, text: '补充这次回访的真实体验，交通信息需要提前确认。'}});
  assert.equal(update.data.review.id, id);
  assert.equal((await c.request('/v1/ratings')).data.ratings[PLACE].count, 1);
  assert.equal((await c.request(`/v1/reviews/${id}`, {method: 'PATCH', token: other.token, body: {stars: 1}})).status, 404);
  assert.equal((await c.request(`/v1/reviews/${id}`, {method: 'DELETE', token: other.token})).status, 404);
  await c.request(`/v1/reviews/${id}`, {method: 'PATCH', token: owner.token, body: {stars: 4}});
  assert.equal((await c.request('/v1/ratings')).data.ratings[PLACE].average, 4);
  await c.request(`/v1/reviews/${id}`, {method: 'DELETE', token: owner.token});
  assert.deepEqual((await c.request(`/v1/places/${PLACE}/community`)).data.rating, {average: null, count: 0});
  assert.deepEqual((await c.request('/v1/ratings')).data.ratings, {});
  const mine = (await c.request('/v1/me/content', {token: owner.token})).data.reviews[0];
  assert.ok(mine.deletedAt);
  assert.equal((await c.request(`/v1/reviews/${id}`, {method: 'PATCH', token: owner.token, body: {stars: 2}})).status, 409);
  await c.request(`/v1/reviews/${id}/restore`, {method: 'POST', token: owner.token, body: {}});
  assert.deepEqual((await c.request('/v1/ratings')).data.ratings[PLACE], {average: 4, count: 1});
  c.db.sqlite.prepare('UPDATE reviews SET hidden_at=? WHERE id=?').run(new Date().toISOString(), id);
  assert.deepEqual((await c.request('/v1/ratings')).data.ratings, {});
  await c.request('/v1/reviews', {method: 'POST', token: owner.token, body: {placeId: PLACE, stars: 5, text: '被隐藏的评价修改内容后，仍然需要运营者核实再展示。'}});
  assert.deepEqual((await c.request('/v1/ratings')).data.ratings, {});
});

test('invalid IDs, injected fields, bad payload types, invalid UTF-8 and large bodies are rejected without storing reviews', async () => {
  const c = client(), owner = await c.session();
  const valid = {placeId: PLACE, stars: 5, text: '这是包含足够字数的一条正常旅行评价。'};
  for (const body of [{...valid, placeId: "' OR 1=1--"}, {...valid, stars: 6}, {...valid, stars: '5'}, {...valid, text: '太短'}, {...valid, text: '非法\u0000控制字符需要拒绝'}, {...valid, hidden_at: null}, {...valid, authorId: 'other'}]) {
    assert.equal((await c.request('/v1/reviews', {method: 'POST', token: owner.token, body})).status, 400);
  }
  assert.equal((await c.request('/v1/reviews', {method: 'POST', token: owner.token, rawBody: '[]'})).status, 400);
  assert.equal((await c.request('/v1/reviews', {method: 'POST', token: owner.token, rawBody: '{broken'})).status, 400);
  assert.equal((await c.request('/v1/reviews', {method: 'POST', token: owner.token, rawBody: new Uint8Array([255])})).status, 400);
  assert.equal((await c.request('/v1/reviews', {method: 'POST', token: owner.token, rawBody: 'a'.repeat(32769)})).status, 413);
  assert.equal((await c.request('/v1/reviews', {method: 'POST', token: owner.token, body: valid, headers: {'Content-Type': 'text/plain'}})).status, 415);
  assert.equal(c.db.sqlite.prepare('SELECT count(*) AS n FROM reviews').get().n, 0);
  assert.equal((await c.request('/v1/places/%E0%A4%A/community')).status, 400);
});

test('guides are public across sessions, scoped by place/city and can only be edited or recovered by their author', async () => {
  const c = client(), owner = await c.session(), other = await c.session('台南旅友');
  const create = await c.request('/v1/guides', {method: 'POST', token: owner.token, body: {placeId: TAINAN, city: '台南', title: '台南散步与美食路线', body: LONG}});
  assert.equal(create.status, 201);
  const id = create.data.guide.id;
  assert.equal((await client(c.db).request(`/v1/places/${TAINAN}/community`, {origin: null})).data.guides[0].id, id);
  assert.equal((await c.request('/v1/guides?city=台北')).data.guides.length, 0);
  assert.equal((await c.request('/v1/guides?city=台南')).data.guides.length, 1);
  assert.equal((await c.request('/v1/guides', {method: 'POST', token: owner.token, body: {placeId: TAINAN, city: '台北', title: '错误城市的笔记', body: LONG}})).status, 400);
  assert.equal((await c.request(`/v1/guides/${id}`, {method: 'PATCH', token: other.token, body: {title: '试图修改他人笔记'}})).status, 404);
  const patch = await c.request(`/v1/guides/${id}`, {method: 'PATCH', token: owner.token, body: {title: '补充后的台南路线'}});
  assert.equal(patch.data.guide.title, '补充后的台南路线');
  await c.request(`/v1/guides/${id}`, {method: 'DELETE', token: owner.token});
  assert.equal((await c.request('/v1/guides')).data.guides.length, 0);
  assert.ok((await c.request('/v1/me/content', {token: owner.token})).data.guides[0].deletedAt);
  assert.equal((await c.request(`/v1/guides/${id}/restore`, {method: 'POST', token: other.token, body: {}})).status, 404);
  await c.request(`/v1/guides/${id}/restore`, {method: 'POST', token: owner.token, body: {}});
  assert.equal((await c.request('/v1/guides')).data.guides.length, 1);
  c.db.sqlite.prepare('UPDATE guides SET hidden_at=? WHERE id=?').run(new Date().toISOString(), id);
  assert.equal((await c.request('/v1/guides')).data.guides.length, 0);
  assert.equal((await c.request(`/v1/places/${TAINAN}/community`)).data.guides.length, 0);
});

test('reports are deduplicated and never auto-hide a post or expose reporter details', async () => {
  const c = client(), owner = await c.session(), reporter = await c.session('举报旅友');
  const post = await c.request('/v1/guides', {method: 'POST', token: owner.token, body: {city: '台中', title: '全岛旅行计划说明', body: LONG}});
  const body = {type: 'guide', id: post.data.guide.id, reason: '这篇内容需要运营者核实具体情况。'};
  assert.equal((await c.request('/v1/reports', {method: 'POST', token: reporter.token, body})).status, 201);
  await c.request('/v1/reports', {method: 'POST', token: reporter.token, body});
  assert.equal(c.db.sqlite.prepare('SELECT count(*) AS n FROM reports').get().n, 1);
  const publicPost = (await c.request('/v1/guides')).data.guides[0];
  assert.equal(publicPost.id, body.id);
  assert.equal(JSON.stringify(publicPost).includes('举报旅友'), false);
  assert.equal((await c.request('/v1/reports', {method: 'POST', token: reporter.token, body: {...body, id: 'missing'}})).status, 404);
});

test('new identity quota cannot be bypassed by choosing a different nickname', async () => {
  const c = client();
  for (let i = 0; i < 10; i++) await c.session(`旅行朋友${i}`);
  const blocked = await c.request('/v1/session', {method: 'POST', body: {nickname: '换名也不绕过'}});
  assert.equal(blocked.status, 429);
  assert.ok(Number(blocked.response.headers.get('Retry-After')) > 0);
  assert.equal((await c.session('另一个网络朋友', '192.0.2.8')).author.nickname, '另一个网络朋友');
  const rateRows = c.db.sqlite.prepare('SELECT key FROM rate_limits').all();
  assert.ok(rateRows.every(row => !row.key.includes('192.0.2.')));
});

test('write quotas apply both per author across IPs and per IP across authors', async () => {
  const c = client(), author = await c.session();
  const body = {placeId: PLACE, stars: 4, text: '我在真实访问后留下的餐厅或景点评价记录。'};
  for (let i = 0; i < 20; i++) assert.equal((await c.request('/v1/reviews', {method: 'POST', token: author.token, ip: `192.0.2.${i + 10}`, body})).status, 201);
  assert.equal((await c.request('/v1/reviews', {method: 'POST', token: author.token, ip: '192.0.2.250', body})).status, 429);
  const d = client();
  const users = [];
  for (let i = 0; i < 4; i++) users.push(await d.session(`旅友名字${i}`));
  for (let i = 0; i < 30; i++) assert.equal((await d.request('/v1/reviews', {method: 'POST', token: users[i % 4].token, body})).status, 201);
  assert.equal((await d.request('/v1/reviews', {method: 'POST', token: users[0].token, body})).status, 429);
});

test('internal database failures return generic errors without SQL or token leakage', async () => {
  const failure = client(undefined, {DB: {prepare() { throw new Error('private SQL token_hash secret'); }}});
  const result = await failure.request('/health');
  assert.equal(result.status, 503);
  assert.equal(JSON.stringify(result.data).includes('token_hash'), false);
  assert.equal(JSON.stringify(result.data).includes('SQL'), false);
});
