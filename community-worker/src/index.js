/* Public community API. Secrets and device tokens must never be logged. */
const DEFAULT_ORIGIN = 'https://linus-he.github.io';
const TABLES = ['authors', 'reviews', 'guides', 'reports', 'rate_limits'];
const encoder = new TextEncoder();
const REVIEW_COLUMNS = 'r.id,r.place_id AS placeId,r.author_id AS authorId,a.nickname,r.stars,r.text,r.created_at AS createdAt,r.updated_at AS updatedAt';
const GUIDE_COLUMNS = 'g.id,g.place_id AS placeId,g.author_id AS authorId,a.nickname,g.city,g.title,g.body,g.created_at AS createdAt,g.updated_at AS updatedAt';
class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const bad = (message = '提交内容不完整或格式不正确。') => { throw new ApiError(400, 'invalid_request', message); };
const missing = () => { throw new ApiError(404, 'not_found', '未找到内容，或你没有修改权限。'); };
const uuid = () => crypto.randomUUID();
async function sha256(value) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))), byte => byte.toString(16).padStart(2, '0')).join('');
}
function secret() { return Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); }
function originAllowed(origin, env) {
  if (!origin) return false;
  return origin === DEFAULT_ORIGIN || origin === env.ALLOWED_ORIGIN;
}
function reply(request, env, value, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin',
    ...extraHeaders,
  });
  const origin = request.headers.get('Origin');
  if (originAllowed(origin, env)) headers.set('Access-Control-Allow-Origin', origin);
  return new Response(status === 204 ? null : JSON.stringify(value), {status, headers});
}
function text(value, min, max, field) {
  if (typeof value !== 'string') bad(`请填写${field}。`);
  const result = value.normalize('NFC').trim();
  if (Array.from(result).length < min || Array.from(result).length > max || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(result)) bad(`${field}需为 ${min}–${max} 个字符。`);
  return result;
}
function singleLine(value, min, max, field) {
  const result = text(value, min, max, field);
  if (/[\r\n\t\u202A-\u202E\u2066-\u2069]/u.test(result)) bad(`${field}不能包含换行或文字方向控制符。`);
  return result;
}
function keys(body, allowed) {
  if (Object.keys(body).some(key => !allowed.includes(key))) bad('请求包含不支持的字段。');
}
async function readJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) throw new ApiError(415, 'json_required', '请使用 JSON 格式提交。');
  const contentLength = Number(request.headers.get('Content-Length'));
  if (Number.isFinite(contentLength) && contentLength > 32768) throw new ApiError(413, 'too_large', '内容超过大小限制。');
  // Bound reads even when Content-Length is absent or forged.
  const reader = request.body?.getReader();
  if (!reader) bad();
  const chunks = []; let size = 0;
  for (;;) {
    const {value, done} = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 32768) { await reader.cancel(); throw new ApiError(413, 'too_large', '内容超过大小限制。'); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes)); } catch { bad('无法读取提交内容。'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) bad();
  return body;
}
function place(value) {
  if (typeof value !== 'string' || !Object.hasOwn(PLACE_CITIES, value)) bad('请选择已收录的地点。');
  return value;
}
function stars(value) { if (!Number.isInteger(value) || value < 1 || value > 5) bad('评分应为 1–5 星。'); return value; }
function guideData(body, existing = {}) {
  const value = {...existing, ...body};
  if (value.placeId !== undefined && value.placeId !== null && typeof value.placeId !== 'string') bad('请选择已收录的地点。');
  const placeId = value.placeId ? place(value.placeId) : null;
  const city = singleLine(value.city === undefined && placeId ? PLACE_CITIES[placeId] : value.city, 2, 30, '城市');
  if (placeId && city !== PLACE_CITIES[placeId]) bad('城市与所选地点不一致。');
  return {placeId, city, title: singleLine(value.title, 4, 100, '标题'), body: text(value.body, 40, 10000, '旅行笔记')};
}
async function auth(request, db) {
  const match = /^Bearer ([0-9a-f]{64})$/i.exec(request.headers.get('Authorization') || '');
  if (!match) throw new ApiError(401, 'sign_in_required', '请先设置投稿昵称。');
  const author = await db.prepare('SELECT id,nickname,created_at AS createdAt FROM authors WHERE token_hash=?1').bind(await sha256(match[1])).first();
  if (!author) throw new ApiError(401, 'session_expired', '投稿身份已失效，请重新设置昵称。');
  return author;
}
async function limit(db, key, maximum, now) {
  const day = now.slice(0, 10);
  const value = await db.prepare('INSERT INTO rate_limits(key,day,count) VALUES(?1,?2,1) ON CONFLICT(key,day) DO UPDATE SET count=count+1 WHERE count<?3 RETURNING count').bind(key, day, maximum).first();
  if (!value) throw new ApiError(429, 'rate_limited', '今天的投稿次数已达上限，请明天再试。');
}
async function ipKey(request, env, now) {
  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    const host = new URL(request.url).hostname;
    if (!['127.0.0.1', 'localhost'].includes(host)) throw new ApiError(503, 'edge_unavailable', '暂时无法核实请求来源，请稍后再试。');
  }
  return sha256(`${env.RATE_LIMIT_SALT || 'island-community-v1'}\n${now.slice(0, 10)}\n${ip || 'local-preview'}`);
}
async function consumeWrite(request, env, author, now, reporting = false) {
  const hash = await ipKey(request, env, now);
  await limit(env.DB, `write-ip:${hash}`, 30, now);
  await limit(env.DB, `write-author:${author.id}`, 20, now);
  if (reporting) {
    await limit(env.DB, `report-ip:${hash}`, 10, now);
    await limit(env.DB, `report-author:${author.id}`, 10, now);
  }
}
async function findReview(db, id, authorId) {
  return db.prepare(`SELECT ${REVIEW_COLUMNS},r.deleted_at AS deletedAt,r.hidden_at AS hiddenAt FROM reviews r JOIN authors a ON a.id=r.author_id WHERE r.id=?1 AND r.author_id=?2`).bind(id, authorId).first();
}
async function findGuide(db, id, authorId) {
  return db.prepare(`SELECT ${GUIDE_COLUMNS},g.deleted_at AS deletedAt,g.hidden_at AS hiddenAt FROM guides g JOIN authors a ON a.id=g.author_id WHERE g.id=?1 AND g.author_id=?2`).bind(id, authorId).first();
}
async function execute(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, '') || '/';
  const method = request.method.toUpperCase();
  const origin = request.headers.get('Origin');
  if (origin && !originAllowed(origin, env)) throw new ApiError(403, 'origin_denied', '此网站未获准使用投稿服务。');
  if (method === 'OPTIONS') {
    if (!originAllowed(origin, env)) throw new ApiError(403, 'origin_denied', '此网站未获准使用投稿服务。');
    return reply(request, env, null, 204, {
      'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
      'Access-Control-Max-Age': '600',
    });
  }
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(method)) throw new ApiError(405, 'method_not_allowed', '不支持此操作。');
  if (method !== 'GET' && !originAllowed(origin, env)) throw new ApiError(403, 'origin_required', '请从网站内提交内容。');
  if (method === 'DELETE' && request.body) { const body = await readJson(request); keys(body, []); }
  if (!env.DB || typeof env.DB.prepare !== 'function') throw new ApiError(503, 'storage_unavailable', '社区数据库尚未连接，请稍后再试。');
  const db = env.DB;
  const now = new Date().toISOString();

  if (method === 'GET' && path === '/health') {
    const {results} = await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('authors','reviews','guides','reports','rate_limits')").all();
    if (!results || TABLES.some(name => !results.some(row => row.name === name))) throw new ApiError(503, 'storage_not_ready', '社区数据库尚未完成初始化。');
    return reply(request, env, {ok: true, storage: 'ready'});
  }
  if (method === 'POST' && path === '/v1/session') {
    const body = await readJson(request); keys(body, ['nickname']);
    const nickname = singleLine(body.nickname, 2, 24, '昵称');
    await limit(db, `session-ip:${await ipKey(request, env, now)}`, 10, now);
    const token = secret(), id = uuid();
    await db.prepare('INSERT INTO authors(id,token_hash,nickname,created_at) VALUES(?1,?2,?3,?4)').bind(id, await sha256(token), nickname, now).run();
    // Rate data is operational and retained for at most a few days, never raw IPs.
    const cutoff = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);
    await db.prepare('DELETE FROM rate_limits WHERE day<?1').bind(cutoff).run();
    return reply(request, env, {token, author: {id, nickname, createdAt: now}}, 201);
  }
  if (method === 'GET' && path === '/v1/ratings') {
    const {results} = await db.prepare('SELECT place_id AS placeId,AVG(stars) AS average,COUNT(*) AS count FROM reviews WHERE deleted_at IS NULL AND hidden_at IS NULL GROUP BY place_id').all();
    const ratings = Object.fromEntries(results.map(row => [row.placeId, {average: Math.round(row.average * 10) / 10, count: row.count}]));
    return reply(request, env, {ratings});
  }
  const communityMatch = /^\/v1\/places\/([^/]+)\/community$/.exec(path);
  if (method === 'GET' && communityMatch) {
    let placeId; try { placeId = decodeURIComponent(communityMatch[1]); } catch { bad(); }
    place(placeId);
    const stats = await db.prepare('SELECT AVG(stars) AS average,COUNT(*) AS count FROM reviews WHERE place_id=?1 AND deleted_at IS NULL AND hidden_at IS NULL').bind(placeId).first();
    const reviews = await db.prepare(`SELECT ${REVIEW_COLUMNS} FROM reviews r JOIN authors a ON a.id=r.author_id WHERE r.place_id=?1 AND r.deleted_at IS NULL AND r.hidden_at IS NULL ORDER BY r.created_at DESC,r.id DESC LIMIT 20`).bind(placeId).all();
    const guides = await db.prepare(`SELECT ${GUIDE_COLUMNS} FROM guides g JOIN authors a ON a.id=g.author_id WHERE g.place_id=?1 AND g.deleted_at IS NULL AND g.hidden_at IS NULL ORDER BY g.created_at DESC,g.id DESC LIMIT 20`).bind(placeId).all();
    return reply(request, env, {rating: {average: stats.average === null ? null : Math.round(stats.average * 10) / 10, count: stats.count}, reviews: reviews.results, guides: guides.results});
  }
  if (method === 'GET' && path === '/v1/guides') {
    const city = url.searchParams.get('city');
    const query = city ? db.prepare(`SELECT ${GUIDE_COLUMNS} FROM guides g JOIN authors a ON a.id=g.author_id WHERE g.city=?1 AND g.deleted_at IS NULL AND g.hidden_at IS NULL ORDER BY g.created_at DESC,g.id DESC LIMIT 30`).bind(text(city, 2, 30, '城市')) : db.prepare(`SELECT ${GUIDE_COLUMNS} FROM guides g JOIN authors a ON a.id=g.author_id WHERE g.deleted_at IS NULL AND g.hidden_at IS NULL ORDER BY g.created_at DESC,g.id DESC LIMIT 30`);
    const {results} = await query.all();
    return reply(request, env, {guides: results});
  }

  // All remaining supported routes operate on an authenticated guest identity.
  const known = ['/v1/me','/v1/me/content','/v1/reviews','/v1/guides','/v1/reports'].includes(path) || /^\/v1\/(reviews|guides)\/[^/]+(?:\/restore)?$/.test(path);
  if (!known) missing();
  const author = await auth(request, db);
  if (method === 'GET' && path === '/v1/me') return reply(request, env, {author});
  if (method === 'GET' && path === '/v1/me/content') {
    const reviews = await db.prepare(`SELECT ${REVIEW_COLUMNS},r.deleted_at AS deletedAt,r.hidden_at AS hiddenAt FROM reviews r JOIN authors a ON a.id=r.author_id WHERE r.author_id=?1 ORDER BY r.created_at DESC LIMIT 100`).bind(author.id).all();
    const guides = await db.prepare(`SELECT ${GUIDE_COLUMNS},g.deleted_at AS deletedAt,g.hidden_at AS hiddenAt FROM guides g JOIN authors a ON a.id=g.author_id WHERE g.author_id=?1 ORDER BY g.created_at DESC LIMIT 100`).bind(author.id).all();
    return reply(request, env, {reviews: reviews.results, guides: guides.results});
  }
  if (method === 'POST' && path === '/v1/reviews') {
    const body = await readJson(request); keys(body, ['placeId', 'stars', 'text']);
    const placeId = place(body.placeId), score = stars(body.stars), content = text(body.text, 10, 2000, '评价');
    await consumeWrite(request, env, author, now);
    const id = uuid();
    const row = await db.prepare('INSERT INTO reviews(id,place_id,author_id,stars,text,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?6) ON CONFLICT(author_id,place_id) DO UPDATE SET stars=excluded.stars,text=excluded.text,updated_at=excluded.updated_at,deleted_at=NULL RETURNING id').bind(id, placeId, author.id, score, content, now).first();
    return reply(request, env, {review: await findReview(db, row.id, author.id)}, 201);
  }
  if (method === 'POST' && path === '/v1/guides') {
    const body = await readJson(request); keys(body, ['placeId', 'city', 'title', 'body']);
    const value = guideData(body);
    await consumeWrite(request, env, author, now);
    const id = uuid();
    await db.prepare('INSERT INTO guides(id,place_id,author_id,city,title,body,created_at,updated_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?7)').bind(id, value.placeId, author.id, value.city, value.title, value.body, now).run();
    return reply(request, env, {guide: await findGuide(db, id, author.id)}, 201);
  }
  const mutation = /^\/v1\/(reviews|guides)\/([a-zA-Z0-9-]{1,80})(\/restore)?$/.exec(path);
  if (mutation) {
    const [, kind, id, restore] = mutation;
    const existing = kind === 'reviews' ? await findReview(db, id, author.id) : await findGuide(db, id, author.id);
    if (!existing) missing();
    if (restore && method !== 'POST' || !restore && !['PATCH', 'DELETE'].includes(method)) throw new ApiError(405, 'method_not_allowed', '不支持此操作。');
    if (restore || method === 'DELETE') {
      if (restore) { const body = await readJson(request); keys(body, []); }
      await consumeWrite(request, env, author, now);
      // kind is derived from a two-value regex, never supplied to SQL unchecked.
      await db.prepare(`UPDATE ${kind} SET deleted_at=?1,updated_at=?2 WHERE id=?3 AND author_id=?4`).bind(restore ? null : now, now, id, author.id).run();
    } else {
      if (existing.deletedAt) throw new ApiError(409, 'content_deleted', '请先恢复这条内容，再进行编辑。');
      const body = await readJson(request);
      if (!Object.keys(body).length) bad();
      if (kind === 'reviews') {
        keys(body, ['stars', 'text']);
        const score = stars(Object.hasOwn(body, 'stars') ? body.stars : existing.stars), content = text(Object.hasOwn(body, 'text') ? body.text : existing.text, 10, 2000, '评价');
        await consumeWrite(request, env, author, now);
        await db.prepare('UPDATE reviews SET stars=?1,text=?2,updated_at=?3 WHERE id=?4 AND author_id=?5').bind(score, content, now, id, author.id).run();
      } else {
        keys(body, ['placeId', 'city', 'title', 'body']);
        const value = guideData(body, existing);
        await consumeWrite(request, env, author, now);
        await db.prepare('UPDATE guides SET place_id=?1,city=?2,title=?3,body=?4,updated_at=?5 WHERE id=?6 AND author_id=?7').bind(value.placeId, value.city, value.title, value.body, now, id, author.id).run();
      }
    }
    const row = kind === 'reviews' ? await findReview(db, id, author.id) : await findGuide(db, id, author.id);
    return reply(request, env, {[kind === 'reviews' ? 'review' : 'guide']: row});
  }
  if (method === 'POST' && path === '/v1/reports') {
    const body = await readJson(request); keys(body, ['type', 'id', 'reason']);
    if (!['review', 'guide'].includes(body.type) || typeof body.id !== 'string' || !/^[a-zA-Z0-9-]{1,80}$/.test(body.id)) bad();
    const reason = text(body.reason, 5, 500, '举报原因');
    const table = body.type === 'review' ? 'reviews' : 'guides';
    const target = await db.prepare(`SELECT id FROM ${table} WHERE id=?1 AND deleted_at IS NULL AND hidden_at IS NULL`).bind(body.id).first();
    if (!target) missing();
    await consumeWrite(request, env, author, now, true);
    await db.prepare('INSERT INTO reports(id,author_id,target_type,target_id,reason,created_at) VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(author_id,target_type,target_id) DO NOTHING').bind(uuid(), author.id, body.type, body.id, reason, now).run();
    return reply(request, env, {ok: true, message: '举报已记录，运营者会核实处理。'}, 201);
  }
  throw new ApiError(405, 'method_not_allowed', '不支持此操作。');
}

export default {
  async fetch(request, env = {}) {
    try { return await execute(request, env); }
    catch (error) {
      const known = error instanceof ApiError;
      const status = known ? error.status : 503;
      return reply(request, env, {error: {code: known ? error.code : 'service_unavailable', message: known ? error.message : '社区服务暂时不可用，请稍后再试。'}}, status, status === 429 ? {'Retry-After': String(Math.ceil((Date.parse(new Date().toISOString().slice(0, 10)) + 86400000 - Date.now()) / 1000))} : {});
    }
  },
};
const PLACE_CITIES = {"Attraction_379000000A_000003":"台北","Attraction_379000000A_000022":"台北","Attraction_379000000A_000024":"台北","Attraction_379000000A_000067":"台北","Attraction_379000000A_000002":"台北","Attraction_379000000A_000052":"台北","Attraction_379000000A_000006":"台北","Attraction_379000000A_000001":"台北","Attraction_379000000A_000080":"台北","Attraction_379000000A_000004":"台北","Attraction_379000000A_000056":"台北","Attraction_379000000A_000068":"台北","Attraction_379000000A_000025":"台北","Attraction_379000000A_000023":"台北","Attraction_379000000A_000045":"台北","Attraction_379000000A_000180":"台北","Attraction_379000000A_000005":"台北","Attraction_379000000A_000179":"台北","Attraction_379000000A_000008":"台北","Attraction_379000000A_000032":"台北","Attraction_379000000A_000082":"台北","Attraction_379000000A_000064":"台北","Attraction_379000000A_000071":"台北","Attraction_379000000A_000070":"台北","Attraction_379000000A_000030":"台北","Attraction_379000000A_000028":"台北","Attraction_379000000A_000184":"台北","Attraction_379000000A_000181":"台北","Attraction_379000000A_000010":"台北","Attraction_379000000A_000182":"台北","Attraction_379000000A_000009":"台北","Attraction_379000000A_000069":"台北","Attraction_379000000A_000190":"台北","Attraction_379000000A_000077":"台北","Attraction_379000000A_000214":"台北","Attraction_379000000A_000073":"台北","Attraction_379000000A_000036":"台北","Attraction_379000000A_000031":"台北","Attraction_379000000A_000185":"台北","Attraction_379000000A_000198":"台北","Attraction_379000000A_000011":"台北","Attraction_379000000A_000183":"台北","Attraction_379000000A_000017":"台北","Attraction_379000000A_000081":"台北","Attraction_379000000A_000222":"台北","Attraction_379000000A_000079":"台北","Attraction_379000000A_000237":"台北","Attraction_379000000A_000074":"台北","Attraction_379000000A_000051":"台北","Attraction_379000000A_000038":"台北","Attraction_379000000A_000217":"台北","Attraction_379000000A_000199":"台北","Attraction_379000000A_000013":"台北","Attraction_379000000A_000294":"台北","Attraction_379000000A_000018":"台北","Attraction_379000000A_000086":"台北","Attraction_379000000A_000232":"台北","Attraction_379000000A_000186":"台北","Attraction_379000000A_000243":"台北","Attraction_379000000A_000084":"台北","Attraction_379000000A_000057":"台北","Attraction_379000000A_000088":"台北","Attraction_379000000A_000272":"台北","Attraction_379000000A_000200":"台北","Attraction_379000000A_000014":"台北","Attraction_379000000A_000383":"台北","Attraction_379000000A_000019":"台北","Attraction_379000000A_000099":"台北","Attraction_379000000A_000241":"台北","Attraction_379000000A_000221":"台北","Attraction_379000000A_000248":"台北","Attraction_379000000A_000087":"台北","Attraction_379000000A_000065":"台北","Attraction_379000000A_000089":"台北","Attraction_379000000A_000379":"台北","Attraction_379000000A_000201":"台北","Attraction_379000000A_000015":"台北","Attraction_379000000A_000402":"台北","Attraction_379000000A_000021":"台北","Attraction_379000000A_000105":"台北","Attraction_395000000A_000470":"台南","Attraction_395000000A_000525":"台南","Attraction_395000000A_000667":"台南","Attraction_395000000A_000571":"台南","Attraction_395000000A_000483":"台南","Attraction_395000000A_000532":"台南","Attraction_395000000A_000684":"台南","Attraction_395000000A_000466":"台南","Attraction_395000000A_000551":"台南","Attraction_395000000A_000658":"台南","Attraction_395000000A_000554":"台南","Attraction_395000000A_000542":"台南","Attraction_395000000A_000475":"台南","Attraction_395000000A_000797":"台南","Attraction_395000000A_001339":"台南","Attraction_395000000A_000671":"台南","Attraction_395000000A_000529":"台南","Attraction_395000000A_000469":"台南","Attraction_395000000A_004252":"台南","Attraction_395000000A_000566":"台南","Attraction_395000000A_000501":"台南","Attraction_395000000A_000559":"台南","Attraction_395000000A_000553":"台南","Attraction_395000000A_000495":"台南","Attraction_395000000A_000670":"台南","Attraction_395000000A_000516":"台南","Attraction_395000000A_000519":"台南","Attraction_395000000A_000550":"台南","Attraction_395000000A_000575":"台南","Attraction_395000000A_000558":"台南","Attraction_395000000A_000545":"台南","Attraction_395000000A_000508":"台南","Attraction_395000000A_000485":"台南","Attraction_395000000A_000580":"台南","Attraction_395000000A_000490":"台南","Attraction_395000000A_000477":"台南","Attraction_395000000A_000582":"台南","Attraction_395000000A_000471":"台南","Attraction_395000000A_000526":"台南","Attraction_395000000A_000668":"台南","Attraction_395000000A_000572":"台南","Attraction_395000000A_000484":"台南","Attraction_395000000A_000533":"台南","Attraction_395000000A_000685":"台南","Attraction_395000000A_000467":"台南","Attraction_395000000A_000599":"台南","Attraction_395000000A_000660":"台南","Attraction_395000000A_000556":"台南","Attraction_395000000A_000543":"台南","Attraction_395000000A_000476":"台南","Attraction_395000000A_000809":"台南","Attraction_395000000A_004334":"台南","Attraction_395000000A_000673":"台南","Attraction_395000000A_000537":"台南","Attraction_395000000A_000601":"台南","Attraction_395000000A_004258":"台南","Attraction_395000000A_000568":"台南","Attraction_395000000A_000502":"台南","Attraction_395000000A_000560":"台南","Attraction_395000000A_000913":"台南","Restaurant_395000000A_001095":"台南","Restaurant_395000000A_001662":"台南","Restaurant_395000000A_001056":"台南","Restaurant_395000000A_001783":"台南","Restaurant_395000000A_001605":"台南","Restaurant_395000000A_001656":"台南","Restaurant_395000000A_001060":"台南","Restaurant_395000000A_001623":"台南","Restaurant_395000000A_001776":"台南","Restaurant_395000000A_001059":"台南","Restaurant_395000000A_001065":"台南","Restaurant_395000000A_001765":"台南","Restaurant_395000000A_001619":"台南","Restaurant_395000000A_001063":"台南","Restaurant_395000000A_001682":"台南","Restaurant_395000000A_001055":"台南","Restaurant_395000000A_001593":"台南","Restaurant_395000000A_001616":"台南","Restaurant_395000000A_001678":"台南","Restaurant_395000000A_001764":"台南","Restaurant_395000000A_001052":"台南","Restaurant_395000000A_001069":"台南","Restaurant_395000000A_001679":"台南","Restaurant_395000000A_001053":"台南","Restaurant_395000000A_001138":"台南","Restaurant_395000000A_001054":"台南","Restaurant_395000000A_001665":"台南","Restaurant_395000000A_001578":"台南","Restaurant_395000000A_001564":"台南","Restaurant_395000000A_001557":"台南","Restaurant_395000000A_001098":"台南","Restaurant_395000000A_001102":"台南","Restaurant_395000000A_001609":"台南","Restaurant_395000000A_001586":"台南","Restaurant_395000000A_001068":"台南","Restaurant_395000000A_001597":"台南","Restaurant_395000000A_001768":"台南","Restaurant_395000000A_001614":"台南","Restaurant_395000000A_001663":"台南","Restaurant_395000000A_001057":"台南","Restaurant_395000000A_001804":"台南","Restaurant_395000000A_001606":"台南","Restaurant_395000000A_001657":"台南","Restaurant_395000000A_001114":"台南","Restaurant_395000000A_001624":"台南","Restaurant_395000000A_001810":"台南","Restaurant_395000000A_001140":"台南","Restaurant_395000000A_001676":"台南","Restaurant_395000000A_002047":"台南","Restaurant_395000000A_001620":"台南","Restaurant_395000000A_001155":"台南","Restaurant_395000000A_001683":"台南","Restaurant_395000000A_001083":"台南","Restaurant_395000000A_001594":"台南","Restaurant_395000000A_001618":"台南","Restaurant_395000000A_002037":"台南","Restaurant_395000000A_001846":"台南","Restaurant_395000000A_001103":"台南","Restaurant_395000000A_001570":"台南","Restaurant_395000000A_001680":"台南"};
