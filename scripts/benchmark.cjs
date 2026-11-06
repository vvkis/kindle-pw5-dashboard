const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFile}=require('node:child_process');
const {promisify}=require('node:util');
const {performance}=require('node:perf_hooks');
const {Sensors}=require('../desktop/sensors.cjs');
const run=promisify(execFile),root=path.resolve(__dirname,'..');
const seconds=Number(process.argv[2]||60),interval=3000;
const meter=path.join(root,'out','ProcessMeter.exe');
let commands=[];
async function execute(file,args,options){
  let result;
  try{result=await run(meter,[file,...args],options);}catch(error){result=error;}
  const match=result.stderr?.match(/PROCESS_METER ([\d.]+) (\d+) (\d+)/);
  commands.push({command:path.basename(file),cpuMs:match?Number(match[1]):null,wallMs:match?Number(match[2]):null,peakMiB:match?Number(match[3])/1024**2:null});
  if(result.code)throw result;return result;
}
(async()=>{
  await fs.access(meter);
  const startCpu=process.cpuUsage(),start=performance.now(),durations=[],rss=[],samples=[];
  const collector=new Sensors(path.join(root,'runtime'),execute);
  while(performance.now()-start<seconds*1000){
    const tick=performance.now();const sample=await collector.collect({cpuSensor:''});
    durations.push(performance.now()-tick);rss.push(process.memoryUsage().rss/1024**2);samples.push({at:sample.at,values:sample.values,sources:sample.sources});
    await new Promise(r=>setTimeout(r,Math.max(0,interval-(performance.now()-tick))));
  }
  const wallMs=performance.now()-start,cpu=process.cpuUsage(startCpu),nodeCpuMs=(cpu.user+cpu.system)/1000;
  if(commands.some(command=>command.cpuMs===null))throw new Error('ProcessMeter 未取得完整子进程 CPU 时间，拒绝输出不完整报告');
  const childrenCpuMs=commands.reduce((sum,c)=>sum+(c.cpuMs||0),0),totalCpuMs=nodeCpuMs+childrenCpuMs;
  const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
  const report={at:new Date().toISOString(),durationSeconds:wallMs/1000,intervalSeconds:3,sampleCount:samples.length,cpu:os.cpus()[0].model,logicalProcessors:os.cpus().length,
    collectorCpuMs:nodeCpuMs,childCpuMs:childrenCpuMs,totalCpuMs,oneCorePercent:totalCpuMs/wallMs*100,wholeMachinePercent:totalCpuMs/wallMs/os.cpus().length*100,
    sampleWallMs:{mean:mean(durations),max:Math.max(...durations)},collectorMemoryMiB:{mean:mean(rss),max:Math.max(...rss)},commands,samples,
    scope:'Actual collector and actual child process CPU; ProcessMeter instrumentation overhead excluded. Electron renderer/main/GPU and elevated helper are measured separately. Sensor values are live; unavailable CPU temperature stays null.'};
  await fs.writeFile(path.join(root,'out','benchmark-collector.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,commands:commands.length,samples:samples.length},null,2));
})().catch(e=>{console.error(e);process.exitCode=1;});
