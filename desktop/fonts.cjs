const {execFile}=require('node:child_process');
const {existsSync}=require('node:fs');
const path=require('node:path');
const {promisify}=require('node:util');

const run=promisify(execFile);
const systemRoot=process.env.SystemRoot||'C:\\Windows';
let catalog;

// WPF resolves installed families, including current-user fonts and faces in collections.
const enumerate=String.raw`
$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName PresentationCore
$chinese=[System.Windows.Markup.XmlLanguage]::GetLanguage('zh-cn')
$rows=foreach($family in [System.Windows.Media.Fonts]::SystemFontFamilies){
  $faces=foreach($type in $family.GetTypefaces()){
    if($type.Style -ne [System.Windows.FontStyles]::Normal){continue}
    $glyph=$null
    if($type.TryGetGlyphTypeface([ref]$glyph) -and $glyph.FontUri.IsFile){
      [pscustomobject]@{path=$glyph.FontUri.LocalPath;weight=$type.Weight.ToOpenTypeWeight()}
    }
  }
  if(!$faces){continue}
  $label=$family.FamilyNames[$chinese]
  if(!$label){$label=$family.Source}
  $files=foreach($weight in 400,700){
    ($faces | Sort-Object {[Math]::Abs($_.weight-$weight)} | Select-Object -First 1).path
  }
  [pscustomobject]@{name=$family.Source;label=$label;files=@($files | Select-Object -Unique)}
}
ConvertTo-Json -InputObject @($rows) -Compress -Depth 3
`;

async function readFonts(){
  if(process.platform!=='win32')return [];
  try{
    const powershell=path.join(systemRoot,'System32','WindowsPowerShell','v1.0','powershell.exe');
    const encoded=Buffer.from(enumerate,'utf16le').toString('base64');
    const {stdout}=await run(powershell,['-NoProfile','-NonInteractive','-EncodedCommand',encoded],{windowsHide:true,timeout:8000,maxBuffer:2*1024*1024});
    const fonts=JSON.parse(stdout).map(font=>({...font,files:font.files.filter(file=>/\.(ttf|ttc|otf|otc)$/i.test(file)&&existsSync(file))}))
      .filter(font=>font.files.length&&!/[,;"'\x00-\x1f]/.test(font.name));
    if(fonts.length)return fonts.sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'));
  }catch{}
  return [
    {name:'Microsoft YaHei',label:'微软雅黑',files:['msyh.ttc','msyhbd.ttc']},
    {name:'DengXian',label:'等线',files:['Deng.ttf','Dengb.ttf']},
    {name:'Segoe UI',label:'Segoe UI',files:['segoeui.ttf','segoeuib.ttf']},
  ].map(font=>({...font,files:font.files.map(file=>path.join(systemRoot,'Fonts',file)).filter(existsSync)})).filter(font=>font.files.length);
}

function systemFonts(){
  return catalog??=readFonts();
}

module.exports={systemFonts};
