/* global MonitorModel, DesktopWidgets */
const $=id=>document.getElementById(id), M=MonitorModel, W=DesktopWidgets;
let state=null,draft=null,editing=false,toastTimer,cityResults=[],selected='clock',activeTab='overview',dragging=false,enablingSensors=false;
function toast(message,error=false){$('toast').textContent=message;$('toast').className='toast'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),6500);}
async function call(method,...args){const result=await window.kindle[method](...args);if(!result.ok)throw new Error(result.error);return result.data;}
async function action(button,fn){const old=button.textContent;button.disabled=true;try{await fn();}catch(error){toast(error.message,true);}finally{button.disabled=false;button.textContent=old;}}
function renderTiles(){
 const values=state.sample?.values||{};
 $('metric-tiles').replaceChildren(...Object.entries(M.METRICS).map(([key,def])=>{
  const value=M.number(values[key]),tile=document.createElement('div');tile.className='metric-tile'+(value===null?' unavailable':'')+(def.warning&&value>=def.warning?' warning':'');
  const label=document.createElement('div');label.className='tile-label';label.textContent=def.label;
  const number=document.createElement('div');number.className='tile-value';number.textContent=M.format(value);
  if(value!==null){const unit=document.createElement('span');unit.className='tile-unit';unit.textContent=def.unit;number.append(unit);}
  const footer=document.createElement('div');footer.className='tile-footer';footer.textContent=value===null?'等待传感器':def.warning&&value>=def.warning?'温度偏高':'实时数据';
  const bar=document.createElement('div');bar.className='tile-bar';const fill=document.createElement('span');fill.style.width=(value===null?0:Math.max(0,Math.min(100,value/def.max*100)))+'%';bar.append(fill);
  tile.append(label,number,footer,bar);return tile;
 }));
}
function updatePreview(){
 if(!state||dragging)return;
 const page=W.screen(draft.orientation),grid=page.grid;
 const preview=$('kindle-preview');preview.style.aspectRatio=page.width+'/'+page.height;
 const panel=document.querySelector('.preview-panel');panel.classList.toggle('landscape',draft.orientation==='landscape');panel.classList.toggle('landscape-top-right',draft.landscapeTop==='right');
 $('preview-direction').textContent='PW5 · '+(draft.orientation==='landscape'?'横屏':'竖屏');$('preview-resolution').textContent=page.width+' × '+page.height+' / 灰阶';$('device-resolution').textContent=page.width+' × '+page.height+' · 灰阶墨水屏';
 preview.innerHTML=M.dashboardSvg(draft||state.config,{...state.sample,at:new Date().toISOString()},state.history,state.weather);
 applyPreviewZoom();
 if(activeTab!=='editor')return;
 const overlay=document.createElement('div');overlay.className='widget-overlay';
 for(const widget of draft.widgets){
  const r=W.rect(widget,draft.orientation),hit=document.createElement('button');hit.className='widget-hit'+(selected===widget.id?' selected':'');hit.title=widget.label+' · 拖动移动，同尺寸可交换';hit.setAttribute('aria-label','编辑'+widget.label);
  hit.style.left=r.x/page.width*100+'%';hit.style.top=r.y/page.height*100+'%';hit.style.width=r.width/page.width*100+'%';hit.style.height=r.height/page.height*100+'%';
  hit.onpointerdown=event=>{
   if(event.button!==0)return;event.preventDefault();selected=widget.id;renderEditor();overlay.querySelectorAll('.widget-hit').forEach(b=>b.classList.toggle('selected',b===hit));
   const x=event.clientX,y=event.clientY,bounds=preview.getBoundingClientRect();dragging=true;hit.setPointerCapture(event.pointerId);
   hit.onpointermove=move=>{hit.style.transform=`translate(${move.clientX-x}px,${move.clientY-y}px)`;};
   hit.onpointerup=up=>{hit.onpointermove=null;hit.onpointerup=null;dragging=false;const stepX=(grid.width+grid.gap)/grid.columns/page.width*bounds.width,stepY=(grid.height+grid.gap)/grid.rows/page.height*bounds.height;
    try{draft.widgets=W.move(draft.widgets,widget.id,widget.x+Math.round((up.clientX-x)/stepX),widget.y+Math.round((up.clientY-y)/stepY),draft.orientation);editing=true;}catch(error){toast(error.message,true);}updatePreview();renderEditor();};
   hit.onpointercancel=()=>{dragging=false;updatePreview();};
  };overlay.append(hit);
 }preview.append(overlay);
}
function update(next){
 state=next;if(!draft)draft=structuredClone(state.config);
 renderTiles();updatePreview();
 const weather=state.weather;
 $('weather-location').textContent=state.config.weather.name;
 $('weather-temperature').textContent=weather?M.format(weather.temperature):'—';
 $('weather-description').textContent=weather?`${weather.condition} · ${M.format(weather.low)}° / ${M.format(weather.high)}°${weather.stale?' · 缓存':''}`:'天气暂不可用';
 $('weather-icon').textContent=weather?(weather.code===0?'☀':weather.code<=3?'☁':weather.code>=51?'☂':'≋'):'☁';
 $('sample-time').textContent=state.sample?'采样 '+new Date(state.sample.at).toLocaleTimeString('zh-CN',{hour12:false}):'等待采样…';
 $('cpu-name').textContent=state.sample?.cpuName||'CPU';$('gpu-name').textContent=state.sample?.gpuName||'GPU';$('memory-total').textContent=state.sample?state.sample.memoryTotal.toFixed(1)+' GB 内存':'';
 const cpu=state.sample?.values.cpuTemp;
 $('sensor-heading').textContent=cpu==null?'连接 CPU 温度传感器':'CPU 温度已连接';
 $('sensor-message').textContent=state.sample?.messages.join(' ')||`数据来源：${state.sample?.sources.cpu||'采样中'}`;
 $('enable-sensors').textContent=enablingSensors?'正在启用…':cpu==null?'启用 CPU 温度':'采集器运行中';
 $('auto').checked=state.auto;
 $('sync-info').textContent=state.auto?`每分钟变化必推送 · 数据每 ${state.config.pushInterval} 秒`:'已暂停 · 不会自动连接设备';
 $('logs').replaceChildren(...state.logs.slice(0,12).map(log=>{const row=document.createElement('div');row.className='log '+log.level;const time=document.createElement('time');time.textContent=new Date(log.at).toLocaleTimeString('zh-CN',{hour12:false});const text=document.createElement('span');text.textContent=log.message;row.append(time,text);return row;}));
 if(!editing)fillForms();
}
function fillForms(){
 if(!draft)return;
 for(const id of ['title','note','host','port'])$(id).value=draft[id];
 $('identity-file').value=draft.identityFile;$('connection-mode').value=draft.connectionMode;$('wifi-host').value=draft.wifiHost;$('font-weight').value=draft.fontWeight;renderConnection();
 $('orientation').value=draft.orientation;$('landscape-top').value=draft.landscapeTop;$('landscape-placement').classList.toggle('hidden',draft.orientation!=='landscape');
 $('weather-name').value=draft.weather.name;$('latitude').value=draft.weather.latitude;$('longitude').value=draft.weather.longitude;$('show-weather').checked=draft.weather.enabled;
 $('interval').value=draft.pushInterval;
 $('cpu-sensor').replaceChildren(new Option('自动选择 CPU Package / Tctl/Tdie',''),...(state.sample?.sensors||[]).filter(s=>/cpu/i.test(s.id)).map(s=>new Option(`${s.name} · ${M.format(s.value)}°C`,s.id)));
 if(draft.cpuSensor&&!Array.from($('cpu-sensor').options).some(o=>o.value===draft.cpuSensor))$('cpu-sensor').add(new Option(draft.cpuSensor,draft.cpuSensor));
 $('cpu-sensor').value=draft.cpuSensor;renderEditor();
}
function renderEditor(){
 if(!draft)return;
 $('widgets-list').replaceChildren(...draft.widgets.map(widget=>{const b=document.createElement('button');b.className='widget-chip'+(widget.id===selected?' selected':'');b.textContent=widget.label;b.onclick=()=>{selected=widget.id;renderEditor();updatePreview();};return b;}));
 const current=draft.widgets.find(w=>w.id===selected);$('widget-inspector').classList.toggle('hidden',!current);
 for(const option of $('widget-size').options)option.disabled=Number(option.value.split(',')[0])>W.screen(draft.orientation).grid.columns;
 $('note-content-field').classList.toggle('hidden',current?.type!=='note');
 if(current?.type==='note')$('widget-content').value=current.content??draft.note;
 if(current){$('widget-label').value=current.label;$('widget-size').value=current.w+','+current.h;}
}
document.querySelectorAll('.nav').forEach(button=>button.onclick=()=>{
 document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b===button));
 const tab=button.dataset.tab;
 activeTab=tab;
 document.querySelector('.content-grid').classList.toggle('edit-mode',tab==='editor');
 for(const name of ['overview','editor','connection'])$(name+'-panel').classList.toggle('hidden',tab!==name);
 $('page-name').textContent=button.textContent.trim().slice(1).trim();
 const headings={overview:['桌面一览','时间、天气与电脑状态，都在这里。'],editor:['编辑桌面','像整理手机桌面一样，安排每一块小组件。'],connection:['连接 Kindle','通过 USB 或 Wi-Fi，同步每一次更新。']};
 $('heading').textContent=headings[tab][0];$('subtitle').textContent=headings[tab][1];
 updatePreview();
});
for(const id of ['title','note'])$(id).addEventListener('input',()=>{draft[id]=$(id).value;editing=true;updatePreview();});
for(const id of ['host','wifi-host','port','identity-file','interval','cpu-sensor'])$(id).addEventListener('input',()=>{editing=true;});
async function saveAll(){
 const clean={...draft,title:$('title').value,note:$('note').value,connectionMode:$('connection-mode').value,wifiHost:$('wifi-host').value.trim(),fontWeight:Number($('font-weight').value),host:$('host').value.trim(),port:Number($('port').value),identityFile:$('identity-file').value.trim(),pushInterval:Number($('interval').value),cpuSensor:$('cpu-sensor').value,weather:{name:$('weather-name').value,latitude:Number($('latitude').value),longitude:Number($('longitude').value),enabled:$('show-weather').checked}};
 draft=await call('save',clean);editing=false;toast('设置已保存');updatePreview();
}
$('save-editor').onclick=()=>action($('save-editor'),saveAll);$('save-connection').onclick=()=>action($('save-connection'),saveAll);
$('add-widget').replaceChildren(...Object.entries(W.TYPES).map(([key,label])=>new Option(label,key)));
$('add').onclick=()=>{const type=$('add-widget').value,space=W.findSpace(draft.widgets,2,1,draft.orientation);if(!space){toast('桌面空间不足，请先缩小或移除一个组件');return;}const widget={id:'widget-'+Date.now(),type,label:W.TYPES[type],...space,w:2,h:1,...(type==='note'?{content:''}:{})};draft.widgets.push(widget);selected=widget.id;editing=true;renderEditor();updatePreview();};
$('widget-label').oninput=()=>{const widget=draft.widgets.find(w=>w.id===selected);if(!widget)return;widget.label=$('widget-label').value;editing=true;updatePreview();};
$('widget-size').onchange=()=>{const size=$('widget-size').value.split(',').map(Number);try{draft.widgets=W.validate(draft.widgets.map(w=>w.id===selected?{...w,w:size[0],h:size[1]}:w),draft.orientation);editing=true;updatePreview();}catch(error){toast('该大小会重叠或越界，请先腾出空间',true);}renderEditor();};
$('remove-widget').onclick=()=>{draft.widgets=draft.widgets.filter(w=>w.id!==selected);selected=draft.widgets[0]?.id;editing=true;renderEditor();updatePreview();};
for(const [id,dx,dy]of [['move-left',-1,0],['move-up',0,-1],['move-down',0,1],['move-right',1,0]])$(id).onclick=()=>{const w=draft.widgets.find(w=>w.id===selected);if(!w)return;try{draft.widgets=W.move(draft.widgets,w.id,w.x+dx,w.y+dy,draft.orientation);editing=true;updatePreview();}catch(error){toast(error.message,true);}renderEditor();};
$('test').onclick=()=>action($('test'),async()=>{await saveAll();const result=await call('test');$('device-state').textContent=(draft.connectionMode==='wifi'?'Wi-Fi':'USBNetwork')+' 已连接';$('device-dot').classList.add('connected');toast(result.message);});
$('push').onclick=()=>action($('push'),async()=>{await saveAll();await call('push');$('device-state').textContent='已成功推送';$('device-dot').classList.add('connected');toast('Kindle 已刷新');});
$('export').onclick=()=>action($('export'),async()=>{await saveAll();if(await call('export'))toast('PNG 已导出');});
$('auto').onchange=async()=>{const enabled=$('auto').checked;try{await saveAll();await call('auto',enabled);}catch(e){$('auto').checked=state.auto;toast(e.message,true);}};
$('enable-sensors').onclick=()=>action($('enable-sensors'),async()=>{enablingSensors=true;$('enable-sensors').textContent='正在启用…';toast('请确认 Windows 管理员授权，程序会自动完成配置。');try{const result=await call('sensors');toast(result.message);}finally{enablingSensors=false;}});
$('choose-key').onclick=()=>action($('choose-key'),async()=>{const file=await call('chooseKey');if(file){$('identity-file').value=file;editing=true;}});
$('open-data').onclick=()=>call('openData').catch(e=>toast(e.message,true));
window.kindle.onState(update);call('state').then(update).catch(e=>toast(e.message,true));
function tickClock(){const now=new Date();$('clock').replaceChildren(document.createTextNode(now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})));const seconds=document.createElement('span');seconds.textContent=String(now.getSeconds()).padStart(2,'0');$('clock').append(seconds);$('today-date').textContent=now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});}
tickClock();setInterval(tickClock,1000);
for(const id of ['weather-name','latitude','longitude','show-weather'])$(id).addEventListener('input',()=>{editing=true;try{draft.weather=M.sanitize({...draft,weather:{name:$('weather-name').value,latitude:Number($('latitude').value),longitude:Number($('longitude').value),enabled:$('show-weather').checked}}).weather;updatePreview();}catch{}});
$('search-weather').onclick=()=>action($('search-weather'),async()=>{cityResults=await call('searchWeather',$('city-search').value);if(!cityResults.length){toast('未找到城市，请尝试英文名，或直接输入坐标');return;}$('city-results').replaceChildren(new Option('选择位置',''),...cityResults.map((r,i)=>new Option(r.name,i)));$('city-results').classList.remove('hidden');});
$('city-results').onchange=()=>{const selected=cityResults[Number($('city-results').value)];if(!selected||$('city-results').value==='')return;draft.weather={...selected,enabled:true};editing=true;fillForms();updatePreview();};

$('orientation').onchange=()=>{
 const next=$('orientation').value;if(next===draft.orientation)return;
 draft.layouts[draft.orientation]=structuredClone(draft.widgets);
 draft.orientation=next;draft.widgets=structuredClone(draft.layouts[next]);
 if(!draft.widgets.some(widget=>widget.id===selected))selected=draft.widgets[0]?.id;
 $('landscape-placement').classList.toggle('hidden',next!=='landscape');
 editing=true;renderEditor();updatePreview();
};
$('landscape-top').onchange=()=>{draft.landscapeTop=$('landscape-top').value;editing=true;updatePreview();};

$('background').onclick=()=>action($('background'),async()=>{await saveAll();await call('background');});

function renderConnection(){
 const wifi=$('connection-mode').value==='wifi';
 $('host').disabled=wifi;$('wifi-address-field').classList.toggle('hidden',!wifi);
 $('connection-help').textContent=wifi?'电脑与 Kindle 请连接可互通的局域网。Kindle 需已启用无线 SSH（USBNetwork 的 Wi-Fi SSH 功能），填写设备在路由器中的无线地址后检测连接；同步时可以拔掉 USB。':'先在 Kindle 启用 USBNetwork，并配置电脑侧静态 IP 和 SSH 公钥。普通 USB 磁盘模式不能实时刷屏。';
}
$('connection-mode').onchange=()=>{draft.connectionMode=$('connection-mode').value;editing=true;renderConnection();$('device-state').textContent='等待检测连接';$('device-dot').classList.remove('connected');};
$('font-weight').onchange=()=>{draft.fontWeight=Number($('font-weight').value);editing=true;updatePreview();};
$('widget-content').oninput=()=>{const widget=draft.widgets.find(w=>w.id===selected);if(widget?.type!=='note')return;widget.content=$('widget-content').value;editing=true;updatePreview();};

let previewZoom=1,previewFit=true;
function applyPreviewZoom(){
 if(!draft)return;
 const page=W.screen(draft.orientation),viewport=$('preview-viewport');
 const landscape=draft.orientation==='landscape';
 if(previewFit)previewZoom=Math.max(.1,Math.min(2,(viewport.clientWidth-48-(landscape?50:24))/page.width,(viewport.clientHeight-48-(landscape?26:50))/page.height));
 const preview=$('kindle-preview');preview.style.width=page.width*previewZoom+'px';preview.style.height=page.height*previewZoom+'px';
 $('preview-zoom-value').textContent=Math.round(previewZoom*100)+'%';
 $('preview-zoom-out').disabled=previewZoom<=.1;$('preview-zoom-in').disabled=previewZoom>=2;
}
function setPreviewZoom(zoom,point){
 if(!draft||dragging)return;
 const viewport=$('preview-viewport'),bounds=viewport.getBoundingClientRect(),before=$('kindle-preview').getBoundingClientRect();
 const x=point?.x??bounds.left+viewport.clientWidth/2,y=point?.y??bounds.top+viewport.clientHeight/2;
 const pixelX=(x-before.left)/previewZoom,pixelY=(y-before.top)/previewZoom;
 previewFit=false;previewZoom=Math.max(.1,Math.min(2,zoom));applyPreviewZoom();
 const after=$('kindle-preview').getBoundingClientRect();viewport.scrollLeft+=after.left+pixelX*previewZoom-x;viewport.scrollTop+=after.top+pixelY*previewZoom-y;
}
$('preview-fit').onclick=()=>{previewFit=true;applyPreviewZoom();$('preview-viewport').scrollTo(0,0);};
$('preview-actual').onclick=()=>setPreviewZoom(1);
$('preview-zoom-in').onclick=()=>setPreviewZoom(previewZoom+.25);
$('preview-zoom-out').onclick=()=>setPreviewZoom(previewZoom-.25);
$('preview-viewport').addEventListener('pointerdown',()=>$('preview-viewport').focus({preventScroll:true}),true);
$('preview-viewport').addEventListener('wheel',event=>{if(!event.ctrlKey)return;event.preventDefault();if(!$('preview-viewport').matches(':focus-within'))return;setPreviewZoom(previewZoom+(event.deltaY<0?.1:-.1),{x:event.clientX,y:event.clientY});},{passive:false});
$('preview-viewport').addEventListener('keydown',event=>{
 if(event.key==='+'||event.key==='='){event.preventDefault();setPreviewZoom(previewZoom+.25);}
 if(event.key==='-'){event.preventDefault();setPreviewZoom(previewZoom-.25);}
});
new ResizeObserver(()=>{if(previewFit)applyPreviewZoom();}).observe($('preview-viewport'));
