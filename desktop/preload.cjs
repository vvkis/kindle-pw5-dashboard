const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('kindle',{
  state:()=>ipcRenderer.invoke('state'),
  save:config=>ipcRenderer.invoke('save',config),
  test:()=>ipcRenderer.invoke('test-connection'),
  push:()=>ipcRenderer.invoke('push'),
  export:()=>ipcRenderer.invoke('export'),
  auto:enabled=>ipcRenderer.invoke('auto',enabled),
  sensors:()=>ipcRenderer.invoke('enable-sensors'),
  searchWeather:name=>ipcRenderer.invoke('weather-search',name),
  saveUsage:(id,input)=>ipcRenderer.invoke('usage-save',id,input),
  removeUsage:id=>ipcRenderer.invoke('usage-remove',id),
  refreshUsage:()=>ipcRenderer.invoke('usage-refresh'),
  loginUsage:input=>ipcRenderer.invoke('usage-codex',input),
  localUsage:(provider,label)=>ipcRenderer.invoke('usage-local',provider,label),
  chooseKey:()=>ipcRenderer.invoke('choose-key'),
  openData:()=>ipcRenderer.invoke('open-data'),
  background:()=>ipcRenderer.invoke('background'),
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('update',listener);return()=>ipcRenderer.removeListener('update',listener);}
});
