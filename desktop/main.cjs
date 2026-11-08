const {app,BrowserWindow,ipcMain,dialog,shell,Tray,Menu,nativeImage,safeStorage}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {renderJob}=require('./render-job.cjs');
const Model=require('./model.cjs');
const Widgets=require('./widgets.cjs');
const {systemFonts}=require('./fonts.cjs');
const {Sensors}=require('./sensors.cjs');
const {enableTemperature}=require('./sensor-start.cjs');
const {Transport}=require('./transport.cjs');
const {Weather}=require('./weather.cjs');
const {Usage,REFRESH_MS}=require('./usage.cjs');
const {SyncSchedule}=require('./sync.cjs');
const sync=new SyncSchedule();
const run=promisify(execFile);
const ROOT=path.resolve(__dirname,'..');
const DATA=app.isPackaged?path.join(path.dirname(process.execPath),'Kindle Monitor Data'):path.join(ROOT,'runtime');
const RESOURCE=app.isPackaged?process.resourcesPath:path.join(ROOT,'vendor');
const SMOKE=process.argv.includes('--smoke-test');
const BENCH=process.argv.includes('--benchmark');
const MEMORY_BENCH=process.argv.includes('--benchmark-memory');
if(!process.argv.includes('--enable-gpu'))app.disableHardwareAcceleration();
// One display pixel per CSS pixel also makes offscreen export independent of Windows DPI.
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.setPath('userData',DATA);
app.setPath('sessionData',path.join(DATA,'chromium'));
app.setPath('crashDumps',path.join(DATA,'crashes'));
if(!app.requestSingleInstanceLock()) app.quit();
let window,tray,backgroundMode=false,config=Model.defaults(),sample=null,history=[],logs=[],auto=false,nextPush=0,sampling=false,exportChain=Promise.resolve(),stopping=false;
let sampleTimer,saveChain=Promise.resolve();
const sensors=new Sensors(DATA),transport=new Transport(),weather=new Weather();
const usage=new Usage(DATA,safeStorage,broadcast);
let connection={status:'idle',message:'',device:null}, connectionCheck;
let fonts=[],availableFonts=[];
const state=()=>({config,sample,history,logs,auto,nextPush,busy:transport.busy,weather:weather.value,connection,availableFonts,usage:usage.view()});
function broadcast(){if(window&&!window.isDestroyed()&&window.isVisible()&&!window.isMinimized())window.webContents.send('update',state());}
function setConnection(status,message='',device=status==='idle'?null:connection.device){
  if(connection.status===status&&connection.message===message&&connection.device?.width===device?.width&&
    connection.device?.height===device?.height&&connection.device?.model===device?.model)return;
  connection={status,message,device};
  broadcast();
}
function checkConnection(){
  const current=config,key=Model.connectionKey(current);
  if(connectionCheck?.key===key)return connectionCheck.task;
  const check={key};
  connectionCheck=check;
  if(connection.status==='idle')setConnection('checking');
  function report(status,message,device){
    if(connectionCheck===check&&Model.connectionKey(config)===key)setConnection(status,message,device??connection.device);
  }
  check.task=transport.test(current).then(result=>{
    report('connected',result.message,result.device);
    return result;
  },error=>{
    report('disconnected',error.message);
    throw error;
  }).finally(()=>{if(connectionCheck===check)connectionCheck=null;});
  return check.task;
}
function refreshConnection(){
  if(stopping||pushing||!window?.isVisible()||window.isMinimized()||!Model.connectionKey(config))return;
  void checkConnection().catch(()=>{});
}
function log(message,level='info'){
  const item={at:new Date().toISOString(),message,level};logs=[item,...logs].slice(0,80);
  fs.appendFile(path.join(DATA,'activity.log'),JSON.stringify(item)+'\n').catch(()=>{});broadcast();
}
async function saveConfig(input){
  const clean=Model.sanitize(input),file=path.join(DATA,'settings.json');
  const operation=saveChain.catch(()=>{}).then(async()=>{
    const intervalChanged=clean.sampleInterval!==config.sampleInterval;
    const connectionChanged=Model.connectionKey(clean)!==Model.connectionKey(config);
    await fs.writeFile(file+'.tmp',JSON.stringify(clean,null,2),'utf8');
    await fs.rename(file+'.tmp',file);config=clean;
    if(intervalChanged){scheduleSampling();void collect();}
    if(connectionChanged){connectionCheck=null;setConnection('idle');refreshConnection();}
    weather.update(config).then(broadcast).catch(()=>{});
    if(auto){sync.reset();nextPush=Date.now();}
    broadcast();return clean;
  });
  saveChain=operation;
  return operation;
}
function scheduleSampling(){
  clearInterval(sampleTimer);
  sampleTimer=setInterval(collect,config.sampleInterval*1000);
}
async function refreshHeartbeat(){
  try{await fs.writeFile(path.join(DATA,'heartbeat'),String(Date.now()));}
  catch(error){log('采集器心跳写入失败：'+error.message,'error');}
}
async function collect(){
  if(sampling||stopping)return;
  sampling=true;
  try{
    sample=await sensors.collect(config);
    const cutoff=Date.parse(sample.at)-180000;
    history=history.filter(point=>Date.parse(point.at)>=cutoff);
    history.push(sample);broadcast();
  }catch(e){log('采集失败：'+e.message,'error');}finally{sampling=false;}
}
async function renderPng(at=Date.now(),target=config,device=connection.device,useImage=file=>file){
  // Keep consumers serialized with rendering, since they use the same on-disk PNG.
  const operation=exportChain.catch(()=>{}).then(async()=>{
    if(!sample)throw new Error('请等待第一轮传感器采样');
    const file=await renderJob(target,{...sample,at:new Date(at).toISOString(),usage:usage.view().rows},
      history,path.join(DATA,'dashboard.png'),weather.value,fonts,device);
    return useImage(file);
  });exportChain=operation;return operation;
}
let pushing=false;
async function push(){
  if(pushing)throw new Error('上一轮推送仍在进行');pushing=true;
  const renderedAt=Date.now(),target=config,key=Model.connectionKey(target);
  try{
    const probe=await checkConnection();
    if(Model.connectionKey(config)!==key)throw new Error('连接设置已更改，请重新推送。');
    const device=probe.device??connection.device;
    const via=target.connectionMode==='http'?'看板插件':target.connectionMode==='wifi'?'Wi-Fi':'USBNetwork';
    log(`正在通过 ${via} 推送…`);
    const result=await renderPng(renderedAt,target,device,file=>{
      if(Model.connectionKey(config)!==key)throw new Error('连接设置已更改，请重新推送。');
      return transport.push(target,file,{...probe,device});
    });
    if(Model.connectionKey(target)===Model.connectionKey(config)){connectionCheck=null;setConnection('connected',result.message);}
    sync.success(renderedAt);nextPush=Date.now()+config.pushInterval*1000;log(result.message);return result;
  }
  catch(e){sync.failure(Date.now());log(e.message,'error');throw e;}finally{pushing=false;broadcast();}
}
let sensorEnableTask=null;
function enableSensors(){
  if(sensorEnableTask)return sensorEnableTask;
  sensorEnableTask=enableTemperature(DATA,RESOURCE,sensors,run,message=>log(message))
    .then(async result=>{await collect();return result;})
    .finally(()=>{sensorEnableTask=null;});
  return sensorEnableTask;
}
function handle(channel,fn){ipcMain.handle(channel,async(event,...args)=>{
  if(event.sender!==window?.webContents || event.senderFrame!==window.webContents.mainFrame)throw new Error('无效来源');
  try{return {ok:true,data:await fn(...args)};}catch(e){return {ok:false,error:e.message};}
});}
async function openWindow(){
  if(window&&!window.isDestroyed()){window.restore();window.show();window.focus();return window;}
  backgroundMode=false;
  const current=new BrowserWindow({title:'Kindle Monitor',icon:path.join(__dirname,'icon.png'),width:1480,height:900,minWidth:1080,minHeight:640,backgroundColor:'#f4f4ef',show:!SMOKE,
    autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  current.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  current.webContents.on('will-navigate',event=>event.preventDefault());
  window=current;
  current.on('closed',()=>{if(window===current)window=null;if(!backgroundMode)app.quit();});
  current.on('show',broadcast);current.on('restore',broadcast);
  await current.loadFile(path.join(__dirname,'ui','index.html'));
  return current;
}
function trayMenu(){
  return Menu.buildFromTemplate([
    {label:'打开控制面板',click:()=>openWindow().catch(e=>log(e.message,'error'))},
    {label:'立即推送',click:()=>push().catch(()=>{})},
    {label:'自动推送',type:'checkbox',checked:auto,click:item=>{auto=item.checked;sync.reset();nextPush=auto?Date.now():0;log(auto?'已开启自动同步：每分钟变化必推送':'已停止自动同步');tray.setContextMenu(trayMenu());}},
    {type:'separator'},{label:'退出',click:()=>app.quit()}
  ]);
}
function enterBackground(){
  if(stopping)return;
  if(!tray){tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'icon.png')).resize({width:16,height:16}));tray.setToolTip('Kindle Monitor · 后台采集与推送');tray.on('double-click',()=>openWindow().catch(e=>log(e.message,'error')));}
  tray.setContextMenu(trayMenu());backgroundMode=true;
  if(window&&!window.isDestroyed()){window.destroy();window=null;}
  log('后台省内存模式：控制面板已释放，采集与推送继续运行');
}
app.whenReady().then(async()=>{
  const fontTask=systemFonts();
  await fs.mkdir(DATA,{recursive:true});
  await usage.load();
  try{config=Model.sanitize(JSON.parse(await fs.readFile(path.join(DATA,'settings.json'),'utf8')));}catch{}
  fonts=await fontTask;
  availableFonts=fonts.map(({name,label})=>({name,label}));
  handle('state',state);handle('save',saveConfig);handle('test-connection',checkConnection);handle('push',push);
  handle('weather-search',name=>weather.search(name));
  handle('usage-save',(id,input)=>usage.set(id,input));
  handle('usage-remove',id=>usage.remove(id));
  handle('usage-refresh',()=>usage.refreshAll().then(()=>true));
  handle('usage-codex',input=>usage.signIn(input,url=>shell.openExternal(url)));
  handle('usage-local',(provider,label)=>usage.useLocal(provider,label));
  handle('auto',enabled=>{auto=Boolean(enabled);sync.reset();nextPush=auto?Date.now():0;if(tray)tray.setContextMenu(trayMenu());log(auto?'已开启自动同步：每分钟变化必推送':'已停止自动同步');return state();});
  handle('enable-sensors',enableSensors);
  handle('background',()=>{setTimeout(enterBackground,100);return true;});
  handle('choose-key',async()=>{const result=await dialog.showOpenDialog(window,{title:'选择本机 SSH 私钥',properties:['openFile']});return result.canceled?null:result.filePaths[0];});
  handle('open-data',async()=>{await shell.openPath(DATA);return true;});
  handle('export',async()=>{
    const result=await dialog.showSaveDialog(window,{title:'导出 Kindle 灰阶图片',defaultPath:path.join(DATA,'dashboard-export.png'),filters:[{name:'PNG',extensions:['png']}]});
    if(result.canceled)return null;
    const target=config,device=connection.device;
    await renderPng(Date.now(),target,device,async image=>{
      if(path.resolve(result.filePath)!==path.resolve(image))await fs.copyFile(image,result.filePath);
    });
    const page=Widgets.screen(target.orientation,Widgets.displayFor(target,device));
    log(`已导出 ${page.width}×${page.height} 灰阶 PNG`);return result.filePath;
  });
  await openWindow();
  refreshConnection();
  const connectionTimer=setInterval(refreshConnection,10000);
  log('应用已启动，自动推送默认关闭');
  await refreshHeartbeat();
  const heartbeatTimer=setInterval(refreshHeartbeat,10000);
  await collect();
  const weatherTask=weather.update(config).then(broadcast).catch(()=>{});
  const weatherTimer=setInterval(()=>weather.update(config).then(broadcast).catch(()=>{}),60000);
  usage.refreshAll();
  const usageTimer=setInterval(()=>usage.refreshAll(),REFRESH_MS);
  scheduleSampling();
  const pushTimer=setInterval(()=>{
    if(auto&&sync.due(Date.now(),nextPush)&&!pushing)push().catch(()=>{});
  },250);
  app.on('before-quit',()=>{clearInterval(sampleTimer);clearInterval(heartbeatTimer);clearInterval(pushTimer);clearInterval(weatherTimer);clearInterval(connectionTimer);clearInterval(usageTimer);});
  if(MEMORY_BENCH){
    const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
    async function measure(name){
      const start=Date.now(),initial=app.getAppMetrics(),rows=[];
      while(Date.now()-start<30000){await delay(1000);rows.push(app.getAppMetrics());}
      const end=rows.at(-1),seconds=(Date.now()-start)/1000;
      const summarize=key=>{const values=rows.map(row=>row.reduce((sum,item)=>sum+(item.memory[key]||0)/1024,0));return{mean:values.reduce((a,b)=>a+b,0)/values.length,max:Math.max(...values)};};
      const cpu=end.reduce((sum,item)=>sum+Math.max(0,(item.cpu.cumulativeCPUUsage||0)-(initial.find(before=>before.pid===item.pid)?.cpu.cumulativeCPUUsage||0)),0);
      return{name,seconds,privateMiB:summarize('privateBytes'),workingSetMiB:summarize('workingSetSize'),wholeMachineCpuPercent:cpu/seconds/require('node:os').cpus().length*100,processes:end.map(item=>({type:item.type,name:item.name,privateMiB:item.memory.privateBytes/1024}))};
    }
    await weatherTask;await renderPng();await delay(10000);
    const foreground=await measure('foreground-after-export');
    const before=sample.at;enterBackground();await delay(8000);await renderPng();await delay(3000);
    const background=await measure('tray-after-export');
    const continued=sample.at!==before&&!window;
    await openWindow();await delay(2000);
    const restored=await window.webContents.executeJavaScript('!!window.kindle && !!document.querySelector("#kindle-preview svg")');
    const report={at:new Date().toISOString(),hardwareAcceleration:process.argv.includes('--enable-gpu'),foreground,background,samplingContinued:continued,restored,scope:`30s each phase, ${config.sampleInterval}s sampling; one PNG export before each phase; helper measured separately; no actual USB device push.`};
    await fs.writeFile(path.join(DATA,'benchmark-memory.json'),JSON.stringify(report,null,2));console.log('MEMORY BENCHMARK',JSON.stringify(report));
    if(!continued||!restored)throw new Error('Background lifecycle failed');app.quit();
  }
  if(BENCH){
    await new Promise(r=>setTimeout(r,10000));
    const baseline=app.getAppMetrics(),start=Date.now(),measurements=[];
    const benchmarkTimer=setInterval(async()=>{
      measurements.push(app.getAppMetrics());
      if(Date.now()-start>=60000){
        clearInterval(benchmarkTimer);
        const end=measurements.at(-1),seconds=(Date.now()-start)/1000;
        const cpuSeconds=end.reduce((sum,m)=>sum+Math.max(0,(m.cpu.cumulativeCPUUsage||0)-(baseline.find(b=>b.pid===m.pid)?.cpu.cumulativeCPUUsage||0)),0);
        const workingMiB=measurements.map(ms=>ms.reduce((sum,m)=>sum+m.memory.workingSetSize/1024,0));
        const privateMiB=measurements.map(ms=>ms.reduce((sum,m)=>sum+(m.memory.privateBytes||0)/1024,0));
        const report={at:new Date().toISOString(),durationSeconds:seconds,processCount:end.length,cpuSeconds,wholeMachinePercent:cpuSeconds/seconds/require('node:os').cpus().length*100,
          workingSetSumMiB:{mean:workingMiB.reduce((a,b)=>a+b,0)/workingMiB.length,max:Math.max(...workingMiB)},privateMemorySumMiB:{mean:privateMiB.reduce((a,b)=>a+b,0)/privateMiB.length,max:Math.max(...privateMiB)},
          baseline,end,scope:`Visible Electron app with ${config.sampleInterval}s sampling, preview updates, auto-push off, 10s warmup. Electron main/renderer/GPU/utility processes counted. Short-lived NVIDIA queries and elevated helper not included in Electron app metrics; see collector benchmark.`};
        await fs.writeFile(path.join(DATA,'benchmark-electron.json'),JSON.stringify(report,null,2));
        console.log('BENCHMARK',JSON.stringify({...report,baseline:undefined,end:undefined}));app.quit();
      }
    },1000);
  }
  if(SMOKE){
    await weatherTask;
    window.webContents.send('update',state());
    await new Promise(r=>setTimeout(r,1600));
    await renderPng();
    await fs.writeFile(path.join(DATA,'smoke-state.json'),JSON.stringify(state(),null,2));
    await fs.writeFile(path.join(DATA,'app-preview.png'),(await window.webContents.capturePage()).toPNG());
    const check=await window.webContents.executeJavaScript(`({cards:document.querySelectorAll('.metric-tile').length,font:getComputedStyle(document.body).fontFamily,preview:document.querySelector('#kindle-preview svg')?.getAttribute('width'),bridge:!!window.kindle,node:typeof require})`);
    await fs.writeFile(path.join(DATA,'smoke-result.json'),JSON.stringify(check,null,2));
    if(check.cards!==8||!check.bridge||check.node!=='undefined'||check.preview!==String(require('./widgets.cjs').screen(config.orientation).width))throw new Error('UI smoke check failed: '+JSON.stringify(check));
    const editor=await window.webContents.executeJavaScript(`document.querySelector('.nav[data-tab="editor"]').click();({widgets:document.querySelectorAll('.widget-hit').length,inspector:!document.querySelector('#widget-inspector').classList.contains('hidden'),errors:document.querySelector('#toast').textContent})`);
    if(editor.widgets!==config.widgets.length||!editor.inspector)throw new Error('Widget editor failed');
    const usageCheck=await window.webContents.executeJavaScript(`(async()=>{
      const original=structuredClone(draft);
      const first=await call('saveUsage','grokBot',{label:'SMOKE_USAGE_ONE',remaining:'72'});
      const second=await call('saveUsage','grokBot',{label:'SMOKE_USAGE_TWO',remaining:'44'});
      try{
        draft.widgets=[];
        document.querySelector('#add-widget').value='usage';document.querySelector('#add').click();
        update(await call('state'));
        const preview=document.querySelector('#kindle-preview');
        const both=preview.textContent.includes('72%')&&preview.textContent.includes('44%')&&!preview.textContent.includes('OpenRouter');
        const filter=document.querySelector('#widget-usage-source');filter.value=second;filter.dispatchEvent(new Event('change'));
        const filtered=!preview.textContent.includes('72%')&&preview.textContent.includes('44%');
        await call('removeUsage',second);update(await call('state'));
        return both&&filtered&&!preview.querySelector('[data-widget]');
      }finally{await call('removeUsage',first);draft=original;selected='clock';editing=false;update(await call('state'));}
    })()`);
    const usageData=await fs.readFile(path.join(DATA,'ai-usage.bin'));
    const decrypted=await safeStorage.decryptStringAsync(usageData);
    if(!usageCheck||usageData.equals(Buffer.from('{}'))||decrypted.result!=='{}')throw new Error('AI usage display or encrypted storage failed');
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(DATA,'editor-preview.png'),(await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(DATA,'smoke-editor.json'),JSON.stringify(editor,null,2));
    const orientationChecks=[];
    for(const orientation of ['portrait','landscape']){
      const dimensions=require('./widgets.cjs').screen(orientation);
      const view=await window.webContents.executeJavaScript(`document.querySelector('#orientation').value=${JSON.stringify(orientation)};document.querySelector('#orientation').dispatchEvent(new Event('change'));({width:document.querySelector('#kindle-preview svg').getAttribute('width'),height:document.querySelector('#kindle-preview svg').getAttribute('height'),aspect:document.querySelector('#kindle-preview').style.aspectRatio,widgets:document.querySelectorAll('.widget-hit').length})`);
      if(view.width!==String(dimensions.width)||view.height!==String(dimensions.height)||view.widgets!==config.layouts[orientation].length)throw new Error('Orientation editor failed: '+JSON.stringify(view));
      const zoomCheck=await window.webContents.executeJavaScript(`(()=>{
        const widgets=JSON.stringify(draft.widgets),viewport=document.querySelector('#preview-viewport'),preview=document.querySelector('#kindle-preview');
        document.querySelector('#preview-fit').click();
        const fit=preview.getBoundingClientRect();
        const fitted=fit.width<=viewport.clientWidth&&fit.height<=viewport.clientHeight;
        document.querySelector('#preview-actual').click();
        const actual=preview.getBoundingClientRect();
        const nativeSize=Math.abs(actual.width-${dimensions.width})<1&&Math.abs(actual.height-${dimensions.height})<1;
        document.querySelector('#preview-zoom-in').click();
        const zoomed=Math.abs(preview.getBoundingClientRect().width-${dimensions.width}*1.25)<1;
        const editable=preview.querySelectorAll('.widget-hit').length===draft.widgets.length;
        viewport.focus();
        viewport.dispatchEvent(new WheelEvent('wheel',{ctrlKey:true,deltaY:100,clientX:actual.left+100,clientY:actual.top+100,bubbles:true,cancelable:true}));
        const wheelZoomed=Math.abs(preview.getBoundingClientRect().width-${dimensions.width}*1.15)<1;
        document.querySelector('#preview-fit').click();
        const fittedAgain=preview.getBoundingClientRect().height<=viewport.clientHeight;
        return{fitted,nativeSize,zoomed,editable,wheelZoomed,fittedAgain,noDialog:!document.querySelector('#preview-dialog'),layoutUnchanged:JSON.stringify(draft.widgets)===widgets};
      })()`);
      if(Object.values(zoomCheck).some(value=>!value))throw new Error('Preview zoom failed: '+JSON.stringify(zoomCheck));
      await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await fs.writeFile(path.join(DATA,`editor-${orientation}.png`),(await window.webContents.capturePage()).toPNG());
      await renderJob({...config,orientation,widgets:config.layouts[orientation]},sample,history,path.join(DATA,`dashboard-${orientation}.png`),weather.value,fonts);
      orientationChecks.push({orientation,...view,zoom:zoomCheck});
    }
    await fs.writeFile(path.join(DATA,'smoke-orientations.json'),JSON.stringify(orientationChecks,null,2));
    const contentSize=window.getContentSize();
    for(const [width,height] of [[1080,640],[1920,960]]){
      window.setContentSize(width,height);
      const layout=await window.webContents.executeJavaScript(`(async()=>{
        await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
        document.querySelector('#preview-fit').click();
        const left=document.querySelector('.left-column'),right=document.querySelector('.preview-panel'),viewport=document.querySelector('#preview-viewport');
        return {ratio:left.offsetWidth/(left.offsetWidth+right.offsetWidth),client:[viewport.clientWidth,viewport.clientHeight],scroll:[viewport.scrollWidth,viewport.scrollHeight]};
      })()`);
      await fs.writeFile(path.join(DATA,`editor-fit-${width}.png`),(await window.webContents.capturePage()).toPNG());
      if(layout.ratio<.37||layout.ratio>.45||layout.scroll.some((size,index)=>size>layout.client[index]+1))throw new Error('Editor layout failed: '+JSON.stringify({width,height,...layout}));
    }
    window.setContentSize(...contentSize);
    const customization=await window.webContents.executeJavaScript(`(()=>{
      const original=structuredClone(draft);
      selected=draft.widgets.find(w=>w.type==='note').id;renderEditor();
      const note=document.querySelector('#widget-content');note.value='第一行\\n第二行';note.dispatchEvent(new Event('input'));
      const noteSaved=M.sanitize(draft).widgets.find(w=>w.id===selected).content==='第一行\\n第二行';
      document.querySelector('.nav[data-tab="settings"]').click();
      document.querySelector('#connection-mode').value='wifi';document.querySelector('#connection-mode').dispatchEvent(new Event('change'));
      document.querySelector('#wifi-host').value='192.168.1.123';document.querySelector('#interval').value='7';
      const wifiVisible=!document.querySelector('#wifi-address-field').classList.contains('hidden');
      const usbDisabled=document.querySelector('#host').disabled;
      const seconds=Number(document.querySelector('#interval').value);
      draft=original;editing=false;fillForms();updatePreview();
      const settings=document.querySelector('#settings-panel');
      const centralized=['orientation','title','interval','sample-interval','connection-mode','weather-name','auto'].every(id=>settings.contains(document.getElementById(id)));
      const previewHidden=document.querySelector('.preview-panel').offsetWidth===0;
      return{noteSaved,wifiVisible,usbDisabled,customSeconds:seconds===7,centralized,previewHidden};
    })()`);
    if(Object.values(customization).some(value=>!value))throw new Error('Customization UI failed: '+JSON.stringify(customization));
    await fs.writeFile(path.join(DATA,'smoke-customization.json'),JSON.stringify(customization,null,2));
    await fs.writeFile(path.join(DATA,'settings-preview.png'),(await window.webContents.capturePage()).toPNG());
    const initialConfig=config;
    try{
      const updated=await window.webContents.executeJavaScript(`(async()=>{
        document.querySelector('#sample-interval').value='1';
        document.querySelector('.nav[data-tab="editor"]').click();
        const hit=document.querySelector('.widget-hit[aria-label="编辑今日便签"]');
        hit.setPointerCapture=()=>{};
        hit.dispatchEvent(new PointerEvent('pointerdown',{button:0}));
        hit.dispatchEvent(new PointerEvent('pointercancel'));
        const family=(state.availableFonts.find(font=>font.name==='Consolas')??state.availableFonts[0]).name;
        const other=document.querySelector('[data-widget="calendar"]').outerHTML;
        for(const [id,value,event] of [['widget-font-family',family,'change'],['widget-font-weight','400','change'],['widget-font-scale','115','input']]){
          const field=document.getElementById(id);field.value=value;field.dispatchEvent(new Event(event));
        }
        const note=document.querySelector('[data-widget="note"]');
        const typeVisible=document.querySelector('#widget-typography').getBoundingClientRect().height>0;
        const typography=typeVisible&&note.getAttribute('font-family').startsWith(family)&&note.getAttribute('font-weight')==='400'&&note.querySelector('text').getAttribute('font-size')==='21'&&document.querySelector('[data-widget="calendar"]').outerHTML===other;
        await saveAll();
        return {typography,family,sampling:draft.sampleInterval===1&&document.querySelector('#sample-cadence').textContent==='1s'};
      })()`);
      const saved=JSON.parse(await fs.readFile(path.join(DATA,'settings.json'),'utf8'));
      if(!updated.sampling||saved.sampleInterval!==1)throw new Error('Sampling interval failed to save or update the badge');
      const savedNote=saved.widgets.find(widget=>widget.id==='note');
      if(!updated.typography||savedNote.fontFamily!==updated.family||savedNote.fontWeight!==400||savedNote.fontScale!==115)throw new Error('Widget typography failed to preview or save');
      const before=sample.at;
      for(let i=0;i<80&&sample.at===before;i++)await new Promise(resolve=>setTimeout(resolve,100));
      if(sample.at===before)throw new Error('Sampling did not resume after changing the interval');
    }finally{await saveConfig(initialConfig);}
    await window.webContents.executeJavaScript(`(async()=>update(await call('state')))()`);
    await window.webContents.executeJavaScript('draft=structuredClone(state.config);fillForms();updatePreview()');
    const originalConnection=connection,requestForCheck=transport.request,executeForCheck=transport.execute;
    let reachable=true;
    try{
      transport.request=async()=>reachable?
        {status:200,body:'{"ok":true,"width":1680,"height":1264,"rotation":1,"model":"KindlePaperWhite6"}'}:
        {status:401,body:'{"ok":false}'};
      transport.execute=async()=>{
        if(!reachable)throw new Error('Connection refused');
        return {stdout:'geometry 1072 1448 1088 2896 8'};
      };
      for(const [mode,label] of [['http','看板 HTTP'],['usb','USB SSH'],['wifi','Wi-Fi SSH']]){
        config={...initialConfig,connectionMode:mode,httpHost:'localhost',httpToken:'SMOKETEST',wifiHost:'localhost'};
        setConnection('idle');
        for(const online of [true,false]){
          reachable=online;
          try{await checkConnection();}catch(error){if(online)throw error;}
          const view=await window.webContents.executeJavaScript(`(async()=>{
            const latest=await call('state');draft=structuredClone(latest.config);update(latest);
            const preview=document.querySelector('#kindle-preview svg');
            return {status:document.querySelector('#device-state').textContent,size:[+preview.getAttribute('width'),+preview.getAttribute('height')],orientation:draft.orientation};
          })()`);
          const expected=mode==='http'?[1264,1680]:[1072,1448];
          if(initialConfig.orientation==='landscape')expected.reverse();
          if(view.status!==`${label} · ${online?'已连接':'未连接'}`||
            view.size.some((size,index)=>size!==expected[index])||view.orientation!==initialConfig.orientation){
            throw new Error('连接状态或自动分辨率显示错误：'+JSON.stringify(view));
          }
        }
      }
    }finally{
      config=initialConfig;connection=originalConnection;
      transport.request=requestForCheck;transport.execute=executeForCheck;
    }
    await window.webContents.executeJavaScript(`(async()=>{
      const latest=await call('state');draft=structuredClone(latest.config);update(latest);
    })()`);
    const manualDisplay=await window.webContents.executeJavaScript(`(()=>{
      const original=structuredClone(draft);
      const nav=tab=>document.querySelector('.nav[data-tab="'+tab+'"]').click();
      try{
        nav('settings');
        const field=document.querySelector('#display-profile');
        field.value='scribe';field.dispatchEvent(new Event('change'));
        nav('editor');
        const preview=document.querySelector('#kindle-preview svg');
        const width=draft.orientation==='portrait'?1860:2480;
        return +preview.getAttribute('width')===width&&document.querySelector('#device-name').textContent.includes('Scribe');
      }finally{draft=original;editing=false;fillForms();renderDeviceStatus();updatePreview();}
    })()`);
    if(!manualDisplay)throw new Error('手动机型预设显示失败');
    const imageCheck=await window.webContents.executeJavaScript(`(async()=>{
      const original=structuredClone(draft);
      try{
        document.querySelector('.nav[data-tab="editor"]').click();
        draft.widgets=[];
        document.querySelector('#add-widget').value='image';
        document.querySelector('#add').click();
        const canvas=document.createElement('canvas');canvas.width=16;canvas.height=16;
        const ctx=canvas.getContext('2d');ctx.fillStyle='#808080';ctx.fillRect(0,0,16,16);
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
        const files=new DataTransfer();files.items.add(new File([blob],'smoke.png',{type:'image/png'}));
        const input=document.querySelector('#widget-image-file');input.files=files.files;
        await input.onchange({target:input});
        const mode=document.querySelector('#widget-image-mode');mode.value='mono';mode.dispatchEvent(new Event('change'));
        for(const [id,value] of [['image-fit','cover'],['image-zoom','180'],['image-x','60']]){
          const control=document.getElementById(id);control.value=value;control.dispatchEvent(new Event('input'));
        }
        const image=M.sanitize(draft).widgets.find(w=>w.type==='image');
        const rendered=document.querySelector('#kindle-preview image');
        return !!image?.image && image.imageMode==='mono' && image.imageView.fit==='cover' && image.imageView.zoom===180
          && image.imageView.x===60 && rendered?.getAttribute('href')===image.image.mono && rendered.hasAttribute('clip-path');
      }finally{draft=original;selected=draft.widgets[0]?.id;editing=false;fillForms();updatePreview();}
    })()`);
    if(!imageCheck)throw new Error('图片组件导入或预览失败');
    const before=sample.at,savedConfig=config,request=transport.request;
    let backgroundSent=false;
    enterBackground();
    config={...config,sampleInterval:1,connectionMode:'http',httpHost:'localhost',httpToken:'SMOKETEST'};
    scheduleSampling();
    transport.request=async spec=>{
      if(spec.method==='GET'&&spec.path==='/status')return {status:200,body:'{"ok":true,"width":1236,"height":1648,"rotation":0}'};
      if(spec.method!=='POST'||spec.path!=='/dashboard.png'||!spec.body?.length)throw new Error('模拟推送收到了无效请求');
      backgroundSent=true;
      return {status:200,body:'{"ok":true}'};
    };
    auto=true;nextPush=Date.now();
    for(let i=0;i<100&&(!backgroundSent||pushing||sample.at===before);i++)await new Promise(resolve=>setTimeout(resolve,100));
    auto=false;
    if(pushing||!backgroundSent)throw new Error('模拟推送超时，测试未连接真实设备');
    config=savedConfig;
    scheduleSampling();
    transport.request=request;
    const released=!app.getAppMetrics().some(item=>item.type==='Tab');
    await openWindow();await new Promise(resolve=>setTimeout(resolve,1000));
    const restored=await window.webContents.executeJavaScript('!!window.kindle && !!document.querySelector("#kindle-preview svg")');
    const backgroundCheck={rendererReleased:released,samplingContinued:sample.at!==before,scheduledPush:backgroundSent,restored};
    await fs.writeFile(path.join(DATA,'smoke-background.json'),JSON.stringify(backgroundCheck,null,2));
    if(Object.values(backgroundCheck).some(value=>!value))throw new Error('Background lifecycle failed: '+JSON.stringify(backgroundCheck));
    console.log('SMOKE PASS',JSON.stringify(check));app.quit();
  }
}).catch(error=>{console.error(error);app.exit(1);});
app.on('before-quit',()=>{stopping=true;fs.writeFile(path.join(DATA,'sensors.stop'),'stop').catch(()=>{});});
app.on('window-all-closed',()=>{if(!backgroundMode)app.quit();});
app.on('second-instance',()=>{app.whenReady().then(openWindow).catch(e=>log(e.message,'error'));});
