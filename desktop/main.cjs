const {app,BrowserWindow,ipcMain,protocol,net,dialog,shell}=require('electron');
const fs=require('node:fs/promises');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const Raster=require('./render.cjs');
const Model=require('./model.cjs');
const {Sensors}=require('./sensors.cjs');
const {Transport}=require('./transport.cjs');
const {Weather}=require('./weather.cjs');
const run=promisify(execFile);
const ROOT=path.resolve(__dirname,'..');
const DATA=app.isPackaged?path.join(path.dirname(process.execPath),'Kindle Monitor Data'):path.join(ROOT,'runtime');
const RESOURCE=app.isPackaged?process.resourcesPath:path.join(ROOT,'vendor');
const SMOKE=process.argv.includes('--smoke-test');
const BENCH=process.argv.includes('--benchmark');
// One display pixel per CSS pixel also makes offscreen export independent of Windows DPI.
app.commandLine.appendSwitch('force-device-scale-factor','1');
app.setPath('userData',DATA);
app.setPath('sessionData',path.join(DATA,'chromium'));
app.setPath('crashDumps',path.join(DATA,'crashes'));
protocol.registerSchemesAsPrivileged([{scheme:'asset',privileges:{standard:true,secure:true,supportFetchAPI:true,corsEnabled:true}}]);
if(!app.requestSingleInstanceLock()) app.quit();
let window,config=Model.defaults(),sample=null,history=[],logs=[],auto=false,nextPush=0,sampling=false,exportChain=Promise.resolve(),stopping=false;
const sensors=new Sensors(DATA),transport=new Transport(),weather=new Weather();
const state=()=>({config,sample,history,logs,auto,nextPush,busy:transport.busy,weather:weather.value});
function broadcast(){if(window&&!window.isDestroyed())window.webContents.send('update',state());}
function log(message,level='info'){
  const item={at:new Date().toISOString(),message,level};logs=[item,...logs].slice(0,80);
  fs.appendFile(path.join(DATA,'activity.log'),JSON.stringify(item)+'\n').catch(()=>{});broadcast();
}
async function saveConfig(input){
  const clean=Model.sanitize(input),file=path.join(DATA,'settings.json');
  await fs.writeFile(file+'.tmp',JSON.stringify(clean,null,2),'utf8');
  await fs.rename(file+'.tmp',file);config=clean;
  weather.update(config).then(broadcast).catch(()=>{});
  if(auto)nextPush=Date.now()+config.pushInterval*1000;
  broadcast();return config;
}
async function collect(){
  if(sampling||stopping)return;
  sampling=true;
  try{
    await fs.writeFile(path.join(DATA,'heartbeat'),String(Date.now()));
    sample=await sensors.collect(config);history.push(sample);history=history.slice(-60);broadcast();
  }catch(e){log('采集失败：'+e.message,'error');}finally{sampling=false;}
}
async function renderPng(){
  // Export without another Chromium window. Keep manual export and auto-push serialized.
  const operation=exportChain.catch(()=>{}).then(async()=>{
    if(!sample)throw new Error('请等待第一轮传感器采样');
    return Raster.renderPng(config,sample,history,path.join(RESOURCE,'fonts'),path.join(DATA,'dashboard.png'),weather.value);
  });exportChain=operation;return operation;
}
let pushing=false;
async function push(){
  if(pushing)throw new Error('上一轮推送仍在进行');pushing=true;
  try{const file=await renderPng();log('正在通过 USBNetwork 推送…');const result=await transport.push(config,file);log(result.message);return result;}
  catch(e){log(e.message,'error');throw e;}finally{pushing=false;broadcast();}
}
async function enableSensors(){
  const library=path.join(RESOURCE,'lhm');
  await fs.access(path.join(library,'LibreHardwareMonitorLib.dll'));
  const current=await sensors.readHelper();
  if(current?.elevated)return {message:'传感器采集器已运行'};
  await fs.rm(path.join(DATA,'sensors.stop'),{force:true});
  const helper=app.isPackaged?path.join(process.resourcesPath,'sensors','sensor-helper.ps1'):path.join(__dirname,'sensor-helper.ps1');
  const quoted=value=>`'${String(value).replace(/'/g,"''")}'`;
  const ps=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  // UAC remains a normal Windows user prompt; this app never auto-accepts it.
  const argumentsString=`-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${helper}" -LibraryDir "${library}" -RuntimeDir "${DATA}"`;
  const script=`$ErrorActionPreference='Stop'; Start-Process -FilePath ${quoted(ps)} -Verb RunAs -WindowStyle Hidden -ArgumentList ${quoted(argumentsString)}`;
  await run(ps,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:60000});
  log('已请求启动传感器采集器，等待 CPU 温度数据');return {message:'请在 Windows 提示中确认，随后等待几秒'};
}
function handle(channel,fn){ipcMain.handle(channel,async(event,...args)=>{
  if(event.sender!==window?.webContents || event.senderFrame!==window.webContents.mainFrame)throw new Error('无效来源');
  try{return {ok:true,data:await fn(...args)};}catch(e){return {ok:false,error:e.message};}
});}
app.whenReady().then(async()=>{
  await fs.mkdir(DATA,{recursive:true});
  try{config=Model.sanitize(JSON.parse(await fs.readFile(path.join(DATA,'settings.json'),'utf8')));}catch{}
  protocol.handle('asset',request=>{
    const url=new URL(request.url),name=url.pathname==='/bold'?'MapleMono-NF-CN-Bold.ttf':'MapleMono-NF-CN-Regular.ttf';
    if(url.hostname!=='font'||!['/regular','/bold'].includes(url.pathname))return new Response('Not found',{status:404});
    return net.fetch(pathToFileURL(path.join(RESOURCE,'fonts',name)).toString());
  });
  window=new BrowserWindow({title:'Kindle Monitor',icon:path.join(__dirname,'icon.png'),width:1480,height:1000,minWidth:1120,minHeight:780,backgroundColor:'#f4f4ef',show:!SMOKE,
    autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  window.webContents.on('will-navigate',event=>event.preventDefault());
  handle('state',state);handle('save',saveConfig);handle('test-connection',()=>transport.test(config));handle('push',push);
  handle('weather-search',name=>weather.search(name));
  handle('auto',enabled=>{auto=Boolean(enabled);nextPush=auto?Date.now()+config.pushInterval*1000:0;log(auto?'已开启定时推送':'已停止定时推送');return state();});
  handle('enable-sensors',enableSensors);
  handle('choose-key',async()=>{const result=await dialog.showOpenDialog(window,{title:'选择本机 SSH 私钥',properties:['openFile']});return result.canceled?null:result.filePaths[0];});
  handle('open-data',async()=>{await shell.openPath(DATA);return true;});
  handle('export',async()=>{
    const result=await dialog.showSaveDialog(window,{title:'导出 Kindle 灰阶图片',defaultPath:path.join(DATA,'dashboard-export.png'),filters:[{name:'PNG',extensions:['png']}]});
    if(result.canceled)return null;
    const image=await renderPng();if(path.resolve(result.filePath)!==path.resolve(image))await fs.copyFile(image,result.filePath);
    const page=require('./widgets.cjs').screen(config.orientation);
    log(`已导出 ${page.width}×${page.height} 灰阶 PNG`);return result.filePath;
  });
  await window.loadFile(path.join(__dirname,'ui','index.html'));
  log('应用已启动，自动推送默认关闭');
  await collect();
  const weatherTask=weather.update(config).then(broadcast).catch(()=>{});
  const weatherTimer=setInterval(()=>weather.update(config).then(broadcast).catch(()=>{}),60000);
  const timer=setInterval(()=>collect(),3000);
  const pushTimer=setInterval(()=>{
    if(auto&&Date.now()>=nextPush&&!pushing){nextPush=Date.now()+config.pushInterval*1000;push().catch(()=>{});}
  },1000);
  window.on('closed',()=>{clearInterval(timer);clearInterval(pushTimer);clearInterval(weatherTimer);app.quit();});
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
          baseline,end,scope:'Visible Electron app with 3s real sampling, preview updates, auto-push off, 10s warmup. Electron main/renderer/GPU/utility processes counted. Short-lived NVIDIA queries and elevated helper not included in Electron app metrics; see collector benchmark.'};
        await fs.writeFile(path.join(DATA,'benchmark-electron.json'),JSON.stringify(report,null,2));
        console.log('BENCHMARK',JSON.stringify({...report,baseline:undefined,end:undefined}));app.quit();
      }
    },1000);
  }
  if(SMOKE){
    await weatherTask;
    await new Promise(r=>setTimeout(r,1600));
    await renderPng();
    await fs.writeFile(path.join(DATA,'smoke-state.json'),JSON.stringify(state(),null,2));
    await fs.writeFile(path.join(DATA,'app-preview.png'),(await window.webContents.capturePage()).toPNG());
    const check=await window.webContents.executeJavaScript(`({cards:document.querySelectorAll('.metric-tile').length,font:getComputedStyle(document.body).fontFamily,preview:document.querySelector('#kindle-preview svg')?.getAttribute('width'),bridge:!!window.kindle,node:typeof require})`);
    await fs.writeFile(path.join(DATA,'smoke-result.json'),JSON.stringify(check,null,2));
    if(check.cards!==8||!check.bridge||check.node!=='undefined'||check.preview!==String(require('./widgets.cjs').screen(config.orientation).width))throw new Error('UI smoke check failed: '+JSON.stringify(check));
    const editor=await window.webContents.executeJavaScript(`document.querySelector('.nav[data-tab="editor"]').click();({widgets:document.querySelectorAll('.widget-hit').length,inspector:!document.querySelector('#widget-inspector').classList.contains('hidden'),errors:document.querySelector('#toast').textContent})`);
    if(editor.widgets!==config.widgets.length||!editor.inspector)throw new Error('Widget editor failed');
    await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
    await fs.writeFile(path.join(DATA,'editor-preview.png'),(await window.webContents.capturePage()).toPNG());
    await fs.writeFile(path.join(DATA,'smoke-editor.json'),JSON.stringify(editor,null,2));
    const orientationChecks=[];
    for(const orientation of ['portrait','landscape']){
      const dimensions=require('./widgets.cjs').screen(orientation);
      const view=await window.webContents.executeJavaScript(`document.querySelector('#orientation').value=${JSON.stringify(orientation)};document.querySelector('#orientation').dispatchEvent(new Event('change'));({width:document.querySelector('#kindle-preview svg').getAttribute('width'),height:document.querySelector('#kindle-preview svg').getAttribute('height'),aspect:document.querySelector('#kindle-preview').style.aspectRatio,widgets:document.querySelectorAll('.widget-hit').length})`);
      if(view.width!==String(dimensions.width)||view.height!==String(dimensions.height)||view.widgets!==config.layouts[orientation].length)throw new Error('Orientation editor failed: '+JSON.stringify(view));
      await window.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
      await fs.writeFile(path.join(DATA,`editor-${orientation}.png`),(await window.webContents.capturePage()).toPNG());
      await Raster.renderPng({...config,orientation,widgets:config.layouts[orientation]},sample,history,path.join(RESOURCE,'fonts'),path.join(DATA,`dashboard-${orientation}.png`),weather.value);
      orientationChecks.push({orientation,...view});
    }
    await fs.writeFile(path.join(DATA,'smoke-orientations.json'),JSON.stringify(orientationChecks,null,2));
    console.log('SMOKE PASS',JSON.stringify(check));app.quit();
  }
}).catch(error=>{console.error(error);app.exit(1);});
app.on('before-quit',()=>{stopping=true;fs.writeFile(path.join(DATA,'sensors.stop'),'stop').catch(()=>{});});
app.on('window-all-closed',()=>app.quit());
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
