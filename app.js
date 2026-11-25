'use strict';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const { filterPlaces, validPlaces, safeUrl, validNotes } = PlacesModel;
const EMPTY_NOTES = () => ({ saved: [], reviews: {}, guides: [] });
let notes = EMPTY_NOTES();
try { const saved = JSON.parse(localStorage.getItem('island-notes')); if (validNotes(saved)) notes = saved; } catch { /* A restricted browser can still explore places. */ }
let places = [], sources = null, dataState = 'loading', city = '全部', category = '全部', onlySaved = false, area = null, pageSize = 30, activeId = null, toastTimer;
function toast(message) {
  clearTimeout(toastTimer); $('#toast').textContent = message; $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}
function persist() {
  try { localStorage.setItem('island-notes', JSON.stringify(notes)); return true; }
  catch { toast('浏览器未能保存笔记，请先导出备份。'); return false; }
}
function options(bounds = area) { return {city, category, query: $('#search').value, onlySaved, saved: notes.saved, bounds}; }
function personalRating(place) {
  const rows = notes.reviews[place.id] || [];
  return rows.length ? `我的评分 ${(rows.reduce((sum, r) => sum + r.stars, 0) / rows.length).toFixed(1)} · ${rows.length} 次记录` : '暂无评分';
}
const placeIcons = {'美食':'utensils','咖啡馆':'coffee','景点':'landmark','自然':'trees','散步':'footprints'};
const icon = name => window.TravelUI?.icon(name) || '';
function refreshUI() {
  window.TravelUI?.refreshIcons();
  window.TravelUI?.syncNavigation();
}
function placeholder(place, detail = false) {
  return detail ? `<p class="detail-photo-note">${icon('image-off')}<span>暂无实景照片</span></p>` : '';
}
function imageMarkup(place, detail = false) {
  // Only display actual, attributed images; missing photos never get a fake thumbnail.
  const image = safeUrl(place.image);
  return image ? `<img class="${detail ? 'detail-image' : 'thumb'}" src="${esc(image)}" data-image-place="${esc(place.id)}" data-detail="${detail}" alt="${esc(place.name)} · 来源实景照片" loading="lazy" referrerpolicy="strict-origin-when-cross-origin">` : placeholder(place, detail);
}
function render() {
  $('#explore').classList.toggle('active', !onlySaved); $('#saved').classList.toggle('active', onlySaved);
  $('#explore').setAttribute('aria-pressed', String(!onlySaved)); $('#saved').setAttribute('aria-pressed', String(onlySaved));
  const tabs = $('#main-tabs');
  if (tabs) tabs.dataset.view = onlySaved ? 'saved' : 'explore';
  document.querySelectorAll('[data-city]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.city === city)));
  const base = filterPlaces(places, {...options(), category: '全部'});
  $('#filters').innerHTML = ['全部','美食','景点','自然','散步','咖啡馆'].map(type => {
    const total = type === '全部' ? base.length : base.filter(p => p.type === type).length;
    return `<button data-category="${type}" class="${category === type ? 'selected' : ''}" aria-pressed="${category === type}" ${!total && category !== type && type !== '全部' ? 'disabled' : ''}><span class="filter-label">${type}</span>${category === type && total ? `<span class="filter-count">${total}</span>` : ''}</button>`;
  }).join('');
  $('#scope').hidden = !area;
  $('#scope-text').textContent = '当前地图区域';
  $('#clear-search').hidden = !$('#search').value;
  $('#listTitle').textContent = onlySaved ? '我的收藏' : '探索地点';
  $('#list').setAttribute('aria-busy', String(dataState === 'loading'));
  if (dataState !== 'ready') {
    $('#count').textContent = dataState === 'loading' ? '加载中' : '暂不可用';
    $('#coverage').textContent = '';
    $('#list').innerHTML = dataState === 'loading'
      ? `<div class="empty"><span class="empty-icon">${icon('loader-circle')}</span><p>正在加载地点</p></div>`
      : `<div class="empty"><span class="empty-icon">${icon('cloud-off')}</span><h3>暂时无法加载地点</h3><p>检查网络后再试一次。</p><button id="retry-data">重新加载</button></div>`;
    $('#more').hidden = true; refreshUI(); return;
  }
  const rows = filterPlaces(places, options());
  $('#count').textContent = `${rows.length} 个地点`;
  $('#coverage').textContent = `${city === '全部' ? '台北 · 台南' : city} · 官方资料选集${area ? ' · 区域内' : ''}`;
  const hasSavedPlaces = places.some(place => notes.saved.includes(place.id));
  $('#list').innerHTML = rows.slice(0, pageSize).map(p => {
    const saved = notes.saved.includes(p.id);
    const hasRating = Boolean(notes.reviews[p.id]?.length);
    return `<article class="card${activeId === p.id ? ' is-selected' : ''}" data-card="${esc(p.id)}"><button class="place-open" data-place="${esc(p.id)}" aria-label="查看${esc(p.name)}详情" ${activeId === p.id ? 'aria-current="true"' : ''}><span class="place-icon">${icon(placeIcons[p.type] || 'map-pin')}</span><span class="place-copy"><h3>${esc(p.name)}</h3><span class="place-meta">${esc([p.city, p.district, p.type].filter(Boolean).join(' · '))}</span>${hasRating ? `<span class="rating">${esc(personalRating(p))}</span>` : ''}</span></button><button class="heart" data-save="${esc(p.id)}" aria-pressed="${saved}" aria-label="${saved ? '取消收藏' : '收藏'}${esc(p.name)}" title="${saved ? '取消收藏' : '收藏地点'}">${icon('bookmark')}</button></article>`;
  }).join('') || (onlySaved && !hasSavedPlaces
    ? `<div class="empty"><span class="empty-icon">${icon('bookmark')}</span><h3>收藏你的下一站</h3><p>点击地点旁的收藏按钮，留待出发时查看。</p><button id="browse-places">去探索地点</button></div>`
    : `<div class="empty"><span class="empty-icon">${icon('search')}</span><h3>${onlySaved ? '没有符合条件的收藏' : '没有找到地点'}</h3><p>换个关键词，或试试其他地图区域。</p><button id="reset-filters">清除筛选</button></div>`);
  $('#more').hidden = rows.length <= pageSize;
  $('#more').textContent = `再看 ${Math.min(30, Math.max(0, rows.length - pageSize))} 个地点`;
  // A moved map never silently changes the explicitly searched list area.
  TravelMap.setPlaces(filterPlaces(places, options(null)), openPlace);
  $('#data-summary').textContent = `台北 ${places.filter(p => p.city === '台北').length} · 台南 ${places.filter(p => p.city === '台南').length} · 官方开放资料`;
  const legacyCount = notes.saved.filter(id => typeof id === 'number').length + Object.keys(notes.reviews).filter(id => /^\d+$/.test(id)).length;
  $('#legacy-notes').hidden = !legacyCount;
  $('#legacy-notes').textContent = '旧演示地点的收藏和评价仍在导出备份中，不会关联到真实地点。';
  refreshUI();
}
function sourceLink(url, text) {
  const valid = safeUrl(url);
  return valid ? `<a href="${esc(valid)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>` : esc(text);
}
function displayDate(value) {
  const match = typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '来源未提供';
}
function disclosure(title, body, open = false) {
  return `<details class="disclosure"${open ? ' open' : ''}><summary><span>${esc(title)}</span>${icon('chevron-down')}</summary><div class="disclosure-body">${body}</div></details>`;
}
function sourceMarkup(source) {
  return `<div class="source-block">${sourceLink(source.url, source.name)}<dl class="source-facts"><div><dt>来源更新</dt><dd>${esc(displayDate(source.updatedAt))}</dd></div><div><dt>收录日期</dt><dd>${esc(displayDate(source.retrievedAt))}</dd></div><div><dt>授权</dt><dd>${sourceLink(source.licenseUrl, source.license || '请见来源说明')}</dd></div></dl></div>`;
}
function updateSelection() {
  document.querySelectorAll('[data-card]').forEach(card => {
    const selected = card.dataset.card === activeId;
    card.classList.toggle('is-selected', selected);
    const button = card.querySelector('[data-place]');
    if (selected) button.setAttribute('aria-current', 'true'); else button.removeAttribute('aria-current');
  });
}
function toggleSaved(id) {
  notes.saved = notes.saved.includes(id) ? notes.saved.filter(value => value !== id) : [...notes.saved, id];
  persist(); render();
}
function openPlace(id, moveMap = true) {
  const p = places.find(place => place.id === id); if (!p) return;
  activeId = id;
  updateSelection();
  if (moveMap) TravelMap.showPlace(p);
  const reviews = notes.reviews[id] || [];
  const image = safeUrl(p.image) ? imageMarkup(p, true) : '';
  const saved = notes.saved.includes(id);
  const facts = `<dl class="place-facts"><div><dt>${icon('map-pin')}地址</dt><dd>${esc(p.address || `${p.locationLabel || p.city} · 详细地址未提供`)}</dd></div><div><dt>${icon('clock-3')}营业时间</dt><dd>${esc(p.openingHours || '来源未提供，出发前请确认')}</dd></div><div><dt>${icon('phone')}联系电话</dt><dd>${esc(p.phone || '来源未提供')}</dd></div>${safeUrl(p.website) ? `<div><dt>${icon('globe')}网站</dt><dd>${sourceLink(p.website, '相关网站')}</dd></div>` : ''}</dl>`;
  const mapLinks = `<div class="detail-links">${sourceLink(`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`, '地图位置')}${sourceLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address || p.city}`)}`, 'Google Maps 导航')}</div>`;
  const origin = `${sourceMarkup(p.source)}${(p.additionalSources || []).map(source => `<p class="dialog-note">坐标等基础资料的补充来源</p>${sourceMarkup(source)}`).join('')}${p.image && p.imageSource ? `<p class="dialog-note">图片出处：${sourceLink(p.imageSource, p.source.name)}</p>` : ''}<p class="dialog-note">官方资料选集不代表即时营业状态，出发前请核实。${safeUrl(p.image) ? '' : '此地点暂无可用实景照片。'}</p>`;
  const discussions = `<p class="dialog-note">前往平台搜索原文。本站未导入这些平台的帖子或评论。</p><div class="detail-links">${[['Threads','https://www.threads.com/search?q='],['Dcard','https://www.dcard.tw/search?query='],['小红书','https://www.xiaohongshu.com/search_result?keyword=']].map(([label,url]) => sourceLink(url + encodeURIComponent(`${p.city} ${p.name}`), label)).join('')}</div>`;
  const experience = `<p class="dialog-note">仅保存于当前浏览器，不会发布为公共评价。</p><div>${reviews.map(r => `<div class="review"><span class="rating">我的评分 ${r.stars} / 5</span><p>${esc(r.text)}</p></div>`).join('')}</div><form id="reviewForm"><label>我的评分<select name="stars" aria-label="我的评分">${[5,4,3,2,1].map(n => `<option value="${n}">${n} 星</option>`).join('')}</select></label><label>体验<textarea name="text" required maxlength="2000" rows="3" placeholder="去过之后，留下你的真实体验。"></textarea></label><button class="primary">保存体验</button></form>`;
  $('#detailContent').innerHTML = `${image}<div class="detail-heading"><span class="place-icon">${icon(placeIcons[p.type] || 'map-pin')}</span><div><p class="detail-topline">${esc([p.city,p.district,p.type].filter(Boolean).join(' · '))}</p><h2 id="detail-title">${esc(p.name)}</h2></div></div><p class="detail-rating">${esc(personalRating(p))}${reviews.length ? ' · 仅为本机记录' : ''}</p><div class="detail-actions"><button class="secondary detail-save" id="detail-save" aria-pressed="${saved}">${icon('bookmark')}<span>${saved ? '已收藏' : '收藏地点'}</span></button><button class="secondary" type="button" id="guide-place">${icon('square-pen')}<span>写攻略</span></button></div>${facts}${mapLinks}${p.description ? disclosure('地点简介', `<p>${esc(p.description)}</p>`) : ''}${disclosure('资料来源与更新时间', origin)}${disclosure('搜索相关讨论', discussions)}${disclosure(`我的体验${reviews.length ? ` · ${reviews.length} 条记录` : ''}`, experience, Boolean(reviews.length))}`;
  $('#detail-save').onclick = () => {
    toggleSaved(id);
    const isSaved = notes.saved.includes(id);
    $('#detail-save').setAttribute('aria-pressed', String(isSaved));
    $('#detail-save').innerHTML = `${icon('bookmark')}<span>${isSaved ? '已收藏' : '收藏地点'}</span>`;
    refreshUI();
  };
  $('#reviewForm').onsubmit = event => {
    event.preventDefault(); const form = new FormData(event.target); const text = String(form.get('text')).trim(); if (!text) return;
    (notes.reviews[id] ??= []).push({stars: Number(form.get('stars')), text});
    const saved = persist(); render(); openPlace(id, false); if (saved) toast('体验已保存到当前浏览器。');
  };
  $('#guide-place').onclick = () => {
    $('#detail').close(); showEditor(); $('#guideForm').elements.title.value = `${p.name} · 旅行笔记`; $('#guideForm').elements.city.value = p.city; $('#guideForm').elements.url.value = p.source.url;
  };
  if (!$('#detail').open) $('#detail').showModal();
  refreshUI();
}
function renderGuides() {
  $('#guides').innerHTML = notes.guides.map((g, i) => `<article class="review guide-entry"><div class="guide-entry-heading"><h3>${esc(g.title)}</h3><button data-edit-guide="${i}" aria-label="编辑${esc(g.title)}">${icon('pencil')}<span>编辑</span></button></div><small>${esc(g.city)}</small><p>${esc(g.body)}</p>${safeUrl(g.url) ? `<div class="guide-actions">${sourceLink(g.url, '来源')}</div>` : ''}</article>`).join('');
  refreshUI();
}
let editingGuide = null;
function showEditor() { editingGuide = null; $('#guideForm').reset(); $('#guide-status').textContent = ''; renderGuides(); $('#editor').showModal(); refreshUI(); }
$('#guideForm').onsubmit = event => {
  event.preventDefault(); const guide = Object.fromEntries(new FormData(event.target));
  guide.title = guide.title.trim(); guide.body = guide.body.trim(); guide.city = guide.city.trim();
  if (!guide.title || !guide.body || !guide.city) return;
  if (editingGuide === null) notes.guides.unshift(guide); else notes.guides[editingGuide] = guide;
  const saved = persist(); editingGuide = null; event.target.reset(); renderGuides(); $('#guide-status').textContent = saved ? ' 已保存到本机' : ' 暂未能保存，请导出备份';
};
$('#guides').onclick = event => {
  const button = event.target.closest('[data-edit-guide]'); if (!button) return;
  editingGuide = Number(button.dataset.editGuide); const guide = notes.guides[editingGuide];
  ['title','city','body','url'].forEach(key => $('#guideForm').elements[key].value = guide[key] || ''); $('#guide-status').textContent = ' 正在编辑已有笔记'; $('#guideForm').elements.title.focus();
};
function clearArea() { area = null; $('#search-area').classList.remove('dirty'); $('#search-area').textContent = '搜索此区域'; }
function resetFilters() { clearArea(); city = '全部'; category = '全部'; area = null; pageSize = 30; $('#search').value = ''; render(); }
$('#filters').onclick = event => { const button = event.target.closest('[data-category]'); if (button && !button.disabled) { category = button.dataset.category; pageSize = 30; render(); } };
$('.cities').onclick = event => { const button = event.target.closest('[data-city]'); if (button) { city = button.dataset.city; clearArea(); pageSize = 30; render(); TravelMap.fitCity(city); } };
$('#search').oninput = () => { pageSize = 30; render(); };
$('#clear-search').onclick = () => { $('#search').value = ''; pageSize = 30; render(); $('#search').focus(); };
$('#list').onclick = event => {
  const save = event.target.closest('[data-save]');
  if (save) { toggleSaved(save.dataset.save); return; }
  const button = event.target.closest('[data-place]'); if (button) openPlace(button.dataset.place);
  if (event.target.closest('#reset-filters')) resetFilters();
  if (event.target.closest('#browse-places')) { onlySaved = false; resetFilters(); TravelMap.reset(); }
  if (event.target.closest('#retry-data')) loadPlaces();
};
$('#saved').onclick = () => { onlySaved = true; pageSize = 30; render(); };
$('#explore').onclick = () => { onlySaved = false; resetFilters(); TravelMap.reset(); };
$('#more').onclick = () => { pageSize += 30; render(); };
$('#search-area').onclick = () => {
  const bounds = TravelMap.getBounds(); if (!bounds) { toast('地图尚未就绪，请稍后再试。'); return; }
  area = {...bounds}; pageSize = 30; render(); $('#search-area').classList.remove('dirty'); $('#search-area').textContent = '已搜索此区域';
};
$('#clear-area').onclick = () => { clearArea(); pageSize = 30; render(); };
TravelMap.onViewportChanged(bounds => { $('#search-area').disabled = !bounds; if (bounds) { $('#search-area').classList.add('dirty'); $('#search-area').textContent = '搜索此区域'; } });
$('#write').onclick = showEditor;
document.querySelectorAll('.close').forEach(button => button.onclick = () => button.closest('dialog').close());
document.addEventListener('error', event => {
  const image = event.target; if (!(image instanceof HTMLImageElement) || !image.dataset.imagePlace) return;
  const p = places.find(place => place.id === image.dataset.imagePlace); if (p) image.outerHTML = placeholder(p, image.dataset.detail === 'true');
}, true);
$('#export').onclick = () => { const url = URL.createObjectURL(new Blob([JSON.stringify(notes, null, 2)], {type:'application/json'})); const link = document.createElement('a'); link.href = url; link.download = 'island-notes.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
$('#import').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw Error('too large');
    const value = JSON.parse(await file.text()); if (!validNotes(value)) throw Error('invalid');
    if (!confirm('导入将替换当前浏览器的收藏、评价和攻略，建议先导出备份。确定导入？')) return;
    notes = {saved: value.saved, reviews: value.reviews, guides: value.guides}; const saved = persist(); render();
    if ($('#editor').open) renderGuides(); if ($('#detail').open) openPlace(activeId, false);
    toast(saved ? '笔记已导入并保存。' : '已读入笔记，请导出备份以免丢失。');
  } catch { toast('无法导入：请选择本站导出的有效 JSON，文件不超过 2 MB。'); }
  finally { event.target.value = ''; }
};
$('#sources').onclick = () => {
  const entries = Array.isArray(sources) ? sources : (sources?.sources || []);
  $('#source-content').innerHTML = entries.length ? entries.map(source => `<div class="source-item"><h3>${esc(source.name)}</h3><p>${sourceLink(source.url, '官方资料来源')}<br>授权：${sourceLink(source.licenseUrl, source.license || '请见来源网站')}<br>收录日期：${esc(displayDate(source.retrievedAt))}</p>${source.note ? `<p>${esc(source.note)}</p>` : ''}${source.attribution ? `<p class="dialog-note">${esc(source.attribution)}</p>` : ''}</div>`).join('') : '<p>各地点详情均列出官方来源、收录日期与原始更新时间。</p>';
  $('#source-dialog').showModal(); refreshUI();
};
async function loadPlaces() {
  dataState = 'loading'; render();
  try {
    const response = await fetch('./places.json'); if (!response.ok) throw Error('http');
    places = validPlaces(await response.json()); dataState = 'ready'; render();
  } catch { dataState = 'error'; render(); }
}
fetch('./sources.json').then(response => response.ok ? response.json() : null).then(value => { sources = value; }).catch(() => {});
render(); loadPlaces(); TravelMap.init();
