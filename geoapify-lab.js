/* Direct viewport search. Credentials/results remain in memory; no seed POIs. */
(function(root){
'use strict';
const ORIGIN='https://api.geoapify.com',CATEGORIES=new Set(['catering.restaurant','catering.cafe','catering.fast_food']);
const str=v=>typeof v==='string'||typeof v==='number'?String(v).trim():'';
function placesUrl(key,bounds,category){
  if(!CATEGORIES.has(category))throw Error('请选择支持的餐饮类别。');
  const {west,south,east,north}=bounds;
  if(![west,south,east,north].every(Number.isFinite)||west>=east||south>=north||west<119||east>123||south<21||north>26||east-west>.12||north-south>.12)throw Error('请放大到台湾街区范围后再搜索。');
  return ORIGIN+'/v2/places?'+new URLSearchParams({categories:category,filter:`rect:${west},${south},${east},${north}`,limit:20,lang:'zh',apiKey:key});
}
function normalize(feature){
 const p=feature?.properties||{},raw=p.datasource?.raw||{},contact=p.contact||{};
 const coordinates=feature?.geometry?.coordinates;
 return {id:str(p.place_id),name:str(p.name||raw['name:zh']||raw.name)||'未命名店家',
 address:str(p.formatted)||str(p.address_line2)||'来源未提供详细地址',
 phone:str(contact.phone||raw['contact:phone']||raw.phone)||'来源未提供电话',
 hours:str(p.opening_hours||raw.opening_hours)||'来源未提供营业时间',
 website:str(p.website||contact.website||raw.website||raw['contact:website']),
 coordinates:Array.isArray(coordinates)&&coordinates.length>=2&&coordinates.slice(0,2).every(Number.isFinite)?coordinates.slice(0,2):null};
}
function createClient({key,fetch:fetcher=root.fetch?.bind(root),maxCalls=60,onCall=()=>{}}){
 let calls=0;
 return {get calls(){return calls;},async get(path,params,signal){
   if(calls>=maxCalls)throw Error('已达到本页 60 次查询上限；请暂停测试。');
   if(!['/v2/places','/v2/place-details'].includes(path))throw Error('不支持的请求。');
   const url=new URL(path,ORIGIN);for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);url.searchParams.set('apiKey',key);
   calls++;onCall(calls);
   let response;try{response=await fetcher(url.href,{signal,credentials:'omit',referrerPolicy:'strict-origin-when-cross-origin'});}catch(error){if(error.name==='AbortError')throw error;throw Error('网络未能连接 Geoapify，请稍后重试。');}
   if(!response.ok)throw Error(response.status===429?'免费额度或查询频率已达限制，请检查控制台。':[401,403].includes(response.status)?'Key 或网站访问限制未通过，请检查 Geoapify 项目配置。':'Geoapify 暂时未能返回结果。');
   let value;try{value=await response.json();}catch{throw Error('服务返回内容暂不可用。');}
   if(!value||value.type!=='FeatureCollection'||!Array.isArray(value.features))throw Error('服务返回内容格式不正确。');
   return value;
 },search(bounds,category,signal){const url=new URL(placesUrl(key,bounds,category));return this.get('/v2/places',Object.fromEntries([...url.searchParams].filter(([k])=>k!=='apiKey')),signal);},
 details(id,signal){if(!str(id))throw Error('此店家没有可查询的编号。');return this.get('/v2/place-details',{id,features:'details',lang:'zh'},signal);}};
}
if(typeof module!=='undefined')module.exports={placesUrl,normalize,createClient};
if(!root.document)return;
const $=s=>document.querySelector(s),centers={taipei:[121.535,25.033],tainan:[120.202,22.994]};
let map,client,popup,results=new Map(),searchController,detailController,sequence=0,detailSequence=0,timer,connecting=false;
function status(s,error=false){$('#status').textContent=s;$('#status').classList.toggle('error',error);}
function node(tag,value,cls){const n=document.createElement(tag);if(value)n.textContent=value;if(cls)n.className=cls;return n;}
function reset(){map?.getSource('live-places')?.setData({type:'FeatureCollection',features:[]});$('#results').replaceChildren();results.clear();popup?.remove();$('#detail').replaceChildren(node('p','点击橙色标记查看当前区域的店家资料。','muted'));}
function invalidate(){sequence++;detailSequence++;searchController?.abort();detailController?.abort();clearTimeout(timer);reset();}
function show(feature){
 const p=normalize(feature),box=$('#detail');box.replaceChildren(node('h2',p.name));const dl=document.createElement('dl');
 for(const [label,value]of [['地址',p.address],['电话',p.phone],['营业时间（来源原文）',p.hours]])dl.append(node('dt',label),node('dd',value));box.append(dl);
 try{const url=new URL(p.website);if(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password){const a=node('a','店家网站 ↗');a.href=url.href;a.target='_blank';a.rel='noopener noreferrer';box.append(a);}}catch{}
 box.append(node('p','资料来源：Geoapify / OpenStreetMap；尚未逐店核实，不代表实时营业。','small muted'));
}
async function select(id){
 const feature=results.get(id);if(!feature)return;detailController?.abort();const controller=new AbortController();detailController=controller;const version=++detailSequence;
 show(feature);const p=normalize(feature);popup?.remove();if(p.coordinates)popup=new root.maplibregl.Popup().setLngLat(p.coordinates).setDOMContent(node('strong',p.name)).addTo(map);
 status('已显示搜索资料，正在补充店家详情…');
 try{const value=await client.details(id,controller.signal);if(version!==detailSequence)return;const exact=value.features.find(f=>f.properties?.place_id===id);if(exact){show({type:'Feature',geometry:exact.geometry,properties:{...feature.properties,...exact.properties}});status('已读取店家详情。');}else status('详情未返回匹配店家，保留搜索结果。');}
 catch(error){if(version===detailSequence&&error.name!=='AbortError')status(error.message+' 已保留搜索资料。',true);}
}
async function search(){
 if(!map||!client||!map.getSource('live-places'))return;
 clearTimeout(timer);searchController?.abort();detailSequence++;detailController?.abort();popup?.remove();const controller=new AbortController();searchController=controller;const version=++sequence;
 const b=map.getBounds(),bounds={west:b.getWest(),south:b.getSouth(),east:b.getEast(),north:b.getNorth()};
 status('正在查询当前地图范围…');
 try{const value=await client.search(bounds,$('#category').value,controller.signal);if(version!==sequence)return;
   reset();const features=value.features.filter(f=>normalize(f).id&&normalize(f).coordinates).slice(0,20);
   const list=$('#results');for(const f of features){const p=normalize(f);if(results.has(p.id))continue;results.set(p.id,f);const button=node('button',p.name,'result');button.type='button';button.append(node('span',p.address));button.addEventListener('click',()=>select(p.id));list.append(button);}
   map.getSource('live-places').setData({type:'FeatureCollection',features:[...results.values()]});
   status(results.size?`当前地图显示 ${results.size} 家，最多取前 20 家；放大可查找更小区域。`:'当前范围没有返回这类店家，试试附近街区。');
 }catch(error){if(version===sequence&&error.name!=='AbortError'){status(error.message,true);if(client.calls>=60)$('#auto').checked=false;}}
}
function loadSdk(){
 if(root.maplibregl)return Promise.resolve();
 return new Promise((resolve,reject)=>{const script=document.createElement('script');let done=false;const finish=error=>{if(done)return;done=true;clearTimeout(timeout);if(error){script.remove();reject(error);}else resolve();};const timeout=setTimeout(()=>finish(Error('地图组件加载超时，请刷新重试。')),20000);script.src='https://unpkg.com/maplibre-gl@5.8.0/dist/maplibre-gl.js';script.onload=()=>finish();script.onerror=()=>finish(Error('地图组件未能加载，请检查网络。'));document.head.append(script);});
}
$('#connect').addEventListener('submit',async event=>{
 event.preventDefault();if(map||connecting)return;const key=$('#geo-key').value.trim();if(!/^[a-zA-Z0-9_-]{16,128}$/.test(key)){status('请填写有效的 Geoapify Key。',true);return;}
 connecting=true;$('#start').disabled=true;status('正在连接地图…');
 try{await loadSdk();if(!root.maplibregl?.Map)throw Error('地图组件未就绪，请刷新重试。');client=createClient({key,onCall:n=>$('#usage').textContent=`店家查询：${n} / 60 次本页上限（不含底图）`});
 $('#amap').replaceChildren();map=new root.maplibregl.Map({container:'amap',style:'https://maps.geoapify.com/v1/styles/osm-bright/style.json?apiKey='+encodeURIComponent(key),center:centers.taipei,zoom:15,maxBounds:[[119,21],[123,26]],minZoom:10,attributionControl:true});map.addControl(new root.maplibregl.NavigationControl());
 map.on('error',()=>status('部分地图资源未能加载，请检查网络、Key 和免费额度。',true));
 map.on('load',()=>{map.addSource('live-places',{type:'geojson',data:{type:'FeatureCollection',features:[]}});map.addLayer({id:'live-place-dots',type:'circle',source:'live-places',paint:{'circle-radius':8,'circle-color':'#df6508','circle-stroke-color':'#fff','circle-stroke-width':2}});
 map.on('click','live-place-dots',event=>select(event.features?.[0]?.properties?.place_id));
 document.querySelectorAll('[data-city]').forEach(button=>{button.disabled=false;button.setAttribute('aria-pressed',String(button.dataset.city==='taipei'));});$('#category').disabled=false;$('#nearby').disabled=false;$('#auto').disabled=false;$('#setup').open=false;$('#geo-key').value='';$('#start').textContent='已连接（刷新页面可更换 Key）';search();});
 map.on('movestart',invalidate);map.on('moveend',()=>{if($('#auto').checked){clearTimeout(timer);timer=setTimeout(search,1000);}else status('地图范围已改变，点击刷新查询这里的店家。');});
 }catch(error){map?.remove();map=null;client=null;status(error.message,true);$('#start').disabled=false;}finally{connecting=false;}
});
document.querySelectorAll('[data-city]').forEach(button=>button.addEventListener('click',()=>{invalidate();document.querySelectorAll('[data-city]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));map.jumpTo({center:centers[button.dataset.city],zoom:15});}));
$('#nearby').addEventListener('click',search);$('#category').addEventListener('change',()=>{invalidate();search();});$('#auto').addEventListener('change',()=>{clearTimeout(timer);if($('#auto').checked)search();});
})(typeof window==='undefined'?globalThis:window);
