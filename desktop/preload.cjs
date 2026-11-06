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
  chooseKey:()=>ipcRenderer.invoke('choose-key'),
  openData:()=>ipcRenderer.invoke('open-data'),
  onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('update',listener);return()=>ipcRenderer.removeListener('update',listener);}
});
