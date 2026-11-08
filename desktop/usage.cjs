const fs=require('node:fs/promises');
const path=require('node:path');
const {homedir}=require('node:os');
const {randomUUID}=require('node:crypto');
const Codex=require('./codex-usage.cjs');

const REFRESH_MS=5*60_000;
const SOURCES={
  codex:{name:'Codex',mode:'login',local:true},
  claude:{name:'Claude Code · 组织',mode:'key',label:'Anthropic Admin API Key'},
  claudePersonal:{name:'Claude · 个人',mode:'manual',label:'剩余额度（%）',local:true},
  deepseek:{name:'DeepSeek',mode:'key',label:'DeepSeek API Key'},
  openrouter:{name:'OpenRouter',mode:'key',label:'OpenRouter Management Key'},
  grokBot:{name:'Grok Bot',mode:'manual',label:'每周剩余额度（%）'},
  xai:{name:'xAI API',mode:'key',label:'xAI Management Key',team:true},
};
const ENV_KEYS={deepseek:'DEEPSEEK_API_KEY',openrouter:'OPENROUTER_MANAGEMENT_KEY',claude:'ANTHROPIC_ADMIN_KEY',xai:'XAI_MANAGEMENT_KEY'};
const percentage=value=>`${Math.round(value)}%`;
const clock=ms=>new Date(ms).toLocaleString('zh-CN',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hour12:false});
const money=(value,currency)=>`${currency==='CNY'?'¥':'$'}${value.toFixed(2)}`;
const tokens=value=>new Intl.NumberFormat('en',{notation:'compact',maximumFractionDigits:1}).format(value);
const number=value=>typeof value==='number'||(typeof value==='string'&&value.trim())?Number(value):NaN;

function codexSummary(result){
  const limits=result?.rateLimitsByLimitId?.codex??result?.rateLimits;
  const windows=[limits?.primary,limits?.secondary].filter(window=>Number.isFinite(window?.usedPercent));
  const readings=windows.map(window=>{
    const minutes=window.windowDurationMins;
    const label=minutes===10080?'周':minutes>=60&&minutes%60===0?`${minutes/60}h`:minutes>0?`${minutes}m`:'额度';
    return label+' '+percentage(Math.max(0,Math.min(100,100-window.usedPercent)));
  });
  const resets=windows.map(window=>window.resetsAt*1000).filter(value=>value>Date.now());
  const balance=number(limits?.credits?.balance);
  if(Number.isFinite(balance))readings.push(`${balance} Credits`);
  if(!readings.length)throw new Error('Codex 暂未返回订阅额度。');
  return {value:readings.join(' / '),detail:resets.length?`最近重置 ${clock(Math.min(...resets))}`:''};
}

async function claudeLocal(){
  const file=path.join(process.env.CLAUDE_CONFIG_DIR||homedir(),'.claude.json');
  let cache;
  try{cache=JSON.parse(await fs.readFile(file,'utf8')).cachedUsageUtilization;}catch{}
  if(!Number.isFinite(cache?.fetchedAtMs)||Date.now()-cache.fetchedAtMs>3600_000)throw new Error('未找到近期的 Claude 用量。请先在 Claude Code 打开 /usage，或手动录入。');
  const windows=[['5h',cache.utilization?.five_hour],['周',cache.utilization?.seven_day]]
    .filter(([,window])=>Number.isFinite(window?.utilization)&&Date.parse(window.resets_at)>Date.now());
  if(!windows.length)throw new Error('本机 Claude 用量已过期。请先打开 /usage。');
  return {value:windows.map(([label,window])=>`${label} ${percentage(Math.max(0,Math.min(100,100-window.utilization)))}`).join(' / '),
    detail:`本机记录 · ${clock(cache.fetchedAtMs)}`,updatedAt:cache.fetchedAtMs};
}

async function requestJson(url,headers,request){
  let response;
  try{response=await request(url,{headers,redirect:'error',signal:AbortSignal.timeout(12_000)});}
  catch{throw new Error('网络请求失败。');}
  if(!response.ok){
    if([401,403].includes(response.status))throw new Error('密钥无效或权限不足。');
    throw new Error(`平台返回 HTTP ${response.status}。`);
  }
  try{return await response.json();}catch{throw new Error('平台返回的数据无法读取。');}
}

async function query(id,entry,request){
  const bearer={Authorization:`Bearer ${entry.key}`};
  const read=(url,headers=bearer)=>requestJson(url,headers,request);
  if(id==='deepseek'){
    const body=await read('https://api.deepseek.com/user/balance');
    const balances=body.balance_infos?.filter(row=>['USD','CNY'].includes(row.currency)&&Number.isFinite(number(row.total_balance)));
    if(balances?.length)return {value:balances.map(row=>money(number(row.total_balance),row.currency)).join(' / '),detail:'API 余额'};
  }
  if(id==='openrouter'){
    const {data}=await read('https://openrouter.ai/api/v1/credits');
    const balance=number(data?.total_credits)-number(data?.total_usage);
    if(Number.isFinite(balance))return {value:money(balance,'USD'),detail:'账户余额'};
  }
  if(id==='xai'){
    const {total}=await read(`https://management-api.x.ai/v1/billing/teams/${entry.team}/prepaid/balance`);
    const balance=number(total?.val);
    if(Number.isFinite(balance))return {value:money(balance/100,'USD'),detail:'团队 API 预付余额'};
  }
  if(id==='claude'){
    const day=new Date().toISOString().slice(0,10);
    const url=new URL('https://api.anthropic.com/v1/organizations/usage_report/claude_code');
    url.search=new URLSearchParams({starting_at:day,limit:'1000'});
    let total=0,more;
    for(let page=0;page<10;page++){
      const report=await read(url,{'x-api-key':entry.key,'anthropic-version':'2026-10-21'});
      if(!Array.isArray(report.data))break;
      for(const record of report.data){
        for(const model of record.model_breakdown??[]){
          for(const key of ['input','output','cache_creation','cache_read'])total+=model.tokens?.[key]??0;
        }
      }
      if(!report.has_more&&Number.isFinite(total))return {value:`${tokens(total)} Token`,detail:`${day.slice(5)} UTC · 组织已用`};
      more=report.next_page;
      if(typeof more!=='string'||url.searchParams.get('page')===more)break;
      url.searchParams.set('page',more);
    }
  }
  throw new Error('平台暂未返回可显示的数据。');
}

function validate(provider,input){
  const source=Object.hasOwn(SOURCES,provider)&&SOURCES[provider];
  if(!source||!input||typeof input!=='object')throw new Error('用量来源无效。');
  const label=typeof input.label==='string'?input.label.trim().replace(/[\x00-\x1f\x7f]/g,'').slice(0,18):'';
  const account={provider,label};
  if(source.mode==='login'||(provider==='claudePersonal'&&input.local))return {...account,local:input.local===true};
  if(source.mode==='manual'){
    const remaining=number(input.remaining);
    const resetsAt=typeof input.resetsAt==='number'?input.resetsAt:input.resetsAt?Date.parse(input.resetsAt):0;
    if(!Number.isFinite(remaining)||remaining<0||remaining>100)throw new Error('请填写 0–100 的剩余百分比。');
    if(!Number.isFinite(resetsAt))throw new Error('重置时间无效。');
    return {...account,remaining,resetsAt,updatedAt:Number.isFinite(input.updatedAt)?input.updatedAt:Date.now()};
  }
  const key=typeof input.key==='string'?input.key.trim():'';
  if(!/^[!-~]{1,1024}$/.test(key))throw new Error('请填写有效的 API Key。');
  if(!source.team)return {...account,key};
  const team=String(input.team??'').trim();
  if(!/^[a-zA-Z0-9_-]{1,128}$/.test(team))throw new Error('请填写 xAI Team ID。');
  return {...account,key,team};
}

class Usage {
  constructor(directory,storage,changed,request=fetch,codex=Codex){
    this.file=path.join(directory,'ai-usage.bin');
    this.codexHome=path.join(directory,'ai-codex');
    this.storage=storage;
    this.changed=changed;
    this.request=request;
    this.codex=codex;
    this.entries=new Map();
    this.results=new Map();
    this.pending=new Map();
    this.writes=Promise.resolve();
    this.login=null;
    this.storageError=false;
  }
  async load(){
    try{
      const {result}=await this.storage.decryptStringAsync(await fs.readFile(this.file));
      const stored=JSON.parse(result);
      for(const [id,entry] of Object.entries(stored)){
        if(!/^[0-9a-f-]{36}$/.test(id))throw new Error('Invalid account identifier');
        // Older versions stored automatic Grok accounts without a manual reading.
        if(entry?.provider==='grokBot'&&(entry.browser===true||typeof entry.grokAccount==='string'))continue;
        this.entries.set(id,validate(entry.provider,entry));
      }
    }catch(error){
      if(error.code!=='ENOENT'){this.entries.clear();this.storageError=true;}
    }
  }
  view(){
    const rows=[];
    for(const [id,entry] of this.entries){
      const {provider,label}=entry,source=SOURCES[provider],name=`${source.name} · ${label}`;
      if(source.mode==='manual'&&!entry.local){
        const expired=entry.resetsAt&&entry.resetsAt<=Date.now();
        rows.push({id,provider,label,name,value:expired?'待更新':percentage(entry.remaining),detail:entry.resetsAt?`手动 · ${clock(entry.resetsAt)} 重置`:'手动录入',updatedAt:entry.updatedAt});
      }else{
        const result=this.results.get(id);
        const detail=result?.error?(result.updatedAt?`缓存 · ${clock(result.updatedAt)}`:result.error):result?.detail??'等待首次查询';
        rows.push({id,provider,label,name,value:result?.value??'—',detail,updatedAt:result?.updatedAt,local:entry.local});
      }
    }
    return {sources:SOURCES,rows,loginPending:!!this.login,storageError:this.storageError,
      detectedKeys:Object.keys(ENV_KEYS).filter(provider=>!!process.env[ENV_KEYS[provider]])};
  }
  async ensureStorage(){
    if(this.storageError||!await this.storage.isAsyncEncryptionAvailable())throw new Error('无法使用 Windows 加密存储。');
  }
  write(id,entry){
    const task=this.writes.catch(()=>{}).then(async()=>{
      await this.ensureStorage();
      const entries=new Map(this.entries);
      if(entry)entries.set(id,entry);else entries.delete(id);
      const encoded=await this.storage.encryptStringAsync(JSON.stringify(Object.fromEntries(entries)));
      await fs.writeFile(this.file+'.tmp',encoded);
      await fs.rename(this.file+'.tmp',this.file);
      this.entries=entries;
      this.results.delete(id);
      this.pending.delete(id);
      this.changed();
    });
    this.writes=task;
    return task;
  }
  nameFor(provider,label){
    if(label?.trim())return label;
    const used=new Set([...this.entries.values()].filter(entry=>entry.provider===provider).map(entry=>entry.label));
    let index=1;
    while(used.has('账号 '+index))index++;
    return '账号 '+index;
  }
  async set(provider,input){
    if(!input||typeof input!=='object')throw new Error('用量账号无效。');
    if(provider==='codex')throw new Error('请使用 Codex 官方登录。');
    const old=this.entries.get(input.id);
    if(input.id&&old?.provider!==provider)throw new Error('用量账号已移除。');
    const id=input.id||randomUUID();
    const key=input.environment?process.env[ENV_KEYS[provider]]:typeof input.key==='string'&&input.key.trim()||old?.key;
    const entry=validate(provider,{remaining:input.remaining,resetsAt:input.resetsAt,updatedAt:input.updatedAt,key,team:input.team||old?.team,label:this.nameFor(provider,input.label||old?.label)});
    await this.write(id,entry);
    await this.refresh(id);
    return id;
  }
  async remove(id){
    const entry=this.entries.get(id);
    if(!entry)throw new Error('用量账号已移除。');
    if(entry.provider==='codex'&&!entry.local){
      if(this.login)throw new Error('请等待当前登录结束。');
      await this.codex.signOut(path.join(this.codexHome,id));
    }
    await this.write(id,null);
  }
  async signIn(input,openBrowser){
    if(!input||typeof input!=='object')throw new Error('用量账号无效。');
    await this.ensureStorage();
    if(this.login)throw new Error('请等待当前登录结束。');
    this.login=(async()=>{
      const old=this.entries.get(input.id);
      if(input.id&&(old?.provider!=='codex'||old.local))throw new Error('请选择浏览器登录的 Codex 账号。');
      if(!input.id&&![...this.entries.values()].some(entry=>entry.provider==='codex'&&entry.local)){
        try{return await this.useLocal('codex',input.label);}catch{}
      }
      const id=input.id||randomUUID(),home=path.join(this.codexHome,id);
      const entry=validate('codex',{label:this.nameFor('codex',input.label||old?.label)});
      const result=await this.codex.signIn(home,openBrowser);
      try{await this.write(id,entry);}
      catch(error){await this.codex.signOut(home).catch(()=>{});throw error;}
      try{this.results.set(id,{...codexSummary(result),updatedAt:Date.now()});}
      catch{this.results.set(id,{error:'Codex 暂未返回订阅额度。'});}
      return id;
    })().finally(()=>{this.login=null;this.changed();});
    this.changed();
    return this.login;
  }
  async useLocal(provider,label){
    if(!['codex','claudePersonal'].includes(provider))throw new Error('此平台不支持本机登录。');
    const found=[...this.entries].find(([,entry])=>entry.provider===provider&&entry.local);
    const id=found?.[0]??randomUUID();
    const result=provider==='codex'?codexSummary(await this.codex.readLocal(path.dirname(this.file))):await claudeLocal();
    await this.write(id,validate(provider,{local:true,label:this.nameFor(provider,label||found?.[1].label||'本机')}));
    this.results.set(id,{updatedAt:Date.now(),...result});this.changed();
    return id;
  }
  refresh(id){
    const entry=this.entries.get(id);
    if(!entry)return;
    const {provider}=entry;
    if((SOURCES[provider].mode==='manual'&&!entry.local)||(provider==='codex'&&this.login))return;
    if(this.pending.has(id))return this.pending.get(id);
    const task=(async()=>{
      try{
        let result;
        if(provider==='codex')result=codexSummary(entry.local?await this.codex.readLocal(path.dirname(this.file)):await this.codex.read(path.join(this.codexHome,id)));
        else if(entry.local)result=await claudeLocal();
        else result=await query(provider,entry,this.request);
        if(this.entries.get(id)===entry)this.results.set(id,{updatedAt:Date.now(),...result});
      }catch(error){
        if(this.entries.get(id)===entry)this.results.set(id,{...this.results.get(id),error:error.message});
      }finally{
        if(this.pending.get(id)===task)this.pending.delete(id);
        this.changed();
      }
    })();
    this.pending.set(id,task);
    return task;
  }
  refreshAll(){return Promise.all([...this.entries.keys()].map(id=>this.refresh(id)));}
}

module.exports={Usage,REFRESH_MS};
