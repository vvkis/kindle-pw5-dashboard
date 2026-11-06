const fs=require('node:fs/promises');
const path=require('node:path');
const {Resvg}=require('@resvg/resvg-js');
const {PNG}=require('pngjs');
const Model=require('./model.cjs');
async function renderPng(config,sample,history,fontsDir,target,weather=null){
  if(!sample)throw new Error('请等待第一轮传感器采样');
  const svg=Model.dashboardSvg(config,sample,history,weather);
  const image=new Resvg(svg,{font:{fontFiles:[path.join(fontsDir,'MapleMono-NF-CN-Regular.ttf'),path.join(fontsDir,'MapleMono-NF-CN-Bold.ttf')],loadSystemFonts:false,defaultFontFamily:'Maple Mono NF CN'}}).render().asPng();
  const decoded=PNG.sync.read(image);
  if(decoded.width!==1236||decoded.height!==1648)throw new Error('导出画布尺寸异常');
  const output=PNG.sync.write(decoded,{colorType:0,inputColorType:6,bitDepth:8});
  if(output[25]!==0)throw new Error('灰阶编码失败');
  await fs.writeFile(target+'.tmp',output);await fs.rename(target+'.tmp',target);return target;
}
module.exports={renderPng};
