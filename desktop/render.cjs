const fs=require('node:fs/promises');
const {Resvg}=require('@resvg/resvg-js');
const {PNG}=require('pngjs');
const Model=require('./model.cjs');
const Widgets=require('./widgets.cjs');
const {systemFonts}=require('./fonts.cjs');
async function renderPng(config,sample,history,target,weather=null,fonts,device){
  if(!sample)throw new Error('请等待第一轮传感器采样');
  const clean=Model.sanitize(config);
  const installed=new Map((fonts??await systemFonts()).map(font=>[font.name,font.files]));
  const available=[...installed.keys()],fallback=Widgets.fallbackFonts(available);
  const families=new Set([...fallback,...clean.widgets.map(widget=>widget.fontFamily)]);
  const fontFiles=[...new Set([...families].flatMap(family=>installed.get(family)??[]))];
  const svg=Widgets.svg(clean,sample,history,weather,available,device);
  const image=new Resvg(svg,{font:{fontFiles,loadSystemFonts:!fontFiles.length,defaultFontFamily:fallback[0]??'sans-serif'}}).render().asPng();
  const decoded=PNG.sync.read(image);
  const page=Widgets.screen(clean.orientation,Widgets.displayFor(clean,device));
  if(decoded.width!==page.width||decoded.height!==page.height)throw new Error('导出画布尺寸异常');
  const output=PNG.sync.write(decoded,{colorType:0,inputColorType:6,bitDepth:8});
  if(output[25]!==0)throw new Error('灰阶编码失败');
  await fs.writeFile(target+'.tmp',output);await fs.rename(target+'.tmp',target);return target;
}
module.exports={renderPng};
