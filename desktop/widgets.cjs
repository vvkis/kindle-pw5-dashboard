(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DesktopWidgets=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 const TYPES={calendar:'日历',clock:'时间与日期',weather:'天气',cpuTemp:'CPU 温度',gpuTemp:'GPU 温度',cpuLoad:'CPU 占用',gpuLoad:'显卡占用',memoryLoad:'内存占用',gpuMemoryLoad:'显存占用',memoryUsed:'已用内存',gpuPower:'显卡功耗',system:'系统概览',trend:'温度趋势',note:'文字便签'};
 const GRID={columns:4,rows:6,x:64,y:134,width:1108,height:1356,gap:20};
 const defaults=()=>[
  {id:'clock',type:'clock',label:'时间与日期',x:0,y:0,w:2,h:2},
  {id:'weather',type:'weather',label:'天气',x:2,y:0,w:2,h:1},
  {id:'calendar',type:'calendar',label:'日历',x:2,y:1,w:1,h:1},
  {id:'note',type:'note',label:'今日便签',x:3,y:1,w:1,h:1},
  {id:'cpu',type:'cpuTemp',label:'CPU 温度',x:0,y:2,w:2,h:2},
  {id:'gpu',type:'gpuTemp',label:'GPU 温度',x:2,y:2,w:2,h:1},
  {id:'memory',type:'memoryLoad',label:'内存占用',x:2,y:3,w:2,h:1},
  {id:'system',type:'system',label:'系统概览',x:0,y:4,w:2,h:2},
  {id:'trend',type:'trend',label:'温度趋势',x:2,y:4,w:2,h:2}
 ];
 const intersects=(a,b)=>a.x<b.x+b.w&&a.x+a.w>b.x&&a.y<b.y+b.h&&a.y+a.h>b.y;
 function validate(widgets){
  if(!Array.isArray(widgets)||widgets.length>24)throw new Error('桌面最多支持 24 个组件');
  const ids=new Set();
  const out=widgets.map(w=>{
   if(!w||!TYPES[w.type]||typeof w.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(w.id)||ids.has(w.id))throw new Error('组件类型或标识无效');
   ids.add(w.id);
   for(const key of ['x','y','w','h'])if(!Number.isInteger(w[key]))throw new Error('组件需对齐网格');
   if(w.x<0||w.y<0||w.w<1||w.h<1||w.x+w.w>4||w.y+w.h>6)throw new Error('组件超出桌面范围');
   return {id:w.id,type:w.type,label:String(w.label||TYPES[w.type]).slice(0,20),x:w.x,y:w.y,w:w.w,h:w.h};
  });
  for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++)if(intersects(out[i],out[j]))throw new Error('组件不能重叠');
  return out;
 }
 function rect(widget){const cw=(GRID.width-GRID.gap*3)/4,ch=(GRID.height-GRID.gap*5)/6;return{x:GRID.x+widget.x*(cw+GRID.gap),y:GRID.y+widget.y*(ch+GRID.gap),width:widget.w*cw+(widget.w-1)*GRID.gap,height:widget.h*ch+(widget.h-1)*GRID.gap};}
 function move(widgets,id,x,y){
  const copy=widgets.map(w=>({...w})),widget=copy.find(w=>w.id===id);if(!widget)throw new Error('组件不存在');
  const old={...widget};widget.x=x;widget.y=y;
  const hits=copy.filter(w=>w.id!==id&&intersects(w,widget));
  if(hits.length&&hits.every(hit=>hit.x>=x&&hit.y>=y&&hit.x+hit.w<=x+widget.w&&hit.y+hit.h<=y+widget.h)){
   for(const hit of hits){hit.x=old.x+hit.x-x;hit.y=old.y+hit.y-y;}
  }
  return validate(copy);
 }
 function findSpace(widgets,w,h){for(let y=0;y<=6-h;y++)for(let x=0;x<=4-w;x++)if(!widgets.some(a=>intersects(a,{x,y,w,h})))return{x,y};return null;}
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(v>=100?0:1).replace(/\.0$/,''):'—';
 function text(x,y,value,size=24,extra='',maxWidth=1108){
  let str=String(value);const width=s=>Array.from(s).reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.6),0)*size;
  if(width(str)>maxWidth){while(str&&width(str+'…')>maxWidth)str=str.slice(0,-1);str+='…';}
  return `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${esc(str)}</text>`;
 }
 function chart(points,x,y,width,height){
  let pieces=[],piece=[];points.slice(-60).forEach((v,i,values)=>{if(typeof v!=='number'||!Number.isFinite(v)){if(piece.length)pieces.push(piece);piece=[];}else piece.push(`${x+i/Math.max(1,values.length-1)*width},${y+height-Math.max(0,Math.min(100,v))/100*height}`);});if(piece.length)pieces.push(piece);
  return pieces.filter(p=>p.length>1).map(p=>`<polyline points="${p.join(' ')}" fill="none" stroke="#111" stroke-width="3"/>`).join('');
 }
 function svg(config,sample,history=[],weather=null){
  const at=new Date(sample?.at||Date.now()),values=sample?.values||{},week=['日','一','二','三','四','五','六'][at.getDay()];
  const englishDay=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][at.getDay()];
  const rounded=(x,y,w,h,fill='#fff',stroke='none',radius=22)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const rule=(x,y,w,color='#c6c6c6')=>`<path d="M${x} ${y}h${w}" stroke="${color}" fill="none"/>`;
  const sun=(x,y,r,color='#fff')=>{let out=`<circle cx="${x}" cy="${y}" r="${r*.43}" fill="none" stroke="${color}" stroke-width="3"/>`;for(let i=0;i<8;i++){const a=i*Math.PI/4;out+=`<path d="M${x+Math.cos(a)*r*.7} ${y+Math.sin(a)*r*.7}L${x+Math.cos(a)*r} ${y+Math.sin(a)*r}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;}return out;};
  let body='<rect width="1236" height="1648" fill="#fff"/><g fill="#161616" font-family="Maple Mono NF CN,monospace">';
  body+=text(64,76,config.title,25,'',850)+text(980,76,'DESK / 01',18);
  for(const widget of validate(config.widgets||defaults())){
   const r=rect(widget),x=r.x,y=r.y,w=r.width,h=r.height,compact=h<260,narrow=w<400,pad=narrow?20:30;
   if(widget.type==='clock'){
    body+=text(x+8,y+45,englishDay,23,'letter-spacing="3"',w-20);
    if(!narrow){const cx=x+w-55,cy=y+34,rad=25;const ah=(at.getHours()%12+at.getMinutes()/60)*Math.PI/6-Math.PI/2,am=at.getMinutes()*Math.PI/30-Math.PI/2;body+=`<circle cx="${cx}" cy="${cy}" r="${rad}" stroke="#111" fill="none" stroke-width="2"/><path d="M${cx+Math.cos(ah)*15} ${cy+Math.sin(ah)*15}L${cx} ${cy}L${cx+Math.cos(am)*20} ${cy+Math.sin(am)*20}" fill="none" stroke="#111" stroke-width="3" stroke-linecap="round"/>`;}
    body+=text(x+2,y+h*(compact?.72:.56),at.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}),narrow?62:120,'font-weight="bold"',w-10);
    if(!compact){body+=rule(x+8,y+h-112,w-22,'#222');body+=text(x+8,y+h-64,`${at.getFullYear()} / ${String(at.getMonth()+1).padStart(2,'0')} / ${String(at.getDate()).padStart(2,'0')}`,26);body+=text(x+8,y+h-20,'星期'+week+'  ·  今天也从容一点',21,'',w-20);}
   }else if(widget.type==='weather'){
    body+=rounded(x,y,w,h,'#191919');body+='<g fill="#fff">';
    body+=text(x+pad,y+38,config.weather.name,narrow?17:21,'',w-pad*2);
    const active=config.weather.enabled!==false&&weather;
    body+=text(x+pad,y+h*(compact?.66:.53),active?`${fmt(weather.temperature)}°`:'—',narrow?56:78,'font-weight="bold"',w-pad*2);
    const label=active?`${weather.condition}  ${fmt(weather.low)}° / ${fmt(weather.high)}°`:'等待天气更新';
    body+=text(x+pad,y+h-24,label,narrow?16:21,'',w-pad*2);
    if(!narrow){body+=sun(x+w-75,y+h*.49,30);if(active&&weather.code>=1)body+=`<path d="M${x+w-104} ${y+h*.6}c-20 0-22-30-1-34 5-22 37-20 42 0 21 0 24 34 0 34Z" fill="#191919" stroke="#fff" stroke-width="3"/>`;}
    if(!compact)body+=text(x+pad,y+h-62,'周边网格预报 / Open-Meteo',17,'',w-pad*2);
    body+='</g>';
   }else if(widget.type==='calendar'){
    body+=rounded(x,y,w,h,'#f3f3f3','none',8);
    body+=`<rect x="${x}" y="${y}" width="${w}" height="42" rx="8" fill="#ddd"/>`;
    body+=text(x+w/2,y+29,(at.getMonth()+1)+'月',18,'text-anchor="middle"');
    body+=text(x+w/2,y+h*.73,at.getDate(),compact?86:112,'font-weight="bold" text-anchor="middle"');
    body+=text(x+w/2,y+h-18,'星期'+week,17,'text-anchor="middle"');
   }else if(widget.type==='note'){
    body+=`<path d="M${x} ${y}h${w-30}l30 30v${h-30}H${x}Z" fill="#fafafa" stroke="#b9b9b9" stroke-width="1.5"/><path d="M${x+w-30} ${y}v30h30" fill="none" stroke="#b9b9b9"/>`;
    body+=text(x+pad,y+35,widget.label,18,'',w-pad*2);
    const chars=Math.max(3,Math.floor((w-pad*2)/23)),phrases=(config.note||'').split(/(?<=[，。！？；])/u).filter(Boolean),lines=[];
    for(const phrase of phrases){const letters=Array.from(phrase);while(letters.length)lines.push(letters.splice(0,chars).join(''));}
    for(let i=0;i<Math.min(Math.floor((h-70)/35),lines.length);i++){body+=text(x+pad,y+83+i*35,lines[i],22,'',w-pad*2);body+=rule(x+pad,y+91+i*35,w-pad*2,'#dedede');}
   }else if(widget.type==='cpuTemp'&&!compact){
    body+=rounded(x,y,w,h,'#f6f6f6');body+=text(x+pad,y+49,widget.label,24,'',w-pad*2);
    const cx=x+w/2,cy=y+h*.56,radius=Math.min(w,h)*.275,value=values.cpuTemp;
    const arc=(start,end)=>{const point=a=>[cx+radius*Math.cos(a),cy+radius*Math.sin(a)];const a=point(start),b=point(end);return `M${a[0]} ${a[1]}A${radius} ${radius} 0 ${end-start>Math.PI?1:0} 1 ${b[0]} ${b[1]}`;};
    body+=`<path d="${arc(Math.PI*.75,Math.PI*2.25)}" fill="none" stroke="#dedede" stroke-width="13" stroke-linecap="round"/>`;
    if(value!=null)body+=`<path d="${arc(Math.PI*.75,Math.PI*.75+Math.max(.01,Math.min(1,value/100))*Math.PI*1.5)}" fill="none" stroke="#111" stroke-width="13" stroke-linecap="round"/>`;
    body+=text(cx,cy+13,fmt(value),narrow?56:80,'font-weight="bold" text-anchor="middle"');body+=text(cx,cy+53,'°C',24,'text-anchor="middle"');
    body+=text(cx,y+h-28,value==null?'等待传感器授权':'CPU PACKAGE / 实时',19,'text-anchor="middle"',w-pad*2);
   }else if(widget.type==='gpuTemp'){
    body+=rounded(x,y,w,h,'#fff','#333');const chipX=x+pad+4,chipY=y+(compact?75:h*.42);
    body+=`<rect x="${chipX}" y="${chipY}" width="45" height="45" rx="5" fill="none" stroke="#111" stroke-width="3"/>`;
    for(let i=1;i<4;i++)body+=`<path d="M${chipX+i*11} ${chipY-8}v8M${chipX+i*11} ${chipY+45}v8M${chipX-8} ${chipY+i*11}h8M${chipX+45} ${chipY+i*11}h8" stroke="#111" stroke-width="2"/>`;
    body+=text(x+pad,y+39,widget.label,21,'',w-pad*2);
    body+=text(x+pad+(narrow?0:85),y+h*(compact?.7:.6),`${fmt(values.gpuTemp)}${values.gpuTemp==null?'':'°C'}`,narrow?46:65,'font-weight="bold"',w-pad*2-(narrow?0:85));
    body+=text(x+pad,y+h-22,values.gpuTemp==null?'等待显卡传感器':`GPU LOAD  ${fmt(values.gpuLoad)}%`,17,'',w-pad*2);
   }else if(widget.type==='memoryLoad'||widget.type==='gpuMemoryLoad'){
    body+=text(x+pad,y+36,widget.label,21,'',w-pad*2)+text(x+w-pad,y+94,`${fmt(values[widget.type])}${values[widget.type]==null?'':'%'}`,compact?48:70,'font-weight="bold" text-anchor="end"',w-pad*2);
    const count=narrow?10:20,gap=6,bw=(w-pad*2-(count-1)*gap)/count,active=Math.round((values[widget.type]||0)/100*count);
    for(let i=0;i<count;i++)body+=rounded(x+pad+i*(bw+gap),y+h-66,bw,25,i<active?'#222':'#e6e6e6','none',3);
    body+=text(x+pad,y+h-18,widget.type==='memoryLoad'?`已用 ${fmt(values.memoryUsed)} GB`:'VIDEO MEMORY',17,'',w-pad*2);
   }else if(widget.type==='system'){
    body+=text(x+pad,y+45,widget.label,23,'',w-pad*2)+text(x+pad,y+76,'AT A GLANCE',15,'letter-spacing="2"');
    const items=[['CPU 占用','cpuLoad'],['GPU 占用','gpuLoad'],['内存占用','memoryLoad'],['显存占用','gpuMemoryLoad']],rowH=(h-110)/4;
    items.forEach(([label,key],i)=>{const sy=y+112+i*rowH;body+=text(x+pad,sy,label,narrow?15:20,'',w*.52)+text(x+w-pad,sy+4,`${fmt(values[key])}${values[key]==null?'':'%'}`,narrow?20:30,'text-anchor="end"',w*.45);if(i<3)body+=rule(x+pad,sy+rowH*.54,w-pad*2);});
   }else if(widget.type==='trend'){
    body+=rounded(x,y,w,h,'#f7f7f7');body+=text(x+pad,y+43,widget.label,22,'',w-pad*2);
    body+=text(x+pad,y+97,`${fmt(values.gpuTemp)}°`,narrow?34:48,'font-weight="bold"',w-pad*2)+text(x+w-pad,y+95,'GPU',17,'text-anchor="end"');
    const cy=y+(compact?105:135),ch=h-(compact?145:190);
    for(let i=0;i<4;i++)body+=rule(x+pad,cy+i/3*ch,w-pad*2,'#ddd');
    body+=chart(history.map(p=>p.values.cpuTemp),x+pad,cy,w-pad*2,ch);body+=`<g stroke-dasharray="8 6">${chart(history.map(p=>p.values.gpuTemp),x+pad,cy,w-pad*2,ch)}</g>`;
    body+=text(x+pad,y+h-22,'3 MIN / CPU —  GPU ···',narrow?13:16,'',w-pad*2);
   }else{
    const value=values[widget.type],unit=/Temp/.test(widget.type)?'°C':widget.type==='memoryUsed'?'GB':widget.type==='gpuPower'?'W':'%';
    body+=rounded(x,y,w,h,'#f7f7f7')+text(x+pad,y+40,widget.label,21,'',w-pad*2)+text(x+pad,y+h*.68,`${fmt(value)}${value==null?'':unit}`,narrow?44:66,'font-weight="bold"',w-pad*2);
   }
  }
  body+=text(64,1545,config.note,20,'',850);
  body+='<path d="M64 1572H1172" stroke="#222" stroke-width="2"/>';
  body+=text(64,1611,`${sample?.hostname||'LOCAL PC'} · ${at.toLocaleTimeString('zh-CN',{hour12:false})}`,18,'',700)+text(800,1611,'天气 / Open-Meteo',14)+text(1078,1611,'PW5',18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1236" height="1648" viewBox="0 0 1236 1648">${body}</g></svg>`;
 }
 return{TYPES,GRID,defaults,validate,rect,move,findSpace,svg};
});
