const os = require('node:os');
const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);
const finite = v => { const n = Number(v); return v !== null && v !== '' && Number.isFinite(n) ? n : null; };
const cpuTicks = () => os.cpus().reduce((sum,cpu) => {
  sum.idle += cpu.times.idle; sum.total += Object.values(cpu.times).reduce((a,b)=>a+b,0); return sum;
}, {idle:0,total:0});

function parseNvidia(output) {
  // First GPU is the display adapter in this first version. N/A is never treated as zero.
  const row = output.trim().split(/\r?\n/)[0]?.split(',').map(s=>s.trim());
  if (!row || row.length !== 6) throw new Error('无法解析 NVIDIA 数据');
  const [name,temp,load,used,total,power] = row;
  const usedN=finite(used), totalN=finite(total);
  return { name, gpuTemp:finite(temp), gpuLoad:finite(load), gpuPower:finite(power), gpuMemoryUsed:usedN===null?null:usedN/1024,
    gpuMemoryLoad:usedN!==null&&totalN>0 ? usedN/totalN*100 : null };
}

function selectCpuSensor(sensors, selected='') {
  const available=sensors.filter(s=>s.type==='Temperature' && /cpu/i.test(s.id) && finite(s.value)>0 && finite(s.value)<150);
  if(selected) return available.find(s=>s.id===selected) || null;
  const ranked = available.map(s=>({s,rank:/package|tctl\/tdie|core \(tctl/i.test(s.name)?0:/tdie|average/i.test(s.name)?1:2}));
  ranked.sort((a,b)=>a.rank-b.rank || b.s.value-a.s.value);
  return ranked[0]?.s || null;
}

class Sensors {
  constructor(runtime,execute=run) { this.runtime=runtime; this.execute=execute; this.previous=cpuTicks(); this.lastWmi=0; this.wmi=[]; }
  async readHelper() {
    try {
      const data=JSON.parse((await fs.readFile(path.join(this.runtime,'sensors.json'),'utf8')).replace(/^\uFEFF/,''));
      const age=Date.now()-new Date(data.at).getTime();
      if(!Number.isFinite(age)||age>15000||age< -5000) throw new Error('传感器数据已过期');
      return data;
    } catch { return null; }
  }
  async collect(config) {
    const ticks=cpuTicks(), elapsed=ticks.total-this.previous.total;
    const cpuLoad=elapsed>0 ? Math.max(0,Math.min(100,(1-(ticks.idle-this.previous.idle)/elapsed)*100)) : null;
    this.previous=ticks;
    const used=os.totalmem()-os.freemem();
    const values={cpuLoad,memoryUsed:used/1024**3,memoryLoad:used/os.totalmem()*100,cpuTemp:null,gpuTemp:null,gpuLoad:null,gpuPower:null,gpuMemoryLoad:null};
    const messages=[];
    const helper=await this.readHelper();
    const all=helper?.sensors||[];
    const gpuId=all.find(s=>/gpu-nvidia/.test(s.id))?.id.split('/').slice(0,3).join('/') || all.find(s=>/gpu-amd|gpu-intel/.test(s.id))?.id.split('/').slice(0,3).join('/');
    const gpuSensors=all.filter(s=>gpuId&&s.id.startsWith(gpuId+'/'));
    const helperGpu=gpuSensors.some(s=>s.type==='Temperature'&&/^GPU Core$/i.test(s.name)&&finite(s.value)>0);
    const gpuResult=helperGpu?null:await this.execute(path.join(process.env.SystemRoot||'C:\\Windows','System32','nvidia-smi.exe'),[
        '--query-gpu=name,temperature.gpu,utilization.gpu,memory.used,memory.total,power.draw','--format=csv,noheader,nounits'
      ],{windowsHide:true,timeout:5000,maxBuffer:128*1024}).then(r=>parseNvidia(r.stdout)).catch(()=>null);
    if(gpuResult) for(const key of ['gpuTemp','gpuLoad','gpuPower','gpuMemoryLoad']) values[key]=gpuResult[key];
    // Do not repeatedly spawn PowerShell/WMI probes while no temperature source is running.
    const sensors=helper?.sensors || [];
    const cpu=selectCpuSensor(sensors,config.cpuSensor);
    if(cpu) values.cpuTemp=finite(cpu.value);
    const gpuSensor=gpuSensors.find(s=>s.type==='Temperature' && /^GPU Core$/i.test(s.name) && finite(s.value)>0);
    if(values.gpuTemp===null && gpuSensor) values.gpuTemp=finite(gpuSensor.value);
    for(const [key,type,name] of [['gpuLoad','Load',/^GPU Core$/i],['gpuPower','Power',/^GPU Package|GPU Power$/i],['gpuMemoryLoad','Load',/^GPU Memory$/i]]) {
      const sensor=gpuSensors.find(s=>s.type===type && name.test(s.name));
      if(values[key]===null && sensor) values[key]=finite(sensor.value);
    }
    if(!cpu) messages.push(helper?.error || (config.cpuSensor?'指定的 CPU 传感器暂无数据，请重新选择。':helper?.elevated?'采集器已运行，但 CPU 温度暂不可用，请检查硬件兼容性与系统驱动策略。':'CPU 温度未连接。点击「启用 CPU 温度」启动内置采集器。'));
    if(!gpuResult && !gpuSensor) messages.push('未找到 GPU 传感器；NVIDIA 可使用 nvidia-smi，其他显卡请启用采集器。');
    return {at:new Date().toISOString(),cpuName:os.cpus()[0]?.model||'CPU',gpuName:gpuResult?.name||helper?.gpus?.find(g=>g.id===gpuId)?.name||'GPU',
      memoryTotal:os.totalmem()/1024**3,values,messages,sensors:sensors.filter(s=>s.type==='Temperature'),
      sources:{cpu:cpu?(helper?'内置 LibreHardwareMonitor':'LibreHardwareMonitor WMI'):'未连接',gpu:gpuResult?'NVIDIA 驱动':gpuSensor?'LibreHardwareMonitor':'未连接'},helper:helper?{elevated:helper.elevated,error:helper.error}:null};
  }
}
module.exports={Sensors,parseNvidia,selectCpuSensor};
