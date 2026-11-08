const {execFile,spawn}=require('node:child_process');
const {mkdir}=require('node:fs/promises');
const {existsSync}=require('node:fs');
const {homedir}=require('node:os');
const path=require('node:path');
const {createInterface}=require('node:readline');
const {promisify}=require('node:util');
const {version}=require('../package.json');
const run=promisify(execFile);

let resolvedExecutable;
async function findExecutable(){
  const arch=process.arch==='arm64'?'aarch64':'x86_64';
  try{
    const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
    const {stdout}=await run(powershell,['-NoProfile','-NonInteractive','-Command',
      '(Get-AppxPackage -Name OpenAI.Codex | Select-Object -First 1).InstallLocation'],{windowsHide:true,timeout:4000});
    const desktop=path.join(stdout.trim(),'app','resources','codex.exe');
    if(path.isAbsolute(desktop)&&existsSync(desktop))return desktop;
  }catch{}
  const candidates=process.env.PATH?.split(path.delimiter).flatMap(folder=>[
    path.join(folder,'codex.exe'),
    ...['codex','codex-win32-'+(arch==='aarch64'?'arm64':'x64')].map(pkg=>
      path.join(folder,'node_modules','@openai',pkg,'vendor',arch+'-pc-windows-msvc','codex','codex.exe')),
  ])??[];
  const file=candidates.find(candidate=>path.isAbsolute(candidate)&&existsSync(candidate));
  if(!file)throw new Error('未找到官方 Codex CLI。安装后重启 Kindle Monitor。');
  return file;
}

async function withServer(home,timeout,work,localTemp){
  const file=await (resolvedExecutable??=findExecutable().catch(error=>{resolvedExecutable=undefined;throw error;}));
  if(!localTemp)await mkdir(home,{recursive:true});
  const env=Object.fromEntries(Object.entries(process.env).filter(([key])=>
    /^(SystemRoot|WINDIR|USERPROFILE|APPDATA|LOCALAPPDATA|PATH|SystemDrive|ProgramData)$/i.test(key)));
  const temp=localTemp??home;
  Object.assign(env,{CODEX_HOME:home,TEMP:temp,TMP:temp,TMPDIR:temp});
  const storage=localTemp?[]:['-c','cli_auth_credentials_store="keyring"'];
  const child=spawn(file,[...storage,'-c','analytics.enabled=false',
    '-c','feedback.enabled=false','-c','check_for_update_on_startup=false','-c','model_provider="openai"',
    '-c','chatgpt_base_url="https://chatgpt.com/backend-api/"','app-server'],{
    cwd:home,env,windowsHide:true,stdio:['pipe','pipe','ignore'],
  });
  const pending=new Map();
  const lines=createInterface({input:child.stdout});
  let seq=0,onNotice;
  lines.on('line',line=>{
    let message;
    try{message=JSON.parse(line);}catch{return;}
    const reply=pending.get(message.id);
    if(reply&&('result' in message||'error' in message)){
      pending.delete(message.id);
      if(message.error?.code===-32601)reply.reject(new Error('当前 Codex 版本不支持额度查询，请更新 Codex。'));
      else if(message.error)reply.reject(new Error('Codex 接口查询失败，请检查登录状态。'));
      else reply.resolve(message.result);
    }else if(message.method&&message.id===undefined)onNotice?.(message);
  });
  const send=message=>child.stdin.write(JSON.stringify(message)+'\n');
  const request=(method,params)=>new Promise((resolve,reject)=>{
    const id=++seq;
    pending.set(id,{resolve,reject});
    send({id,method,params});
  });
  let timer;
  try{
    const failure=new Promise((_,reject)=>{
      const stopped=()=>reject(new Error('Codex 查询进程已退出。'));
      child.once('error',stopped);
      child.once('exit',stopped);
      child.stdin.on('error',stopped);
      timer=setTimeout(()=>reject(new Error('Codex 登录或查询超时。')),timeout);
    });
    const result=(async()=>{
      await request('initialize',{clientInfo:{name:'kindle_monitor',title:'Kindle Monitor',version}});
      send({method:'initialized'});
      return work(request,handler=>{onNotice=handler;});
    })();
    return await Promise.race([failure,result]);
  }finally{
    clearTimeout(timer);
    for(const reply of pending.values())reply.reject(new Error('Codex 查询已结束。'));
    lines.close();
    child.kill();
  }
}

function signIn(home,openBrowser){
  return withServer(home,180_000,async(request,listen)=>{
    const started=await request('account/login/start',{type:'chatgpt'});
    let url;
    try{url=new URL(started?.authUrl);}catch{throw new Error('Codex 未返回登录地址。');}
    if(url.protocol!=='https:'||!['auth.openai.com','chatgpt.com'].includes(url.hostname)||url.username||url.password||url.port){
      throw new Error('Codex 返回了未知的登录地址。');
    }
    const complete=new Promise((resolve,reject)=>listen(message=>{
      if(message.method!=='account/login/completed'||message.params?.loginId!==started.loginId)return;
      if(message.params.success)resolve();
      else reject(new Error('Codex 登录未完成。'));
    }));
    await Promise.all([openBrowser(url.href).catch(()=>{throw new Error('无法打开 Codex 登录页面。');}),complete]);
    return request('account/rateLimits/read');
  });
}

const read=home=>withServer(home,15_000,request=>request('account/rateLimits/read'));
const readLocal=temp=>{
  const home=path.resolve(process.env.CODEX_HOME||path.join(homedir(),'.codex'));
  if(!existsSync(home))throw new Error('本机没有可用的 Codex 登录。');
  return withServer(home,12_000,request=>request('account/rateLimits/read'),temp);
};
const signOut=home=>withServer(home,15_000,request=>request('account/logout'));
module.exports={signIn,read,readLocal,signOut};
