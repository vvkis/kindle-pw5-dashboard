const fs=require('node:fs/promises');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {selectCpuSensor}=require('./sensors.cjs');

const quote=value=>`'${String(value).replace(/'/g,"''")}'`;
async function enableTemperature(runtime,resources,sensors,execute,onProgress=()=>{},options={}) {
  const current=await sensors.readHelper();
  if(current?.elevated&&selectCpuSensor(current.sensors||[]))return {message:'CPU 温度采集器已运行'};
  const helper=path.join(resources,'sensors','SensorHelper.exe');
  const bootstrap=path.join(resources,'sensors','EnableSensors.ps1');
  const library=path.join(resources,'lhm');
  for(const file of [helper,bootstrap,path.join(library,'LibreHardwareMonitorLib.dll'),path.join(resources,'sensors','PawnIO_setup.exe')])await fs.access(file);
  const operation=randomUUID(),statusFile=path.join(runtime,'sensor-start.json');
  const argumentsString=['-NoProfile','-ExecutionPolicy','Bypass','-File',`"${bootstrap}"`,'-Library',`"${library}"`,'-Runtime',`"${runtime}"`,'-Operation',operation].join(' ');
  const script=`$ErrorActionPreference='Stop'; Start-Process -FilePath ${quote(path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe'))} -Verb RunAs -WindowStyle Hidden -ArgumentList ${quote(argumentsString)}`;
  const powershell=path.join(process.env.SystemRoot||'C:\\Windows','System32','WindowsPowerShell','v1.0','powershell.exe');
  try{await execute(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,timeout:90000});}
  catch(error){throw new Error(/cancel|1223|取消/i.test(String(error.stderr||error.message))?'已取消管理员授权，CPU 温度尚未启用。':'无法启动温度采集器：'+String(error.stderr||error.message).slice(-800));}
  const deadline=Date.now()+(options.timeoutMs??150000),sleep=options.sleep||(ms=>new Promise(resolve=>setTimeout(resolve,ms)));
  let phase='';
  while(Date.now()<deadline){
    let status;
    try{status=JSON.parse((await fs.readFile(statusFile,'utf8')).replace(/^\uFEFF/,''));}catch{}
    if(status?.operation===operation){
      if(status.phase!==phase){phase=status.phase;onProgress(status.message);}
      if(status.phase==='error')throw new Error(status.message);
      if(status.phase==='reboot-required')throw new Error('温度驱动已准备好，需要重启 Windows；重启后再次点击「启用 CPU 温度」。');
      if(status.phase==='ready'){
        const live=await sensors.readHelper();
        if(live?.elevated&&selectCpuSensor(live.sensors||[]))return {message:'CPU 温度已连接'};
      }
    }
    await sleep(400);
  }
  throw new Error('启用 CPU 温度超时，请查看本地 sensor-start.json 和 sensor-setup.log。');
}
module.exports={enableTemperature};
