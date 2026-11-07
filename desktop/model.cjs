(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./widgets.cjs'));
  else root.MonitorModel = factory(root.DesktopWidgets);
})(typeof globalThis === 'object' ? globalThis : this, function (Widgets) {
  const METRICS = {
    cpuTemp: { label: 'CPU 温度', unit: '°C', max: 100, warning: 85 },
    gpuTemp: { label: 'GPU 温度', unit: '°C', max: 100, warning: 85 },
    cpuLoad: { label: 'CPU 占用', unit: '%', max: 100 },
    gpuLoad: { label: 'GPU 占用', unit: '%', max: 100 },
    memoryLoad: { label: '内存占用', unit: '%', max: 100 },
    gpuMemoryLoad: { label: '显存占用', unit: '%', max: 100 },
    memoryUsed: { label: '已用内存', unit: 'GB', max: 64 },
    gpuPower: { label: '显卡功耗', unit: 'W', max: 400 }
  };
  const defaults = () => ({
    title: '工作站监控', note: '保持专注，保持冷静。',
    host: '192.168.15.244', wifiHost: '', connectionMode: 'http', port: 22, identityFile: '', pushInterval: 60, fontWeight: 700,
    httpHost: '', httpPort: 8686, httpToken: '', eipsRefresh: true,
    cpuSensor: '', sampleInterval: 3, layout: 'cards', showChart: true,
    weather: { name: '广州', latitude: 23.1291, longitude: 113.2644, enabled: true },
    widgets: Widgets.defaults(),
    orientation: 'portrait', landscapeTop: 'left',
    layouts: {portrait:Widgets.defaults(),landscape:Widgets.defaults('landscape')},
    metrics: ['cpuTemp','gpuTemp','cpuLoad','gpuLoad','memoryLoad','gpuMemoryLoad'].map(key => ({ key, label: METRICS[key].label, enabled: true }))
  });
  function sanitize(input) {
    if (!input || typeof input !== 'object') throw new Error('配置格式无效');
    const out = defaults();
    for (const [key, max] of [['title',48],['note',100],['identityFile',500],['cpuSensor',200]]) {
      if (input[key] !== undefined) out[key] = String(input[key]).replace(/[\x00-\x1f]/g,' ').slice(0,max);
    }
    if (input.host !== undefined) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(input.host)) throw new Error('设备地址应为 IPv4 或主机名');
      out.host = input.host;
    }
    if(input.connectionMode!==undefined&&!['usb','wifi','http'].includes(input.connectionMode))throw new Error('无效的连接模式');
    out.connectionMode=input.connectionMode||'http';
    if(input.wifiHost!==undefined){
      if(input.wifiHost!==''&&!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(input.wifiHost))throw new Error('Wi-Fi 地址应为 IPv4 或主机名');
      out.wifiHost=input.wifiHost;
    }
    if(input.httpHost!==undefined){
      if(input.httpHost!==''&&!/^[a-zA-Z0-9][a-zA-Z0-9.-]{0,252}$/.test(input.httpHost))throw new Error('看板地址应为 IPv4 或主机名');
      out.httpHost=input.httpHost;
    }
    if(input.httpToken!==undefined){
      const token=String(input.httpToken).replace(/[\x00-\x1f]/g,'').trim();
      if(token.length>128||(token&&!/^[A-Za-z0-9._~-]+$/.test(token)))throw new Error('配对口令格式无效');
      out.httpToken=token;
    }
    out.eipsRefresh=input.eipsRefresh!==false;
    if(input.fontWeight!==undefined){if(![400,700].includes(Number(input.fontWeight)))throw new Error('无效的字体粗细');out.fontWeight=Number(input.fontWeight);}
    for (const [key,min,max] of [['port',1,65535],['pushInterval',1,3600],['httpPort',1,65535]]) {
      if (input[key] !== undefined) {
        if (!Number.isInteger(Number(input[key])) || Number(input[key]) < min || Number(input[key]) > max) throw new Error(`${key} 超出范围`);
        out[key] = Number(input[key]);
      }
    }
    if(input.sampleInterval!==undefined){
      const seconds=Number(input.sampleInterval);
      if(!Number.isInteger(seconds)||seconds<1||seconds>300)throw new Error('采集间隔须为 1–300 秒的整数');
      out.sampleInterval=seconds;
    }
    out.layout = input.layout === 'rows' ? 'rows' : 'cards';
    out.showChart = input.showChart !== false;
    if(input.orientation!==undefined&&!['portrait','landscape'].includes(input.orientation))throw new Error('无效的屏幕方向');
    if(input.landscapeTop!==undefined&&!['left','right'].includes(input.landscapeTop))throw new Error('无效的横屏摆放方向');
    out.orientation=input.orientation||'portrait';out.landscapeTop=input.landscapeTop||'left';
    for(const orientation of ['portrait','landscape']){
      if(input.layouts?.[orientation]!==undefined)out.layouts[orientation]=Widgets.validate(input.layouts[orientation],orientation);
    }
    out.widgets=input.widgets!==undefined?Widgets.validate(input.widgets,out.orientation):out.layouts[out.orientation];
    out.layouts[out.orientation]=out.widgets.map(widget=>({...widget}));
    for(const orientation of ['portrait','landscape'])out.layouts[orientation]=out.layouts[orientation].map(widget=>widget.type==='note'&&widget.content===undefined?{...widget,content:out.note}:widget);
    out.widgets=out.layouts[out.orientation];
    if(input.weather) {
      const w=input.weather;
      if(!Number.isFinite(Number(w.latitude))||Math.abs(Number(w.latitude))>90||!Number.isFinite(Number(w.longitude))||Math.abs(Number(w.longitude))>180)throw new Error('天气坐标无效');
      out.weather={name:String(w.name||'天气').slice(0,30),latitude:Number(w.latitude),longitude:Number(w.longitude),enabled:w.enabled!==false};
    }
    if (input.metrics !== undefined) {
      if (!Array.isArray(input.metrics) || input.metrics.length > 8) throw new Error('最多支持 8 个显示项');
      const seen = new Set();
      out.metrics = input.metrics.map(item => {
        if (!METRICS[item.key] || seen.has(item.key)) throw new Error('无效或重复的显示项');
        seen.add(item.key);
        return { key: item.key, label: String(item.label || METRICS[item.key].label).slice(0,18), enabled: item.enabled !== false };
      });
    }
    return out;
  }
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
  const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const format = value => number(value) === null ? '—' : value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/,'');
  function sparkline(values, x, y, w, h, max = 100) {
    const samples = values.slice(-60);
    let segments = [], current = [];
    samples.forEach((v,i) => {
      if (number(v) === null) { if(current.length) segments.push(current); current=[]; return; }
      current.push(`${x + i / Math.max(1,samples.length-1)*w},${y+h-Math.min(max,Math.max(0,v))/max*h}`);
    });
    if (current.length) segments.push(current);
    return segments.filter(s=>s.length>1).map(s=>`<polyline points="${s.join(' ')}" fill="none" stroke="#111" stroke-width="4"/>`).join('');
  }
  function dashboardSvg(config, sample, history = [], weather = null) {
    return Widgets.svg(sanitize(config),sample,history,weather);
  }
  return { METRICS, defaults, sanitize, escape, number, format, dashboardSvg, sparkline };
});
