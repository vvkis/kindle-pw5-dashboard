const path=require('node:path');
const fs=require('node:fs');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const command=process.argv[2]||'start';
const temp=path.join(root,'out','tmp');
const electronCache=path.join(root,'.electron-cache');
const builderCache=path.join(root,'.electron-builder-cache');
const env={...process.env,TEMP:temp,TMP:temp,TMPDIR:temp,ELECTRON_CACHE:electronCache,electron_config_cache:electronCache,ELECTRON_BUILDER_CACHE:builderCache};
for(const directory of [temp,electronCache,builderCache])fs.mkdirSync(directory,{recursive:true});
const release=command==='release';
const builder=command==='build'||release;
if(builder||!fs.existsSync(path.join(root,'vendor/sensors/SensorHelper.exe'))){const result=spawnSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(root,'scripts/build-sensor-helper.ps1')],{cwd:root,env,stdio:'inherit',windowsHide:true});if(result.status!==0)process.exit(result.status||1);}
const script=builder?require.resolve('electron-builder/out/cli/cli.js'):require.resolve('electron/cli.js');
const args=builder?['--win','--dir','--publish','never',...(release?['--config.directories.output=dist/release']:[])]:['.',...(command==='smoke'?['--smoke-test']:command==='benchmark'?['--benchmark']:command==='memory'?['--benchmark-memory']:[])];
// electron-builder clears win-unpacked; preserve portable user data across builds.
const portableData=path.join(root,'dist','win-unpacked','Kindle Monitor Data');
const dataBackup=builder&&!release&&fs.existsSync(portableData)?path.join(root,'runtime','build-data-backup-'+Date.now()):null;
const transientData=new Set(['chromium','tmp','lockfile','heartbeat','sensors.lock','sensors.stop','sensors.json']);
if(dataBackup)fs.cpSync(portableData,dataBackup,{recursive:true,filter:source=>!transientData.has(path.basename(source))});
let dataRestored=false;
function restoreData(){if(dataBackup&&!dataRestored){fs.mkdirSync(portableData,{recursive:true});fs.cpSync(dataBackup,portableData,{recursive:true});dataRestored=true;}}
const child=spawn(process.execPath,[script,...args],{cwd:root,env,stdio:'inherit',windowsHide:true});
child.on('error',error=>{restoreData();console.error(error.message);process.exitCode=1;});
child.on('exit',code=>{restoreData();process.exitCode=code??1;});
