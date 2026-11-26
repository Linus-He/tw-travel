/* Public community data stays on the shared service. Private notebooks are never uploaded. */
(function (root) {
  'use strict';
  const SESSION_KEY = 'island-community-session';
  const PUBLIC_NOTE = '使用昵称公开发表；本机保留修改和删除权限，换设备仍可查看公开内容。';
  const mounts = new WeakMap();
  let clientCache, clientBase, fieldId = 0;

  function normalizeApiUrl(value) {
    try {
      const url = new URL(value);
      const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return '';
      return url.href.replace(/\/+$/, '');
    } catch { return ''; }
  }
  class CommunityError extends Error {
    constructor(status, message) { super(message); this.name = 'CommunityError'; this.status = status; }
  }
  function friendlyError(status) {
    return ({
      400: '内容格式不正确，请检查必填项、字数和星级。',
      401: '发布身份已失效，请重新填写昵称后再试。',
      403: '当前身份没有操作这条内容的权限。',
      404: '这条内容已不存在，请刷新后查看。',
      409: '内容状态已变化，请刷新后再试。',
      413: '内容过长，请缩短后再试。',
      429: '操作较频繁，请稍后再试。',
    })[status] || '公共社区暂时无法连接，请稍后重试。';
  }
  function validSession(value, baseUrl) {
    return value && value.baseUrl === baseUrl && typeof value.token === 'string' && value.token.length >= 32 && value.token.length <= 512
      && value.author && typeof value.author.id === 'string' && typeof value.author.nickname === 'string';
  }
  function browserStorage() { try { return root.localStorage; } catch { return null; } }

  function createClient({ baseUrl, fetch: fetcher = root.fetch?.bind(root), storage = browserStorage(), timeoutMs = 15000 } = {}) {
    const base = normalizeApiUrl(baseUrl);
    let session = null, sessionPromise = null, persistent = true;
    try { const value = JSON.parse(storage?.getItem(SESSION_KEY) || 'null'); if (validSession(value, base)) session = value; } catch { /* A damaged session must not block public reading. */ }
    function clearSession() {
      session = null;
      try { storage?.removeItem(SESSION_KEY); } catch { /* Local storage may be disabled. */ }
    }
    async function request(path, { method = 'GET', body, auth = false, signal } = {}) {
      if (!base || typeof fetcher !== 'function') throw new CommunityError(503, '公共社区正在连接，暂不能发表。');
      if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') || path.includes('\\')) throw new CommunityError(400, friendlyError(400));
      if (auth && !session) throw new CommunityError(401, friendlyError(401));
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) controller.abort(); else signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      const headers = { Accept: 'application/json' };
      if (body !== undefined) headers['Content-Type'] = 'application/json';
      if (auth) headers.Authorization = `Bearer ${session.token}`;
      try {
        const response = await fetcher(base + path, {
          method, mode: 'cors', credentials: 'omit', cache: 'no-store', headers,
          ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: controller.signal,
        });
        if (!response.ok) {
          if (response.status === 401 && auth) clearSession();
          throw new CommunityError(response.status, friendlyError(response.status));
        }
        if (response.status === 204) return null;
        try { return await response.json(); }
        catch { throw new CommunityError(502, '社区返回内容暂不可用，请稍后重试。'); }
      } catch (error) {
        if (error instanceof CommunityError) throw error;
        if (signal?.aborted) { const cancelled = new Error('Request cancelled'); cancelled.name = 'AbortError'; throw cancelled; }
        throw new CommunityError(0, '网络未能连接社区，请检查网络后重试。');
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', abort);
      }
    }
    async function ensureSession(nickname) {
      if (session) return session;
      if (sessionPromise) return sessionPromise;
      const name = String(nickname || '').trim();
      if (name.length < 2 || name.length > 24) throw new CommunityError(400, '请输入 2–24 个字的公开昵称。');
      sessionPromise = (async () => {
        const result = await request('/v1/session', { method: 'POST', body: { nickname: name } });
        const value = { baseUrl: base, token: result?.token, author: result?.author };
        if (!validSession(value, base)) throw new CommunityError(502, '暂未能建立发布身份，请稍后重试。');
        session = value;
        try { if (!storage) throw new Error('No storage'); storage.setItem(SESSION_KEY, JSON.stringify(session)); persistent = true; }
        catch { persistent = false; }
        return session;
      })();
      try { return await sessionPromise; } finally { sessionPromise = null; }
    }
    const id = value => encodeURIComponent(String(value));
    return {
      configured: Boolean(base), getSession: () => session, isPersistent: () => persistent,
      ensureSession, request,
      place: (placeId, signal) => request(`/v1/places/${id(placeId)}/community`, { signal }),
      guides: (city = '', signal) => request(`/v1/guides${city ? `?city=${id(city)}` : ''}`, { signal }),
      me: () => request('/v1/me', { auth: true }),
      myContent: signal => request('/v1/me/content', { auth: true, signal }),
      saveReview: values => request('/v1/reviews', { method: 'POST', body: values, auth: true }),
      saveGuide: values => request('/v1/guides', { method: 'POST', body: values, auth: true }),
      edit: (type, contentId, values) => request(`/v1/${type === 'review' ? 'reviews' : 'guides'}/${id(contentId)}`, { method: 'PATCH', body: values, auth: true }),
      remove: (type, contentId) => request(`/v1/${type === 'review' ? 'reviews' : 'guides'}/${id(contentId)}`, { method: 'DELETE', body: {}, auth: true }),
      restore: (type, contentId) => request(`/v1/${type === 'review' ? 'reviews' : 'guides'}/${id(contentId)}/restore`, { method: 'POST', body: {}, auth: true }),
      report: values => request('/v1/reports', { method: 'POST', body: values, auth: true }),
    };
  }
  function currentClient() {
    const base = root.TRAVEL_CONFIG?.communityApiUrl || '';
    if (!clientCache || base !== clientBase) { clientBase = base; clientCache = createClient({ baseUrl: base }); }
    return clientCache;
  }
  function dateLabel(value) {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleDateString('zh-CN', { year: 'numeric', month: 'short', day: 'numeric' }) : '';
  }
  function notify(placeId) {
    if (typeof root.dispatchEvent === 'function' && typeof root.CustomEvent === 'function') {
      root.dispatchEvent(new root.CustomEvent('travel-community-updated', { detail: { placeId: placeId || '' } }));
    }
  }
  function startMount(container) {
    mounts.get(container)?.();
    const document = container.ownerDocument || root.document, client = currentClient();
    let active = true;
    const reads = new Set();
    const cleanup = () => { active = false; reads.forEach(controller => controller.abort()); reads.clear(); };
    mounts.set(container, cleanup); container.replaceChildren();
    function node(tag, className, text) {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = String(text);
      return element;
    }
    function button(text, handler, className = 'community-action') {
      const element = node('button', className, text); element.type = 'button'; element.addEventListener('click', handler); return element;
    }
    function status() { const element = node('p', 'community-status'); element.setAttribute('role', 'status'); element.setAttribute('aria-live', 'polite'); return element; }
    function message(target, text, error = false) {
      target.replaceChildren(); target.textContent = text; target.classList.toggle('is-error', error);
      target.setAttribute('role', error ? 'alert' : 'status');
    }
    function field(form, text, name, { tag = 'input', value = '', min = 0, max = 2000, required = true, placeholder = '' } = {}) {
      const label = node('label', 'community-field', text), input = node(tag);
      input.id = `community-field-${++fieldId}`; input.name = name; input.value = value; input.required = required;
      label.setAttribute('for', input.id); input.maxLength = max; if (min) input.minLength = min;
      if (tag === 'input') input.type = 'text'; else input.rows = name === 'body' ? 6 : 4;
      if (placeholder) input.placeholder = placeholder;
      label.append(input); form.append(label); return input;
    }
    function nickname(form) {
      const author = client.getSession()?.author;
      const input = field(form, '公开昵称', 'nickname', { value: author?.nickname || '', min: 2, max: 24, placeholder: '2–24 个字' });
      input.dataset.communityNickname = 'true';
      if (author) input.readOnly = true;
      input.autocomplete = 'nickname'; return input;
    }
    function updateNickname(input) {
      const author = client.getSession()?.author;
      if (author) { input.value = author.nickname; input.readOnly = true; }
      else input.readOnly = false;
    }
    async function read(task) {
      const controller = new AbortController(); reads.add(controller);
      try { const result = await task(controller.signal); return active ? result : null; }
      finally { reads.delete(controller); }
    }
    function composer(title) {
      const details = node('details', 'community-composer'), summary = node('summary', '', title), form = node('form', 'community-form');
      form.append(node('p', 'community-public-note', PUBLIC_NOTE)); details.append(summary, form);
      return { details, form };
    }
    function submitButton(form, text) { const submit = node('button', 'primary community-submit', text); submit.type = 'submit'; submit.disabled = !client.configured; form.append(submit); return submit; }
    async function submit(form, target, task, success, after) {
      if (form.dataset.busy === 'true' || !active) return;
      if (typeof form.reportValidity === 'function' && !form.reportValidity()) return;
      form.dataset.busy = 'true';
      const controls = Array.from(form.querySelectorAll('button')); controls.forEach(control => { control.disabled = true; });
      message(target, '正在保存…');
      try {
        const result = await task();
        if (!active) return;
        const suffix = client.isPersistent() ? '' : ' 此浏览器无法保留发布身份，关闭页面后将无法修改这次投稿。';
        const saved = result?.review || result?.guide;
        const successText = saved?.hiddenAt || saved?.hidden_at ? '内容已保存，目前处于隐藏状态，仅本人可见。' : success;
        message(target, successText + suffix);
        await after?.();
      } catch (error) {
        if (active) {
          message(target, error.message || '暂未能保存，请稍后重试。', true);
          if (error.status === 401) form.querySelectorAll('[data-community-nickname]').forEach(updateNickname);
        }
      } finally {
        form.dataset.busy = 'false'; controls.forEach(control => { control.disabled = !client.configured; });
      }
    }
    function guideFields(form, places, values = {}) {
      const label = node('label', 'community-field', '关联地点（可选）'), select = node('select');
      select.name = 'placeId'; select.id = `community-field-${++fieldId}`; label.setAttribute('for', select.id);
      const none = node('option', '', '不关联具体地点'); none.value = ''; select.append(none);
      places.forEach(place => { const option = node('option', '', `${place.city} · ${place.name}`); option.value = place.id; select.append(option); });
      select.value = values.placeId || ''; label.append(select); form.append(label);
      const city = field(form, '城市', 'city', { value: values.city || '', min: 2, max: 30, placeholder: '例如：台南' });
      const syncCity = () => { const place = places.find(value => value.id === select.value); if (place) city.value = place.city; city.readOnly = Boolean(place); };
      select.addEventListener('change', syncCity); syncCity();
      const title = field(form, '笔记标题', 'title', { value: values.title || '', min: 4, max: 100, placeholder: '这趟旅行，想和大家分享什么？' });
      const body = field(form, '旅行笔记', 'body', { tag: 'textarea', value: values.body || '', min: 40, max: 10000, placeholder: '写下路线、体验、花费和实用建议，至少 40 个字。' });
      return { placeId: select, city, title, body, values: () => ({ placeId: select.value, city: city.value.trim(), title: title.value.trim(), body: body.value.trim() }) };
    }
    function reviewFields(form, values = {}) {
      const label = node('label', 'community-field', '亲身体验评分'), stars = node('select'); stars.name = 'stars';
      stars.id = `community-field-${++fieldId}`; label.setAttribute('for', stars.id);
      [5, 4, 3, 2, 1].forEach(value => { const option = node('option', '', `${value} 星`); option.value = String(value); stars.append(option); });
      stars.value = String(values.stars || 5); label.append(stars); form.append(label);
      const text = field(form, '评价内容', 'text', { tag: 'textarea', value: values.text || '', min: 10, max: 2000, placeholder: '分享你的亲身体验，至少 10 个字。' });
      return { stars, text, values: () => ({ stars: Number(stars.value), text: text.value.trim() }) };
    }
    function renderRecord(record, type, { places = [], reload, actionStatus } = {}) {
      const article = node('article', 'community-card');
      const author = node('div', 'community-author'), name = node('strong', '', record.nickname || '旅友');
      const date = dateLabel(record.updatedAt || record.createdAt);
      author.append(name, node('span', '', date)); article.append(author);
      if (type === 'guide') article.append(node('h4', 'community-title', record.title));
      else article.append(node('p', 'community-stars', `${record.stars} / 5`));
      const place = places.find(value => value.id === record.placeId);
      if (type === 'guide' || place) article.append(node('p', 'community-context', [record.city || place?.city, place?.name].filter(Boolean).join(' · ')));
      article.append(node('p', 'community-body', type === 'review' ? record.text : record.body));
      const actions = node('div', 'community-actions'), owner = client.getSession()?.author?.id === record.authorId;
      const deleted = Boolean(record.deletedAt || record.deleted_at);
      const hidden = Boolean(record.hiddenAt || record.hidden_at);
      if (deleted) article.classList.add('is-deleted');
      if (owner && hidden) article.append(node('p', 'community-context', '此内容已被隐藏，仅本人可见。'));
      if (owner && deleted) {
        actions.append(node('span', 'community-context', '已删除，仅自己可见'), button('恢复', async () => {
          try { await client.restore(type, record.id); if (!active) return; message(actionStatus, hidden ? '已恢复，内容仍处于隐藏状态。' : '已恢复公开内容。'); notify(record.placeId); await reload(); }
          catch (error) { if (active) message(actionStatus, error.message, true); }
        }));
      } else if (owner) {
        actions.append(button('编辑', () => {
          if (article.querySelector('.community-edit-form')) return;
          const form = node('form', 'community-form community-edit-form');
          const values = type === 'review' ? reviewFields(form, record) : guideFields(form, places, record);
          const result = status(); form.append(result); submitButton(form, '保存修改');
          form.append(button('取消', () => form.remove()));
          form.addEventListener('submit', event => {
            event.preventDefault(); submit(form, result, () => client.edit(type, record.id, values.values()), '修改已公开保存。', async () => { notify(record.placeId); await reload(); });
          });
          article.append(form); values.text?.focus(); values.title?.focus();
        }), button('删除', async event => {
          const control = event.currentTarget; if (control.disabled) return; control.disabled = true;
          try {
            await client.remove(type, record.id); if (!active) return;
            message(actionStatus, '已删除公开内容。');
            const undo = button('撤销删除', async () => {
              undo.disabled = true;
              try { await client.restore(type, record.id); if (!active) return; message(actionStatus, hidden ? '已恢复，内容仍处于隐藏状态。' : '已恢复。'); notify(record.placeId); await reload(); }
              catch (error) { if (active) { message(actionStatus, error.message, true); undo.disabled = false; actionStatus.append(undo); } }
            });
            actionStatus.append(undo); notify(record.placeId); await reload();
          } catch (error) { if (active) { message(actionStatus, error.message, true); control.disabled = false; } }
        }));
      } else if (!deleted) {
        const details = node('details', 'community-report'), summary = node('summary', '', '举报'), form = node('form', 'community-form');
        const nick = nickname(form), reason = field(form, '举报原因', 'reason', { tag: 'textarea', min: 5, max: 500, placeholder: '说明与内容有关的问题，至少 5 个字。' }), result = status();
        form.append(result); submitButton(form, '提交举报'); details.append(summary, form); actions.append(details);
        form.addEventListener('submit', event => {
          event.preventDefault(); submit(form, result, async () => {
            await client.ensureSession(nick.value); await client.report({ type, id: record.id, reason: reason.value.trim() });
          }, '举报已提交，等待处理。', () => { updateNickname(nick); reason.value = ''; });
        });
      }
      article.append(actions); return article;
    }
    function unavailable() {
      const note = node('p', 'community-empty', '公共社区正在连接，暂不能发表。'); note.setAttribute('role', 'status'); container.append(note);
    }
    return { client, node, button, status, message, nickname, updateNickname, read, composer, submit, submitButton, guideFields, reviewFields, renderRecord, unavailable, alive: () => active, cleanup };
  }

  function mountPlace(container, { place, places = [] } = {}) {
    const ui = startMount(container), { client, node, button, status, message } = ui;
    if (!place?.id) { container.append(node('p', 'community-empty', '请先选择一个地点。')); return ui.cleanup; }
    const section = node('section', 'community-place'), heading = node('div', 'community-heading');
    heading.append(node('h3', '', '网友评价'));
    const rating = node('p', 'community-rating', '正在读取公开评价…'); heading.append(rating); section.append(heading);
    const actionStatus = status(), readStatus = status(), reviews = node('div', 'community-list'), guides = node('div', 'community-list');
    const reviewComposer = ui.composer('写一条公开评价'), nick = ui.nickname(reviewComposer.form), review = ui.reviewFields(reviewComposer.form), reviewStatus = status();
    reviewComposer.form.append(reviewStatus); ui.submitButton(reviewComposer.form, '公开发表评价');
    section.append(readStatus, actionStatus, reviews, reviewComposer.details, node('h3', 'community-subheading', '旅友笔记'), guides);
    const guideComposer = ui.composer('分享一篇旅行笔记'), guideNick = ui.nickname(guideComposer.form);
    const guide = ui.guideFields(guideComposer.form, places.length ? places : [place], { placeId: place.id, city: place.city });
    const guideStatus = status(); guideComposer.form.append(guideStatus); ui.submitButton(guideComposer.form, '公开发表笔记'); section.append(guideComposer.details); container.append(section);
    let readVersion = 0, hasRead = false;
    async function reload() {
      const version = ++readVersion; if (!client.configured) return;
      section.setAttribute('aria-busy', 'true'); message(readStatus, '正在读取公开内容…');
      try {
        const data = await ui.read(signal => client.place(place.id, signal));
        if (!data || !ui.alive() || version !== readVersion) return;
        if (!Array.isArray(data.reviews) || !Array.isArray(data.guides) || !data.rating || !Number.isInteger(data.rating.count)) throw new Error('公开内容暂未能完整读取，请重试。');
        const average = Number(data.rating.average);
        rating.textContent = data.rating.count > 0 && Number.isFinite(average) ? `${average.toFixed(1)} / 5 · ${data.rating.count} 条公开评价` : '还没有公开评价';
        reviews.replaceChildren(...(data.reviews.length ? data.reviews.map(record => ui.renderRecord(record, 'review', { places, reload, actionStatus })) : [node('p', 'community-empty', '还没有旅友留下评价。欢迎分享你的亲身体验。')]));
        guides.replaceChildren(...(data.guides.length ? data.guides.map(record => ui.renderRecord(record, 'guide', { places, reload, actionStatus })) : [node('p', 'community-empty', '还没有关联到这里的旅行笔记。')]));
        hasRead = true; message(readStatus, ''); ui.updateNickname(nick); ui.updateNickname(guideNick);
      } catch (error) {
        if (!ui.alive() || version !== readVersion || error.name === 'AbortError') return;
        if (!hasRead) rating.textContent = '公开评分暂不可用';
        message(readStatus, error.message, true); readStatus.append(button('重新读取', reload));
      } finally { if (ui.alive() && version === readVersion) section.setAttribute('aria-busy', 'false'); }
    }
    reviewComposer.form.addEventListener('submit', event => {
      event.preventDefault(); ui.submit(reviewComposer.form, reviewStatus, async () => {
        await client.ensureSession(nick.value); return client.saveReview({ placeId: place.id, ...review.values() });
      }, '评价已公开发表。', async () => { review.text.value = ''; ui.updateNickname(nick); notify(place.id); await reload(); });
    });
    guideComposer.form.addEventListener('submit', event => {
      event.preventDefault(); ui.submit(guideComposer.form, guideStatus, async () => {
        await client.ensureSession(guideNick.value); return client.saveGuide(guide.values());
      }, '笔记已公开发表。', async () => { guide.title.value = ''; guide.body.value = ''; ui.updateNickname(guideNick); notify(guide.placeId.value); await reload(); });
    });
    if (client.configured) reload(); else { rating.textContent = ''; ui.unavailable(); }
    return ui.cleanup;
  }

  function mountHub(container, { places = [], initialPlaceId = '' } = {}) {
    const ui = startMount(container), { client, node, button, status, message } = ui;
    const section = node('section', 'community-hub'), intro = node('p', 'community-intro', '在这里分享路线、店家体验，和旅途中的发现。'); section.append(intro);
    const composer = ui.composer('写一篇公开旅行笔记'), nick = ui.nickname(composer.form), initial = places.find(place => place.id === initialPlaceId);
    const guide = ui.guideFields(composer.form, places, { placeId: initial?.id || '', city: initial?.city || '' }), composeStatus = status();
    if (initial) composer.details.open = true;
    composer.form.append(composeStatus); ui.submitButton(composer.form, '公开发表笔记'); section.append(composer.details);
    const filters = node('form', 'community-feed-filter'), label = node('label', 'community-field', '查看城市'), city = node('input');
    city.type = 'text'; city.name = 'city'; city.maxLength = 30; city.placeholder = '全部城市'; city.id = `community-field-${++fieldId}`; label.setAttribute('for', city.id); label.append(city);
    const filterButton = node('button', 'secondary', '查看'); filterButton.type = 'submit';
    const mine = button('我的投稿', () => { ownOnly = !ownOnly; mine.setAttribute('aria-pressed', String(ownOnly)); mine.textContent = ownOnly ? '返回公开笔记' : '我的投稿'; reload(); }, 'community-action community-my-posts');
    mine.setAttribute('aria-pressed', 'false'); mine.disabled = !client.getSession(); mine.title = '发布后可在本设备管理自己的投稿';
    filters.append(label, filterButton, mine); section.append(filters);
    const readStatus = status(), actionStatus = status(), list = node('div', 'community-list'); section.append(readStatus, actionStatus, list); container.append(section);
    let ownOnly = false, readVersion = 0;
    async function reload() {
      const version = ++readVersion; if (!client.configured) return;
      list.setAttribute('aria-busy', 'true'); message(readStatus, '正在读取公开笔记…');
      try {
        const data = await ui.read(signal => ownOnly ? client.myContent(signal) : client.guides(city.value.trim(), signal));
        if (!data || !ui.alive() || version !== readVersion) return;
        if (!Array.isArray(data.guides) || (ownOnly && !Array.isArray(data.reviews))) throw new Error('社区内容暂未能完整读取，请重试。');
        const records = ownOnly ? [...data.reviews.map(record => ({ record, type: 'review' })), ...data.guides.map(record => ({ record, type: 'guide' }))] : data.guides.map(record => ({ record, type: 'guide' }));
        list.replaceChildren(...(records.length ? records.map(({ record, type }) => ui.renderRecord(record, type, { places, reload, actionStatus })) : [node('p', 'community-empty', ownOnly ? '你还没有公开发表的内容。' : '还没有这个城市的旅行笔记，来分享第一篇吧。')]));
        message(readStatus, ''); ui.updateNickname(nick); mine.disabled = !client.getSession();
      } catch (error) {
        if (!ui.alive() || version !== readVersion || error.name === 'AbortError') return;
        message(readStatus, error.message, true); readStatus.append(button('重新读取', reload));
        if (error.status === 401) { mine.disabled = true; ownOnly = false; mine.setAttribute('aria-pressed', 'false'); mine.textContent = '我的投稿'; ui.updateNickname(nick); }
      } finally { if (ui.alive() && version === readVersion) list.setAttribute('aria-busy', 'false'); }
    }
    filters.addEventListener('submit', event => { event.preventDefault(); ownOnly = false; mine.setAttribute('aria-pressed', 'false'); mine.textContent = '我的投稿'; reload(); });
    composer.form.addEventListener('submit', event => {
      event.preventDefault(); ui.submit(composer.form, composeStatus, async () => {
        await client.ensureSession(nick.value); return client.saveGuide(guide.values());
      }, '旅行笔记已公开发表。', async () => {
        guide.title.value = ''; guide.body.value = ''; ui.updateNickname(nick); mine.disabled = false; city.value = ''; notify(guide.placeId.value); await reload();
      });
    });
    if (client.configured) reload(); else ui.unavailable();
    return ui.cleanup;
  }

  const api = { mountPlace, mountHub, createClient, normalizeApiUrl, dateLabel, CommunityError };
  root.TravelCommunity = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
