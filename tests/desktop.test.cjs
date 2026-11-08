const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {PNG}=require('pngjs');
const M=require('../desktop/model.cjs'),W=require('../desktop/widgets.cjs');
const {parseNvidia,selectCpuSensor,Sensors}=require('../desktop/sensors.cjs');
const {Transport,argsFor,deviceImage,payloadFor,installCommand,httpCall}=require('../desktop/transport.cjs');
const Raster=require('../desktop/render.cjs');
const {systemFonts}=require('../desktop/fonts.cjs');
const {Usage}=require('../desktop/usage.cjs');
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
 assert.equal(M.sanitize({}).sampleInterval,3);
 assert.equal(M.sanitize({sampleInterval:'300'}).sampleInterval,300);
 for(const seconds of [0,1.5,301])assert.throws(()=>M.sanitize({sampleInterval:seconds}),/采集间隔/);
});
test('SVG escapes editable text, uses a Windows font, and retains clock/weather/footer',()=>{
 const c=M.defaults();c.title='<script>&';c.note='测试留言';const s={at:'2026-11-06T10:00:00Z',hostname:'<host>',values:{gpuTemp:37}};
 const svg=M.dashboardSvg(c,s,[],{temperature:25,condition:'多云',low:22,high:29});
 assert.ok(!svg.includes('<script>'));assert.ok(svg.includes('&lt;script&gt;&amp;'));assert.ok(svg.includes('Microsoft YaHei'));assert.ok(svg.includes('25°'));assert.ok(svg.includes('测试留言'));
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
  await Raster.renderPng(M.defaults(),{at:'2026-11-06T10:00:00Z',values:{gpuTemp:37}},[],image);
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
  await Raster.renderPng(config,{at:'2026-11-06T10:00:00Z',values:{gpuTemp:37,cpuTemp:55}},[],file);
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

test('widget typography stays local through saves and changes only its own PNG pixels',async()=>{
 const config=M.defaults();
 const fonts=await systemFonts();
 const family=fonts.find(font=>font.name==='Consolas')?.name??fonts[0]?.name??'Consolas';
 const note=config.widgets.find(widget=>widget.id==='note');
 note.content='字体测试\nAa 12:34';
 const sample={at:'2026-11-07T10:00:00Z',values:{}};
 const directory=await fs.mkdtemp(path.join(ROOT,'out','typography-'));
 const render=async(value,file)=>PNG.sync.read(await fs.readFile(await Raster.renderPng(value,sample,[],path.join(directory,file))));
 try{
  const original=await render(config,'original.png');
  Object.assign(note,{fontFamily:family,fontWeight:400,fontScale:115});
  const saved=M.sanitize(JSON.parse(JSON.stringify(config)));
  assert.deepEqual(saved.layouts.portrait.find(widget=>widget.id==='note'),note);
  assert.equal(saved.layouts.landscape.find(widget=>widget.id==='note').fontFamily,undefined);
  assert.throws(()=>W.validate([{...note,fontScale:116}]),/字号/);
  assert.throws(()=>W.validate([{...note,fontFamily:'Consolas,serif'}]),/字体/);
  assert.equal(W.validate([{...note,fontFamily:'maple'}])[0].fontFamily,'Maple Mono NF CN');
  assert.equal(W.validate([{...note,fontFamily:'yahei'}])[0].fontFamily,'Microsoft YaHei');
  assert.equal(W.validate([{...note,fontFamily:'dengxian'}])[0].fontFamily,'DengXian');
  const moved=W.move(saved.widgets,'note',2,1).find(widget=>widget.id==='note');
  assert.deepEqual([moved.fontFamily,moved.fontWeight,moved.fontScale],[family,400,115]);
  const preview=M.dashboardSvg(saved,sample,[],null,['Microsoft YaHei','Segoe UI']);
  assert.match(preview,/<g data-widget="note" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-weight="400">/);
  const updated=await render(saved,'updated.png');
  const rect=W.rect(note);
  let changed=0;
  for(let y=0;y<original.height;y++){
   const start=y*original.width*4,end=start+original.width*4;
   const left=y>=rect.y&&y<rect.y+rect.height?start+rect.x*4:end;
   const right=left===end?end:left+rect.width*4;
   assert.ok(original.data.subarray(start,left).equals(updated.data.subarray(start,left)));
   assert.ok(original.data.subarray(right,end).equals(updated.data.subarray(right,end)));
   if(!original.data.subarray(left,right).equals(updated.data.subarray(left,right)))changed++;
  }
  assert.ok(changed>0);
  if(fonts.length){
   delete saved.widgets.find(widget=>widget.id==='note').fontFamily;
   const fallback=await render(saved,'fallback.png');
   assert.ok(!fallback.data.equals(updated.data),'selected Windows font must change the rasterized text');
  }
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

function grayPng(width, height, corners) {
 const png=new PNG({width,height});
 png.data.fill(255);
 if(corners){
  const offsets=[0,width-1,(height-1)*width,width*height-1];
  offsets.forEach((offset,index)=>png.data.fill(corners[index],offset*4,offset*4+3));
 }
 return PNG.sync.write(png,{colorType:0,inputColorType:6,bitDepth:8});
}

test('AI usage keeps independent local accounts and exports only configured summaries',async()=>{
 const directory=await fs.mkdtemp(path.join(ROOT,'out','usage-test-'));
 const storage={
  isAsyncEncryptionAvailable:async()=>true,
  encryptStringAsync:async value=>Buffer.from(value,'utf8').map(byte=>byte^0x91),
  decryptStringAsync:async value=>({result:value.map(byte=>byte^0x91).toString('utf8')}),
 };
 const requests=[];
 const request=async(url,options)=>{
  requests.push([url,options]);
  return {ok:true,json:async()=>({balance_infos:[{currency:'CNY',total_balance:options.headers.Authorization==='Bearer demo-key-two'?'18.25':'0.00'}]})};
 };
 const providerReply={rateLimits:{primary:{usedPercent:35,windowDurationMins:300}}};
 const signedIn=[],signedOut=[];
 const codex={
  readLocal:async()=>providerReply,
  signIn:async home=>{signedIn.push(home);return providerReply;},
  read:async()=>providerReply,
  signOut:async home=>{signedOut.push(home);},
 };
 try{
  const usage=new Usage(directory,storage,()=>{},request,codex);
  const config={...M.defaults(),widgets:[{id:'usage',type:'usage',label:'AI 额度',x:0,y:0,w:4,h:2}]};
  const svg=rows=>M.dashboardSvg(config,{usage:rows});
  await usage.refreshAll();
  assert.equal(requests.length,0);
  assert.doesNotMatch(svg(usage.view().rows),/data-widget="usage"/);
  const [first,second]=await Promise.all([
   usage.set('deepseek',{key:'demo-key-one',label:'个人'}),
   usage.set('deepseek',{key:'demo-key-two',label:'工作'}),
  ]);
  const bot=await usage.set('grokBot',{remaining:'0',label:'Bot'});
  const local=await usage.signIn({label:'本机'},()=>{throw new Error('unexpected browser login');});
  const extra=await usage.signIn({label:'另一账号'},()=>{});
  assert.equal(signedIn.length,1);
  assert.equal(path.basename(signedIn[0]),extra);
  const result=usage.view();
  assert.deepEqual(result.rows.filter(row=>row.provider==='deepseek').map(row=>row.value),['¥0.00','¥18.25']);
  assert.equal(result.rows.find(row=>row.id===bot).value,'0%');
  assert.match(svg(result.rows),/DeepSeek · 个人/);
  assert.doesNotMatch(svg(result.rows),/OpenRouter|Claude|demo-key/);
  assert.doesNotMatch(JSON.stringify(result),/demo-key/);
  assert.ok(!(await fs.readFile(path.join(directory,'ai-usage.bin'))).includes('demo-key'));
  assert.ok(requests.every(([url,options])=>url==='https://api.deepseek.com/user/balance'&&options.redirect==='error'));
  config.widgets[0].usageSource=second;
  assert.match(svg(result.rows),/¥18\.25/);
  assert.doesNotMatch(svg(result.rows),/¥0\.00|Grok Bot/);
  await usage.remove(second);
  assert.doesNotMatch(svg(usage.view().rows),/data-widget="usage"/);
  await usage.remove(local);
  assert.equal(signedOut.length,0);
  await usage.remove(extra);
  assert.deepEqual(signedOut,signedIn);
  const restored=new Usage(directory,storage,()=>{},request,codex);
  await restored.load();await restored.refreshAll();
  assert.deepEqual(restored.view().rows.map(row=>row.id),[first,bot]);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('retired Grok Bot connections do not block loading saved usage accounts',async()=>{
 const directory=await fs.mkdtemp(path.join(ROOT,'out','usage-legacy-test-'));
 const storage={decryptStringAsync:async value=>({result:value.toString('utf8')})};
 const manual='00000000-0000-4000-8000-000000000003';
 try{
  await fs.writeFile(path.join(directory,'ai-usage.bin'),JSON.stringify({
   '00000000-0000-4000-8000-000000000001':{provider:'grokBot',browser:true,label:'旧账单'},
   '00000000-0000-4000-8000-000000000002':{provider:'grokBot',grokAccount:'a'.repeat(64),label:'旧直连'},
   [manual]:{provider:'grokBot',remaining:72,label:'手动'},
  }));
  let requests=0;
  const usage=new Usage(directory,storage,()=>{},async()=>{requests++;});
  await usage.load();
  await usage.refreshAll();
  const {rows,storageError}=usage.view();
  assert.equal(storageError,false);
  assert.deepEqual(rows.map(({id,value})=>[id,value]),[[manual,'72%']]);
  assert.equal(requests,0);
 }finally{await fs.rm(directory,{recursive:true,force:true});}
});

test('an image widget keeps both ink modes through saving and uses the selected mode in the PNG',async()=>{
 const source=new PNG({width:4,height:4});
 for(let i=0;i<source.data.length;i+=4)source.data.set([0,178,0,255],i);
 const encode=()=>`data:image/png;base64,${PNG.sync.write(source).toString('base64')}`;
 W.mapImage(source.data,source.width);
 const gray=encode();
 assert.equal(source.data[0],127);
 W.mapImage(source.data,source.width,true);
 const mono=encode();
 assert.deepEqual(new Set(source.data.filter((_,i)=>i%4===0)),new Set([0,255]));

 const widget={id:'picture',type:'image',x:0,y:0,w:2,h:1,image:{gray,mono},imageMode:'mono'};
 const config=M.sanitize(JSON.parse(JSON.stringify(M.sanitize({widgets:[widget]}))));
 assert.deepEqual(config.widgets[0].image,widget.image);
 assert.throws(()=>M.sanitize({widgets:[{...widget,image:{gray:'file:///private.png',mono}}]}),/图片无效/);
 const dir=await fs.mkdtemp(path.join(ROOT,'out','image-widget-'));
 try{
  const file=path.join(dir,'dashboard.png');
  const box=W.rect(widget),x=Math.floor(box.x+box.width/2),y=Math.floor(box.y+box.height/2);
  for(const mode of ['gray','mono']){
   config.widgets[0].imageMode=mode;
   await Raster.renderPng(config,{at:'2026-11-06T10:00:00Z',values:{}},[],file);
   const png=PNG.sync.read(await fs.readFile(file));
   const tones=new Set();
   for(let row=y-80;row<y+80;row++)for(let col=x-80;col<x+80;col++)tones.add(png.data[(row*png.width+col)*4]);
   assert.deepEqual(tones,new Set(mode==='gray'?[127]:[0,255]));
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('an image widget saves crop settings and clips the export to the selected edge',async()=>{
 const source=new PNG({width:12,height:4});
 for(let y=0;y<source.height;y++)for(let x=0;x<source.width;x++){
  const shade=x<4?20:x<8?120:220;
  source.data.set([shade,shade,shade,255],(y*source.width+x)*4);
 }
 const data=`data:image/png;base64,${PNG.sync.write(source).toString('base64')}`;
 const imageView={fit:'cover',zoom:200,x:100,y:0};
 const widget={id:'crop',type:'image',x:0,y:0,w:1,h:1,image:{gray:data,mono:data},imageView};
 const config=M.sanitize(JSON.parse(JSON.stringify(M.sanitize({widgets:[widget]}))));
 assert.deepEqual(config.widgets[0].imageView,imageView);
 assert.deepEqual(M.sanitize({widgets:[{...widget,imageView:undefined}]}).widgets[0].imageView,W.IMAGE_VIEW);
 assert.throws(()=>M.sanitize({widgets:[{...widget,imageView:{...imageView,zoom:401}}]}),/裁剪设置无效/);
 const dir=await fs.mkdtemp(path.join(ROOT,'out','image-crop-'));
 try{
  const file=path.join(dir,'dashboard.png'),box=W.rect(widget);
  for(const [position,shade] of [[100,220],[-100,20]]){
   config.widgets[0].imageView.x=position;
   await Raster.renderPng(config,{at:'2026-11-06T10:00:00Z',values:{}},[],file);
   const png=PNG.sync.read(await fs.readFile(file));
   const y=Math.floor(box.y+box.height/2),sample=x=>png.data[(y*png.width+x)*4];
   assert.equal(sample(Math.floor(box.x+box.width/2)),shade);
   assert.equal(sample(box.x-2),255);
   assert.equal(sample(box.x+box.width+2),255);
  }
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('temperature trend shows separate CPU and GPU readings and traces',()=>{
 const config=M.sanitize({widgets:[{id:'trend',type:'trend',x:0,y:0,w:1,h:1}]});
 const first={at:'2026-11-06T09:59:50Z',values:{cpuTemp:50,gpuTemp:35}};
 const latest={at:'2026-11-06T10:00:00Z',values:{cpuTemp:61.2,gpuTemp:42.5}};
 const svg=M.dashboardSvg(config,latest,[first,latest]);
 assert.match(svg,/>CPU<\/text>/);
 assert.match(svg,/>GPU<\/text>/);
 assert.match(svg,/>61\.2°C<\/text>/);
 assert.match(svg,/>42\.5°C<\/text>/);
 assert.match(svg,/<g color="#111"><polyline/);
 assert.match(svg,/<g color="#555" stroke-dasharray="8 6"><polyline/);
 assert.match(M.dashboardSvg(config,latest,[latest]),/<g color="#111"><circle/);
});

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
   if(spec.path==='/status')return {status:200,body:JSON.stringify({ok:true,version:'1',width:1236,height:1648,orientation:'portrait',rotation:0})};
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
  assert.deepEqual(calls.map(call=>call.path),['/status','/status','/dashboard.png']);
  const spec=httpCall(config,'POST','/dashboard.png',Buffer.from('x'));
  assert.equal(spec.host,'192.168.1.20');
  assert.equal(spec.port,8686);
  assert.equal(spec.path.includes(config.httpToken),false);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('HTTP fits the Kindle screen and preserves the selected physical placement',async()=>{
 const dir=await fs.mkdtemp(path.join(ROOT,'out','http-rotation-'));
 try{
  const file=path.join(dir,'dashboard.png');
  const corners=[11,22,33,44];
  const landscape=grayPng(1648,1236,corners),portrait=grayPng(1236,1648,corners);
  const config={connectionMode:'http',httpHost:'kindle.local',httpToken:'abc123token'};
  for(const [orientation,landscapeTop,rotation,expected] of [
   ['landscape','left',0,[33,11,44,22]],
   ['landscape','right',0,[22,44,11,33]],
   ['landscape','left',3,corners],
   ['landscape','right',1,corners],
   ['landscape','left',1,[44,33,22,11]],
   ['portrait','left',3,[22,44,11,33]],
  ]){
   const source=orientation==='landscape'?landscape:portrait;
   await fs.writeFile(file,source);
   const [width,height]=rotation%2?[1648,1236]:[1236,1648];
   const transport=new Transport(async()=>{throw new Error('SSH should not run');},async spec=>{
    if(spec.path==='/status')return {status:200,body:JSON.stringify({ok:true,width,height,rotation})};
    const image=PNG.sync.read(spec.body);
    assert.deepEqual([image.width,image.height],[width,height]);
    assert.equal(spec.body[25],0);
    assert.deepEqual([0,width-1,(height-1)*width,width*height-1].map(offset=>image.data[offset*4]),expected);
    if(expected===corners)assert.deepEqual(spec.body,source);
    return {status:200,body:'{"ok":true}'};
   });
   await transport.push({...config,orientation,landscapeTop},file);
  }
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

test('connected Kindle dimensions drive the preview, raster export and upload, with manual override',async()=>{
 const dir=await fs.mkdtemp(path.join(ROOT,'out','kindle-displays-'));
 try{
  const target=path.join(dir,'board.png');
  const config=M.sanitize({connectionMode:'http',httpHost:'kindle.local',httpToken:'test-token',orientation:'landscape'});
  const sample={at:'2026-11-06T10:00:00Z',values:{}};
  const calls=[];
  const transport=new Transport(async()=>{throw new Error('SSH should not run');},async spec=>{
   calls.push(spec.path);
   if(spec.path==='/status')return {status:200,body:JSON.stringify({ok:true,width:1072,height:1448,model:'KindleBasic5',rotation:0})};
   const image=PNG.sync.read(spec.body);
   assert.deepEqual([image.width,image.height],[1072,1448]);
   return {status:200,body:'{"ok":true}'};
  });
  const probe=await transport.test(config);
  assert.deepEqual(probe.device,{width:1072,height:1448,model:'KindleBasic5'});
  assert.match(W.displayFor(config,probe.device).name,/基础款/);
  assert.match(M.dashboardSvg(config,sample,[],null,undefined,probe.device),/width="1448" height="1072"/);
  await Raster.renderPng(config,sample,[],target,null,undefined,probe.device);
  const image=PNG.sync.read(await fs.readFile(target));
  assert.deepEqual([image.width,image.height,image.data[0]],[1448,1072,255]);
  await transport.push(config,target,probe);
  assert.deepEqual(calls,['/status','/dashboard.png']);
  const manual=M.sanitize({...config,displayProfile:'scribe'});
  assert.match(M.dashboardSvg(manual,sample,[],null,undefined,probe.device),/width="2480" height="1860"/);
  const custom=M.sanitize({...config,displayProfile:'custom',displayWidth:1210,displayHeight:1666});
  assert.match(M.dashboardSvg(custom,sample),/width="1666" height="1210"/);
  assert.throws(()=>M.sanitize({...custom,displayHeight:0}),/自定义尺寸/);
 }finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('USB and Wi-Fi checks require eips only when refresh is enabled',async()=>{
 const commands=[];
 const transport=new Transport(async(_exe,args)=>{commands.push(args.at(-1));return {stdout:''};});
 for(const connectionMode of ['usb','wifi']){
  const config={connectionMode,wifiHost:'kindle.local'};
  await transport.test({...config,eipsRefresh:false});
  await transport.test({...config,eipsRefresh:true});
 }
 assert.deepEqual(commands.map(command=>command.includes('command -v eips')),[false,true,false,true]);
 const eips=new Transport(async()=>({stdout:'xres: 600 yres: 800 xres_virtual: 608 yres_virtual: 5376'}));
 assert.deepEqual((await eips.test({connectionMode:'usb'})).device,{width:600,height:800});
 const fbset=new Transport(async()=>({stdout:'mode "1264x1680"\n  geometry 1264 1680 1280 3360 8\nendmode'}));
 assert.deepEqual((await fbset.test({connectionMode:'wifi',wifiHost:'kindle.local',eipsRefresh:false})).device,{width:1264,height:1680});
});
