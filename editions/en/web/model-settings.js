"use strict";

// Drafts stay in this page's memory only. Secrets are never interpolated into markup.
let modelSettings = {owner:'',epoch:0,data:null,draft:null,secret:'',loading:false,pending:'',error:'',notice:'',dirty:false,test:null,testSignature:'',advanced:false};
function resetModelSettings() {
  modelSettings={owner:'',epoch:modelSettings.epoch+1,data:null,draft:null,secret:'',loading:false,pending:'',error:'',notice:'',dirty:false,test:null,testSignature:'',advanced:false};
}
const runtimeMessage=value=>String(value??'').replace(/DeepSeek Harness|DeepSeek ?\u5e95\u5ea7/g,'Runtime');
function runtimePresentation(runtime=state?.settings?.runtime) {
  if(!runtime) return state?.settings?.mode==='demo'?{label:'Rule-based run (no model calls)',kind:'neutral',text:'Using fixed rules; no model calls are made.'}:{label:'Model status unconfirmed',kind:'warning',text:'The current model connection status has not been retrieved.'};
  if(runtime.mode==='demo'||runtime.runtime==='demo')return {label:'Rule-based run (no model calls)',kind:'neutral',text:'Using fixed rules; no model calls are made.'};
  if(!runtime.configured)return {label:'Model not configured',kind:'warning',text:runtimeMessage(runtime.message)||'An administrator must configure the model connection. Employee collaboration can continue.'};
  if(runtime.available===false)return {label:'Model unavailable',kind:'error',text:runtimeMessage(runtime.message)||'An administrator needs to check the connection settings.'};
  const test=runtime.last_test||runtime.test;
  if(test?.ok===false)return {label:'Connection test failed',kind:'error',text:runtimeMessage(test.message)||'The latest connection test failed. Check the settings and retry.'};
  if(test?.ok===true||runtime.model_connection_verified===true)return {label:'Connection test passed',kind:'success',text:'The connection passed its test. Actual task deliverables still require human review.'};
  return {label:'Configured · Not tested',kind:'warning',text:'Settings are active; the model connection has not been verified.'};
}
function runtimeBadgeHtml() {
  const view=runtimePresentation(),inner=`${icon('bot')}${escape(view.label)}`;
  return isAdmin()?`<a id="runtime-badge" class="mode-badge runtime-${view.kind}" href="#model-settings" title="Manage model connection">${inner}</a>`:`<span id="runtime-badge" class="mode-badge runtime-${view.kind}">${inner}</span>`;
}
function runtimeHintHtml() {
  const view=runtimePresentation();
  return `<div class="hint-bar runtime-hint">${icon('info')}<div><strong>${escape(view.label)}.</strong> ${escape(view.text)}${state?.settings?.mode==='model'?` Current model: ${escape(state.settings.model||'Not configured')}. Generated text does not mean an external business action was completed.`:''}${isAdmin()?' <a href="#model-settings">Configure model connection</a>':''}</div></div>`;
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
  if(!isAdmin())return heading('Model settings','Only organization administrators can manage model connections.')+`<section class="panel">${empty('Administrator access required','Ask an organization administrator to configure the model.','lock')}</section>`;
  if(modelSettings.owner!==currentUser().id){resetModelSettings();modelSettings.owner=currentUser().id;}
  return heading('Model settings','Manage the model connection used by the organization.',button('Load latest state','model-refresh','','small','refresh'))+`<div class="model-framework"><div class="model-framework-mark">${icon('network')}</div><div><strong>Model connection</strong><p>Local or cloud services for Agent tasks.</p></div><span class="pill">Text execution · Human review</span></div><div id="model-settings-content">${modelSettings.data?modelSettingsFormHtml():modelSettings.error?`<section class="panel model-load-state"><p>${escape(runtimeMessage(modelSettings.error))}</p>${button('Reload settings','model-load','','','refresh')}</section>`:'<section class="panel model-load-state">Loading the current connection settings...</section>'}</div>`;
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
  return `<section class="model-current"><div><span class="model-section-eyebrow">Active connection</span><strong class="runtime-${view.kind}">${escape(view.label)}</strong><p>${escape(s.status?.model||'No model configured')}<span>${s.draft?.connection==='cloud'?'Cloud service':'Local / LAN service'}</span></p><small class="model-saved-endpoint">${escape(s.draft?.base_url||'No service address provided')}</small></div><p>${escape(view.text)}${s.last_test?.tested_at?`<small>Last tested: ${date(s.last_test.tested_at)}</small>`:''}</p></section><section class="panel model-config-panel"><form data-form="model-settings" novalidate><div class="model-form-heading"><div><h2>Connection settings</h2><p>Test the current draft; save it for subsequent Agent tasks.</p></div><span id="model-draft-state" class="pill">${modelSettings.dirty?'Unsaved changes':'Current settings loaded'}</span></div><div id="model-config-error" class="form-error" tabindex="-1"></div><fieldset class="model-form-fields" ${modelSettings.pending?'disabled':''}><div class="model-form-grid"><div class="form-field"><label for="model-connection">Model location</label><select id="model-connection" name="connection"><option value="local" ${d.connection==='local'?'selected':''}>Local / LAN device</option><option value="cloud" ${d.connection==='cloud'?'selected':''}>Cloud model service</option></select><small>A failed local connection will not automatically switch to the cloud.</small></div><div class="form-field"><label for="model-preset">Quick setup</label><select id="model-preset" name="preset"><option value="custom">Custom connection</option><option value="cloud-example">Cloud API</option><option value="local">Local OpenAI compatible service</option></select><small>A preset only fills the draft. It does not save or send a request.</small></div></div><div class="model-form-grid"><div class="form-field"><label for="model-protocol">API protocol</label><select id="model-protocol" name="protocol"><option value="openai-completions" ${d.protocol==='openai-completions'?'selected':''}>OpenAI Chat Completions compatible</option><option value="deepseek-messages" ${d.protocol==='deepseek-messages'?'selected':''}>Messages API</option></select><small>Local devices typically use the OpenAI compatible protocol.</small></div>${input('model','Model name','text','required maxlength="200" autocomplete="off" placeholder="Enter a model name available from the service"')}</div>${input('base_url','API base URL','url','required autocomplete="off" spellcheck="false" placeholder="https://api.example.com/v1"')}<p class="model-field-hint">Enter the API base URL without /chat/completions or /messages. Cloud services require HTTPS; task data will be sent to this address.</p><section class="model-credential"><div><h3>API key</h3><span>${hasKey?'A key is saved; its value is not shown':'No key is saved'}</span></div><div class="model-form-grid"><div class="form-field"><label for="model-key-action">How to handle the key</label><select id="model-key-action" name="key_action"><option value="keep"${selected('keep')} ${!hasKey||keyChanged?'disabled':''}>Keep saved key</option><option value="replace"${selected('replace')}>Enter / replace key</option><option value="remove"${selected('remove')}>Remove saved key</option></select><small id="model-key-policy">${keyChanged?'The address or protocol changed. Enter a key again, or explicitly remove it for a keyless local service.':'The server reuses the current key only when you select Keep saved key.'}</small><small class="model-field-error" data-error-for="key_action"></small></div><div class="form-field" id="model-secret-field" ${d.key_action!=='replace'?'hidden':''}><label for="model-api-key">New API key</label><input id="model-api-key" name="api_key" type="password" autocomplete="new-password" maxlength="4096" spellcheck="false" aria-describedby="model-key-storage"><small class="model-field-error" data-error-for="api_key"></small></div></div><p id="model-key-storage" class="model-field-hint">${s.secret_storage==='memory-only'?'This environment stores keys only in process memory. Enter the key again after a restart.':s.secret_storage==='environment'?'The current key comes from the startup environment. Replacing and saving it here stores it securely on the server.':'The key is sent only to this backend and stored server-side. The browser does not persist it.'} After removing a cloud key, configure a new one before making calls. Keyless local connections do not use cloud keys.</p></section><details class="model-advanced" ${modelSettings.advanced?'open':''}><summary>Advanced parameters</summary><div class="model-form-grid">${input('max_tokens','Maximum output per call (tokens)','number','required min="32" max="131072" step="1"')}${input('context_window','Model context capacity','number','required min="1024" max="2000000" step="1"')}${input('timeout_seconds','Timeout per call (seconds)','number','required min="1" max="1800" step="1"')}${input('max_concurrency','Concurrent Agent limit','number','required min="1" max="32" step="1"')}</div><p class="model-field-hint">The context capacity must match the model service. Concurrency limits simultaneous Agent runs, not the number of employees.</p></details><div class="model-actions"><button type="submit" name="intent" value="test" class="button">${icon('play')}Test current connection</button><button type="submit" name="intent" value="save" class="button primary">${icon('check')}Save and activate</button><button type="button" class="button ghost" data-action="model-reset">Discard unsaved changes</button></div></fieldset><div id="model-operation-status" class="model-operation-status">${modelSettings.pending?`${modelSettings.pending==='test'?'Testing model connection':'Saving and activating settings'}. Please wait...`:escape(modelSettings.notice)}</div><p class="model-test-note">The test sends fixed text only, without organization data, and may incur a small charge. A passed test only confirms connectivity.</p><div id="model-test-result">${modelTestResultHtml()}</div></form></section>`;
}
function modelTestResultHtml() {
  const result=modelSettings.test;if(!result)return '';
  const stale=modelSettings.testSignature!==modelDraftSignature();
  return `<div class="model-test-result ${result.ok?'success':'error'}"><strong>${stale?'Previous draft test':result.draft!==false?'Current draft test':'Active connection test'}: ${result.ok?'Passed':'Failed'}</strong><p>${escape(runtimeMessage(result.message)||'Test complete')}</p><small>${date(result.tested_at)}${Number.isFinite(result.latency_ms??result.latency)?` · Duration ${(result.latency_ms!=null?result.latency_ms/1000:result.latency).toFixed(2)} seconds`:''}${stale?' · Settings changed; test again':result.draft!==false?' · Save and activate to apply':''}</small></div>`;
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
    else modelSettings.notice='Latest server settings and revision loaded. Your draft is unchanged. Compare it with the active connection before testing or saving.';
    if(state?.settings&&result.status)state.settings.runtime={...result.status,last_test:result.last_test};
    renderModelSettingsContent();refreshRuntimeBadge();
  } catch(error){if(epoch!==modelSettings.epoch)return;modelSettings.error=error.message;if(route()==='model-settings')render();}
  finally{if(epoch===modelSettings.epoch)modelSettings.loading=false;}
}
function modelFormErrors(intent='test') {
  const d=modelSettings.draft,errors=[];
  if(!String(d.model).trim())errors.push(['model','Enter a model name available from the service.']);
  let url;try{url=new URL(String(d.base_url).trim());}catch{errors.push(['base_url','Enter a complete HTTP(S) API base URL.']);}
  if(url&&(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash||/\/(chat\/completions|messages)\/?$/.test(url.pathname)))errors.push(['base_url','Use an API base URL without credentials, a query, a fragment or an inference endpoint.']);
  if(url&&d.connection==='cloud'&&url.protocol!=='https:'&&!['127.0.0.1','localhost','[::1]'].includes(url.hostname))errors.push(['base_url','Cloud model services require HTTPS.']);
  if(d.key_action==='keep'&&(!modelSettings.data.has_api_key||modelSettingsKeyChanged()))errors.push(['key_action','The address or protocol changed; the saved key cannot be reused. Enter it again or explicitly remove it.']);
  if(d.key_action==='replace'&&!modelSettings.secret.trim())errors.push(['api_key','Enter a new API key.']);
  if(intent==='test'&&d.key_action==='remove'&&(d.connection==='cloud'||d.protocol==='deepseek-messages'))errors.push(['key_action','Cloud services or Messages API require a key. Enter one or keep the saved key.']);
  for(const [key,min,max] of [['max_tokens',32,131072],['context_window',1024,2000000],['timeout_seconds',1,1800],['max_concurrency',1,32]]){const n=Number(d[key]);if(!Number.isInteger(n)||n<min||n>max)errors.push([key,`Enter an integer in the range ${min}–${max}.`]);}
  if(Number(d.max_tokens)>=Number(d.context_window))errors.push(['max_tokens','Maximum output tokens must be less than the context capacity.']);
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
  const dirty=document.getElementById('model-draft-state');if(dirty)dirty.textContent='Unsaved changes';
  const hasKey=modelSettings.data.has_api_key,changed=hasKey&&modelSettingsKeyChanged(),keep=form.querySelector('option[value="keep"]');if(keep)keep.disabled=!hasKey||changed;
  const policy=document.getElementById('model-key-policy');if(policy)policy.textContent=changed?'The address or protocol changed. Enter a key again, or explicitly remove it for a keyless local service.':'The server reuses the current key only when you select Keep saved key.';
  document.getElementById('model-secret-field').hidden=modelSettings.draft.key_action!=='replace';
  if(el.name==='key_action'&&el.value!=='replace'){modelSettings.secret='';form.elements.api_key.value='';}
  document.getElementById('model-test-result').innerHTML=modelTestResultHtml();
}
document.addEventListener('input',updateModelDraft);
document.addEventListener('change',event=>{
  if(event.target.id==='model-preset'){
    const preset=event.target.value;if(preset==='custom'||modelSettings.pending)return;
    Object.assign(modelSettings.draft,preset==='cloud-example'?{connection:'cloud',protocol:'openai-completions',base_url:'',model:'',key_action:'replace'}:{connection:'local',protocol:'openai-completions',base_url:'http://127.0.0.1:1234/v1',model:'',key_action:'remove'});
    modelSettings.secret='';modelSettings.dirty=true;modelSettings.notice='Preset added to the draft. Check the address and model name.';renderModelSettingsContent();document.getElementById('model-base_url')?.focus();return;
  }
  updateModelDraft(event);
});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.model-advanced'))modelSettings.advanced=event.target.open;},true);
document.addEventListener('click',event=>{
  const action=event.target.closest('[data-action]')?.dataset.action;
  if(action==='model-load')loadModelSettings();
  if(action==='model-refresh')loadModelSettings(true);
  if(action==='model-reset'&&!modelSettings.pending){modelSettings.draft={...modelSettingsDefaults(),...modelSettings.data.draft,key_action:modelSettings.data.has_api_key?'keep':'remove'};modelSettings.secret='';modelSettings.error='';modelSettings.test=null;modelSettings.dirty=false;modelSettings.notice='Unsaved changes discarded.';renderModelSettingsContent();}
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
    if(intent==='test'){modelSettings.test=result;modelSettings.testSignature=signature;modelSettings.notice=result.ok?'Test complete. Review the result; the draft is not activated automatically.':'Connection test failed. Settings and key input are preserved.';}
    else {modelSettings.data=result;modelSettings.draft={...modelSettingsDefaults(),...result.draft,key_action:result.has_api_key?'keep':'remove'};modelSettings.secret='';modelSettings.dirty=false;modelSettings.test=null;modelSettings.notice='Settings saved and activated. Subsequent Agent runs will use this connection. Existing tasks and historical deliverables are preserved.';}
    if(intent==='save'&&state?.settings&&result.status){state.settings.runtime={...result.status,last_test:result.last_test};state.settings.mode=result.status.mode;state.settings.model=result.status.model;}
    if(intent==='test'&&result.draft===false&&state?.settings){state.settings.runtime={...state.settings.runtime,last_test:result};modelSettings.data.last_test=result;modelSettings.data.status={...modelSettings.data.status,last_test:result};}
    refreshRuntimeBadge();notify(intent==='save'?'Model settings saved and activated.':result.ok?'Connection test passed.':'Connection test failed. Review the result on this page.',intent==='test'&&!result.ok);
  } catch(error){if(epoch!==modelSettings.epoch)return;modelSettings.error=error.status===409?'Settings changed or an Agent is running. Not saved yet. Your draft is preserved. Retry after the task completes; if the settings revision changed, reload and review it.':error.message;}
  finally{if(epoch===modelSettings.epoch){modelSettings.pending='';renderModelSettingsContent();refreshRuntimeBadge();if(modelSettings.error)showModelErrors([],modelSettings.error);}}
});
