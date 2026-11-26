/* Isolated live-provider experiment. No local POIs, credentials storage or community writes. */
(function(root){
  'use strict';
  function text(value){return typeof value==='string'||typeof value==='number'?String(value).trim():'';}
  function normalizePoi(p={}){
    const business=p.business||p.business_info||{};
    const raw=text(business.rating||p.rating), score=raw?Number(raw):NaN;
    return {id:text(p.id),name:text(p.name)||'未命名地点',address:text(p.address)||'高德未返回地址',
      phone:text(p.tel||business.tel)||'高德未返回电话',hours:text(p.open_time||business.opentime_today||business.opentime_week)||'高德未返回营业时间',
      rating:Number.isFinite(score)&&score>=0&&score<=5?score:null,location:p.location};
  }
  function errorMessage(value){
    const code=text(value?.info||value?.message||value);
    if(/KEY|SCODE|REFERER|DOMAIN|INVALID_USER|PLATFORM/.test(code))return '高德鉴权未通过，请检查 Key 平台类型、安全密钥及域名白名单。';
    if(/LIMIT|QUOTA|FREQUENT/.test(code))return '高德调用额度或频率已达限制，请在控制台检查。';
    return '高德请求未成功，请检查网络、权限或稍后重试。';
  }
  const api={normalizePoi,errorMessage};
  if(typeof module!=='undefined')module.exports=api;
  if(!root.document)return;
  const $=s=>document.querySelector(s);
  let map, places, markers=[], calls=0, searchVersion=0, detailVersion=0, timer, connecting=false;
  const centers={taipei:[121.535,25.033],tainan:[120.202,22.994]};
  function status(message,error=false){$('#status').textContent=message;$('#status').classList.toggle('error',error);}
  function node(tag,value,className){const n=document.createElement(tag);if(value)n.textContent=value;if(className)n.className=className;return n;}
  function call(){calls+=1;$('#usage').textContent=`本页搜索／详情请求：${calls} 次`;}
  function clearMarkers(){markers.forEach(m=>map.remove(m));markers=[];}
  function show(poi){
    const p=normalizePoi(poi), box=$('#detail');box.replaceChildren(node('h2',p.name));
    const dl=document.createElement('dl');
    for(const [label,value] of [['地址',p.address],['电话',p.phone],['营业时间（高德原文）',p.hours],['高德评分',p.rating===null?'此店未返回评分':`${p.rating} / 5`]])dl.append(node('dt',label),node('dd',value));
    box.append(dl,node('p','资料由高德实时接口返回；这里不显示或编造网友评论。','small muted'));
  }
  function details(id){
    if(!places||!text(id))return;
    const version=++detailVersion;status('正在向高德读取店家详情…');call();
    places.getDetails(text(id),(state,result)=>{
      if(version!==detailVersion)return;
      const poi=result?.poiList?.pois?.[0];
      if(state!=='complete'||!poi){status(errorMessage(result),true);return;}
      show(poi);status('已取得高德店家详情。');
    });
  }
  function search(){
    if(!map||!places)return;
    clearTimeout(timer);const version=++searchVersion;status('正在搜索地图中心附近的餐馆…');call();
    places.searchNearBy('',map.getCenter(),1200,(state,result)=>{
      if(version!==searchVersion)return;
      if(state==='no_data'){clearMarkers();$('#results').replaceChildren();status('此处高德接口未返回餐馆；可移动地图后再试。');return;}
      if(state!=='complete'||!Array.isArray(result?.poiList?.pois)){status(errorMessage(result),true);return;}
      clearMarkers();const list=$('#results');list.replaceChildren();
      result.poiList.pois.slice(0,25).forEach(raw=>{
        const p=normalizePoi(raw),button=node('button',p.name,'result');button.type='button';
        button.append(node('span',p.address));button.addEventListener('click',()=>details(p.id));list.append(button);
        if(p.location){const marker=new root.AMap.Marker({position:p.location,title:p.name,map});marker.on('click',()=>details(p.id));markers.push(marker);}
      });
      status(`高德返回 ${result.poiList.pois.length} 个餐馆结果。点击地图标记或店名查看详情。`);
    });
  }
  function sdk(key,security){
    return new Promise((resolve,reject)=>{
      const script=document.createElement('script');let done=false;
      const finish=error=>{if(done)return;done=true;clearTimeout(timeout);delete root.__islandAmapReady;if(error){script.remove();reject(error);}else resolve();};
      const timeout=setTimeout(()=>finish(new Error('地图连接超时，请检查网络及 Key 后重试。')),20000);
      root._AMapSecurityConfig={securityJsCode:security};root.__islandAmapReady=()=>finish();
      script.src='https://webapi.amap.com/maps?'+new URLSearchParams({v:'2.0',key,plugin:'AMap.PlaceSearch',callback:'__islandAmapReady'});
      script.onerror=()=>finish(new Error('未能加载高德地图，请检查网络。'));document.head.append(script);
    });
  }
  $('#connect').addEventListener('submit',async event=>{
    event.preventDefault();if(connecting||map)return;
    const key=$('#amap-key').value.trim(),security=$('#amap-security').value.trim();
    if(!/^[a-f\d]{32}$/i.test(key)||!/^[a-f\d]{32}$/i.test(security)){status('请填写网页专用 Key 和配套安全密钥。',true);return;}
    connecting=true;$('#start').disabled=true;status('正在连接高德…');
    try{
      await sdk(key,security);
      if(!root.AMap?.Map||!root.AMap?.PlaceSearch)throw Error('高德组件未就绪，请检查权限后刷新重试。');
      $('#amap').replaceChildren();map=new root.AMap.Map('amap',{center:centers.taipei,zoom:16,viewMode:'2D',isHotspot:true,showLabel:true,showOversea:$('#world').checked});
      places=new root.AMap.PlaceSearch({type:'餐饮服务',pageSize:25,pageIndex:1,extensions:'all',city:'台湾',citylimit:false});
      map.on('hotspotclick',event=>details(event.id));
      map.on('moveend',()=>{++searchVersion;clearTimeout(timer);if($('#auto').checked)timer=setTimeout(search,900);});
      map.on('complete',()=>status('地图已加载。请检查是否显示台湾街道和店名，再点击店家或搜索附近餐馆。'));
      document.querySelectorAll('[data-city]').forEach(button=>{button.disabled=false;button.setAttribute('aria-pressed',String(button.dataset.city==='taipei'));});
      $('#nearby').disabled=false;$('#auto').disabled=false;$('#setup').open=false;
      $('#amap-key').value='';$('#amap-security').value='';$('#start').textContent='已连接（刷新页面可更换 Key）';
      status('已建立地图实例，正在加载台湾图面；尚未验证店家覆盖。');
    }catch(error){if(map){map.destroy();map=null;}places=null;status(error.message||errorMessage(error),true);$('#start').disabled=false;}
    finally{connecting=false;}
  });
  document.querySelectorAll('[data-city]').forEach(button=>button.addEventListener('click',()=>{
    if(!map)return;++searchVersion;++detailVersion;clearMarkers();$('#results').replaceChildren();
    document.querySelectorAll('[data-city]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));
    map.setZoomAndCenter(16,centers[button.dataset.city]);status('已切换城市。点击底图店名或搜索附近餐馆。');
  }));
  $('#nearby').addEventListener('click',search);
  $('#auto').addEventListener('change',()=>{clearTimeout(timer);if($('#auto').checked)search();});
})(typeof window==='undefined'?globalThis:window);
