(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DesktopWidgets=factory();})(typeof globalThis==='object'?globalThis:this,function(){
 const TYPES={calendar:'日历',clock:'时间与日期',weather:'天气',cpuTemp:'CPU 温度',gpuTemp:'GPU 温度',cpuLoad:'CPU 占用',gpuLoad:'显卡占用',memoryLoad:'内存占用',gpuMemoryLoad:'显存占用',memoryUsed:'已用内存',gpuPower:'显卡功耗',system:'系统概览',trend:'温度趋势',note:'文字便签',image:'图片'};
 const IMAGE_MAX_SIDE=768;
 const IMAGE_VIEW=Object.freeze({fit:'contain',zoom:100,x:0,y:0});
 const BAYER=[0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5];
 function mapImage(data,width,mono=false){
  for(let i=0;i<data.length;i+=4){
   const luminance=Math.round(.2126*data[i]+.7152*data[i+1]+.0722*data[i+2]);
   let value=luminance;
   if(mono){
    const pixel=i/4,x=pixel%width,y=Math.floor(pixel/width);
    value=luminance>(BAYER[(y%4)*4+x%4]+.5)*16?255:0;
   }
   data[i]=data[i+1]=data[i+2]=value;
  }
 }
 function imageData(value){
  if(typeof value!=='string'||value.length>2_000_000||!/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('组件图片无效或过大');
  return value;
 }
 function imageSize(data){
  const header=atob(data.slice('data:image/png;base64,'.length,'data:image/png;base64,'.length+32));
  const width=header.charCodeAt(16)*2**24+header.charCodeAt(17)*2**16+header.charCodeAt(18)*256+header.charCodeAt(19);
  const height=header.charCodeAt(20)*2**24+header.charCodeAt(21)*2**16+header.charCodeAt(22)*256+header.charCodeAt(23);
  if(!(width>0&&height>0))throw new Error('组件图片尺寸无效');
  return {width,height};
 }
 const GRID={columns:4,rows:6,x:64,y:134,width:1108,height:1356,gap:20};
 function screen(orientation='portrait'){
  return orientation==='landscape'?{width:1648,height:1236,grid:{columns:6,rows:4,x:64,y:118,width:1520,height:972,gap:20}}:{width:1236,height:1648,grid:GRID};
 }
 const defaults=(orientation='portrait')=>orientation==='landscape'?[
  {id:'clock',type:'clock',label:'时间与日期',x:0,y:0,w:2,h:2},
  {id:'weather',type:'weather',label:'天气',x:2,y:0,w:2,h:1},
  {id:'calendar',type:'calendar',label:'日历',x:2,y:1,w:1,h:1},
  {id:'note',type:'note',label:'今日便签',x:3,y:1,w:1,h:1},
  {id:'cpu',type:'cpuTemp',label:'CPU 温度',x:4,y:0,w:2,h:2},
  {id:'gpu',type:'gpuTemp',label:'GPU 温度',x:0,y:2,w:2,h:1},
  {id:'memory',type:'memoryLoad',label:'内存占用',x:0,y:3,w:2,h:1},
  {id:'system',type:'system',label:'系统概览',x:2,y:2,w:2,h:2},
  {id:'trend',type:'trend',label:'温度趋势',x:4,y:2,w:2,h:2}
 ]:[
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
 function validate(widgets,orientation='portrait'){
  const grid=screen(orientation).grid;
  if(!Array.isArray(widgets)||widgets.length>24)throw new Error('桌面最多支持 24 个组件');
  const ids=new Set();
  const out=widgets.map(w=>{
   if(!w||!TYPES[w.type]||typeof w.id!=='string'||!/^[a-zA-Z0-9_-]{1,60}$/.test(w.id)||ids.has(w.id))throw new Error('组件类型或标识无效');
   ids.add(w.id);
   for(const key of ['x','y','w','h'])if(!Number.isInteger(w[key]))throw new Error('组件需对齐网格');
   if(w.x<0||w.y<0||w.w<1||w.h<1||w.x+w.w>grid.columns||w.y+w.h>grid.rows)throw new Error('组件超出桌面范围');
   const out={id:w.id,type:w.type,label:String(w.label||TYPES[w.type]).slice(0,20),x:w.x,y:w.y,w:w.w,h:w.h};
   if(w.type==='note'&&w.content!==undefined)out.content=String(w.content).replace(/\r\n?/g,'\n').replace(/[\x00-\x09\x0b-\x1f]/g,' ').slice(0,2000);
   if(w.type==='image'){
    out.imageMode=w.imageMode==='mono'?'mono':'gray';
    if(w.image!==undefined)out.image={gray:imageData(w.image?.gray),mono:imageData(w.image?.mono)};
    const {fit,zoom,x,y}={...IMAGE_VIEW,...w.imageView};
    if(!['contain','cover'].includes(fit)||!Number.isInteger(zoom)||zoom<25||zoom>400||![x,y].every(value=>Number.isInteger(value)&&Math.abs(value)<=100))throw new Error('图片缩放或裁剪设置无效');
    out.imageView={fit,zoom,x,y};
   }
   return out;
  });
  for(let i=0;i<out.length;i++)for(let j=i+1;j<out.length;j++)if(intersects(out[i],out[j]))throw new Error('组件不能重叠');
  return out;
 }
 function rect(widget,orientation='portrait'){const grid=screen(orientation).grid,cw=(grid.width-grid.gap*(grid.columns-1))/grid.columns,ch=(grid.height-grid.gap*(grid.rows-1))/grid.rows;return{x:grid.x+widget.x*(cw+grid.gap),y:grid.y+widget.y*(ch+grid.gap),width:widget.w*cw+(widget.w-1)*grid.gap,height:widget.h*ch+(widget.h-1)*grid.gap};}
 function move(widgets,id,x,y,orientation='portrait'){
  const copy=widgets.map(w=>({...w})),widget=copy.find(w=>w.id===id);if(!widget)throw new Error('组件不存在');
  const old={...widget};widget.x=x;widget.y=y;
  const hits=copy.filter(w=>w.id!==id&&intersects(w,widget));
  if(hits.length&&hits.every(hit=>hit.x>=x&&hit.y>=y&&hit.x+hit.w<=x+widget.w&&hit.y+hit.h<=y+widget.h)){
   for(const hit of hits){hit.x=old.x+hit.x-x;hit.y=old.y+hit.y-y;}
  }
  return validate(copy,orientation);
 }
 function findSpace(widgets,w,h,orientation='portrait'){const grid=screen(orientation).grid;for(let y=0;y<=grid.rows-h;y++)for(let x=0;x<=grid.columns-w;x++)if(!widgets.some(a=>intersects(a,{x,y,w,h})))return{x,y};return null;}
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
 const fmt=v=>typeof v==='number'&&Number.isFinite(v)?v.toFixed(v>=100?0:1).replace(/\.0$/,''):'—';
 function text(x,y,value,size=24,extra='',maxWidth=1108){
  let str=String(value);const width=s=>Array.from(s).reduce((n,c)=>n+(c.charCodeAt(0)>255?1:.6),0)*size;
  if(width(str)>maxWidth){while(str&&width(str+'…')>maxWidth)str=str.slice(0,-1);str+='…';}
  return `<text x="${x}" y="${y}" font-size="${size}" ${extra}>${esc(str)}</text>`;
 }
 function chart(history,key,end,x,y,width,height){
  const start=end-180000;
  let pieces=[],piece=[];
  for(const point of history){
   const timestamp=Date.parse(point.at);
   if(!Number.isFinite(timestamp)||timestamp<start||timestamp>end)continue;
   const value=point.values[key];
   if(typeof value!=='number'||!Number.isFinite(value)){if(piece.length)pieces.push(piece);piece=[];}
   else piece.push([x+(timestamp-start)/180000*width,y+height-Math.max(0,Math.min(100,value))/100*height]);
  }
  if(piece.length)pieces.push(piece);
  return pieces.map(points=>points.length===1
   ?`<circle cx="${points[0][0]}" cy="${points[0][1]}" r="3" fill="currentColor"/>`
   :`<polyline points="${points.join(' ')}" fill="none" stroke="currentColor" stroke-width="3"/>`).join('');
 }
 function svg(config,sample,history=[],weather=null){
  const page=screen(config.orientation);
  const at=new Date(sample?.at||Date.now()),values=sample?.values||{},week=['日','一','二','三','四','五','六'][at.getDay()];
  const englishDay=['SUNDAY','MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY'][at.getDay()];
  const rounded=(x,y,w,h,fill='#fff',stroke='none',radius=22)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" stroke-width="2"/>`;
  const rule=(x,y,w,color='#c6c6c6')=>`<path d="M${x} ${y}h${w}" stroke="${color}" fill="none"/>`;
  const sun=(x,y,r,color='#fff')=>{let out=`<circle cx="${x}" cy="${y}" r="${r*.43}" fill="none" stroke="${color}" stroke-width="3"/>`;for(let i=0;i<8;i++){const a=i*Math.PI/4;out+=`<path d="M${x+Math.cos(a)*r*.7} ${y+Math.sin(a)*r*.7}L${x+Math.cos(a)*r} ${y+Math.sin(a)*r}" stroke="${color}" stroke-width="3" stroke-linecap="round"/>`;}return out;};
  let body=`<rect width="${page.width}" height="${page.height}" fill="#fff"/><g fill="#161616" font-family="Maple Mono NF CN,monospace" font-weight="${config.fontWeight===400?400:700}">`;
  body+=text(64,76,config.title,25,'',850)+text(page.width-256,76,'DESK / 01',18);
  for(const widget of validate(config.widgets||defaults(config.orientation),config.orientation)){
   const r=rect(widget,config.orientation),x=r.x,y=r.y,w=r.width,h=r.height,compact=h<260,narrow=w<400,pad=narrow?20:30;
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
   }else if(widget.type==='image'){
    if(widget.image){
     const source=widget.image[widget.imageMode],native=imageSize(source),view=widget.imageView;
     const fit=view.fit==='cover'?Math.max:Math.min;
     const scale=fit(w/native.width,h/native.height)*view.zoom/100;
     const width=native.width*scale,height=native.height*scale;
     const left=x+(w-width)*(view.x+100)/200,top=y+(h-height)*(view.y+100)/200;
     const clip=`image-clip-${widget.id}`;
     const rendering=widget.imageMode==='mono'?' image-rendering="optimizeSpeed"':'';
     body+=`<defs><clipPath id="${clip}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/></clipPath></defs><image x="${left}" y="${top}" width="${width}" height="${height}" preserveAspectRatio="none" clip-path="url(#${clip})"${rendering} href="${source}"/>`;
    }else{
     body+=rounded(x,y,w,h,'#f7f7f7','#ddd')+text(x+w/2,y+h/2,'请选择图片',24,'text-anchor="middle"',w-24);
    }
   }else if(widget.type==='note'){
    body+=`<path d="M${x} ${y}h${w-30}l30 30v${h-30}H${x}Z" fill="#fafafa" stroke="#b9b9b9" stroke-width="1.5"/><path d="M${x+w-30} ${y}v30h30" fill="none" stroke="#b9b9b9"/>`;
    body+=text(x+pad,y+35,widget.label,18,'',w-pad*2);
    const chars=Math.max(3,Math.floor((w-pad*2)/23)),paragraphs=(widget.content??config.note??'').split('\n'),lines=[];
    for(const paragraph of paragraphs){const letters=Array.from(paragraph);if(!letters.length)lines.push('');while(letters.length)lines.push(letters.splice(0,chars).join(''));}
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
    const half=(w-pad*2)/2;
    for(const [index, label, key, color, dash] of [[0,'CPU','cpuTemp','#111',''],[1,'GPU','gpuTemp','#555',' stroke-dasharray="8 6"']]){
     const left=x+pad+half*index;
     const reading=values[key];
     body+=`<path d="M${left} ${y+64}h22" stroke="${color}" stroke-width="3"${dash}/>`;
     body+=text(left+29,y+69,label,17,'',half-29);
     body+=text(left,y+102,reading==null?'—':`${fmt(reading)}°C`,narrow?24:34,'font-weight="bold"',half-4);
    }
    const cy=y+(compact?105:135),ch=h-(compact?145:190);
    for(let i=0;i<4;i++)body+=rule(x+pad,cy+i/3*ch,w-pad*2,'#ddd');
    body+=`<g color="#111">${chart(history,'cpuTemp',at.getTime(),x+pad,cy,w-pad*2,ch)}</g>`;
    body+=`<g color="#555" stroke-dasharray="8 6">${chart(history,'gpuTemp',at.getTime(),x+pad,cy,w-pad*2,ch)}</g>`;
    body+=text(x+pad,y+h-22,'最近 3 分钟',narrow?13:16,'',w-pad*2);
   }else{
    const value=values[widget.type],unit=/Temp/.test(widget.type)?'°C':widget.type==='memoryUsed'?'GB':widget.type==='gpuPower'?'W':'%';
    body+=rounded(x,y,w,h,'#f7f7f7')+text(x+pad,y+40,widget.label,21,'',w-pad*2)+text(x+pad,y+h*.68,`${fmt(value)}${value==null?'':unit}`,narrow?44:66,'font-weight="bold"',w-pad*2);
   }
  }
  body+=text(64,page.height-103,config.note,20,'',page.width-386);
  body+=`<path d="M64 ${page.height-76}H${page.width-64}" stroke="#222" stroke-width="2"/>`;
  body+=text(64,page.height-37,`更新于 ${at.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false})}`,18,'',page.width-536)+text(page.width-436,page.height-37,'天气 / Open-Meteo',14)+text(page.width-158,page.height-37,'PW5',18);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${page.width}" height="${page.height}" viewBox="0 0 ${page.width} ${page.height}">${body}</g></svg>`;
 }
 return{TYPES,GRID,IMAGE_MAX_SIDE,IMAGE_VIEW,mapImage,screen,defaults,validate,rect,move,findSpace,svg};
});
