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
function detectedDisplay(){
 return M.connectionKey(connectionForm())===M.connectionKey(state.config)?state.connection.device:null;
}
function updatePreview(){
 if(!state||dragging||activeTab==='settings')return;
 const detected=detectedDisplay(),display=W.displayFor(draft,detected);
 const page=W.screen(draft.orientation,display),{grid,viewBox}=page;
 const preview=$('kindle-preview');preview.style.aspectRatio=page.width+'/'+page.height;
 const panel=document.querySelector('.preview-panel');panel.classList.toggle('landscape',draft.orientation==='landscape');panel.classList.toggle('landscape-top-right',draft.landscapeTop==='right');
 $('preview-direction').textContent=display.short+' · '+(draft.orientation==='landscape'?'横屏':'竖屏');
 $('preview-resolution').textContent=page.width+' × '+page.height+' / 灰阶';
 preview.innerHTML=M.dashboardSvg(draft,{...state.sample,at:new Date().toISOString(),usage:state.usage.rows},state.history,state.weather,state.availableFonts.map(font=>font.name),detected);
 applyPreviewZoom(page);
 if(activeTab!=='editor')return;
 const overlay=document.createElement('div');overlay.className='widget-overlay';
 for(const widget of draft.widgets){
  const r=W.rect(widget,draft.orientation),hit=document.createElement('button');hit.className='widget-hit'+(selected===widget.id?' selected':'');hit.title=widget.label+' · 拖动移动，同尺寸可交换';hit.setAttribute('aria-label','编辑'+widget.label);
  hit.style.left=(r.x-viewBox.x)/viewBox.width*100+'%';hit.style.top=(r.y-viewBox.y)/viewBox.height*100+'%';hit.style.width=r.width/viewBox.width*100+'%';hit.style.height=r.height/viewBox.height*100+'%';
  hit.onpointerdown=event=>{
   if(event.button!==0)return;event.preventDefault();selected=widget.id;renderEditor();overlay.querySelectorAll('.widget-hit').forEach(b=>b.classList.toggle('selected',b===hit));
   const x=event.clientX,y=event.clientY,bounds=preview.getBoundingClientRect();dragging=true;hit.setPointerCapture(event.pointerId);
   hit.onpointermove=move=>{hit.style.transform=`translate(${move.clientX-x}px,${move.clientY-y}px)`;};
   hit.onpointerup=up=>{hit.onpointermove=null;hit.onpointerup=null;dragging=false;const stepX=(grid.width+grid.gap)/grid.columns/viewBox.width*bounds.width,stepY=(grid.height+grid.gap)/grid.rows/viewBox.height*bounds.height;
    try{draft.widgets=W.move(draft.widgets,widget.id,widget.x+Math.round((up.clientX-x)/stepX),widget.y+Math.round((up.clientY-y)/stepY),draft.orientation);editing=true;}catch(error){toast(error.message,true);}updatePreview();renderEditor();};
   hit.onpointercancel=()=>{dragging=false;updatePreview();};
  };overlay.append(hit);
 }preview.append(overlay);
}
function update(next){
 state=next;if(!draft)draft=structuredClone(state.config);
 renderTiles();
 const weather=state.weather;
 $('weather-location').textContent=state.config.weather.name;
 $('weather-temperature').textContent=weather?M.format(weather.temperature):'—';
 $('weather-description').textContent=weather?`${weather.condition} · ${M.format(weather.low)}° / ${M.format(weather.high)}°${weather.stale?' · 缓存':''}`:'天气暂不可用';
 $('weather-icon').textContent=weather?(weather.code===0?'☀':weather.code<=3?'☁':weather.code>=51?'☂':'≋'):'☁';
 $('sample-time').textContent=state.sample?'采样 '+new Date(state.sample.at).toLocaleTimeString('zh-CN',{hour12:false}):'等待采样…';
 $('sample-cadence').textContent=state.config.sampleInterval+'s';
 $('cpu-name').textContent=state.sample?.cpuName||'CPU';$('gpu-name').textContent=state.sample?.gpuName||'GPU';$('memory-total').textContent=state.sample?state.sample.memoryTotal.toFixed(1)+' GB 内存':'';
 const cpu=state.sample?.values.cpuTemp;
 $('sensor-heading').textContent=cpu==null?'连接 CPU 温度传感器':'CPU 温度已连接';
 $('sensor-message').textContent=state.sample?.messages.join(' ')||`数据来源：${state.sample?.sources.cpu||'采样中'}`;
 $('enable-sensors').textContent=enablingSensors?'正在启用…':cpu==null?'启用 CPU 温度':'采集器运行中';
 $('auto').checked=state.auto;
 $('sync-info').textContent=state.auto?`每分钟变化必推送 · 数据每 ${state.config.pushInterval} 秒`:'已暂停 · 不会自动连接设备';
 $('logs').replaceChildren(...state.logs.slice(0,12).map(log=>{const row=document.createElement('div');row.className='log '+log.level;const time=document.createElement('time');time.textContent=new Date(log.at).toLocaleTimeString('zh-CN',{hour12:false});const text=document.createElement('span');text.textContent=log.message;row.append(time,text);return row;}));
 if(!editing)fillForms();
 else if(activeTab==='editor')renderWidgetUsage(draft.widgets.find(widget=>widget.id===selected));
 renderDeviceStatus();
 renderUsageSettings();
 updatePreview();
}
function connectionForm(){
 return {
  connectionMode:$('connection-mode').value,host:$('host').value.trim(),port:Number($('port').value),
  wifiHost:$('wifi-host').value.trim(),identityFile:$('identity-file').value.trim(),eipsRefresh:$('eips-refresh').checked,
  httpHost:$('http-host').value.trim(),httpPort:Number($('http-port').value),httpToken:$('http-token').value.trim()
 };
}
function renderDeviceStatus(){
 if(!state)return;
 const current=connectionForm(),key=M.connectionKey(current);
 const mode={http:'看板 HTTP',usb:'USB SSH',wifi:'Wi-Fi SSH'}[current.connectionMode];
 let {status,message}=state.connection;
 if(!key){status='unconfigured';message='请在设置中填写 Kindle 的连接信息。';}
 else if(key!==M.connectionKey(state.config)){status='unsaved';message='保存连接设置后会自动检测。';}
 const label={unconfigured:'待配置',unsaved:'待保存',idle:'等待检测',checking:'检测中',connected:'已连接',disconnected:'未连接'}[status];
 $('device-state').textContent=`${mode} · ${label}`;
 $('device-state').title=message;
 $('device-dot').classList.toggle('connected',status==='connected');
 $('device-dot').classList.toggle('disconnected',status==='disconnected');
 $('connection-status-detail').textContent=message||`${mode} · ${label}`;
 renderDisplaySettings();
}
function renderDisplaySettings(){
 const display=W.displayFor(draft,detectedDisplay()),{width,height}=display;
 $('device-name').textContent=draft.displayProfile==='auto'&&!display.detected?'Kindle · 待识别':display.name;
 $('device-resolution').textContent=`${width} × ${height} · 灰阶墨水屏`;
 const orientation=$('orientation');
 orientation.options[0].textContent=`竖屏 · ${width} × ${height}`;
 orientation.options[1].textContent=`横屏 · ${height} × ${width}`;
 $('custom-display').classList.toggle('hidden',draft.displayProfile!=='custom');
 $('display-help').textContent=draft.displayProfile!=='auto'?`手动指定 ${width} × ${height} 像素。`:
  display.detected?`${state.connection.status==='connected'?'已识别':'上次识别'} ${width} × ${height} 像素。`:'连接后按设备实测尺寸适配。暂用 Paperwhite 5 的尺寸预览。';
}
function fillForms(){
 if(!draft)return;
 for(const id of ['title','note','host','port'])$(id).value=draft[id];
 $('identity-file').value=draft.identityFile;$('connection-mode').value=draft.connectionMode;$('wifi-host').value=draft.wifiHost;$('http-host').value=draft.httpHost;$('http-port').value=draft.httpPort;$('http-token').value=draft.httpToken;$('eips-refresh').checked=draft.eipsRefresh!==false;renderConnection();
 $('orientation').value=draft.orientation;$('landscape-top').value=draft.landscapeTop;$('landscape-placement').classList.toggle('hidden',draft.orientation!=='landscape');
 $('display-profile').value=draft.displayProfile;$('display-width').value=draft.displayWidth;$('display-height').value=draft.displayHeight;
 fillWeather();
 $('interval').value=draft.pushInterval;
 $('sample-interval').value=draft.sampleInterval;
 $('cpu-sensor').replaceChildren(new Option('自动选择 CPU Package / Tctl/Tdie',''),...(state.sample?.sensors||[]).filter(s=>/cpu/i.test(s.id)).map(s=>new Option(`${s.name} · ${M.format(s.value)}°C`,s.id)));
 if(draft.cpuSensor&&!Array.from($('cpu-sensor').options).some(o=>o.value===draft.cpuSensor))$('cpu-sensor').add(new Option(draft.cpuSensor,draft.cpuSensor));
 $('cpu-sensor').value=draft.cpuSensor;renderEditor();
}
function fillWeather(){
 $('weather-name').value=draft.weather.name;
 $('latitude').value=draft.weather.latitude;
 $('longitude').value=draft.weather.longitude;
 $('show-weather').checked=draft.weather.enabled;
}
function renderEditor(){
 if(!draft)return;
 $('widgets-list').replaceChildren(...draft.widgets.map(widget=>{const b=document.createElement('button');b.className='widget-chip'+(widget.id===selected?' selected':'');b.textContent=widget.label;b.onclick=()=>{selected=widget.id;renderEditor();updatePreview();};return b;}));
 const current=draft.widgets.find(w=>w.id===selected);$('widget-inspector').classList.toggle('hidden',!current);
 renderTypography(current);
 renderWidgetUsage(current);
 for(const option of $('widget-size').options)option.disabled=Number(option.value.split(',')[0])>W.screen(draft.orientation).grid.columns;
 $('note-content-field').classList.toggle('hidden',current?.type!=='note');
 if(current?.type==='note')$('widget-content').value=current.content??draft.note;
 const isImage=current?.type==='image';
 $('widget-image-file-field').classList.toggle('hidden',!isImage);
 $('widget-image-mode-field').classList.toggle('hidden',!isImage);
 $('widget-image-view').classList.toggle('hidden',!isImage||!current.image);
 if(isImage){
  $('widget-image-mode').value=current.imageMode??'gray';
  $('widget-image-status').textContent=current.image?'已导入，可选择新文件替换':'PNG、JPG、WebP，最大 20 MB';
  const view=current.imageView??W.IMAGE_VIEW;
  for(const key of ['fit','zoom','x','y'])$('image-'+key).value=view[key];
  $('image-zoom-value').textContent=view.zoom+'%';
 }
 if(current){$('widget-label').value=current.label;$('widget-size').value=current.w+','+current.h;}
}
function renderWidgetUsage(widget){
 $('widget-usage-field').classList.toggle('hidden',widget?.type!=='usage');
 if(widget?.type!=='usage')return;
 const control=$('widget-usage-source'),value=widget.usageSource??'';
 const signature=JSON.stringify([value,state.usage.rows.map(row=>[row.id,row.name])]);
 if(control.dataset.signature===signature)return;
 control.dataset.signature=signature;
 const providers=[...new Set(state.usage.rows.map(row=>row.provider))];
 control.replaceChildren(new Option('所有已配置账号',''),
  ...providers.map(provider=>new Option(state.usage.sources[provider].name+' · 全部账号',provider)),
  ...state.usage.rows.map(row=>new Option(row.name,row.id)));
 if(value&&!Array.from(control.options).some(option=>option.value===value)){
  control.add(new Option('已移除或未配置',value));
 }
 control.value=value;
}
function renderTypography(widget){
 const visible=activeTab==='editor'&&!!widget&&widget.type!=='image';
 $('widget-typography').classList.toggle('hidden',!visible);
 $('preview-widget-name').textContent=activeTab==='editor'&&widget?' · '+widget.label:'';
 if(!visible)return;
 const family=$('widget-font-family');
 if(!family.options.length){
  const fallback=W.fallbackFonts(state.availableFonts.map(font=>font.name))[0];
  const label=state.availableFonts.find(font=>font.name===fallback)?.label;
  family.add(new Option(label?`默认（${label}）`:'默认',''));
  for(const font of state.availableFonts)family.add(new Option(font.label,font.name));
 }
 const current=widget.fontFamily??'';
 const missing=family.querySelector('[data-missing]');
 if(missing?.value!==current)missing?.remove();
 if(current&&!Array.from(family.options).some(option=>option.value===current)){
  const option=new Option(current+'（未安装，使用默认）',current);
  option.disabled=true;option.dataset.missing='';family.add(option);
 }
 family.value=current;
 const weight=$('widget-font-weight');
 weight.querySelector('[value=""]').hidden=draft.fontWeight!==400;
 weight.value=widget.fontWeight??(draft.fontWeight===400?'':700);
 $('widget-font-scale').value=widget.fontScale??W.FONT_SCALE.default;
 $('widget-font-scale-value').textContent=$('widget-font-scale').value+'%';
}
document.querySelectorAll('.nav').forEach(button=>button.onclick=()=>{
 document.querySelectorAll('.nav').forEach(b=>b.classList.toggle('active',b===button));
 const tab=button.dataset.tab;
 activeTab=tab;
 const grid=document.querySelector('.content-grid');
 grid.classList.toggle('edit-mode',tab==='editor');
 grid.classList.toggle('settings-mode',tab==='settings');
 for(const name of ['overview','editor','settings'])$(name+'-panel').classList.toggle('hidden',tab!==name);
 $('page-name').textContent=button.textContent.trim().slice(1).trim();
 const headings={overview:['桌面一览','时间、天气与电脑状态，都在这里。'],editor:['编辑桌面','添加、移动和调整组件，右侧实时预览。'],settings:['设置','管理屏幕、采集、推送、设备连接和天气。']};
 $('heading').textContent=headings[tab][0];$('subtitle').textContent=headings[tab][1];
 const widget=draft?.widgets.find(w=>w.id===selected);
 renderTypography(widget);renderWidgetUsage(widget);updatePreview();
});
for(const id of ['title','note'])$(id).addEventListener('input',()=>{draft[id]=$(id).value;editing=true;updatePreview();});
for(const id of ['host','wifi-host','port','identity-file','http-host','http-port','http-token'])$(id).addEventListener('input',()=>{editing=true;renderDeviceStatus();});
for(const id of ['interval','sample-interval','cpu-sensor'])$(id).addEventListener('input',()=>{editing=true;});
$('eips-refresh').addEventListener('change',()=>{editing=true;renderDeviceStatus();});
async function saveAll(){
 const clean={...draft,...connectionForm(),title:$('title').value,note:$('note').value,orientation:$('orientation').value,landscapeTop:$('landscape-top').value,displayWidth:Number($('display-width').value),displayHeight:Number($('display-height').value),pushInterval:Number($('interval').value),sampleInterval:Number($('sample-interval').value),cpuSensor:$('cpu-sensor').value,weather:{name:$('weather-name').value,latitude:Number($('latitude').value),longitude:Number($('longitude').value),enabled:$('show-weather').checked}};
 draft=await call('save',clean);editing=false;$('sample-cadence').textContent=draft.sampleInterval+'s';toast('设置已保存');updatePreview();
}
$('save-editor').onclick=()=>action($('save-editor'),saveAll);$('save-settings').onclick=()=>action($('save-settings'),saveAll);
$('add-widget').replaceChildren(...Object.entries(W.TYPES).map(([key,label])=>new Option(label,key)));
$('add').onclick=()=>{
 const type=$('add-widget').value;
 let width=2,height=type==='usage'?2:1,space=W.findSpace(draft.widgets,width,height,draft.orientation);
 if(!space&&height===2){height=1;space=W.findSpace(draft.widgets,width,height,draft.orientation);}
 if(!space&&['image','usage'].includes(type)){width=1;space=W.findSpace(draft.widgets,width,height,draft.orientation);}
 if(!space){toast('桌面空间不足，请先缩小或移除一个组件');return;}
 const widget={id:'widget-'+Date.now(),type,label:W.TYPES[type],...space,w:width,h:height,...(type==='note'?{content:''}:{})};
 draft.widgets.push(widget);selected=widget.id;editing=true;renderEditor();updatePreview();
};
$('widget-label').oninput=()=>{const widget=draft.widgets.find(w=>w.id===selected);if(!widget)return;widget.label=$('widget-label').value;editing=true;renderTypography(widget);updatePreview();};
$('widget-usage-source').onchange=()=>{
 const widget=draft.widgets.find(w=>w.id===selected);
 if(widget?.type!=='usage')return;
 const source=$('widget-usage-source').value;
 if(source)widget.usageSource=source;else delete widget.usageSource;
 editing=true;updatePreview();
};
$('widget-size').onchange=()=>{const size=$('widget-size').value.split(',').map(Number);try{draft.widgets=W.validate(draft.widgets.map(w=>w.id===selected?{...w,w:size[0],h:size[1]}:w),draft.orientation);editing=true;updatePreview();}catch(error){toast('该大小会重叠或越界，请先腾出空间',true);}renderEditor();};
$('remove-widget').onclick=()=>{draft.widgets=draft.widgets.filter(w=>w.id!==selected);selected=draft.widgets[0]?.id;editing=true;renderEditor();updatePreview();};
for(const [id,dx,dy]of [['move-left',-1,0],['move-up',0,-1],['move-down',0,1],['move-right',1,0]])$(id).onclick=()=>{const w=draft.widgets.find(w=>w.id===selected);if(!w)return;try{draft.widgets=W.move(draft.widgets,w.id,w.x+dx,w.y+dy,draft.orientation);editing=true;updatePreview();}catch(error){toast(error.message,true);}renderEditor();};
$('test').onclick=()=>action($('test'),async()=>{await saveAll();const result=await call('test');toast(result.message);});
$('push').onclick=()=>action($('push'),async()=>{await saveAll();await call('push');toast(draft.connectionMode==='http'?'看板已更新':'Kindle 已刷新');});
$('export').onclick=()=>action($('export'),async()=>{await saveAll();if(await call('export'))toast('PNG 已导出');});
$('auto').onchange=async()=>{const enabled=$('auto').checked;try{await saveAll();await call('auto',enabled);}catch(e){$('auto').checked=state.auto;toast(e.message,true);}};
$('enable-sensors').onclick=()=>action($('enable-sensors'),async()=>{enablingSensors=true;$('enable-sensors').textContent='正在启用…';toast('请确认 Windows 管理员授权，程序会自动完成配置。');try{const result=await call('sensors');toast(result.message);}finally{enablingSensors=false;}});
$('choose-key').onclick=()=>action($('choose-key'),async()=>{const file=await call('chooseKey');if(file){$('identity-file').value=file;editing=true;renderDeviceStatus();}});
$('open-data').onclick=()=>call('openData').catch(e=>toast(e.message,true));
window.kindle.onState(update);call('state').then(update).catch(e=>toast(e.message,true));
function tickClock(){const now=new Date();$('clock').replaceChildren(document.createTextNode(now.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})));const seconds=document.createElement('span');seconds.textContent=String(now.getSeconds()).padStart(2,'0');$('clock').append(seconds);$('today-date').textContent=now.toLocaleDateString('zh-CN',{month:'long',day:'numeric',weekday:'long'});}
tickClock();setInterval(tickClock,1000);
for(const id of ['weather-name','latitude','longitude','show-weather'])$(id).addEventListener('input',()=>{editing=true;try{draft.weather=M.sanitize({...draft,weather:{name:$('weather-name').value,latitude:Number($('latitude').value),longitude:Number($('longitude').value),enabled:$('show-weather').checked}}).weather;updatePreview();}catch{}});
$('search-weather').onclick=()=>action($('search-weather'),async()=>{cityResults=await call('searchWeather',$('city-search').value);if(!cityResults.length){toast('未找到城市，请尝试英文名，或直接输入坐标');return;}$('city-results').replaceChildren(new Option('选择位置',''),...cityResults.map((r,i)=>new Option(r.name,i)));$('city-results').classList.remove('hidden');});
$('city-results').onchange=()=>{const selected=cityResults[Number($('city-results').value)];if(!selected||$('city-results').value==='')return;draft.weather={...selected,enabled:true};editing=true;fillWeather();updatePreview();};

$('orientation').onchange=()=>{
 const next=$('orientation').value;if(next===draft.orientation)return;
 draft.layouts[draft.orientation]=structuredClone(draft.widgets);
 draft.orientation=next;draft.widgets=structuredClone(draft.layouts[next]);
 if(!draft.widgets.some(widget=>widget.id===selected))selected=draft.widgets[0]?.id;
 $('landscape-placement').classList.toggle('hidden',next!=='landscape');
 previewFit=true;editing=true;renderEditor();updatePreview();$('preview-viewport').scrollTo(0,0);
};
$('landscape-top').onchange=()=>{draft.landscapeTop=$('landscape-top').value;editing=true;updatePreview();};
$('display-profile').replaceChildren(new Option('自动识别设备','auto'),
 ...Object.entries(W.DISPLAYS).map(([key,display])=>new Option(display.name,key)),new Option('自定义分辨率','custom'));
$('display-profile').onchange=()=>{
 draft.displayProfile=$('display-profile').value;previewFit=true;editing=true;renderDisplaySettings();updatePreview();
};
for(const id of ['display-width','display-height'])$(id).oninput=()=>{
 const size=W.displaySize(Number($('display-width').value),Number($('display-height').value));
 editing=true;
 if(!size)return;
 draft.displayWidth=size.width;draft.displayHeight=size.height;previewFit=true;renderDisplaySettings();updatePreview();
};

$('background').onclick=()=>action($('background'),async()=>{await saveAll();await call('background');});

const usageDescriptions={
 codex:'使用本机的官方 Codex 桌面版或 CLI 查询。优先尝试本机登录，其他账号通过浏览器授权。',
 claude:'显示组织的 Claude Code Token 用量，按 UTC 日期统计。',
 claudePersonal:'可读取本机 Claude Code 的近期用量记录，或手动录入。使用 /usage 可更新本机记录。',
 grokBot:'手动录入每周剩余额度和重置时间。',
 xai:'查询 xAI 开发者团队的预付 API 余额。',
};
function renderUsageSettings(){
 const source=$('usage-source');
 if(!source.options.length)for(const [id,info] of Object.entries(state.usage.sources))source.add(new Option(info.name,id));
 const id=source.value,info=state.usage.sources[id],account=$('usage-account'),chosen=account.value;
 const rows=state.usage.rows.filter(row=>row.provider===id);
 const signature=JSON.stringify(rows.map(row=>[row.id,row.label]));
 if(account.dataset.signature!==signature){
  account.replaceChildren(new Option('新增账号',''),...rows.map(row=>new Option(row.label,row.id)));
  account.value=rows.some(row=>row.id===chosen)?chosen:'';
  account.dataset.signature=signature;
 }
 const row=rows.find(row=>row.id===account.value);
 $('usage-key-field').classList.toggle('hidden',info.mode!=='key');
 $('usage-team-field').classList.toggle('hidden',!info.team);
 $('usage-remaining-field').classList.toggle('hidden',info.mode!=='manual');
 $('usage-reset-field').classList.toggle('hidden',info.mode!=='manual');
 if(info.mode==='key')$('usage-key-label').textContent=info.label;
 if(info.mode==='manual')$('usage-remaining-label').textContent=info.label;
 $('usage-description').textContent=usageDescriptions[id]??'每 5 分钟向平台查询一次。';
 $('usage-save').textContent=info.mode==='login'?(row&&!row.local?'重新登录':'连接 Codex'):'保存账号';
 $('usage-save').classList.toggle('hidden',info.mode==='login'&&row?.local===true);
 $('usage-local').classList.toggle('hidden',!(info.local||state.usage.detectedKeys.includes(id))||!!row&&!row.local);
 $('usage-remove').classList.toggle('hidden',!row);
 $('usage-status').textContent=state.usage.storageError?'无法读取本机的加密凭证。':
  id==='codex'&&state.usage.loginPending?'请在浏览器完成授权。':row?`${row.value} · ${row.detail}`:'未配置';
}
function clearUsageInputs(){
 for(const id of ['usage-key','usage-team','usage-remaining','usage-reset','usage-label'])$(id).value='';
}
$('usage-source').onchange=()=>{$('usage-account').value='';clearUsageInputs();renderUsageSettings();};
$('usage-account').onchange=()=>{
 clearUsageInputs();
 $('usage-label').value=state.usage.rows.find(row=>row.id===$('usage-account').value)?.label??'';
 renderUsageSettings();
};
async function showUsageAccount(provider,id){
 update(await call('state'));
 if($('usage-source').value!==provider)return;
 $('usage-account').value=id;
 $('usage-account').onchange();
}
$('usage-save').onclick=()=>action($('usage-save'),async()=>{
 const provider=$('usage-source').value,id=$('usage-account').value,label=$('usage-label').value;
 const account=provider==='codex'?await call('loginUsage',{id,label}):await call('saveUsage',provider,{id,label,key:$('usage-key').value,team:$('usage-team').value,remaining:$('usage-remaining').value,resetsAt:$('usage-reset').value});
 await showUsageAccount(provider,account);toast('用量账号已配置');
});
$('usage-local').onclick=()=>action($('usage-local'),async()=>{
 const provider=$('usage-source').value,label=$('usage-label').value;
 const account=state.usage.sources[provider].local?await call('localUsage',provider,label):
  await call('saveUsage',provider,{environment:true,label,team:$('usage-team').value});
 await showUsageAccount(provider,account);toast('已添加本机账号');
});
$('usage-remove').onclick=()=>action($('usage-remove'),async()=>{
 await call('removeUsage',$('usage-account').value);
 clearUsageInputs();update(await call('state'));toast('用量来源已移除');
});
$('usage-refresh').onclick=()=>action($('usage-refresh'),async()=>{
 await call('refreshUsage');update(await call('state'));
});

function renderConnection(){
 const mode=$('connection-mode').value;
 const http=mode==='http', wifi=mode==='wifi';
 $('http-fields').classList.toggle('hidden',!http);
 $('ssh-fields').classList.toggle('hidden',http);
 $('host').disabled=wifi;$('wifi-address-field').classList.toggle('hidden',!wifi);
 $('connection-help').textContent=http?'在 KOReader 主菜单打开「看板模式」。把屏幕上的地址、端口和配对口令填到这里。电脑与 Kindle 需在同一 Wi-Fi，不需要 SSH。':wifi?'电脑与 Kindle 请连接可互通的局域网。Kindle 需已启用无线 SSH（USBNetwork 的 Wi-Fi SSH 功能），填写设备在路由器中的无线地址后检测连接；同步时可以拔掉 USB。':'先在 Kindle 启用 USBNetwork，并配置电脑侧静态 IP 和 SSH 公钥。普通 USB 磁盘模式不能实时刷屏。';
}
$('connection-mode').onchange=()=>{draft.connectionMode=$('connection-mode').value;editing=true;renderConnection();renderDeviceStatus();};
const fontSize=$('widget-font-scale');
fontSize.min=W.FONT_SCALE.min;fontSize.max=W.FONT_SCALE.max;
for(const [control,key] of [[$('widget-font-family'),'fontFamily'],[$('widget-font-weight'),'fontWeight'],[fontSize,'fontScale']]){
 control.addEventListener(control===fontSize?'input':'change',()=>{
  const widget=draft?.widgets.find(w=>w.id===selected);
  if(!widget||widget.type==='image')return;
  if(control.value==='')delete widget[key];
  else widget[key]=key==='fontFamily'?control.value:Number(control.value);
  editing=true;
  renderTypography(widget);
  updatePreview();
 });
}
$('widget-content').oninput=()=>{const widget=draft.widgets.find(w=>w.id===selected);if(widget?.type!=='note')return;widget.content=$('widget-content').value;editing=true;updatePreview();};
$('widget-image-file').onchange=async event=>{
 const input=event.target,file=input.files[0];
 input.value='';
 if(!file)return;
 const id=selected,orientation=draft.orientation;
 try{
  if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>20*1024*1024)throw new Error('请选择 20 MB 以内的 PNG、JPG 或 WebP 图片');
  input.disabled=true;
  const bitmap=await createImageBitmap(file);
  const canvas=document.createElement('canvas');
  const scale=Math.min(1,W.IMAGE_MAX_SIDE/Math.max(bitmap.width,bitmap.height));
  canvas.width=Math.max(1,Math.round(bitmap.width*scale));
  canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d',{alpha:false});
  try{
   ctx.fillStyle='#fff';
   ctx.fillRect(0,0,canvas.width,canvas.height);
   ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  }finally{bitmap.close();}
  const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
  W.mapImage(pixels.data,canvas.width);
  ctx.putImageData(pixels,0,0);
  const gray=canvas.toDataURL('image/png');
  W.mapImage(pixels.data,canvas.width,true);
  ctx.putImageData(pixels,0,0);
  const mono=canvas.toDataURL('image/png');
  const widgets=draft.orientation===orientation?draft.widgets:draft.layouts[orientation];
  const widget=widgets.find(w=>w.id===id&&w.type==='image');
  if(!widget)return;
  widget.image={gray,mono};
  widget.imageView={...W.IMAGE_VIEW};
  editing=true;renderEditor();updatePreview();
 }catch(error){toast('导入图片失败：'+error.message,true);}
 finally{input.disabled=false;}
};
$('widget-image-mode').onchange=()=>{
 const widget=draft.widgets.find(w=>w.id===selected);
 if(widget?.type!=='image')return;
 widget.imageMode=$('widget-image-mode').value;
 editing=true;updatePreview();
};
for(const key of ['fit','zoom','x','y'])$('image-'+key).oninput=event=>{
 const widget=draft.widgets.find(w=>w.id===selected);
 if(widget?.type!=='image'||!widget.image)return;
 const value=event.target.value;
 widget.imageView={...(widget.imageView??W.IMAGE_VIEW),[key]:key==='fit'?value:Number(value)};
 $('image-zoom-value').textContent=widget.imageView.zoom+'%';
 editing=true;updatePreview();
};
$('image-reset').onclick=()=>{
 const widget=draft.widgets.find(w=>w.id===selected);
 if(widget?.type!=='image'||!widget.image)return;
 widget.imageView={...W.IMAGE_VIEW};
 editing=true;renderEditor();updatePreview();
};

let previewZoom=1,previewFit=true;
function applyPreviewZoom(page){
 if(!draft||!state||activeTab==='settings')return;
 page??=W.screen(draft.orientation,W.displayFor(draft,detectedDisplay()));
 const viewport=$('preview-viewport');
 const preview=$('kindle-preview');
 if(previewFit){
  const device=preview.parentElement,stage=getComputedStyle(device.parentElement);
  const horizontalPadding=parseFloat(stage.paddingLeft)+parseFloat(stage.paddingRight);
  const verticalPadding=parseFloat(stage.paddingTop)+parseFloat(stage.paddingBottom);
  const availW=viewport.clientWidth-horizontalPadding-(device.offsetWidth-preview.offsetWidth)-2;
  const availH=viewport.clientHeight-verticalPadding-(device.offsetHeight-preview.offsetHeight)-2;
  previewZoom=Math.max(.05,Math.min(2,availW/page.width,availH/page.height));
 }
 const width=Math.round(page.width*previewZoom),height=Math.round(page.height*previewZoom);
 preview.style.aspectRatio=page.width+' / '+page.height;
 preview.style.width=width+'px';preview.style.height=height+'px';
 preview.style.minWidth=width+'px';preview.style.minHeight=height+'px';
 preview.style.maxWidth='none';preview.style.flex='0 0 auto';preview.style.alignSelf='flex-start';
 $('preview-zoom-value').textContent=Math.round(previewZoom*100)+'%';
 $('preview-zoom-out').disabled=previewZoom<=.05;$('preview-zoom-in').disabled=previewZoom>=2;
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
