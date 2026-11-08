const path=require('node:path');
function renderJob(config,sample,history,target,weather,fonts,device){
  const {utilityProcess}=require('electron');
  return new Promise((resolve,reject)=>{
    let result,errors='';
    const child=utilityProcess.fork(path.join(__dirname,'render-worker.cjs'),[],{serviceName:'PNG Export',stdio:'pipe'});
    const timeout=setTimeout(()=>{child.kill();},30000);
    child.stderr?.on('data',data=>{errors=(errors+data.toString()).slice(-4000);});
    child.once('spawn',()=>child.postMessage({config,sample,history,target,weather,fonts,device}));
    child.once('message',message=>{result=message;});
    child.once('exit',code=>{clearTimeout(timeout);if(result?.ok&&code===0)resolve(result.target);else reject(new Error(result?.error||errors||'图片导出进程异常退出'));});
  });
}
module.exports={renderJob};
