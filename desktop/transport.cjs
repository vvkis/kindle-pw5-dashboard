const path=require('node:path');
const fs=require('node:fs/promises');
const http=require('node:http');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {randomUUID}=require('node:crypto');
const {PNG}=require('pngjs');
const {sanitize}=require('./model.cjs');
const {screen}=require('./widgets.cjs');
const run=promisify(execFile);
const options={windowsHide:true,timeout:20000,maxBuffer:512*1024};
function readPage(buffer, config) {
  const page=screen(config.orientation), image=PNG.sync.read(buffer,{checkCRC:true});
  if(image.width!==page.width||image.height!==page.height||buffer[24]!==8||buffer[25]!==0)throw new Error(`图片必须是 ${page.width}×${page.height} 的 8-bit 灰阶 PNG`);
  return image;
}
function placementTurns(config) {
  if(config.orientation!=='landscape')return 0;
  return config.landscapeTop==='right'?3:1;
}
function rotateImage(buffer, image, turns) {
  if(turns===0)return buffer;
  const {width,height}=image;
  const rotated=new PNG(turns===2?{width,height}:{width:height,height:width});
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    let dx,dy;
    if(turns===1){dx=height-1-y;dy=x;}
    else if(turns===2){dx=width-1-x;dy=height-1-y;}
    else{dx=y;dy=width-1-x;}
    const offset=(y*width+x)*4;
    image.data.copy(rotated.data,(dy*rotated.width+dx)*4,offset,offset+4);
  }
  return PNG.sync.write(rotated,{colorType:0,inputColorType:6,bitDepth:8});
}
function deviceImage(buffer, config) {
  return rotateImage(buffer, readPage(buffer, config), placementTurns(config));
}
// SSH + eips targets the native framebuffer. File-only SSH uploads keep the preview orientation.
function wantsFramebuffer(config) {
  return config.connectionMode!=='http' && config.eipsRefresh!==false;
}
function payloadFor(buffer, config) {
  if(!wantsFramebuffer(config)){readPage(buffer, config);return buffer;}
  return deviceImage(buffer, config);
}
function installCommand(temp, refresh) {
  if(!/^\/mnt\/us\/dashboard\.[A-Za-z0-9-]+\.tmp\.png$/.test(temp))throw new Error('临时文件名无效');
  const quoted=`'${temp}'`;
  const move=`test -s ${quoted} && mv ${quoted} /mnt/us/dashboard.png`;
  return refresh?`${move} && eips -f -g /mnt/us/dashboard.png`:move;
}
function argsFor(config) {
  const c=sanitize(config);
  if(c.connectionMode==='http')throw new Error('看板插件模式通过 HTTP 推送，不使用 SSH');
  const host=c.connectionMode==='wifi'?c.wifiHost:c.host;
  if(!host)throw new Error('请填写 Kindle 的 Wi-Fi 地址');
  const args=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2'];
  if(c.identityFile) args.push('-i',c.identityFile);
  return {c,args,target:`root@${host}`};
}
function explain(error) {
  const raw=String(error.stderr||error.message||error).trim();
  if(/Host key verification failed/.test(raw)) return '主机密钥尚未信任或已变化。请先核对设备指纹并用 SSH 完成首次登录。';
  if(/Permission denied/.test(raw)) return 'SSH 认证失败，请检查私钥与 Kindle authorized_keys。';
  if(/timed out|unreachable|refused|killed/i.test(raw)) return '设备连接不可达。请检查所选网络、SSH 地址和端口，并唤醒 Kindle；Wi-Fi 模式需两端处于可互通的局域网且设备已开放无线 SSH。';
  return raw.slice(-1500);
}
function explainHttp(status) {
  if(status===401)return '配对口令不正确。请核对看板屏幕上的口令。';
  if(status===413)return '图片超过看板插件接受的大小。';
  if(status===400||status===415)return '看板插件拒绝了这张图片。';
  if(status===404)return '没有找到看板接口。请确认 Kindle 上已打开「看板模式」。';
  return `看板插件返回 HTTP ${status}`;
}
function httpFailure(error) {
  const raw=String(error.code||error.message||error);
  if(/ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|timed out|ECONNRESET/i.test(raw)){
    return new Error('设备连接不可达。请确认 Kindle 已打开「看板模式」、电脑与 Kindle 在同一 Wi-Fi，并核对地址和端口。');
  }
  return error instanceof Error?error:new Error(String(error));
}
function httpTarget(config) {
  const c=sanitize(config);
  if(c.connectionMode!=='http')throw new Error('不是看板插件模式');
  if(!c.httpHost)throw new Error('请填写 Kindle 的地址');
  if(!c.httpToken)throw new Error('请填写看板配对口令');
  return c;
}
function httpCall(config, method, requestPath, body) {
  const c=httpTarget(config);
  const headers={Authorization:`Bearer ${c.httpToken}`,Connection:'close'};
  if(body){headers['Content-Type']='image/png';headers['Content-Length']=body.length;}
  return {host:c.httpHost,port:c.httpPort,method,path:requestPath,headers,body:body||null,timeout:20000};
}
function httpRequest(spec) {
  return new Promise((resolve, reject) => {
    let settled=false;
    const fail=error=>{if(settled)return;settled=true;reject(error);};
    const req=http.request({host:spec.host,port:spec.port,method:spec.method,path:spec.path,headers:spec.headers,timeout:spec.timeout||20000}, res=>{
      const chunks=[];
      res.on('data', chunk=>chunks.push(chunk));
      res.on('end', ()=>{if(settled)return;settled=true;resolve({status:res.statusCode,body:Buffer.concat(chunks).toString('utf8')});});
    });
    req.on('error', fail);
    req.on('timeout', ()=>req.destroy(Object.assign(new Error('timed out'),{code:'ETIMEDOUT'})));
    if(spec.body)req.end(spec.body);else req.end();
  });
}
function parseStatus(body) {
  let parsed;
  try{parsed=JSON.parse(body||'');}catch{throw new Error('看板插件返回了无法识别的结果');}
  if(!parsed || parsed.ok!==true)throw new Error('看板插件没有接受这次请求');
  return parsed;
}
class Transport {
  constructor(execute=run, request=httpRequest) {this.execute=execute;this.request=request;this.busy=false;this.bin=path.join(process.env.SystemRoot||'C:\\Windows','System32','OpenSSH');}
  async test(config) {
    const c=sanitize(config);
    if(c.connectionMode==='http')return this.testHttp(c);
    const {args,target}=argsFor(c);
    try {await this.execute(path.join(this.bin,'ssh.exe'),[...args,'-p',String(c.port),target,'test -d /mnt/us && test -w /mnt/us && command -v eips'],options);return {ok:true,message:'SSH 已连接，设备具备刷屏条件'};}
    catch(error) {throw new Error(explain(error));}
  }
  async testHttp(config) {
    const status=await this.readHttpStatus(config);
    const size=status.width&&status.height?`，屏幕 ${status.width}×${status.height}`:'';
    return {ok:true,message:`看板插件已连接${size}`};
  }
  async readHttpStatus(config) {
    const spec=httpCall(config,'GET','/status',null);
    let response;
    try{response=await this.request(spec);}catch(error){throw httpFailure(error);}
    if(response.status!==200)throw new Error(explainHttp(response.status));
    return parseStatus(response.body);
  }
  async push(config, pngPath) {
    const c=sanitize(config);
    if(c.connectionMode==='http')return this.pushHttp(c, pngPath);
    return this.pushSsh(c, pngPath);
  }
  async pushHttp(config, pngPath) {
    if(this.busy) throw new Error('上一轮推送仍在进行');
    this.busy=true;
    try {
      const buffer=await fs.readFile(pngPath);
      const image=readPage(buffer,config);
      const {rotation}=await this.readHttpStatus(config);
      if(![0,1,2,3].includes(rotation))throw new Error('看板插件返回了无法识别的屏幕方向');
      // KOReader maps its logical coordinates to the native panel by -rotation quarter turns.
      const payload=rotateImage(buffer,image,(placementTurns(config)+rotation)%4);
      const spec=httpCall(config,'POST','/dashboard.png',payload);
      let response;
      try{response=await this.request(spec);}catch(error){throw httpFailure(error);}
      if(response.status!==200)throw new Error(explainHttp(response.status));
      parseStatus(response.body);
      return {ok:true,message:'已通过看板插件更新图片'};
    } finally {this.busy=false;}
  }
  async pushSsh(config, pngPath) {
    if(this.busy) throw new Error('上一轮推送仍在进行');
    let uploadStarted=false;
    const {c,args,target}=argsFor(config),temp=`/mnt/us/dashboard.${randomUUID()}.tmp.png`;
    this.busy=true;
    const sshArgs=[...args,'-p',String(c.port),target];
    const refresh=wantsFramebuffer(c);
    let uploadFile;
    try {
      const buffer=await fs.readFile(pngPath);
      const native=payloadFor(buffer,c);
      uploadFile=path.join(path.dirname(pngPath),`.kindle-${randomUUID()}.png`);
      await fs.writeFile(uploadFile,native);
      await this.test(c);
      uploadStarted=true;
      await this.execute(path.join(this.bin,'scp.exe'),[...args,'-O','-P',String(c.port),'./'+path.basename(uploadFile),`${target}:${temp}`],{...options,cwd:path.dirname(uploadFile),timeout:45000});
      // Upload to a unique temp name on the same filesystem, then rename over the live file.
      await this.execute(path.join(this.bin,'ssh.exe'),[...sshArgs,installCommand(temp, refresh)],options);
      return {ok:true,message:refresh?'已推送并执行 Kindle 全屏刷新':'已推送看板图片，等待插件刷新'};
    } catch(error) {throw new Error(explain(error));}
    finally {
      // Best-effort cleanup also handles interrupted SCP writes.
      if(uploadStarted) await this.execute(path.join(this.bin,'ssh.exe'),[...sshArgs,`rm -f '${temp}'`],options).catch(()=>{});
      if(uploadFile)await fs.rm(uploadFile,{force:true}).catch(()=>{});
      this.busy=false;
    }
  }
}
module.exports={Transport,argsFor,explain,deviceImage,payloadFor,installCommand,httpCall,httpRequest,wantsFramebuffer};
