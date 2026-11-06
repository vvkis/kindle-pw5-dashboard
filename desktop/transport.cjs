const path=require('node:path');
const fs=require('node:fs/promises');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {randomUUID}=require('node:crypto');
const {PNG}=require('pngjs');
const {sanitize}=require('./model.cjs');
const {screen}=require('./widgets.cjs');
const run=promisify(execFile);
const options={windowsHide:true,timeout:20000,maxBuffer:512*1024};
function deviceImage(buffer,config){
  const page=screen(config.orientation),image=PNG.sync.read(buffer,{checkCRC:true});
  if(image.width!==page.width||image.height!==page.height||buffer[24]!==8||buffer[25]!==0)throw new Error(`图片必须是 ${page.width}×${page.height} 的 8-bit 灰阶 PNG`);
  if(config.orientation!=='landscape')return buffer;
  // Keep the framebuffer in its native portrait orientation; compensate for physical placement.
  const native=new PNG({width:1236,height:1648});
  for(let y=0;y<image.height;y++)for(let x=0;x<image.width;x++){
    const dx=config.landscapeTop==='right'?y:image.height-1-y;
    const dy=config.landscapeTop==='right'?image.width-1-x:x;
    image.data.copy(native.data,(dy*native.width+dx)*4,(y*image.width+x)*4,(y*image.width+x)*4+4);
  }
  return PNG.sync.write(native,{colorType:0,inputColorType:6,bitDepth:8});
}
function argsFor(config) {
  const c=sanitize(config);
  const args=['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=5','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2'];
  if(c.identityFile) args.push('-i',c.identityFile);
  return {c,args,target:`root@${c.host}`};
}
function explain(error) {
  const raw=String(error.stderr||error.message||error).trim();
  if(/Host key verification failed/.test(raw)) return '主机密钥尚未信任或已变化。请先核对设备指纹并用 SSH 完成首次登录。';
  if(/Permission denied/.test(raw)) return 'SSH 认证失败，请检查私钥与 Kindle authorized_keys。';
  if(/timed out|unreachable|refused|killed/i.test(raw)) return 'USB 连接不可达。请检查 USBNetwork、地址，并唤醒 Kindle。';
  return raw.slice(-1500);
}
class Transport {
  constructor(execute=run) {this.execute=execute;this.busy=false;this.bin=path.join(process.env.SystemRoot||'C:\\Windows','System32','OpenSSH');}
  async test(config) {
    const {c,args,target}=argsFor(config);
    try {await this.execute(path.join(this.bin,'ssh.exe'),[...args,'-p',String(c.port),target,'test -d /mnt/us && test -w /mnt/us && command -v eips'],options);return {ok:true,message:'SSH 已连接，设备具备刷屏条件'};}
    catch(error) {throw new Error(explain(error));}
  }
  async push(config,pngPath) {
    if(this.busy) throw new Error('上一轮推送仍在进行');
    let uploadStarted=false;
    const {c,args,target}=argsFor(config),temp=`/mnt/us/dashboard.${randomUUID()}.tmp.png`;
    this.busy=true;
    const sshArgs=[...args,'-p',String(c.port),target];
    let uploadFile;
    try {
      const buffer=await fs.readFile(pngPath);
      const native=deviceImage(buffer,c);
      uploadFile=path.join(path.dirname(pngPath),`.kindle-${randomUUID()}.png`);
      await fs.writeFile(uploadFile,native);
      await this.test(c);
      uploadStarted=true;
      await this.execute(path.join(this.bin,'scp.exe'),[...args,'-O','-P',String(c.port),'./'+path.basename(uploadFile),`${target}:${temp}`],{...options,cwd:path.dirname(uploadFile),timeout:45000});
      await this.execute(path.join(this.bin,'ssh.exe'),[...sshArgs,`test -s '${temp}' && mv '${temp}' /mnt/us/dashboard.png && eips -f -g /mnt/us/dashboard.png`],options);
      return {ok:true,message:'已推送并执行 Kindle 全屏刷新'};
    } catch(error) {throw new Error(explain(error));}
    finally {
      // Best-effort cleanup also handles interrupted SCP writes.
      if(uploadStarted) await this.execute(path.join(this.bin,'ssh.exe'),[...sshArgs,`rm -f '${temp}'`],options).catch(()=>{});
      if(uploadFile)await fs.rm(uploadFile,{force:true}).catch(()=>{});
      this.busy=false;
    }
  }
}
module.exports={Transport,argsFor,explain,deviceImage};
