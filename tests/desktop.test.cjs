const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {PNG}=require('pngjs');
const M=require('../desktop/model.cjs'),W=require('../desktop/widgets.cjs');
const {parseNvidia,selectCpuSensor,Sensors}=require('../desktop/sensors.cjs');
const {Transport,argsFor,deviceImage,payloadFor,installCommand,httpCall}=require('../desktop/transport.cjs');
const Raster=require('../desktop/render.cjs');
const {conditions}=require('../desktop/weather.cjs');
const ROOT=path.resolve(__dirname,'..');
test.before(async()=>{await fs.mkdir(path.join(ROOT,'out'),{recursive:true});});
test('widgets cannot overlap or leave the grid; moving same-sized widgets swaps them',()=>{
 const widgets=W.defaults(),swapped=W.move(widgets,'clock',0,2);
 assert.equal(swapped.find(w=>w.id==='cpu').y,0);assert.equal(swapped.find(w=>w.id==='clock').y,2);
 assert.equal(widgets[0].x,0);
 const groupSwap=W.move(widgets,'weather',2,1);
 assert.equal(groupSwap.find(w=>w.id==='calendar').y,0);
 assert.equal(groupSwap.find(w=>w.id==='note').y,0);
 assert.throws(()=>W.move(widgets,'clock',3,0));assert.throws(()=>W.move(widgets,'clock',1,1));
 assert.throws(()=>W.validate([...widgets,{...widgets[0]}]));
 assert.deepEqual(W.findSpace(widgets.filter(w=>w.id==='clock'),2,1),{x:2,y:0});
});
test('configuration rejects command injection, invalid coordinates, unknown or duplicate widgets',()=>{
 assert.throws(()=>M.sanitize({...M.defaults(),host:'host;cmd'}));
 assert.throws(()=>M.sanitize({...M.defaults(),weather:{latitude:100,longitude:2}}));
 assert.throws(()=>M.sanitize({...M.defaults(),widgets:[{id:'a',type:'evil',x:0,y:0,w:1,h:1}]}));
 assert.equal(argsFor({...M.defaults(),connectionMode:'usb'}).args.includes('StrictHostKeyChecking=yes'),true);
 assert.equal(M.defaults().connectionMode,'http');
 assert.equal(M.sanitize({httpPort:8686,httpToken:'abcDEF12'}).httpToken,'abcDEF12');
 assert.throws(()=>M.sanitize({httpToken:'口令 带空格'}));
 assert.throws(()=>M.sanitize({httpHost:'bad host'}));
 assert.equal(M.sanitize({eipsRefresh:false}).eipsRefresh,false);
 assert.equal(M.sanitize({}).eipsRefresh,true);
});
test('SVG escapes editable text, uses Maple, and retains clock/weather/footer',()=>{
 const c=M.defaults();c.title='<script>&';c.note='测试留言';const s={at:'2026-11-06T10:00:00Z',hostname:'<host>',values:{gpuTemp:37}};
 const svg=M.dashboardSvg(c,s,[],{temperature:25,condition:'多云',low:22,high:29});
 assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;&amp;'));assert.ok(svg.includes('Maple Mono NF CN'));assert.ok(svg.includes('25°'));assert.ok(svg.includes('测试留言'));
});
test('NVIDIA N/A and invalid zero-degree CPU readings never become fake temperatures',()=>{
 assert.equal(parseNvidia('RTX 5070, N/A, 3, 1000, 12000, 28').gpuTemp,null);
 assert.equal(parseNvidia('RTX 5070, 37, 3, 1000, 12000, 28').gpuLoad,3);
 assert.equal(selectCpuSensor([{id:'/amdcpu/0/temperature/2',name:'Core (Tctl/Tdie)',type:'Temperature',value:0}]),null);
 const sensors=[{id:'/cpu/0/1',name:'CPU Package',type:'Temperature',value:55},{id:'/cpu/0/2',name:'CPU Core',type:'Temperature',value:60}];
 assert.equal(selectCpuSensor(sensors).value,55);assert.equal(selectCpuSensor(sensors,'/cpu/0/2').value,60);
});
test('live helper uses discrete NVIDIA GPU instead of integrated GPU and avoids CLI spawning',async()=>{
 const dir=await fs.mkdtemp(path.join(ROOT,'out','sensor-test-'));
 try{
  await fs.writeFile(path.join(dir,'sensors.json'),JSON.stringify({at:new Date().toISOString(),gpus:[{id:'/gpu-nvidia/0',name:'RTX 5070'}],sensors:[
   {id:'/gpu-amd/0/temperature/0',name:'GPU Core',type:'Temperature',value:50},
   {id:'/gpu-nvidia/0/temperature/0',name:'GPU Core',type:'Temperature',value:37},
   {id:'/gpu-nvidia/0/load/0',name:'GPU Core',type:'Load',value:4}]}));
  let calls=0;const collector=new Sensors(dir,async()=>{calls++;throw Error('should not spawn');});const s=await collector.collect({});
  assert.equal(s.values.gpuTemp,37);assert.equal(s.gpuName,'RTX 5070');assert.equal(s.values.gpuLoad,4);assert.equal(calls,0);
  await fs.writeFile(path.join(dir,'sensors.json'),JSON.stringify({at:'2000-01-01',sensors:[]}));assert.equal(await collector.readHelper(),null);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('raster export is full-size grayscale, contains footer, and failed SCP never replaces live file',async()=>{
 const dir=await fs.mkdtemp(path.join(ROOT,'out','render-test-')),image=path.join(dir,'dashboard.png');
 try{
  await Raster.renderPng(M.defaults(),{at:'2026-11-06T10:00:00Z',values:{gpuTemp:37}},[],path.join(ROOT,'vendor/fonts'),image);
  const buf=await fs.readFile(image),png=PNG.sync.read(buf);assert.equal(png.width,1236);assert.equal(png.height,1648);assert.equal(buf[25],0);
  const pixel=(x,y)=>png.data[(y*png.width+x)*4];assert.ok(pixel(500,1572)<100,'footer rule must be present below the monitor height');
  const calls=[];const transport=new Transport(async(file,args)=>{calls.push({file,args});if(file.endsWith('scp.exe'))throw {stderr:'upload failed'};return{stdout:''};});
  await assert.rejects(transport.push({...M.defaults(),connectionMode:'usb'},image),/upload failed/);assert.equal(transport.busy,false);
  assert.ok(!calls.some(c=>c.args.some(a=>a.includes('&& mv'))));assert.ok(calls.at(-1).args.some(a=>a.startsWith('rm -f')));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('weather code mapping covers clear, rain and thunderstorm',()=>{assert.equal(conditions(0),'晴');assert.equal(conditions(81),'阵雨');assert.equal(conditions(95),'雷雨');});
test('orientation-specific layouts survive switching and old configurations remain portrait',()=>{
 const legacy=M.defaults();delete legacy.orientation;delete legacy.layouts;
 assert.equal(M.sanitize(legacy).orientation,'portrait');
 let config=M.defaults();config.widgets[0].label='我的时钟';config=M.sanitize(config);
 const landscape=M.sanitize({...config,orientation:'landscape',widgets:config.layouts.landscape});
 landscape.widgets.find(w=>w.id==='cpu').label='横屏 CPU';
 const saved=M.sanitize(JSON.parse(JSON.stringify(landscape)));
 assert.equal(saved.layouts.portrait[0].label,'我的时钟');
 assert.equal(saved.layouts.landscape.find(w=>w.id==='cpu').label,'横屏 CPU');
 const portrait=M.sanitize({...saved,orientation:'portrait',widgets:saved.layouts.portrait});
 assert.equal(portrait.widgets[0].label,'我的时钟');
 assert.equal(portrait.layouts.landscape.find(w=>w.id==='cpu').label,'横屏 CPU');
 assert.throws(()=>M.sanitize({...portrait,orientation:'upside-down'}));
 assert.throws(()=>M.sanitize({...portrait,landscapeTop:'up'}));
});
test('landscape grid supports placement, swapping, and full-width widgets without overflow',()=>{
 const widgets=W.defaults('landscape'),page=W.screen('landscape');
 assert.equal(page.grid.columns,6);assert.equal(page.grid.rows,4);
 W.validate(widgets,'landscape');
 for(const w of widgets){const r=W.rect(w,'landscape');assert.ok(r.x+r.width<=page.width-64+.01);assert.ok(r.y+r.height<=page.height-146+.01);}
 const moved=W.move(widgets,'clock',4,0,'landscape');assert.equal(moved.find(w=>w.id==='cpu').x,0);
 assert.throws(()=>W.move(widgets,'cpu',5,0,'landscape'));
 assert.throws(()=>W.move(widgets,'clock',0,3,'landscape'));
 assert.deepEqual(W.findSpace([],6,1,'landscape'),{x:0,y:0});
 assert.equal(W.findSpace([],6,1,'portrait'),null);
});
test('landscape rendering is complete, grayscale, and transport rotates correctly for both placements',async()=>{
 const dir=await fs.mkdtemp(path.join(ROOT,'out','landscape-test-'));
 try{
  const config=M.sanitize({orientation:'landscape'}),file=path.join(dir,'landscape.png');
  await Raster.renderPng(config,{at:'2026-11-06T10:00:00Z',values:{gpuTemp:37,cpuTemp:55}},[],path.join(ROOT,'vendor/fonts'),file);
  const buffer=await fs.readFile(file),image=PNG.sync.read(buffer);
  assert.equal(image.width,1648);assert.equal(image.height,1236);assert.equal(buffer[25],0);
  assert.ok(image.data[(1160*1648+500)*4]<100,'landscape footer must not be cropped');
  assert.throws(()=>deviceImage(buffer,M.defaults()),/1236×1648/);
  const corners=new PNG({width:1648,height:1236});corners.data.fill(255);
  for(const [x,y,v]of [[0,0,11],[1647,0,22],[0,1235,33],[1647,1235,44]])for(let c=0;c<3;c++)corners.data[(y*1648+x)*4+c]=v;
  const source=PNG.sync.write(corners,{colorType:0,inputColorType:6,bitDepth:8});
  for(const [top,expected]of [['left',[33,11,44,22]],['right',[22,44,11,33]]]){
   const encoded=deviceImage(source,{...config,landscapeTop:top}),native=PNG.sync.read(encoded);
   assert.equal(native.width,1236);assert.equal(native.height,1648);assert.equal(encoded[25],0);
   const actual=[[0,0],[1235,0],[0,1647],[1235,1647]].map(([x,y])=>native.data[(y*1236+x)*4]);assert.deepEqual(actual,expected);
  }
  let received=false;const transport=new Transport(async(file,args,options)=>{
   assert.ok(args.some(arg=>arg==='root@kindle.local'||arg.startsWith('root@kindle.local:')));
   if(file.endsWith('scp.exe')){const local=args.find(arg=>arg.startsWith('./'));const sent=PNG.sync.read(await fs.readFile(path.join(options.cwd,local)));assert.equal(sent.width,1236);assert.equal(sent.height,1648);received=true;}
   return{stdout:''};
  });
  await transport.push({...config,connectionMode:'wifi',wifiHost:'kindle.local'},file);assert.ok(received);
  assert.ok(!(await fs.readdir(dir)).some(name=>name.startsWith('.kindle-')),'temporary upload snapshot must be removed');
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});


test('minute changes override long intervals; busy pushes catch up and failures back off',()=>{
 const {SyncSchedule}=require('../desktop/sync.cjs'),schedule=new SyncSchedule();
 const start=new Date('2026-11-07T10:00:59.000Z').getTime();
 assert.equal(schedule.due(start,start+3600000),true);
 schedule.success(start);
 assert.equal(schedule.due(start+500,start+3600000),false);
 assert.equal(schedule.due(start+1000,start+3600000),true);
 // A completed slow upload of the previous minute must still trigger catch-up.
 schedule.success(start);
 assert.equal(schedule.due(start+7000,start+3600000),true);
 schedule.failure(start+7000);
 assert.equal(schedule.due(start+8000,start+3600000),false);
 assert.equal(schedule.due(start+12000,start+3600000),true);
 schedule.success(start+12000);
 assert.equal(schedule.due(start+13000,start+13000),true);
 schedule.reset();assert.equal(schedule.due(start+13000,Infinity),true);
});

test('Wi-Fi selects its saved endpoint and uses the same strict SSH checks',async()=>{
 const config=M.sanitize({...M.defaults(),connectionMode:'wifi',wifiHost:'192.168.1.123',pushInterval:7});
 assert.equal(argsFor(config).target,'root@192.168.1.123');
 assert.equal(argsFor({...config,connectionMode:'usb'}).target,'root@192.168.15.244');
 assert.equal(argsFor(config).args.includes('StrictHostKeyChecking=yes'),true);
 assert.throws(()=>argsFor({...config,wifiHost:''}),/Wi-Fi/);
 assert.throws(()=>M.sanitize({...config,wifiHost:'host;cmd'}));
 assert.throws(()=>M.sanitize({...config,connectionMode:'other'}));
 assert.throws(()=>M.sanitize({...config,pushInterval:0}));
 const calls=[],transport=new Transport(async(file,args)=>{calls.push(args);return{stdout:''};});
 await transport.test(config);assert.ok(calls[0].includes('root@192.168.1.123'));
});

test('independent multiline notes and font weights persist through layout edits',()=>{
 const config=M.defaults();config.note='底部留言';
 config.widgets.find(w=>w.type==='note').content='第一行\n<script>第二行';
 const saved=M.sanitize(JSON.parse(JSON.stringify(config)));
 const moved=W.move(saved.widgets,'note',2,1);
 assert.equal(moved.find(w=>w.type==='note').content,'第一行\n<script>第二行');
 const svg=M.dashboardSvg(saved,{at:'2026-11-07T10:00:00Z',values:{}},[]);
 assert.ok(svg.includes('第一行'));assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('font-weight="700"'));
 assert.equal(M.sanitize({...saved,fontWeight:400}).fontWeight,400);
 saved.widgets.find(w=>w.type==='note').content='';
 const empty=M.dashboardSvg(saved,{values:{}},[]);
 assert.equal(empty.split('底部留言').length-1,1,'empty note must not inherit footer');
});

function grayPng(width, height) {
 const png=new PNG({width,height});
 png.data.fill(255);
 return PNG.sync.write(png,{colorType:0,inputColorType:6,bitDepth:8});
}

test('SSH install renames atomically and eips is optional',()=>{
 const temp='/mnt/us/dashboard.abc-def.tmp.png';
 assert.equal(installCommand(temp,true),`test -s '${temp}' && mv '${temp}' /mnt/us/dashboard.png && eips -f -g /mnt/us/dashboard.png`);
 assert.equal(installCommand(temp,false),`test -s '${temp}' && mv '${temp}' /mnt/us/dashboard.png`);
 assert.throws(()=>installCommand('/mnt/us/dashboard.png;reboot',false));
 assert.equal(installCommand(temp,false).includes('/mnt/us/dashboard.png'),true);
});

test('turning eips off keeps the readable PNG and skips the refresh command',async()=>{
 const dir=await fs.mkdtemp(path.join(ROOT,'out','eips-off-'));
 try{
  const file=path.join(dir,'landscape.png');
  await fs.writeFile(file,grayPng(1648,1236));
  const config=M.sanitize({orientation:'landscape',connectionMode:'usb',eipsRefresh:false,landscapeTop:'left'});
  const calls=[];
  const transport=new Transport(async(bin,args,options)=>{
   calls.push({bin,args,options});
   if(bin.endsWith('scp.exe')){
    const local=args.find(arg=>arg.startsWith('./'));
    const sent=PNG.sync.read(await fs.readFile(path.join(options.cwd,local)));
    assert.equal(sent.width,1648);assert.equal(sent.height,1236);
   }
   return {stdout:''};
  });
  const result=await transport.push(config,file);
  assert.equal(result.message.includes('等待插件刷新'),true);
  const install=calls.map(call=>call.args.at(-1)).find(command=>String(command).includes('mv '));
  assert.equal(install.includes('eips'),false);
  assert.ok(install.startsWith('test -s '));
  assert.ok(install.includes("mv '"));
  assert.ok(install.includes('/mnt/us/dashboard.png'));
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('HTTP mode uploads the PNG with a bearer token and never opens SSH',async()=>{
 const dir=await fs.mkdtemp(path.join(ROOT,'out','http-push-'));
 try{
  const file=path.join(dir,'portrait.png');
  await fs.writeFile(file,grayPng(1236,1648));
  const config=M.sanitize({connectionMode:'http',httpHost:'192.168.1.20',httpPort:8686,httpToken:'abc123token',orientation:'portrait'});
  const calls=[];
  const transport=new Transport(async()=>{throw new Error('SSH should not run');}, async spec=>{
   calls.push(spec);
   if(spec.path==='/status')return {status:200,body:JSON.stringify({ok:true,version:'1',width:1236,height:1648,orientation:'portrait'})};
   assert.equal(spec.path,'/dashboard.png');
   assert.equal(spec.method,'POST');
   assert.equal(spec.headers.Authorization,'Bearer abc123token');
   assert.equal(spec.path.includes('abc123token'),false);
   const image=PNG.sync.read(spec.body);
   assert.equal(image.width,1236);assert.equal(image.height,1648);
   return {status:200,body:'{"ok":true}'};
  });
  const status=await transport.test(config);
  assert.equal(status.message.includes('1236×1648'),true);
  const pushed=await transport.push(config,file);
  assert.equal(pushed.message,'已通过看板插件更新图片');
  assert.equal(calls.length,2);
  const spec=httpCall(config,'POST','/dashboard.png',Buffer.from('x'));
  assert.equal(spec.host,'192.168.1.20');
  assert.equal(spec.port,8686);
  assert.equal(spec.path.includes(config.httpToken),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('HTTP errors stay free of the pairing token',async()=>{
 const config=M.sanitize({connectionMode:'http',httpHost:'kindle.local',httpPort:8686,httpToken:'secret-token'});
 const transport=new Transport(async()=>{}, async()=>{const error=new Error('connect ECONNREFUSED');error.code='ECONNREFUSED';throw error;});
 await assert.rejects(transport.test(config), error=>{
  assert.equal(error.message.includes('secret-token'),false);
  assert.match(error.message,/看板模式/);
  return true;
 });
 const denied=new Transport(async()=>{}, async()=>({status:401,body:'{"ok":false}'}));
 await assert.rejects(denied.test(config),/口令不正确/);
 assert.throws(()=>payloadFor(grayPng(2,2),config),/1236×1648/);
});
