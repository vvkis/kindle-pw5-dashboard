const path=require('node:path');
const fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const command=process.argv[2]||'start';
const env={...process.env,ELECTRON_CACHE:path.join(root,'.electron-cache'),ELECTRON_BUILDER_CACHE:path.join(root,'.electron-builder-cache')};
const builder=command==='build';
if(builder||!fs.existsSync(path.join(root,'vendor/sensors/SensorHelper.exe'))){const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/build-sensor-helper.ps1')],{cwd:root,env,stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);}
const script=builder?require.resolve('electron-builder/out/cli/cli.js'):require.resolve('electron/cli.js');
const args=builder?['--win','--dir']:['.',...(command==='smoke'?['--smoke-test']:command==='benchmark'?['--benchmark']:command==='memory'?['--benchmark-memory']:[])];
for(const key of ['ELECTRON_CACHE','ELECTRON_BUILDER_CACHE'])fs.mkdirSync(env[key],{recursive:true});
const child=spawn(process.execPath,[script,...args],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
