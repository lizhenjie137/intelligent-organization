"use strict";

// Drafts stay in this page's memory only. Secrets are never interpolated into markup.
let modelSettings = {owner:'',epoch:0,data:null,draft:null,secret:'',loading:false,pending:'',error:'',notice:'',dirty:false,test:null,testSignature:'',advanced:false};
function resetModelSettings() {
  modelSettings={owner:'',epoch:modelSettings.epoch+1,data:null,draft:null,secret:'',loading:false,pending:'',error:'',notice:'',dirty:false,test:null,testSignature:'',advanced:false};
}
const runtimeMessage=value=>String(value??'').replace(/DeepSeek Harness|DeepSeek ?底座/g,'运行服务');
function runtimePresentation(runtime=state?.settings?.runtime) {
  if(!runtime) return state?.settings?.mode==='demo'?{label:'规则运行（不调用模型）',kind:'neutral',text:'当前使用固定规则，不调用模型。'}:{label:'模型状态待确认',kind:'warning',text:'尚未取得当前模型连接状态。'};
  if(runtime.mode==='demo'||runtime.runtime==='demo')return {label:'规则运行（不调用模型）',kind:'neutral',text:'当前使用固定规则，不调用模型。'};
  if(!runtime.configured)return {label:'模型未配置',kind:'warning',text:runtimeMessage(runtime.message)||'管理员需要填写模型服务连接，员工协作仍可继续。'};
  if(runtime.available===false)return {label:'模型暂不可用',kind:'error',text:runtimeMessage(runtime.message)||'连接配置需要管理员检查。'};
  const test=runtime.last_test||runtime.test;
  if(test?.ok===false)return {label:'连接测试失败',kind:'error',text:runtimeMessage(test.message)||'最近一次连接测试未通过，请检查配置后重试。'};
  if(test?.ok===true||runtime.model_connection_verified===true)return {label:'连接测试通过',kind:'success',text:'当前连接已通过测试；实际任务产物仍需人工验收。'};
  return {label:'已配置 · 未测试',kind:'warning',text:'配置已启用，尚未验证模型连接。'};
}
function runtimeBadgeHtml() {
  const view=runtimePresentation(),inner=`${icon('bot')}${escape(view.label)}`;
  return isAdmin()?`<a id="runtime-badge" class="mode-badge runtime-${view.kind}" href="#model-settings" title="管理模型连接">${inner}</a>`:`<span id="runtime-badge" class="mode-badge runtime-${view.kind}">${inner}</span>`;
}
function runtimeHintHtml() {
  const view=runtimePresentation();
  return `<div class="hint-bar runtime-hint">${icon('info')}<div><strong>${escape(view.label)}。</strong> ${escape(view.text)}${state?.settings?.mode==='model'?` 当前模型：${escape(state.settings.model||'待配置')}。文本生成不代表外部业务动作已经完成。`:''}${isAdmin()?' <a href="#model-settings">配置模型连接</a>':''}</div></div>`;
}
function refreshRuntimeBadge() {
  const badge=document.getElementById('runtime-badge');if(badge)badge.outerHTML=runtimeBadgeHtml();
}
function modelSettingsApplyRuntime(runtime) {
  if(!runtime||!state?.settings)return;
  state.settings.runtime=runtime;
  if(runtime.mode)state.settings.mode=runtime.mode;
  if(runtime.model)state.settings.model=runtime.model;
  refreshRuntimeBadge();
  document.querySelectorAll('.runtime-hint').forEach(el=>{el.outerHTML=runtimeHintHtml();});
}
function modelSettingsPage() {
  if(!isAdmin())return heading('模型配置','仅组织管理员可以管理模型连接。')+`<section class="panel">${empty('需要管理员权限','请联系组织管理员配置模型。','lock')}</section>`;
  if(modelSettings.owner!==currentUser().id){resetModelSettings();modelSettings.owner=currentUser().id;}
  return heading('模型配置','管理组织使用的模型连接。',button('读取最新状态','model-refresh','','small','refresh'))+`<div class="model-framework"><div class="model-framework-mark">${icon('network')}</div><div><strong>模型服务连接</strong><p>本地或云端服务，统一供 Agent 任务使用。</p></div><span class="pill">文本执行 · 人工验收</span></div><div id="model-settings-content">${modelSettings.data?modelSettingsFormHtml():modelSettings.error?`<section class="panel model-load-state"><p>${escape(runtimeMessage(modelSettings.error))}</p>${button('重新读取配置','model-load','','','refresh')}</section>`:'<section class="panel model-load-state">正在读取当前连接配置…</section>'}</div>`;
}
function modelSettingsDefaults() {return {connection:'local',protocol:'openai-completions',base_url:'http://127.0.0.1:1234/v1',model:'',max_tokens:4096,timeout_seconds:120,context_window:32768,max_concurrency:4,key_action:'remove'};}
function modelSettingsKeyChanged() {
  const old=modelSettings.data?.draft||{},draft=modelSettings.draft||{};
  return String(old.base_url||'').replace(/\/+$/,'')!==String(draft.base_url||'').trim().replace(/\/+$/,'')||old.protocol!==draft.protocol;
}
function modelSettingsFormHtml() {
  const d=modelSettings.draft,s=modelSettings.data,view=runtimePresentation({...s.status,last_test:s.last_test}),hasKey=!!s.has_api_key,keyChanged=hasKey&&modelSettingsKeyChanged();
  const input=(name,label,type='text',extra='')=>`<div class="form-field"><label for="model-${name}">${label}</label><input id="model-${name}" name="${name}" type="${type}" value="${escape(d[name])}" ${extra}><small class="model-field-error" data-error-for="${name}"></small></div>`;
  const selected=value=>d.key_action===value?' selected':'';
  return `<section class="model-current"><div><span class="model-section-eyebrow">当前生效连接</span><strong class="runtime-${view.kind}">${escape(view.label)}</strong><p>${escape(s.status?.model||'尚未配置模型')}<span>${s.draft?.connection==='cloud'?'云端服务':'本地 / 局域网服务'}</span></p><small class="model-saved-endpoint">${escape(s.draft?.base_url||'尚未填写服务地址')}</small></div><p>${escape(view.text)}${s.last_test?.tested_at?`<small>最近测试：${date(s.last_test.tested_at)}</small>`:''}</p></section><section class="panel model-config-panel"><form data-form="model-settings" novalidate><div class="model-form-heading"><div><h2>连接设置</h2><p>测试当前草稿，保存后供后续 Agent 任务使用。</p></div><span id="model-draft-state" class="pill">${modelSettings.dirty?'有未保存的修改':'已读取当前配置'}</span></div><div id="model-config-error" class="form-error" tabindex="-1"></div><fieldset class="model-form-fields" ${modelSettings.pending?'disabled':''}><div class="model-form-grid"><div class="form-field"><label for="model-connection">模型部署位置</label><select id="model-connection" name="connection"><option value="local" ${d.connection==='local'?'selected':''}>本地 / 局域网设备</option><option value="cloud" ${d.connection==='cloud'?'selected':''}>云端模型服务</option></select><small>本地连接失败时，不会自动切换云端。</small></div><div class="form-field"><label for="model-preset">快速填写</label><select id="model-preset" name="preset"><option value="custom">自定义连接</option><option value="cloud-example">云端 API</option><option value="local">本地 OpenAI 兼容服务</option></select><small>选择预设仅填写草稿，不会保存或发送请求。</small></div></div><div class="model-form-grid"><div class="form-field"><label for="model-protocol">接口协议</label><select id="model-protocol" name="protocol"><option value="openai-completions" ${d.protocol==='openai-completions'?'selected':''}>OpenAI Chat Completions 兼容</option><option value="deepseek-messages" ${d.protocol==='deepseek-messages'?'selected':''}>Messages API</option></select><small>本地设备通常使用 OpenAI 兼容协议。</small></div>${input('model','模型名称','text','required maxlength="200" autocomplete="off" placeholder="填写服务实际提供的模型名"')}</div>${input('base_url','API 根地址','url','required autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1"')}<p class="model-field-hint">填写 API 根地址，不含 /chat/completions 或 /messages。云端须使用 HTTPS；任务资料将发送至此地址。</p><section class="model-credential"><div><h3>API 密钥</h3><span>${hasKey?'已保存密钥，内容不回显':'当前没有已保存密钥'}</span></div><div class="model-form-grid"><div class="form-field"><label for="model-key-action">本次如何处理密钥</label><select id="model-key-action" name="key_action"><option value="keep"${selected('keep')} ${!hasKey||keyChanged?'disabled':''}>保留已保存密钥</option><option value="replace"${selected('replace')}>输入 / 替换密钥</option><option value="remove"${selected('remove')}>清除已保存密钥</option></select><small id="model-key-policy">${keyChanged?'地址或协议已改变：必须重新输入密钥，或明确清除后连接本地免密服务。':'只有选择保留时，服务端才会继续使用当前密钥。'}</small><small class="model-field-error" data-error-for="key_action"></small></div><div class="form-field" id="model-secret-field" ${d.key_action!=='replace'?'hidden':''}><label for="model-api-key">新的 API 密钥</label><input id="model-api-key" name="api_key" type="password" autocomplete="new-password" maxlength="4096" spellcheck="false" aria-describedby="model-key-storage"><small class="model-field-error" data-error-for="api_key"></small></div></div><p id="model-key-storage" class="model-field-hint">${s.secret_storage==='memory-only'?'当前环境仅在进程内保管密钥，重启后需要重新填写。':s.secret_storage==='environment'?'当前密钥来自启动环境；在本页替换保存后由服务端安全保管。':'密钥只提交给当前后台，由服务端保存；浏览器不持久化密钥。'} 清除云端密钥后需重新配置才能调用。本地免密连接不使用云端密钥。</p></section><details class="model-advanced" ${modelSettings.advanced?'open':''}><summary>高级参数</summary><div class="model-form-grid">${input('max_tokens','单次最大输出 token','number','required min="32" max="131072" step="1"')}${input('context_window','模型上下文容量','number','required min="1024" max="2000000" step="1"')}${input('timeout_seconds','单次超时（秒）','number','required min="1" max="1800" step="1"')}${input('max_concurrency','并行 Agent 上限','number','required min="1" max="32" step="1"')}</div><p class="model-field-hint">容量应与模型服务一致。并发上限是同时运行的 Agent 数量，与员工人数无关。</p></details><div class="model-actions"><button type="submit" name="intent" value="test" class="button">${icon('play')}测试当前连接</button><button type="submit" name="intent" value="save" class="button primary">${icon('check')}保存并启用</button><button type="button" class="button ghost" data-action="model-reset">撤销未保存修改</button></div></fieldset><div id="model-operation-status" class="model-operation-status">${modelSettings.pending?`${modelSettings.pending==='test'?'正在测试模型连接':'正在保存并启用配置'}，请稍候…`:escape(modelSettings.notice)}</div><p class="model-test-note">测试仅发送固定文本，不含组织资料，可能产生少量费用。测试通过仅证明连接可用。</p><div id="model-test-result">${modelTestResultHtml()}</div></form></section>`;
}
function modelTestResultHtml() {
  const result=modelSettings.test;if(!result)return '';
  const stale=modelSettings.testSignature!==modelDraftSignature();
  return `<div class="model-test-result ${result.ok?'success':'error'}"><strong>${stale?'历史草稿测试结果':result.draft!==false?'当前草稿测试结果':'生效连接测试结果'}：${result.ok?'通过':'失败'}</strong><p>${escape(runtimeMessage(result.message)||'测试已完成')}</p><small>${date(result.tested_at)}${Number.isFinite(result.latency_ms??result.latency)?` · 耗时 ${(result.latency_ms!=null?result.latency_ms/1000:result.latency).toFixed(2)} 秒`:''}${stale?' · 配置已修改，请重新测试':result.draft!==false?' · 尚需保存并启用':''}</small></div>`;
}
function modelDraftSignature() {return JSON.stringify(modelSettings.draft||{});}
function mountModelSettings() {
  if(!isAdmin())return;
  if(!modelSettings.data){if(!modelSettings.loading&&!modelSettings.error)loadModelSettings();return;}
  const password=document.getElementById('model-api-key');if(password)password.value=modelSettings.secret;
  const box=document.getElementById('model-config-error');if(box)box.textContent=modelSettings.error;
}
function renderModelSettingsContent() {
  if(route()!=='model-settings')return;
  const area=document.getElementById('model-settings-content');if(area){area.innerHTML=modelSettingsFormHtml();mountModelSettings();}
}
async function loadModelSettings(preserveDraft=false) {
  if(modelSettings.loading||modelSettings.pending||!isAdmin())return;
  const epoch=modelSettings.epoch,owner=currentUser().id;modelSettings.loading=true;modelSettings.error='';
  try {
    const result=await api('/api/model-config');if(epoch!==modelSettings.epoch||owner!==currentUser().id)return;
    modelSettings.data=result;
    if(!preserveDraft||!modelSettings.draft){modelSettings.draft={...modelSettingsDefaults(),...result.draft,key_action:result.has_api_key?'keep':'remove'};modelSettings.secret='';modelSettings.dirty=false;modelSettings.test=null;}
    else modelSettings.notice='已读取服务器最新配置与版本，当前草稿保持不变。请对照生效连接后再测试或保存。';
    if(state?.settings&&result.status)state.settings.runtime={...result.status,last_test:result.last_test};
    renderModelSettingsContent();refreshRuntimeBadge();
  } catch(error){if(epoch!==modelSettings.epoch)return;modelSettings.error=error.message;if(route()==='model-settings')render();}
  finally{if(epoch===modelSettings.epoch)modelSettings.loading=false;}
}
function modelFormErrors(intent='test') {
  const d=modelSettings.draft,errors=[];
  if(!String(d.model).trim())errors.push(['model','请填写模型服务实际提供的模型名称。']);
  let url;try{url=new URL(String(d.base_url).trim());}catch{errors.push(['base_url','请输入完整的 HTTP(S) API 根地址。']);}
  if(url&&(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||/\/(chat\/completions|messages)\/?$/.test(url.pathname)))errors.push(['base_url','请使用不含凭据、查询、片段或推理端点的 API 根地址。']);
  if(url&&d.connection==='cloud'&&url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))errors.push(['base_url','云端模型服务必须使用 HTTPS。']);
  if(d.key_action==='keep'&&(!modelSettings.data.has_api_key||modelSettingsKeyChanged()))errors.push(['key_action','地址或协议变化后不能沿用已保存密钥，请重新输入或明确清除。']);
  if(d.key_action==='replace'&&!modelSettings.secret.trim())errors.push(['api_key','请填写新的 API 密钥。']);
  if(intent==='test'&&d.key_action==='remove'&&(d.connection==='cloud'||d.protocol==='deepseek-messages'))errors.push(['key_action','云端或 Messages API 需要密钥，请选择输入或保留。']);
  for(const [key,min,max] of [['max_tokens',32,131072],['context_window',1024,2000000],['timeout_seconds',1,1800],['max_concurrency',1,32]]){const n=Number(d[key]);if(!Number.isInteger(n)||n<min||n>max)errors.push([key,`请填写 ${min}–${max} 之间的整数。`]);}
  if(Number(d.max_tokens)>=Number(d.context_window))errors.push(['max_tokens','最大输出 token 必须小于上下文容量。']);
  return errors;
}
function showModelErrors(errors,message='') {
  const form=document.querySelector('form[data-form="model-settings"]');if(!form)return;
  form.querySelectorAll('[data-error-for]').forEach(el=>el.textContent='');form.querySelectorAll('[aria-invalid]').forEach(el=>el.removeAttribute('aria-invalid'));
  const box=form.querySelector('.form-error');box.replaceChildren();
  if(message)box.textContent=runtimeMessage(message);
  for(const [name,text] of errors){const field=form.elements.namedItem(name),inline=form.querySelector(`[data-error-for="${name}"]`);if(inline)inline.textContent=text;if(field){field.setAttribute('aria-invalid','true');const link=document.createElement('a');link.href='#'+field.id;link.textContent=text;link.addEventListener('click',e=>{e.preventDefault();field.closest('details')?.setAttribute('open','');field.focus();});box.append(link);}}
  if(errors.length||message)box.focus();
}
function updateModelDraft(event) {
  const el=event.target,form=el.closest('form[data-form="model-settings"]');if(!form||!modelSettings.draft||modelSettings.pending)return;
  if(el.name==='api_key'){modelSettings.secret=el.value;modelSettings.testSignature='';}
  else if(Object.hasOwn(modelSettings.draft,el.name))modelSettings.draft[el.name]=el.value;
  else return;
  modelSettings.dirty=true;modelSettings.error='';modelSettings.notice='';
  const dirty=document.getElementById('model-draft-state');if(dirty)dirty.textContent='有未保存的修改';
  const hasKey=modelSettings.data.has_api_key,changed=hasKey&&modelSettingsKeyChanged(),keep=form.querySelector('option[value="keep"]');if(keep)keep.disabled=!hasKey||changed;
  const policy=document.getElementById('model-key-policy');if(policy)policy.textContent=changed?'地址或协议已改变：必须重新输入密钥，或明确清除后连接本地免密服务。':'只有选择保留时，服务端才会继续使用当前密钥。';
  document.getElementById('model-secret-field').hidden=modelSettings.draft.key_action!=='replace';
  if(el.name==='key_action'&&el.value!=='replace'){modelSettings.secret='';form.elements.api_key.value='';}
  document.getElementById('model-test-result').innerHTML=modelTestResultHtml();
}
document.addEventListener('input',updateModelDraft);
document.addEventListener('change',event=>{
  if(event.target.id==='model-preset'){
    const preset=event.target.value;if(preset==='custom'||modelSettings.pending)return;
    Object.assign(modelSettings.draft,preset==='cloud-example'?{connection:'cloud',protocol:'openai-completions',base_url:'',model:'',key_action:'replace'}:{connection:'local',protocol:'openai-completions',base_url:'http://127.0.0.1:1234/v1',model:'',key_action:'remove'});
    modelSettings.secret='';modelSettings.dirty=true;modelSettings.notice='预设已填入草稿，请核对地址与模型名称。';renderModelSettingsContent();document.getElementById('model-base_url')?.focus();return;
  }
  updateModelDraft(event);
});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.model-advanced'))modelSettings.advanced=event.target.open;},true);
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='model-load')loadModelSettings();
  if(action==='model-refresh')loadModelSettings(true);
  if(action==='model-reset'&&!modelSettings.pending){modelSettings.draft={...modelSettingsDefaults(),...modelSettings.data.draft,key_action:modelSettings.data.has_api_key?'keep':'remove'};modelSettings.secret='';modelSettings.error='';modelSettings.test=null;modelSettings.dirty=false;modelSettings.notice='已撤销未保存的修改。';renderModelSettingsContent();}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form="model-settings"]');if(!form)return;event.preventDefault();
  if(!isAdmin()||modelSettings.pending)return;
  const intent=event.submitter?.value;if(!['test','save'].includes(intent))return;
  const errors=modelFormErrors(intent);showModelErrors(errors);if(errors.length)return;
  const payload={...modelSettings.draft,expected_revision:modelSettings.data.revision};
  for(const key of ['max_tokens','context_window','timeout_seconds','max_concurrency'])payload[key]=Number(payload[key]);
  payload.model=payload.model.trim();payload.base_url=payload.base_url.trim();if(payload.key_action==='replace')payload.api_key=modelSettings.secret.trim();
  const epoch=modelSettings.epoch,owner=currentUser().id,signature=modelDraftSignature();modelSettings.pending=intent;modelSettings.error='';modelSettings.notice='';renderModelSettingsContent();
  try {
    const result=await api(intent==='test'?'/api/model-config/test':'/api/model-config',payload);
    if(epoch!==modelSettings.epoch||owner!==currentUser().id)return;
    if(intent==='test'){modelSettings.test=result;modelSettings.testSignature=signature;modelSettings.notice=result.ok?'测试已完成；请核对结果，草稿不会自动启用。':'连接测试未通过，配置与密钥输入已保留。';}
    else {modelSettings.data=result;modelSettings.draft={...modelSettingsDefaults(),...result.draft,key_action:result.has_api_key?'keep':'remove'};modelSettings.secret='';modelSettings.dirty=false;modelSettings.test=null;modelSettings.notice='配置已保存并启用。后续 Agent 尝试将使用此连接，现有任务与历史产物保留。';}
    if(intent==='save'&&state?.settings&&result.status){state.settings.runtime={...result.status,last_test:result.last_test};state.settings.mode=result.status.mode;state.settings.model=result.status.model;}
    if(intent==='test'&&result.draft===false&&state?.settings){state.settings.runtime={...state.settings.runtime,last_test:result};modelSettings.data.last_test=result;modelSettings.data.status={...modelSettings.data.status,last_test:result};}
    refreshRuntimeBadge();notify(intent==='save'?'模型配置已保存并启用。':result.ok?'连接测试通过。':'连接测试失败，请检查页面结果。',intent==='test'&&!result.ok);
  } catch(error){if(epoch!==modelSettings.epoch)return;modelSettings.error=error.status===409?'配置已被更新或有 Agent 正在执行，暂未保存。草稿已保留；待任务结束后重试，若配置版本变化请重新读取后核对。':error.message;}
  finally{if(epoch===modelSettings.epoch){modelSettings.pending='';renderModelSettingsContent();refreshRuntimeBadge();if(modelSettings.error)showModelErrors([],modelSettings.error);}}
});
