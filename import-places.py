#!/usr/bin/env python3
"""Import an attributed, bounded Taipei/Tainan snapshot from official open data.

No API key or third-party scraping service is needed. Run with no arguments to
refresh from the official endpoints, or provide the three downloaded input files
for a reproducible offline run. Missing details stay empty; no rating is created.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import math
import re
import tempfile
import urllib.request
from collections import Counter, defaultdict, deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zipfile import ZipFile

LICENSE_NAME = '政府資料開放授權條款－第1版'
LICENSE_URL = 'https://data.gov.tw/license'
SOURCES = {
    'tourism-attractions': {
        'name': '交通部觀光署｜景點－觀光資訊資料庫',
        'publisher': '交通部觀光署',
        'url': 'https://data.gov.tw/dataset/7777',
        'downloadUrl': 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Attraction-json.zip',
        'license': LICENSE_NAME,
        'licenseUrl': LICENSE_URL,
    },
    'tourism-restaurants': {
        'name': '交通部觀光署｜餐飲－觀光資訊資料庫',
        'publisher': '交通部觀光署',
        'url': 'https://data.gov.tw/dataset/7779',
        'downloadUrl': 'https://media.taiwan.net.tw/XMLReleaseAll_public/v2.0/Zh_tw/Restaurant-json.zip',
        'license': LICENSE_NAME,
        'licenseUrl': LICENSE_URL,
    },
    'tainan-attractions': {
        'name': '臺南市政府觀光旅遊局｜臺南景點',
        'publisher': '臺南市政府觀光旅遊局',
        'url': 'https://data.gov.tw/dataset/6183',
        'downloadUrl': 'https://www.twtainan.net/data/attractions_zh-tw.json',
        'policyUrl': 'https://www.twtainan.net/zh-tw/openapipolicy/',
        'license': LICENSE_NAME,
        'licenseUrl': LICENSE_URL,
    },
}


def clean(value):
    """Remove HTML from provider text without inventing or translating facts."""
    value = html.unescape(str(value or ''))
    value = re.sub(r'<(?:br\s*/?|/p|/div)>', '\n', value, flags=re.I)
    value = re.sub(r'<[^>]*>', '', value)
    return re.sub(r'\s+', ' ', value).strip()


def excerpt(value, limit=150):
    text = clean(value)
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + '…'


def safe_url(value):
    value = clean(value)
    return value if value.startswith(('https://', 'http://')) else ''


def classify(name, restaurant=False, source_categories=()):
    """Site navigation categories, not external ratings or recommendations."""
    if restaurant:
        return '咖啡馆' if '咖啡' in name else '美食'
    if any(word in name for word in ('步道', '古道', '自行車道', '老街', '河濱')):
        return '散步'
    if any(word in name for word in ('國家公園', '溼地', '濕地', '森林', '生態', '海岸', '海灘', '瀑布', '自然公園')):
        return '自然'
    if any(word in source_categories for word in ('自然景觀', '生態旅遊')):
        return '自然'
    return '景点'


def valid_position(row, city):
    try:
        lat, lng = float(row['PositionLat']), float(row['PositionLon'])
    except (TypeError, KeyError, ValueError):
        return False
    if not (math.isfinite(lat) and math.isfinite(lng)):
        return False
    # Broad city envelopes only reject obvious outliers, not determine ownership.
    bounds = {'臺北市': (24.90, 25.25, 121.40, 121.70),
              '臺南市': (22.80, 23.50, 120.00, 120.70)}
    south, north, west, east = bounds[city]
    return south <= lat <= north and west <= lng <= east


def round_robin(rows, count):
    """Stable IDs and district rotation avoid a popularity/rating claim."""
    groups = defaultdict(deque)
    for row in sorted(rows, key=lambda r: r.get('AttractionID', r.get('RestaurantID', ''))):
        groups[clean(row['PostalAddress'].get('Town'))].append(row)
    result = []
    while len(result) < count and any(groups.values()):
        for district in sorted(groups):
            if groups[district]:
                result.append(groups[district].popleft())
                if len(result) == count:
                    break
    return result


def source_record(source_id, updated, retrieved, record_id):
    info = SOURCES[source_id]
    return {**info, 'id': source_id, 'updatedAt': updated or None,
            'retrievedAt': retrieved, 'recordId': record_id}


def convert(row, kind, retrieved, city_rows):
    restaurant = kind == 'Restaurant'
    record_id = row[kind + 'ID']
    addr = row['PostalAddress']
    city = addr['City']
    name = clean(row[kind + 'Name'])
    district = clean(addr.get('Town'))
    street = clean(addr.get('StreetAddress'))
    address = ''.join((city, district, street)) if street else ''
    hours = clean(row.get('ServiceTimeInfo'))
    description = row.get('Description')
    updated = row.get('UpdateTime')
    source_id = 'tourism-restaurants' if restaurant else 'tourism-attractions'
    base_source = source_record(source_id, updated, retrieved, record_id)
    base_source['fields'] = ['id', 'name', 'city', 'district', 'locationLabel',
                             'lat', 'lng', 'phone', 'website']
    additional_sources = []
    supplemented_fields = []
    original_categories = []
    # National IDs retain the local Tainan identifier in their final segment.
    local_id = str(int(record_id.rsplit('_', 1)[-1]))
    local = city_rows.get(local_id) if city == '臺南市' and not restaurant else None
    if local and clean(local.get('name')) == name:
        # Supplement only the exact local-ID + exact-name match; do not fuzzy join.
        for field, value in [
            ('address', clean(local.get('address'))),
            ('openingHours', clean(local.get('open_time'))),
            ('description', clean(local.get('summary') or local.get('introduction'))),
            ('originalCategories', local.get('category')),
        ]:
            if value:
                supplemented_fields.append(field)
        address = clean(local.get('address')) or address
        hours = clean(local.get('open_time')) or hours
        description = local.get('summary') or local.get('introduction') or description
        updated = local.get('update_time') or updated
        original_categories = [clean(x) for x in local.get('category', [])]
        source_id = 'tainan-attractions'
        base_source['fields'].extend(field for field in
                                     ['address', 'openingHours', 'description', 'originalCategories']
                                     if field not in supplemented_fields)
        base_source['note'] = '觀光署原始紀錄；座標、電話等欄位仍使用此來源，更新日期與臺南補充資料分開記錄。'
        additional_sources.append(base_source)
    source = source_record(source_id, updated, retrieved,
                           local_id if additional_sources else record_id)
    source['fields'] = supplemented_fields if additional_sources else base_source['fields'] + [
        'address', 'openingHours', 'description', 'originalCategories']
    source['note'] = ('臺南官方補充資料；僅替換有值的簡介、地址、營業時間與原分類，其他欄位見 additionalSources。'
                      if additional_sources else '觀光署原始紀錄；缺失資訊保留空值，非即時營業狀態。')
    return {
        'id': record_id,
        'name': name,
        'city': {'臺北市': '台北', '臺南市': '台南'}[city],
        'district': district,
        'address': address,
        'locationLabel': city + district,
        'lat': round(float(row['PositionLat']), 7),
        'lng': round(float(row['PositionLon']), 7),
        'type': classify(name, restaurant, original_categories),
        'description': excerpt(description),
        'openingHours': hours or None,
        'phone': ' / '.join(clean(x.get('Tel')) for x in row.get('Telephones', []) if clean(x.get('Tel'))),
        'website': safe_url(row.get('WebsiteURL')),
        'source': source,
        'additionalSources': additional_sources,
        'image': None,
        'imageSource': '',
        'originalCategories': original_categories or row.get('CuisineClasses' if restaurant else 'AttractionClasses', []),
        'categoryMethod': '本站按來源資料類型與名稱關鍵字整理；非平台分類或推薦排名',
        'detailsNotice': '開放資料快照，非即時營業狀態；出發前請向店家或管理單位確認。',
    }


def download(source_id, target):
    url = SOURCES[source_id]['downloadUrl']
    request = urllib.request.Request(url, headers={'User-Agent': 'IslandRoamDataImporter/1.0 (Taiwan travel open-data snapshot)'})
    with urllib.request.urlopen(request, timeout=240) as response:
        target.write_bytes(response.read())
    return target


def read_zip(path, filename):
    with ZipFile(path) as archive:
        return json.loads(archive.read(filename).decode('utf-8-sig'))


def validate(places):
    assert places and len(places) == len({r['id'] for r in places}), 'empty or duplicate IDs'
    seen = set()
    for row in places:
        assert row['name'] and row['source']['licenseUrl'] == LICENSE_URL
        assert isinstance(row['additionalSources'], list)
        all_sources = [row['source'], *row['additionalSources']]
        assert len(all_sources) == len({source['id'] for source in all_sources})
        assert all(source['licenseUrl'] == LICENSE_URL and source['fields'] for source in all_sources)
        assert row['city'] in ('台北', '台南')
        assert row['type'] in ('景点', '美食', '自然', '散步', '咖啡馆')
        assert -90 <= row['lat'] <= 90 and -180 <= row['lng'] <= 180
        assert 'rating' not in row and row['image'] is None
        # Same name/address may still be different branches if their positions differ.
        key = (row['name'], row['city'], round(row['lat'], 5), round(row['lng'], 5))
        assert key not in seen, 'duplicate record at same position'
        seen.add(key)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--attractions-zip', type=Path)
    parser.add_argument('--restaurants-zip', type=Path)
    parser.add_argument('--tainan-json', type=Path)
    parser.add_argument('--output-dir', type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument('--retrieved-at', default=datetime.now(timezone(timedelta(hours=8))).date().isoformat())
    args = parser.parse_args()
    datetime.strptime(args.retrieved_at, '%Y-%m-%d')
    with tempfile.TemporaryDirectory(prefix='island-open-data-') as tmp:
        tmp = Path(tmp)
        paths = {
            'tourism-attractions': args.attractions_zip or download('tourism-attractions', tmp / 'Attraction-json.zip'),
            'tourism-restaurants': args.restaurants_zip or download('tourism-restaurants', tmp / 'Restaurant-json.zip'),
            'tainan-attractions': args.tainan_json or download('tainan-attractions', tmp / 'tainan-attractions.json'),
        }
        attractions = read_zip(paths['tourism-attractions'], 'AttractionList.json')
        restaurants = read_zip(paths['tourism-restaurants'], 'RestaurantList.json')
        city_data = json.loads(paths['tainan-attractions'].read_text('utf-8-sig'))
        city_rows = {str(r['id']): r for r in city_data}
        places, pool_counts = [], {}
        for city, kind, limit, data in [
            ('臺北市', 'Attraction', 80, attractions['Attractions']),
            ('臺南市', 'Attraction', 60, attractions['Attractions']),
            ('臺南市', 'Restaurant', 60, restaurants['Restaurants']),
        ]:
            eligible = [row for row in data if row.get('PostalAddress', {}).get('City') == city
                        and row.get('ServiceStatus') == 1 and valid_position(row, city)]
            pool_counts[city + '-' + kind] = len(eligible)
            for row in round_robin(eligible, limit):
                places.append(convert(row, kind, args.retrieved_at, city_rows))
        validate(places)
        by_city = Counter(row['city'] for row in places)
        by_type = Counter(row['type'] for row in places)
        source_meta = []
        for sid, source in SOURCES.items():
            updated = {'tourism-attractions': attractions['UpdateTime'],
                       'tourism-restaurants': restaurants['UpdateTime'],
                       'tainan-attractions': None}[sid]
            source_meta.append({
                **source, 'id': sid, 'retrievedAt': args.retrieved_at,
                'datasetUpdatedAt': updated,
                'downloadSha256': hashlib.sha256(paths[sid].read_bytes()).hexdigest(),
                'recordsUsed': sum(any(info['id'] == sid for info in
                                       [row['source'], *row['additionalSources']]) for row in places),
                'primaryRecordsUsed': sum(row['source']['id'] == sid for row in places),
                'additionalRecordsUsed': sum(any(info['id'] == sid for info in row['additionalSources'])
                                             for row in places),
                'countingNote': 'recordsUsed 含主來源及 additionalSources；同一地點可使用多個來源，各來源筆數不可相加作為地點總數。',
                'note': '開放資料快照，非即時營業狀態；缺失資訊不補造，圖片未匯入。',
                'attribution': f"{source['publisher']} {args.retrieved_at[:4]} {source['name']}；此開放資料依政府資料開放授權條款第1版釋出，遵守條款者得利用；授權條款：{LICENSE_URL}",
            })
        manifest = {
            'retrievedAt': args.retrieved_at,
            'formatVersion': 1,
            'coverage': {'total': len(places), 'byCity': dict(by_city), 'byType': dict(by_type), 'eligibleSourceRecords': pool_counts},
            'sources': source_meta,
            'processingNotes': [
                '首批限量收錄200筆：台北80景點、台南60景點與60餐飲；各群組依穩定來源ID排序並逐行政區輪選，非熱門榜或平台評分排名。',
                '僅保留來源標示ServiceStatus=1且在城市寬範圍座標框內的資料；此欄位非即時營業狀態。',
                '台南景點補充資料以本地ID及名稱完全相符後才合併；不做模糊合併。',
                '每筆 source 與 additionalSources 分別列出來源紀錄ID、欄位與原始更新日期；台南補充資料不覆寫觀光署座標及電話的來源日期。',
                '保留繁體來源專名、地址與營業時間原文；頁面城市分類採台北/台南，簡介移除HTML與多餘空白並截取最多150字。',
                '本站分類按來源為景點/餐飲及名稱關鍵字整理，不代表來源平台分類。',
                '台北詳細街道地址在此次全國資料中未提供，address保持空字串，locationLabel僅為官方城市與行政區。',
                '沒有提供或無法確認的營業時間保留null；不推算今天是否營業。餐飲缺少台北資料，並不表示台北沒有餐飲店家。',
                '評分與評論未導入；圖片一律null，不以示意照片冒充實地照片。',
                '來源更新日期與本次取得日期分開記錄；政府開放資料不代表提供機關背書或即時查證。',
            ],
        }
        args.output_dir.mkdir(parents=True, exist_ok=True)
        for name, content in [('places.json', places), ('sources.json', manifest)]:
            (args.output_dir / name).write_text(json.dumps(content, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        print(json.dumps(manifest['coverage'], ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
