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
const symbols = {'美食':'食','咖啡馆':'啡','景点':'游','自然':'山','散步':'巷'};
function placeholder(place, detail = false) {
  return detail ? `<div class="detail-placeholder"><span>${symbols[place.type] || '游'}</span><small>暂无可用实景照片</small></div>` : `<div class="thumb placeholder" aria-label="暂无实景照片"><span class="placeholder-symbol">${symbols[place.type] || '游'}</span><small>暂无照片</small></div>`;
}
function imageMarkup(place, detail = false) {
  // Images are only included when the importer recorded an official, licensed URL.
  const image = safeUrl(place.image);
  return image ? `<img class="${detail ? 'detail-image' : 'thumb'}" src="${esc(image)}" data-image-place="${esc(place.id)}" data-detail="${detail}" alt="${esc(place.name)} · 来源实景照片" loading="lazy" referrerpolicy="strict-origin-when-cross-origin">` : placeholder(place, detail);
}
function render() {
  $('#explore').classList.toggle('active', !onlySaved); $('#saved').classList.toggle('active', onlySaved);
  $('#explore').setAttribute('aria-pressed', String(!onlySaved)); $('#saved').setAttribute('aria-pressed', String(onlySaved));
  document.querySelectorAll('[data-city]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.city === city)));
  const base = filterPlaces(places, {...options(), category: '全部'});
  $('#filters').innerHTML = ['全部','美食','景点','自然','散步','咖啡馆'].map(type => {
    const total = type === '全部' ? base.length : base.filter(p => p.type === type).length;
    return `<button data-category="${type}" class="${category === type ? 'selected' : ''}" aria-pressed="${category === type}" ${!total && category !== type && type !== '全部' ? 'disabled' : ''}>${type}${total ? ` ${total}` : ''}</button>`;
  }).join('');
  $('#scope').hidden = !area;
  $('#scope-text').textContent = '已限定地图区域';
  $('#clear-search').hidden = !$('#search').value;
  $('#listTitle').textContent = onlySaved ? '我的岛屿收藏' : '地图上的好去处';
  $('#list').setAttribute('aria-busy', String(dataState === 'loading'));
  if (dataState !== 'ready') {
    $('#count').textContent = dataState === 'loading' ? '正在加载…' : '资料暂不可用';
    $('#coverage').textContent = '';
    $('#list').innerHTML = dataState === 'loading' ? '<p class="empty">正在加载真实地点资料…</p>' : '<div class="empty">地点资料未能加载，请检查网络后重试。<button id="retry-data">重新加载地点资料</button></div>';
    $('#more').hidden = true; return;
  }
  const rows = filterPlaces(places, options());
  $('#count').textContent = `${rows.length} 个地点`;
  $('#coverage').textContent = `${city === '全部' ? '台北 · 台南' : city}官方资料选集 · 非全量商家名录${area ? ' · 当前地图区域' : ''}`;
  $('#list').innerHTML = rows.slice(0, pageSize).map(p => `<article class="card">${imageMarkup(p)}<button class="place-open" data-place="${esc(p.id)}" aria-label="查看${esc(p.name)}详情"><h3>${esc(p.name)}</h3><span class="tag">${esc(p.city)} · ${esc(p.type)}</span><p>${esc(p.district || p.address || '地址待补充')}</p><span class="no-rating">${esc(personalRating(p))}</span><p class="source-caption">${esc(p.source.name)}</p></button><button class="heart" data-save="${esc(p.id)}" aria-pressed="${notes.saved.includes(p.id)}" aria-label="${notes.saved.includes(p.id) ? '取消收藏' : '收藏'}${esc(p.name)}">${notes.saved.includes(p.id) ? '♥' : '♡'}</button></article>`).join('') || `<div class="empty">${onlySaved ? '这个条件下还没有收藏，点地点旁的爱心保存。' : '没有符合条件的已收录地点，试试放大其他区域或清除筛选。'}<button id="reset-filters">清除筛选条件</button></div>`;
  $('#more').hidden = rows.length <= pageSize;
  $('#more').textContent = `再看 ${Math.min(30, Math.max(0, rows.length - pageSize))} 个地点`;
  // The map retains all matching locations while the list uses the last explicitly searched viewport.
  TravelMap.setPlaces(filterPlaces(places, options(null)), openPlace);
  $('#data-summary').textContent = `已收录 ${places.filter(p => p.city === '台北').length} 个台北地点、${places.filter(p => p.city === '台南').length} 个台南地点。`;
  const legacyCount = notes.saved.filter(id => typeof id === 'number').length + Object.keys(notes.reviews).filter(id => /^\d+$/.test(id)).length;
  $('#legacy-notes').hidden = !legacyCount;
  $('#legacy-notes').textContent = '旧演示地点的收藏和评价已保留在导出备份中，不会关联到新的真实地点。';
}
function sourceLink(url, text) {
  const valid = safeUrl(url);
  return valid ? `<a href="${esc(valid)}" target="_blank" rel="noopener noreferrer">${esc(text)} ↗</a>` : esc(text);
}
function displayDate(value) {
  const match = typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : '来源未提供';
}
function openPlace(id, moveMap = true) {
  const p = places.find(place => place.id === id); if (!p) return;
  activeId = id;
  if (moveMap) TravelMap.showPlace(p);
  const reviews = notes.reviews[id] || [];
  $('#detailContent').innerHTML = `${imageMarkup(p, true)}<p class="eyebrow">${esc(p.city)} / ${esc(p.district || p.type)}</p><h2 id="detail-title">${esc(p.name)}</h2><p class="no-rating">${esc(personalRating(p))} · 仅为本机记录，不是平台口碑评分</p>${p.description ? `<h3>来源简介</h3><p>${esc(p.description)}</p>` : ''}<dl class="place-facts"><div><dt>地址</dt><dd>${esc(p.address || `${p.locationLabel || p.city} · 详细地址来源未提供`)}</dd></div><div><dt>营业时间</dt><dd>${esc(p.openingHours || '来源未提供，请出发前确认')}</dd></div><div><dt>联系电话</dt><dd>${esc(p.phone || '来源未提供')}</dd></div>${safeUrl(p.website) ? `<div><dt>相关网站</dt><dd>${sourceLink(p.website, '查看网站')}</dd></div>` : ''}</dl><div class="detail-links">${sourceLink(`https://www.openstreetmap.org/?mlat=${p.lat}&mlon=${p.lng}#map=17/${p.lat}/${p.lng}`, '查看地图位置')}${sourceLink(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${p.name} ${p.address || p.city}`)}`, 'Google Maps 导航')}</div><div class="source-block"><strong>资料出处</strong><br>${sourceLink(p.source.url, p.source.name)}${(p.additionalSources || []).map(source => `<br>${sourceLink(source.url, source.name)}（坐标等基础资料）`).join('')}<br>来源更新时间：${esc(displayDate(p.source.updatedAt))}<br>收录日期：${esc(displayDate(p.source.retrievedAt))}<br>授权：${sourceLink(p.source.licenseUrl, p.source.license || '请见来源说明')}${p.image && p.imageSource ? `<br>图片出处：${sourceLink(p.imageSource, p.source.name)}` : ''}</div><h3>搜索相关讨论</h3><p class="dialog-note">以下为平台搜索入口，本站未收录这些平台的帖子或评论。</p><div class="detail-links">${[['Threads','https://www.threads.com/search?q='],['Dcard','https://www.dcard.tw/search?query='],['小红书','https://www.xiaohongshu.com/search_result?keyword=']].map(([label,url]) => sourceLink(url + encodeURIComponent(`${p.city} ${p.name}`), label)).join('')}</div><h3>我的体验记录</h3><p class="dialog-note">这份记录仅保存于当前浏览器。公开评价系统尚未上线。</p><div>${reviews.map(r => `<div class="review"><span class="rating">${'★'.repeat(r.stars)}${'☆'.repeat(5 - r.stars)}</span><p>${esc(r.text)}</p></div>`).join('') || '<p class="dialog-note">还没有记录，去过之后再写下真实体验吧。</p>'}</div><form id="reviewForm"><label>我的评分<select name="stars" aria-label="我的评分">${[5,4,3,2,1].map(n => `<option value="${n}">${n} 星</option>`).join('')}</select></label><label>体验<textarea name="text" required maxlength="2000" rows="3" placeholder="你尝过什么、逛过哪里，有哪些实用建议？"></textarea></label><button class="primary">保存体验</button><button type="button" id="guide-place">为这里写攻略</button></form>`;
  $('#reviewForm').onsubmit = event => {
    event.preventDefault(); const form = new FormData(event.target); const text = String(form.get('text')).trim(); if (!text) return;
    (notes.reviews[id] ??= []).push({stars: Number(form.get('stars')), text});
    const saved = persist(); render(); openPlace(id, false); if (saved) toast('体验已保存到当前浏览器。');
  };
  $('#guide-place').onclick = () => {
    $('#detail').close(); showEditor(); $('#guideForm').elements.title.value = `${p.name} · 旅行笔记`; $('#guideForm').elements.city.value = p.city; $('#guideForm').elements.url.value = p.source.url;
  };
  if (!$('#detail').open) $('#detail').showModal();
}
function renderGuides() {
  $('#guides').innerHTML = notes.guides.map((g, i) => `<article class="review"><h3>${esc(g.title)}</h3><small>${esc(g.city)}</small><p>${esc(g.body)}</p><div class="guide-actions">${safeUrl(g.url) ? sourceLink(g.url, '来源') : ''}<button data-edit-guide="${i}">编辑笔记</button></div></article>`).join('');
}
let editingGuide = null;
function showEditor() { editingGuide = null; $('#guideForm').reset(); $('#guide-status').textContent = ''; renderGuides(); $('#editor').showModal(); }
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
  if (save) { const id = save.dataset.save; notes.saved = notes.saved.includes(id) ? notes.saved.filter(value => value !== id) : [...notes.saved, id]; persist(); render(); return; }
  const button = event.target.closest('[data-place]'); if (button) openPlace(button.dataset.place);
  if (event.target.closest('#reset-filters')) resetFilters();
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
  $('#source-dialog').showModal();
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
