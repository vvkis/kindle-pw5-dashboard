const conditions=code=>{
  if(code===0)return '晴';if(code<=3)return '多云';if(code===45||code===48)return '雾';
  if(code>=51&&code<=67)return '雨';if(code>=71&&code<=77)return '雪';if(code>=80&&code<=82)return '阵雨';if(code>=85&&code<=86)return '阵雪';if(code>=95)return '雷雨';return '天气';
};
class Weather {
  constructor(){this.value=null;this.key='';this.last=0;this.busy=false;}
  async update(config,force=false){
    const w=config.weather,key=`${w.latitude},${w.longitude}`;
    if(!w.enabled){this.value=null;return;}
    if(this.busy||!force&&key===this.key&&Date.now()-this.last<900000)return;
    if(key!==this.key){this.value=null;this.key=key;}
    this.busy=true;this.last=Date.now();
    try{
      const query=new URLSearchParams({latitude:String(w.latitude),longitude:String(w.longitude),current:'temperature_2m,weather_code',daily:'temperature_2m_max,temperature_2m_min',forecast_days:'1',timezone:'auto'});
      const response=await fetch('https://api.open-meteo.com/v1/forecast?'+query,{signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('天气请求失败');const data=await response.json();
      if(!Number.isFinite(data.current?.temperature_2m))throw new Error('天气数据不完整');
      this.value={temperature:data.current.temperature_2m,condition:conditions(data.current.weather_code),code:data.current.weather_code,low:data.daily?.temperature_2m_min?.[0],high:data.daily?.temperature_2m_max?.[0],at:new Date().toISOString(),stale:false};
    }catch{if(this.value)this.value.stale=true;}finally{this.busy=false;}
  }
  async search(name){
    if(typeof name!=='string'||!name.trim()||name.length>80)throw new Error('请输入城市名');
    const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+new URLSearchParams({name:name.trim(),count:'8',language:'zh',format:'json'}),{signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw new Error('城市查找失败');const data=await response.json();
    return(data.results||[]).map(r=>({name:[r.name,r.admin1,r.country].filter(Boolean).join(' · '),latitude:r.latitude,longitude:r.longitude}));
  }
}
module.exports={Weather,conditions};
