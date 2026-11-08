// Font parsing and raster allocations live only for this export job.
process.parentPort.once('message',async event=>{
  try{
    const {config,sample,history,target,weather,fonts,device}=event.data;
    await require('./render.cjs').renderPng(config,sample,history,target,weather,fonts,device);
    process.parentPort.postMessage({ok:true,target});
    setTimeout(()=>process.exit(0),20);
  }catch(error){process.parentPort.postMessage({ok:false,error:error.message});setTimeout(()=>process.exit(1),20);}
});
