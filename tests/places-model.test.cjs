const {test} = require('node:test');
const assert = require('node:assert/strict');
const {filterPlaces,withinBounds,validPlaces,validNotes,safeUrl} = require('../places-model.js');
const rows = [
  {id:'tpe-1',name:'臺北植物園',city:'台北',type:'自然',district:'中正區',lat:25.03,lng:121.51,source:{name:'官方',url:'https://example.org',retrievedAt:'2026-11-25'}},
  {id:'tnn-1',name:'臺南孔廟',city:'台南',type:'景点',district:'中西區',lat:22.99,lng:120.20,source:{name:'官方',url:'https://example.org',retrievedAt:'2026-11-25'}},
];
test('simplified queries match official traditional place names and districts',()=>{
  assert.equal(filterPlaces(rows,{query:'台北 植物园'}).length,1);
  assert.equal(filterPlaces(rows,{query:'中正区'}).length,1);
  assert.equal(filterPlaces([{...rows[0],name:'臺北市立美術館'}],{query:'台北市立美术馆'}).length,1);
});
test('city, category, saved and explicit geographic bounds intersect',()=>{
  const bounds={south:24.9,west:121.4,north:25.2,east:121.7};
  assert.deepEqual(filterPlaces(rows,{bounds}).map(p=>p.id),['tpe-1']);
  assert.equal(filterPlaces(rows,{city:'台南',bounds}).length,0);
  assert.equal(filterPlaces(rows,{category:'自然',onlySaved:true,saved:['tnn-1']}).length,0);
  assert.equal(filterPlaces(rows,{onlySaved:true,saved:['tpe-1']}).length,1);
  assert.equal(filterPlaces(rows,{onlySaved:true,saved:[1]}).length,0);
});
test('bounds include edge points and support crossing the antimeridian',()=>{
  assert.equal(withinBounds({lat:1,lng:180},{south:1,west:170,north:2,east:-170}),true);
  assert.equal(withinBounds({lat:1,lng:0},{south:1,west:170,north:2,east:-170}),false);
});
test('reject invalid or duplicate records and require evidence',()=>{
  assert.equal(validPlaces(rows).length,2);
  assert.throws(()=>validPlaces([rows[0],rows[0]]));
  assert.throws(()=>validPlaces([{...rows[0],lat:null}]));
  assert.throws(()=>validPlaces([{...rows[0],source:{}}]));
  assert.throws(()=>validPlaces([]));
  assert.equal(safeUrl('javascript:alert(1)'),null);
});
test('legacy notes remain valid, malformed ratings and guides are rejected',()=>{
  assert.equal(validNotes({saved:[1,'tpe-1'],reviews:{1:[{stars:5,text:'旧笔记'}]},guides:[{title:'路线',city:'台南',body:'散步'}]}),true);
  assert.equal(validNotes({saved:[],reviews:{a:[{stars:10,text:'bad'}]},guides:[]}),false);
  assert.equal(validNotes({saved:[],reviews:[],guides:[]}),false);
});
test('published data has unique real locations, evidence and no demo ratings or photos',()=>{
  const fs=require('node:fs');
  const places=validPlaces(JSON.parse(fs.readFileSync('places.json','utf8')));
  const manifest=JSON.parse(fs.readFileSync('sources.json','utf8'));
  assert.equal(places.length,manifest.coverage.total);
  assert.deepEqual(Object.fromEntries(['台北','台南'].map(city=>[city,places.filter(p=>p.city===city).length])),manifest.coverage.byCity);
  assert.ok(places.filter(p=>p.city==='台北'&&['美食','咖啡馆'].includes(p.type)).length>5000);
  assert.ok(places.filter(p=>p.city==='台南'&&['美食','咖啡馆'].includes(p.type)).length>1000);
  assert.ok(places.every(p=>!('rating' in p)&&p.image===null&&Array.isArray(p.additionalSources)));
  assert.ok(places.every(p=>p.source.license&&p.source.retrievedAt));
  assert.ok(places.filter(p=>p.additionalSources.length).length>=58);
  const osm=places.filter(p=>p.source.id==='taipei-osm-food');
  assert.ok(osm.length>5000&&osm.every(p=>p.address&&p.source.licenseUrl.includes('odbl')));
  assert.ok(manifest.databaseLicense.url.includes('odbl'));
  const original=JSON.parse(fs.readFileSync('social-posts.json','utf8'));
  assert.ok(original.every(post=>places.some(p=>p.id===post.placeId)));
  for(const source of manifest.sources){
    assert.ok(source.attribution&&safeUrl(source.licenseUrl));
    assert.equal(places.filter(p=>p.source.id===source.id||p.additionalSources.some(s=>s.id===source.id)).length,source.recordsUsed);
  }
  assert.equal(filterPlaces(places,{query:'台北市立美术馆'}).length,1);
});
