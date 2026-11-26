const {test}=require('node:test'),assert=require('node:assert/strict');
const {placesUrl,normalize,createClient,matchDetails}=require('../geoapify-lab.js');
const bounds={west:121.53,south:25.03,east:121.54,north:25.04};
const data={type:'FeatureCollection',features:[{type:'Feature',properties:{name:'赤崁208巷燒烤',place_id:'provider-id',contact:{phone:'+886 6 221 1116'},opening_hours:'17:00-25:00'},geometry:{type:'Point',coordinates:[120.202,22.994]}}]};
test('live viewport URLs constrain Taiwan streets and reject unsupported categories and world-size bounds',()=>{
 const url=new URL(placesUrl('test-key',bounds,'catering.restaurant'));
 assert.equal(url.origin,'https://api.geoapify.com');assert.equal(url.searchParams.get('filter'),'rect:121.53,25.03,121.54,25.04');
 assert.equal(url.searchParams.get('limit'),'20');assert.equal(url.searchParams.get('lang'),'zh');
 assert.throws(()=>placesUrl('key',{west:-180,south:-90,east:180,north:90},'catering.restaurant'));
 assert.throws(()=>placesUrl('key',bounds,'injected&apiKey=other'));
});
test('real Geoapify property shapes preserve contact details and missing fields without invented ratings',()=>{
 const p=normalize(data.features[0]);assert.equal(p.phone,'+886 6 221 1116');assert.equal(p.hours,'17:00-25:00');
 assert.match(p.address,/未提供/);assert.equal('rating' in p,false);
 assert.equal(normalize({properties:{datasource:{raw:{phone:'123',opening_hours:'Mo-Fr 09:00-17:00'}}}}).phone,'123');
});
test('client only calls provider endpoints, enforces a session budget and never treats auth failures as empty results',async()=>{
 const calls=[],seen=[];const c=createClient({key:'private-test-key',maxCalls:2,onCall:n=>seen.push(n),fetch:async(url,opts)=>{calls.push({url,opts});return {ok:true,json:async()=>data};}});
 assert.equal(calls.length,0);assert.equal((await c.search(bounds,'catering.restaurant')).features.length,1);
 await c.details('id/?&=');assert.equal(new URL(calls[1].url).searchParams.get('id'),'id/?&=');
 assert.equal(calls[0].opts.credentials,'omit');assert.deepEqual(seen,[1,2]);
 await assert.rejects(c.search(bounds,'catering.restaurant'),/上限/);assert.equal(calls.length,2);
 const failed=createClient({key:'key',fetch:async()=>({ok:false,status:403})});await assert.rejects(failed.details('id'),/Key/);
 const malformed=createClient({key:'key',fetch:async()=>({ok:true,json:async()=>({features:[]})})});await assert.rejects(malformed.details('id'),/格式/);
});

test('detail matching tolerates provider coordinate rounding but never joins neighboring or different OSM objects',()=>{
 const feature=(id,type,osm,featureType='details')=>({properties:{place_id:id,feature_type:featureType,name:'同名店家',datasource:{sourcename:'openstreetmap',raw:{osm_type:type,osm_id:osm}}}});
 const search=feature('search-rounded-coordinate-id','n',3923847450,'place');
 const correct=feature('detail-rounded-coordinate-id','node',3923847450);
 const neighbor=feature('other','n',3923847451),sameNumberDifferentType=feature('way-id','w',3923847450);
 assert.equal(matchDetails(search,[neighbor,sameNumberDifferentType,correct]),correct);
 assert.equal(matchDetails(search,[neighbor,sameNumberDifferentType]),undefined);
 assert.equal(matchDetails({properties:{name:'同名店家'}},[correct]),undefined);
 assert.equal(matchDetails(search,[feature('x','n',3923847450,'building')]),undefined);
 assert.equal(matchDetails(search,[feature('search-rounded-coordinate-id','n',3923847450)]).properties.place_id,'search-rounded-coordinate-id');
});
