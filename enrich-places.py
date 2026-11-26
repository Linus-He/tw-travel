#!/usr/bin/env python3
"""Enrich the base snapshot using explicit downloaded open-data inputs.
Run import-places.py first for a clean rebuild. No fuzzy joins or geocoding.
"""
import argparse, hashlib, importlib.util, json, math, re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('base_import', ROOT / 'import-places.py')
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)
ODBL = 'https://opendatacommons.org/licenses/odbl/1-0/'

def run():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--taipei-osm', type=Path, required=True)
    p.add_argument('--tainan-dining', type=Path, required=True)
    p.add_argument('--retrieved-at', required=True)
    a = p.parse_args()
    places = json.loads((ROOT / 'places.json').read_text())
    # Rebuild enrichment deterministically while retaining every original stable ID.
    places = [r for r in places if r['source']['id'] not in ('taipei-osm-food', 'tainan-dining')]
    manifest = json.loads((ROOT / 'sources.json').read_text())
    meta = {
      'tainan-dining': {'id':'tainan-dining','name':'臺南市政府觀光旅遊局｜美食店家',
        'publisher':'臺南市政府觀光旅遊局','url':'https://data.tainan.gov.tw/Resource/453640e4-1592-4170-af1d-f921dbe54388?handler=GoJson',
        'downloadUrl':'https://www.twtainan.net/data/shops_zh-tw.json',
        'license':base.LICENSE_NAME,'licenseUrl':base.LICENSE_URL},
      'taipei-osm-food': {'id':'taipei-osm-food','name':'OpenStreetMap｜台北餐飲',
        'publisher':'OpenStreetMap contributors','url':'https://www.openstreetmap.org/copyright',
        'downloadUrl':'https://overpass-api.de/api/interpreter','license':'Open Database License 1.0','licenseUrl':ODBL}}
    def source(sid, record, updated):
        return {**meta[sid], 'recordId':record,'retrievedAt':a.retrieved_at,'updatedAt':updated,
          'fields':['name','address','district','lat','lng','openingHours','phone','website','originalCategories'],
          'note':'開放資料快照，非即時營業狀態；缺失欄位保留空值。'}
    def common(id, name, city, district, address, lat, lng, kind, desc, hours, phone, website, src, cats):
        return dict(id=id,name=base.clean(name),city=city,district=district,address=address,
          locationLabel=('臺北市' if city=='台北' else '臺南市')+district,lat=round(float(lat),7),lng=round(float(lng),7),
          type=kind,description=base.excerpt(desc),openingHours=hours or None,phone=phone,website=base.safe_url(website),
          source=src,additionalSources=[],image=None,imageSource='',originalCategories=cats,
          categoryMethod='本站依來源餐飲分類整理；非推薦或評分排名',detailsNotice='開放資料快照；營業時間請向店家確認。')
    tainan = json.loads(a.tainan_dining.read_text('utf-8-sig'))
    old = {r['id']:r for r in places}
    excluded = Counter(); added = []
    for r in tainan:
        cats = r.get('category',[])
        if not any(c not in ('租機車','租汽車','計程車','租自行車') for c in cats):
            excluded['tainan_nonfood'] += 1; continue
        lat,lng = r.get('lat'),r.get('long')
        if not isinstance(lat,(float,int)) or not isinstance(lng,(float,int)) or not (22.8<=lat<=23.5 and 120<=lng<=120.7):
            excluded['tainan_invalid_position'] += 1; continue
        id = 'Restaurant_395000000A_'+str(r['id']).zfill(6)
        src = source('tainan-dining',str(r['id']),r.get('update_time'))
        row = common(id,r['name'],'台南',base.clean(r.get('district')),base.clean(r.get('address')),lat,lng,
          '咖啡馆' if '咖啡茶鋪' in cats or '咖啡' in r['name'] else '美食',r.get('summary') or r.get('introduction'),
          base.clean(r.get('open_time')),base.clean(r.get('tel')),'',src,cats)
        if id in old:
            original = old[id]
            if base.clean(original['name']) != row['name']:
                excluded['tainan_id_name_conflict'] += 1; continue
            # Preserve original coordinates, phone and source; supplement only known fields.
            for field in ('address','openingHours','description','originalCategories'):
                if row[field]: original[field] = row[field]
            src['fields'] = [f for f in ('address','openingHours','description','originalCategories') if row[f]]
            original['additionalSources'] = [s for s in original['additionalSources'] if s['id']!='tainan-dining'] + [src]
        else: added.append(row)
    places += added
    osm = json.loads(a.taipei_osm.read_text())
    if osm.get('remark') or not osm.get('elements') or not osm.get('osm3s',{}).get('timestamp_osm_base'):
        raise ValueError('Incomplete Overpass response')
    seen = {(r['name'],round(r['lat'],4),round(r['lng'],4)) for r in places}
    for r in sorted(osm['elements'],key=lambda x:(x['type'],x['id'])):
        t=r.get('tags',{}); center=r.get('center',r); lat,lng=center.get('lat'),center.get('lon')
        if t.get('amenity') not in ('restaurant','cafe','fast_food','food_court') or t.get('disused')=='yes' or t.get('closed')=='yes': continue
        if not isinstance(lat,(int,float)) or not isinstance(lng,(int,float)) or not (24.9<=lat<=25.25 and 121.4<=lng<=121.7): continue
        if t.get('addr:city') and t['addr:city'] not in ('台北市','臺北市','Taipei','Taipei City'): continue
        name=base.clean(t.get('name:zh') or t.get('name'))
        district=base.clean(t.get('addr:district') or t.get('addr:suburb'))
        address=base.clean(t.get('addr:full'))
        if not address and t.get('addr:street') and t.get('addr:housenumber'):
            n=base.clean(t['addr:housenumber']); address='臺北市'+district+base.clean(t['addr:street'])+n+('' if n.endswith('號') else '號')
        if not name or not address:
            excluded['osm_missing_name_or_street_address']+=1; continue
        key=(name,round(lat,4),round(lng,4))
        if key in seen: excluded['osm_duplicate']+=1; continue
        seen.add(key)
        osm_id=f"{r['type']}/{r['id']}"; src=source('taipei-osm-food',osm_id,r.get('timestamp'))
        src['url']='https://www.openstreetmap.org/'+osm_id
        src['note']='© OpenStreetMap contributors，ODbL 1.0。時間為地圖標籤原文，並非店家即時確認；資料快照時間見來源總表。'
        places.append(common('OSM_'+r['type']+'_'+str(r['id']),name,'台北',district,address,lat,lng,
          '咖啡馆' if t['amenity']=='cafe' else '美食','',base.clean(t.get('opening_hours')),base.clean(t.get('phone') or t.get('contact:phone')),
          t.get('website') or t.get('contact:website'),src,[t['amenity'],*filter(None,t.get('cuisine','').split(';'))]))
    places.sort(key=lambda r: (r['type'] not in ('美食','咖啡馆'), r['city'], r['id']))
    assert len(places)==len({r['id'] for r in places})
    assert all(math.isfinite(r['lat']) and math.isfinite(r['lng']) for r in places)
    sources=[s for s in manifest['sources'] if s['id'] not in meta]
    for sid,path in [('tainan-dining',a.tainan_dining),('taipei-osm-food',a.taipei_osm)]:
        sources.append({**meta[sid],'retrievedAt':a.retrieved_at,'datasetUpdatedAt':osm['osm3s']['timestamp_osm_base'] if sid=='taipei-osm-food' else None,
          'downloadSha256':hashlib.sha256(path.read_bytes()).hexdigest(),
          'attribution':'© OpenStreetMap contributors，資料依 ODbL 1.0 提供：'+ODBL if sid=='taipei-osm-food' else '臺南市政府觀光旅遊局，美食店家，政府資料開放授權條款第1版。',
          'note':'只收錄有具體街道地址與座標的具名餐飲點；非全量商家名錄，不代表已確認營業。' if sid=='taipei-osm-food' else '排除純租車等非餐飲類；依官方ID及店名精確比對，保留既有地點ID。'})
    for s in sources:
        s['primaryRecordsUsed']=sum(r['source']['id']==s['id'] for r in places)
        s['additionalRecordsUsed']=sum(any(x['id']==s['id'] for x in r['additionalSources']) for r in places)
        s['recordsUsed']=s['primaryRecordsUsed']+s['additionalRecordsUsed']
    manifest.update(retrievedAt=a.retrieved_at,sources=sources,formatVersion=2,
      databaseLicense={'name':'Open Database License 1.0','url':ODBL,'note':'本次整合資料庫以ODbL 1.0公開提供；各原始資料來源之署名及授權保留。可直接下載places.json。'},
      coverage={'total':len(places),'byCity':dict(Counter(r['city'] for r in places)),
        'byType':dict(Counter(r['type'] for r in places)),
        'foodByCity':dict(Counter(r['city'] for r in places if r['type'] in ('美食','咖啡馆'))),
        'fields':{f:sum(bool(r.get(f)) for r in places) for f in ('address','openingHours','phone','website')},'excluded':dict(excluded)},
      processingNotes=['台北餐飲採OSM臺北市行政邊界查詢，只納入具名、有街道地址及座標的餐館、咖啡館、快餐與美食街。',
        '台南美食依官方分類排除純租車資料；相同官方ID和名稱才補充既有資料，不依模糊店名混接分店。',
        'OSM原始標籤時間不一定存在，缺失時updatedAt為null；資料庫快照時間不冒充店家資訊更新日期。',
        '保留原始營業時間文字，沒有即時營業或價位推算；沒有導入平台評分、評論或照片。',
        '原有140個景點與60個餐飲的穩定ID保留；資料不代表所有商戶或推薦排名。'])
    for name,data in [('places.json',places),('sources.json',manifest)]:
        (ROOT/name).write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n')
    worker=ROOT/'community-worker/src/index.js'; code=worker.read_text()
    code=re.sub(r'const PLACE_CITIES = .*?;\s*$', 'const PLACE_CITIES = '+json.dumps({r['id']:r['city'] for r in places},ensure_ascii=False,separators=(',',':'))+';\n',code)
    worker.write_text(code)
    print(json.dumps(manifest['coverage'],ensure_ascii=False,indent=2))
if __name__=='__main__': run()
