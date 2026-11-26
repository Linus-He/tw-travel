const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {normalizePoi}=require('../amap-lab.js');

test('missing provider ratings remain missing and provider phone/address are not invented',()=>{
  assert.equal(normalizePoi({business_info:{rating:''}}).rating,null);
  assert.equal(normalizePoi({business:{rating:'4.6'}}).rating,4.6);
  assert.equal(normalizePoi({business:{rating:'9'}}).rating,null);
  assert.match(normalizePoi({}).hours,/未返回/);
});
function setup(){
  const elements=new Map(),scripts=[],requests=[],details=[];
  function element(){return {value:'',checked:false,disabled:true,children:[],attrs:{},events:{},classList:{toggle(){}},
    addEventListener(k,fn){this.events[k]=fn;},append(...values){this.children.push(...values);},replaceChildren(...values){this.children=values;},
    setAttribute(k,v){this.attrs[k]=v;},remove(){},textContent:''};}
  const ids=['connect','setup','start','amap','amap-key','amap-security','world','nearby','auto','status','usage','detail','results'];
  ids.forEach(id=>elements.set('#'+id,element()));
  const cities=['taipei','tainan'].map(city=>Object.assign(element(),{dataset:{city}}));
  const map={events:{},on(k,fn){this.events[k]=fn;},getCenter(){return [121.535,25.033];},remove(){},destroy(){},setZoomAndCenter(){this.events.moveend?.();}};
  const context={URLSearchParams,setTimeout,clearTimeout,document:{querySelector:id=>elements.get(id),querySelectorAll:()=>cities,
    createElement:()=>element(),head:{append(s){scripts.push(s);}}},AMap:{Map:function(){return map;},PlaceSearch:function(){return {
      searchNearBy(...args){requests.push(args.at(-1));},getDetails(id,cb){details.push({id,cb});}};},Marker:class{on(){}}}};
  context.window=context;vm.createContext(context);vm.runInContext(fs.readFileSync('amap-lab.js','utf8'),context);
  return {context,e:elements,scripts,requests,details,map,cities,async connect(){elements.get('#amap-key').value='a'.repeat(32);elements.get('#amap-security').value='b'.repeat(32);
    const p=elements.get('#connect').events.submit({preventDefault(){}});context.__islandAmapReady();await p;}};
}
test('experiment makes no request before explicit connection and never imports local POIs or stores credentials',async()=>{
  const s=setup();assert.equal(s.scripts.length,0);assert.equal(s.requests.length,0);
  await s.connect();const url=new URL(s.scripts[0].src);assert.equal(url.origin,'https://webapi.amap.com');
  assert.equal(url.searchParams.get('key'),'a'.repeat(32));assert.equal(url.searchParams.has('jscode'),false);
  assert.equal(s.e.get('#amap-key').value,'');assert.equal(s.e.get('#amap-security').value,'');
  assert.equal(s.requests.length,0,'connecting must not silently start paid searches');
  s.map.events.hotspotclick({id:'provider-poi'});assert.equal(s.details[0].id,'provider-poi');
  s.details[0].cb('complete',{poiList:{pois:[{name:'<script>店家</script>',address:'来源地址',business_info:{rating:'4.3'}}]}});
  assert.equal(s.e.get('#detail').children[0].textContent,'<script>店家</script>');
});
test('latest nearby search wins and no-data clears results instead of showing fake local data',async()=>{
  const s=setup();await s.connect();s.e.get('#nearby').events.click();s.e.get('#nearby').events.click();
  s.requests[1]('complete',{poiList:{pois:[{id:'b',name:'较新结果',address:'地址'}]}});
  s.requests[0]('complete',{poiList:{pois:[{id:'a',name:'过期结果'}]}});
  assert.equal(s.e.get('#results').children[0].textContent,'较新结果');
  s.e.get('#nearby').events.click();s.requests[2]('no_data',{});
  assert.equal(s.e.get('#results').children.length,0);assert.match(s.e.get('#status').textContent,/未返回/);
});
