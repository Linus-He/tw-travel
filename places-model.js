/* Pure helpers shared by the UI and regression tests. */
(function (root) {
  const aliases = Object.fromEntries('臺台 灣湾 區区 縣县 鄉乡 鎮镇 東东 義义 龍龙 華华 萬万 與与 廟庙 館馆 園园 廣广 場场 橋桥 壽寿 學学 風风 藝艺 體体 歷历 聖圣 觀观 遊游 樂乐 飲饮 貓猫 鹽盐 綠绿 紅红 蓮莲 雲云 術术 樓楼 門门 關关 國国 圖图 書书 鐵铁 車车 站站 道道 營营 時时 號号 處处 莊庄 溪溪 溫温 濕湿 獅狮 島岛 蘭兰 濟济 懷怀 舊旧 復复 興兴 機机 紀纪 憶忆 寶宝 眷眷 慶庆 榮荣 會会 長长 將将 麵面 飯饭 餅饼 滷卤 鴨鸭 雞鸡 鵝鹅 魚鱼 湯汤 燒烧 貢贡 圓圆 點点 餐餐 餃饺 腸肠 醬酱 鳳凤 梨梨 豬猪 蝦虾 蚵蚵 蠣蛎 糕糕 齋斋 賓宾 龜龟 鳥鸟 徑径 嶺岭 欖榄 濱滨 連连 經经 貨货 廠厂 櫻樱 纜缆 線线 電电 菸烟 窯窑 戲戏 劇剧 廳厅 總总 統统 獨独 頂顶 傳传 說说 級级 峽峡 擔担 擴扩 產产 發发 蔣蒋 愛爱 設设 計计 構构 實实 驗验 遺遗 址址 銀银 蛋蛋 莊庄 蘇苏'.split(' ').map(pair => Array.from(pair)));
  const normalize = text => Array.from(String(text || '').normalize('NFKC').toLowerCase()).map(c => aliases[c] || c).join('').replace(/\s+/g, ' ').trim();
  function withinBounds(place, bounds) {
    if (!bounds) return true;
    const longitude = bounds.west <= bounds.east ? place.lng >= bounds.west && place.lng <= bounds.east : place.lng >= bounds.west || place.lng <= bounds.east;
    return place.lat >= bounds.south && place.lat <= bounds.north && longitude;
  }
  function filterPlaces(places, { city = '全部', category = '全部', query = '', onlySaved = false, saved = [], bounds = null } = {}) {
    const terms = normalize(query).split(' ').filter(Boolean);
    const savedIds = new Set(saved);
    return places.filter(p => (city === '全部' || p.city === city) && (category === '全部' || p.type === category) && (!onlySaved || savedIds.has(p.id)) && withinBounds(p, bounds) && terms.every(term => normalize([p.name, p.city, p.district, p.address, p.type].join(' ')).includes(term)));
  }
  function validPlaces(rows) {
    if (!Array.isArray(rows) || !rows.length) throw Error('empty places');
    const ids = new Set();
    for (const p of rows) {
      if (typeof p.id !== 'string' || !p.id || ids.has(p.id) || typeof p.name !== 'string' || !['台北', '台南'].includes(p.city) || !['美食', '景点', '自然', '散步', '咖啡馆'].includes(p.type) || !Number.isFinite(p.lat) || !Number.isFinite(p.lng) || p.lat < 21 || p.lat > 26 || p.lng < 119 || p.lng > 123 || !p.source || !safeUrl(p.source.url) || !p.source.name || !p.source.retrievedAt) throw Error('invalid place');
      ids.add(p.id);
    }
    return rows;
  }
  function safeUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; } catch { return null; }
  }
  function validNotes(value) {
    return value && Array.isArray(value.saved) && value.saved.every(id => typeof id === 'string' || Number.isInteger(id)) && Array.isArray(value.guides) && value.guides.every(g => g && typeof g.title === 'string' && typeof g.city === 'string' && typeof g.body === 'string' && (!g.url || typeof g.url === 'string')) && value.reviews && typeof value.reviews === 'object' && !Array.isArray(value.reviews) && Object.values(value.reviews).every(rows => Array.isArray(rows) && rows.every(r => r && Number.isInteger(r.stars) && r.stars >= 1 && r.stars <= 5 && typeof r.text === 'string'));
  }
  const api = { normalize, withinBounds, filterPlaces, validPlaces, safeUrl, validNotes };
  root.PlacesModel = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window === 'undefined' ? globalThis : window);
