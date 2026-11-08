const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
const {enableTemperature}=require('../desktop/sensor-start.cjs');
const live={elevated:true,sensors:[{id:'/amdcpu/0/temperature/2',name:'Core (Tctl/Tdie)',type:'Temperature',value:47}]};

async function fixture(fn){
  const out=path.resolve(__dirname,'..','out');
  await fs.mkdir(out,{recursive:true});
  const root=await fs.mkdtemp(path.join(out,'kindle-sensor-start-'));
  try{
    for(const relative of ['sensors/SensorHelper.exe','sensors/EnableSensors.ps1','sensors/PawnIO_setup.exe','lhm/LibreHardwareMonitorLib.dll']){
      const file=path.join(root,relative);await fs.mkdir(path.dirname(file),{recursive:true});await fs.writeFile(file,'fixture');
    }
    await fn(root);
  }finally{await fs.rm(root,{recursive:true,force:true});}
}
function getOperation(args){const script=Buffer.from(args.at(-1),'base64').toString('utf16le');return script.match(/-Operation ([0-9a-f-]{36})/)[1];}
test('healthy elevated collector needs no reinstall and no new elevation',async()=>{
  const result=await enableTemperature('unused','unused',{readHelper:async()=>live},async()=>{throw Error('unexpected elevation');});
  assert.match(result.message,/已运行/);
});
test('elevated helper with zero temperature is restarted; stale operation success is ignored',async()=>fixture(async root=>{
  let sample={elevated:true,sensors:[{...live.sensors[0],value:0}]},operation,calls=0;
  const phases=[];
  const execute=async(file,args)=>{calls++;operation=getOperation(args);await fs.writeFile(path.join(root,'sensor-start.json'),JSON.stringify({operation:'stale',phase:'ready',message:'incorrect success'}));};
  const sleep=async()=>{sample=live;await fs.writeFile(path.join(root,'sensor-start.json'),JSON.stringify({operation,phase:'ready',message:'ready'}));};
  const result=await enableTemperature(root,root,{readHelper:async()=>sample},execute,message=>phases.push(message),{sleep,timeoutMs:1000});
  assert.equal(calls,1);assert.deepEqual(phases,['ready']);assert.match(result.message,/已连接/);
}));
for(const [phase,message,expected] of [['error','driver signature rejected',/driver signature rejected/],['reboot-required','restart',/重启 Windows/]]){
  test(`${phase} is not reported as successful temperature activation`,async()=>fixture(async root=>{
    const execute=async(file,args)=>{await fs.writeFile(path.join(root,'sensor-start.json'),JSON.stringify({operation:getOperation(args),phase,message}));};
    await assert.rejects(enableTemperature(root,root,{readHelper:async()=>null},execute),expected);
  }));
}
test('cancelled UAC returns an actionable message',async()=>fixture(async root=>{
  await assert.rejects(enableTemperature(root,root,{readHelper:async()=>null},async()=>{throw Error('Operation cancelled 1223');}),/取消管理员授权/);
}));
test('missing bundled component fails before requesting elevation',async()=>fixture(async root=>{
  await fs.unlink(path.join(root,'sensors/PawnIO_setup.exe'));
  let calls=0;
  await assert.rejects(enableTemperature(root,root,{readHelper:async()=>null},async()=>{calls++;}),/ENOENT/);
  assert.equal(calls,0);
}));
test('Windows PowerShell 5.1 can atomically update activation status more than once',{skip:process.platform!=='win32'},async()=>fixture(async root=>{
  const source=path.resolve(__dirname,'../desktop/EnableSensors.ps1');
  const quote=value=>"'"+value.replace(/'/g,"''")+"'";
  const script=`$ErrorActionPreference='Stop';$env:PSModulePath="$env:WINDIR\\System32\\WindowsPowerShell\\v1.0\\Modules;$env:PSModulePath";$errors=$null;$tokens=$null;$ast=[Management.Automation.Language.Parser]::ParseInput([IO.File]::ReadAllText(${quote(source)}),[ref]$tokens,[ref]$errors);if($errors.Count){throw 'Parse failure'};$f=$ast.Find({param($n) $n -is [Management.Automation.Language.FunctionDefinitionAst] -and $n.Name -eq 'Write-Status'},$true);. ([scriptblock]::Create($f.Extent.Text));$statusPath=${quote(path.join(root,'status.json'))};$Operation='test';Write-Status 'preparing' 'first';Write-Status 'ready' 'second';[IO.File]::ReadAllText($statusPath)`;
  const result=spawnSync(path.join(process.env.SystemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{encoding:'utf8',windowsHide:true,timeout:10000});
  assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).phase,'ready');
}));
