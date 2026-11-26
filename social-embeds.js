/* Public posts stay on their original platform. We store links, never scraped post text. */
(function (root) {
  'use strict';
  const platformNames = { threads: 'Threads', facebook: 'Facebook', instagram: 'Instagram' };
  const sdkUrls = {
    threads: 'https://www.threads.com/embed.js',
    instagram: 'https://www.instagram.com/embed.js',
  };
  const scriptLoads = new WeakMap(), activeMounts = new WeakMap();
  let nextEmbedId = 0;

  function normalizePostUrl(value) {
    if (typeof value !== 'string' || value.length > 2048) return null;
    const input = value.trim();
    if (/[\\\u0000-\u001f\u007f]/.test(input)) return null;
    const authority = /^https:\/\/([^/?#]+)/i.exec(input)?.[1]?.toLowerCase();
    const hosts = {
      'threads.com': 'threads', 'www.threads.com': 'threads',
      'threads.net': 'threads', 'www.threads.net': 'threads',
      'instagram.com': 'instagram', 'www.instagram.com': 'instagram',
      'facebook.com': 'facebook', 'www.facebook.com': 'facebook', 'm.facebook.com': 'facebook',
    };
    const platform = Object.prototype.hasOwnProperty.call(hosts, authority) ? hosts[authority] : null;
    if (!platform) return null;
    let parsed;
    try { parsed = new URL(input); } catch { return null; }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.hostname.toLowerCase() !== authority) return null;
    const path = parsed.pathname;
    let match, canonical;
    if (platform === 'threads') {
      match = /^\/@([A-Za-z0-9_.]{1,100})\/post\/([A-Za-z0-9_-]{5,100})\/?$/.exec(path);
      if (match) canonical = `https://www.threads.com/@${match[1].toLowerCase()}/post/${match[2]}/`;
      else if ((match = /^\/t\/([A-Za-z0-9_-]{5,100})\/?$/.exec(path))) canonical = `https://www.threads.com/t/${match[1]}/`;
    } else if (platform === 'instagram') {
      match = /^\/(p|reel)\/([A-Za-z0-9_-]{5,100})\/?$/.exec(path);
      if (match) canonical = `https://www.instagram.com/${match[1]}/${match[2]}/`;
    } else {
      const owner = '[A-Za-z0-9.]{1,100}', post = '(?:[0-9]{3,100}|pfbid[A-Za-z0-9]{5,200})';
      match = new RegExp(`^/(${owner})/posts/(${post})/?$`).exec(path);
      if (match && !['groups', 'events', 'share', 'stories'].includes(match[1].toLowerCase())) {
        canonical = `https://www.facebook.com/${match[1]}/posts/${match[2]}/`;
      } else if ((match = /^\/reel\/([0-9]{3,100})\/?$/.exec(path))) {
        canonical = `https://www.facebook.com/reel/${match[1]}/`;
      } else if ((match = new RegExp(`^/(${owner})/videos/([0-9]{3,100})/?$`).exec(path)) && !['groups', 'events', 'share', 'stories'].includes(match[1].toLowerCase())) {
        canonical = `https://www.facebook.com/${match[1]}/videos/${match[2]}/`;
      } else if (/^\/watch\/?$/.test(path) && parsed.searchParams.getAll('v').length === 1 && /^[0-9]{3,100}$/.test(parsed.searchParams.get('v'))) {
        canonical = `https://www.facebook.com/watch/?v=${parsed.searchParams.get('v')}`;
      } else if (path === '/permalink.php' && parsed.searchParams.getAll('story_fbid').length === 1 && parsed.searchParams.getAll('id').length === 1 && new RegExp(`^${post}$`).test(parsed.searchParams.get('story_fbid')) && /^[0-9]{3,100}$/.test(parsed.searchParams.get('id'))) {
        canonical = `https://www.facebook.com/permalink.php?story_fbid=${parsed.searchParams.get('story_fbid')}&id=${parsed.searchParams.get('id')}`;
      }
    }
    return canonical ? { platform, url: canonical } : null;
  }

  function validEntries(rows, validPlaceIds) {
    if (!Array.isArray(rows)) return [];
    const allowed = validPlaceIds ? new Set(validPlaceIds) : null, seen = new Set();
    return rows.flatMap(row => {
      if (!row || typeof row.placeId !== 'string' || !row.placeId.trim() || row.placeId.length > 180 || (allowed && !allowed.has(row.placeId))) return [];
      if (!['official', 'traveler'].includes(row.kind) || typeof row.curatedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(row.curatedAt)) return [];
      const date = new Date(`${row.curatedAt}T00:00:00Z`);
      if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== row.curatedAt) return [];
      const normalized = normalizePostUrl(row.url);
      if (!normalized || (row.platform && row.platform !== normalized.platform) || (row.label !== undefined && (typeof row.label !== 'string' || row.label.length > 120))) return [];
      const key = `${row.placeId}\n${normalized.url}`;
      if (seen.has(key)) return [];
      seen.add(key);
      return [{ placeId: row.placeId, ...normalized, curatedAt: row.curatedAt, kind: row.kind, ...(row.label?.trim() ? { label: row.label.trim() } : {}) }];
    });
  }

  function node(doc, tag, className, text) {
    const element = doc.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function originalLink(doc, url, text = '打开原帖 ↗') {
    const link = node(doc, 'a', 'social-original', text);
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
  }
  function loadSdk(doc, platform) {
    let loads = scriptLoads.get(doc);
    if (!loads) { loads = new Map(); scriptLoads.set(doc, loads); }
    if (loads.has(platform)) return loads.get(platform);
    const script = doc.createElement('script');
    script.src = sdkUrls[platform];
    script.async = true;
    script.dataset.socialSdk = platform;
    const load = new Promise((resolve, reject) => {
      const timer = root.setTimeout(() => finish(new Error('原帖平台连接超时')), 15000);
      function finish(error) {
        root.clearTimeout(timer);
        script.onload = script.onerror = null;
        // Both official SDKs currently export instgrm.Embeds. Keep each SDK's
        // own processor so loading Instagram later cannot replace Threads'.
        const namespace = platform === 'threads' ? (root.threads?.Embeds || root.instgrm?.Embeds) : root.instgrm?.Embeds;
        const process = namespace?.process;
        if (!error && typeof process !== 'function') error = new Error('原帖平台暂时无法显示');
        if (error) { loads.delete(platform); script.remove(); reject(error); }
        else resolve(process.bind(namespace));
      }
      script.onload = () => finish();
      script.onerror = () => finish(new Error('原帖平台暂时无法连接'));
    });
    loads.set(platform, load);
    doc.head.append(script);
    return load;
  }
  async function mount(container, entry) {
    const normalized = normalizePostUrl(entry?.url);
    if (!normalized || (entry.platform && entry.platform !== normalized.platform)) throw new Error('无效的原帖链接');
    const doc = container?.ownerDocument;
    if (!doc || typeof container.replaceChildren !== 'function') throw new Error('无法显示原帖');
    const instance = {}, { platform, url } = normalized;
    activeMounts.set(container, instance);
    let element;
    if (platform === 'facebook') {
      const video = /\/reel\/|\/videos\/|\/watch\//.test(new URL(url).pathname);
      const frameUrl = new URL(`https://www.facebook.com/plugins/${video ? 'video' : 'post'}.php`);
      frameUrl.search = new URLSearchParams({ href: url, show_text: 'true', width: '500' });
      element = node(doc, 'iframe', 'social-official-frame');
      element.src = frameUrl.href;
      element.title = 'Facebook 官方原帖';
      element.loading = 'lazy';
      element.referrerPolicy = 'strict-origin-when-cross-origin';
      element.setAttribute('width', '500');
      element.setAttribute('height', video ? '650' : '620');
      element.setAttribute('allow', 'encrypted-media; picture-in-picture; web-share');
      element.setAttribute('allowfullscreen', '');
    } else {
      element = node(doc, 'blockquote', platform === 'instagram' ? 'instagram-media' : 'text-post-media');
      if (platform === 'instagram') {
        element.setAttribute('data-instgrm-permalink', url);
        element.setAttribute('data-instgrm-version', '14');
      } else {
        element.setAttribute('data-text-post-permalink', url);
        element.setAttribute('data-text-post-version', '0');
        element.id = `island-threads-${++nextEmbedId}`;
      }
      element.append(originalLink(doc, url, `在 ${platformNames[platform]} 查看原帖 ↗`));
    }
    container.replaceChildren(element);
    if (platform !== 'facebook') {
      const process = await loadSdk(doc, platform);
      if (container.isConnected && activeMounts.get(container) === instance) process();
    }
    return () => {
      if (activeMounts.get(container) === instance) {
        activeMounts.delete(container);
        container.replaceChildren();
      }
    };
  }

  function renderPlace(container, { placeId, posts = [] } = {}) {
    const doc = container?.ownerDocument;
    if (!doc || typeof container.replaceChildren !== 'function') throw new Error('无法显示关联帖子');
    const entries = validEntries(posts).filter(entry => entry.placeId === placeId).sort((a, b) => b.curatedAt.localeCompare(a.curatedAt));
    const panel = node(doc, 'div', 'social-panel');
    container.replaceChildren(panel);
    if (!entries.length) {
      panel.append(node(doc, 'p', 'social-empty', '还没有关联的公开帖子'));
      return { count: 0, destroy: () => panel.remove() };
    }
    const filters = node(doc, 'div', 'social-platforms');
    filters.setAttribute('role', 'group');
    filters.setAttribute('aria-label', '原帖来源平台');
    const feed = node(doc, 'div', 'social-feed'), cards = [];
    const buttons = Object.entries({ all: '全部', ...platformNames }).map(([platform, label]) => {
      const button = node(doc, 'button', 'social-platform-button', label);
      button.type = 'button';
      button.dataset.socialPlatform = platform;
      button.setAttribute('aria-pressed', String(platform === 'all'));
      button.onclick = () => {
        buttons.forEach(other => other.setAttribute('aria-pressed', String(other === button)));
        cards.forEach(({ card, entry }) => { card.hidden = platform !== 'all' && entry.platform !== platform; });
        emptyFilter.hidden = cards.some(({ card }) => !card.hidden);
      };
      filters.append(button);
      return button;
    });
    const emptyFilter = node(doc, 'p', 'social-empty', '这个平台还没有关联原帖');
    emptyFilter.hidden = true;
    for (const entry of entries) {
      const card = node(doc, 'article', 'social-post');
      card.dataset.socialPlatform = entry.platform;
      card.dataset.socialKind = entry.kind;
      const header = node(doc, 'div', 'social-post-header');
      const source = node(doc, 'div', 'social-post-source');
      source.append(node(doc, 'span', 'social-platform-name', platformNames[entry.platform]), node(doc, 'span', 'social-post-kind', entry.kind === 'official' ? '官方动态' : '旅友原帖'));
      header.append(source, originalLink(doc, entry.url));
      card.append(header);
      if (entry.label) card.append(node(doc, 'p', 'social-post-label', entry.label));
      const host = node(doc, 'div', 'social-embed-host');
      host.hidden = true;
      const loadButton = node(doc, 'button', 'social-load', '显示原帖');
      loadButton.type = 'button';
      const status = node(doc, 'p', 'social-embed-status');
      status.setAttribute('role', 'status');
      loadButton.onclick = async () => {
        loadButton.disabled = true;
        loadButton.textContent = '正在加载…';
        host.hidden = false;
        status.textContent = '正在连接原帖平台…';
        try {
          await mount(host, entry);
          if (!card.isConnected) return;
          loadButton.hidden = true;
          status.textContent = '如未显示或需查看完整讨论，请打开原帖。';
        } catch {
          if (!card.isConnected) return;
          loadButton.disabled = false;
          loadButton.textContent = '重试显示';
          status.textContent = '原帖暂时无法加载，请打开原帖查看。';
        }
      };
      card.append(loadButton, host, status);
      feed.append(card);
      cards.push({ card, entry });
    }
    panel.append(filters, feed, emptyFilter, node(doc, 'p', 'social-disclosure', '原帖由各平台提供，可能需要登录；完整讨论以原平台为准。官方动态与旅友原帖分别标注。'));
    return { count: entries.length, destroy: () => panel.remove() };
  }

  const api = { normalizePostUrl, validEntries, mount, renderPlace };
  root.SocialEmbeds = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
