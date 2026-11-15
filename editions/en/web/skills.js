"use strict";

let skillUploadDraft=null;
const skillProviders=()=>state.actors.filter(a=>(a.type==='agent'||a.type==='human'&&a.user_id)&&(isAdmin()||a.id===currentUser().actor_id));
const skillText=value=>Array.isArray(value)?value.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n'):textOutput(value);
const providerTypeLabel=value=>({human:'Employee capability',agent:'Agent capability',both:'Employees and Agents'}[value]||value||'Unspecified');
const packagesFor=(capId,actorId)=>state.skill_packages.filter(p=>p.capability_id===capId&&(!actorId||p.provider_actor_id===actorId)).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
const skillProvidersForCapability=capId=>state.actors.filter(a=>(a.type==='agent'||a.user_id)&&((a.capability_ids||[]).includes(capId)||state.skill_packages.some(p=>p.capability_id===capId&&p.provider_actor_id===a.id)));

function capabilitySpecification(cap,actorId) {
  const pkg=packagesFor(cap.id,actorId)[0],normalized=pkg?.normalized||cap.normalized||cap.skill||{};
  return {...normalized,name:normalized.name||cap.name,description:normalized.description||cap.description,version:normalized.version||cap.version||'1.0',provider_type:normalized.provider_type||cap.provider_type||'both',inputs:normalized.inputs||cap.inputs||cap.input_schema,outputs:normalized.outputs||cap.outputs||cap.output_schema,acceptance:normalized.acceptance||cap.acceptance,instructions:normalized.instructions||cap.instructions,limitations:normalized.limitations||cap.limitations,tags:normalized.tags||cap.tags||[],tools:normalized.tools||cap.tools||[],examples:normalized.examples||cap.examples||[]};
}

function skillSpecificationHtml(cap,actorId) {
  if(cap.details_restricted)return `<section class="skill-section"><h3>Capability introduction</h3><p>${escape(cap.description)}</p><div class="notice">Detailed steps, document text and source files are visible only to the owner and administrators.</div></section>`;
  const spec=capabilitySpecification(cap,actorId),packages=packagesFor(cap.id,actorId);
  return `<section class="skill-section"><div class="skill-section-title"><h3>Capability specification</h3><span class="pill">${escape(providerTypeLabel(spec.provider_type))}</span><span class="pill">v${escape(spec.version)}</span></div><p class="skill-description">${escape(spec.description)}</p>${spec.tags.length?`<div class="tag-list">${spec.tags.map(t=>`<span class="tag">${escape(t)}</span>`).join('')}</div>`:''}<div class="skill-contract-grid"><div><h4>Input requirements</h4><pre>${escape(skillText(spec.inputs)||'No input requirements provided')}</pre></div><div><h4>Outputs and deliverables</h4><pre>${escape(skillText(spec.outputs)||'No output specification provided')}</pre></div><div class="wide"><h4>Acceptance criteria</h4><pre>${escape(skillText(spec.acceptance)||'No acceptance criteria provided')}</pre></div></div></section><section class="skill-section"><h3>Steps and method</h3><pre class="skill-prose">${escape(skillText(spec.instructions)||'No execution steps provided. Upload a capability package to add them.')}</pre></section><section class="skill-section"><h3>Scope and limitations</h3><pre class="skill-prose">${escape(skillText(spec.limitations)||'No scope specified. Execution remains subject to permissions, budgets and human review.')}</pre></section><section class="skill-section"><h3>Declared tools</h3>${spec.tools.length?`<div class="tag-list">${spec.tools.map(t=>`<span class="tag">${escape(typeof t==='string'?t:JSON.stringify(t))}</span>`).join('')}</div>`:'<p class="skill-muted">No tool dependencies declared.</p>'}<p class="skill-muted">Tools are declarations only; connect and authorize them separately.</p></section><section class="skill-section"><h3>Input and output examples</h3>${spec.examples.length?spec.examples.map((e,i)=>`<div class="skill-example"><strong>Example ${i+1}</strong><dl><dt>Input</dt><dd><pre>${escape(skillText(e.input))}</pre></dd><dt>Output</dt><dd><pre>${escape(skillText(e.output))}</pre></dd></dl></div>`).join(''):'<p class="skill-muted">No input/output examples provided.</p>'}</section><section class="skill-section"><h3>Source and version</h3>${packages.length?packages.map(p=>`<div class="skill-source"><div><strong>${escape(p.source_name||'Capability package')}</strong><p>Provider: ${escape(productName(actor(p.provider_actor_id)?.name||p.provider_actor_id))} · v${escape(p.version||p.normalized?.version||'1.0')} · ${date(p.created_at)}</p><details><summary>View source summary</summary><code>${escape(p.source_sha256||'Not provided')}</code></details></div><a class="button small" href="/api/skills/${encodeURIComponent(p.id)}/source" download>${icon('download')}Download source file</a></div>`).join(''):'<p class="skill-muted">Registered in this workspace; no uploaded source file.</p>'}</section>`;
}

function showSkillDetail(capId,actorId) {
  const cap=capability(capId),who=actor(actorId);if(!cap)return;
  const providers=skillProvidersForCapability(capId);
  const allowed=who?.permissions?.includes(capId),registered=who?.capability_ids?.includes(capId),records=who?.type==='human'?state.assessments.filter(a=>a.actor_id===actorId&&a.capability_id===capId).slice().reverse():[];
  dialog.classList.add('skill-dialog');
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${escape(cap.name)}</h2><p class="dialog-subtitle">${who?`${escape(productName(who.name))}: capability specification`:'Organization capability details'}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close window">${icon('close')}</button></div><div class="dialog-body">${who?`<section class="skill-provider-intro"><span class="person-avatar ${who.type==='human'?'human':''}">${icon(who.type==='human'?'person':'bot')}</span><div><h3>${escape(productName(who.name))} <span class="pill">${who.type==='human'?'Employee':'Agent'}</span></h3><p>${escape(who.role)}</p>${who.type==='agent'?`<p class="skill-muted">${state.settings.mode==='model'?'Model mode':'Rule-based run (no model calls)'} · Capability pending validation</p>`:''}</div></section><div class="permission-panel"><div><strong>${allowed?'Authorized to execute':registered?'Capability registered; not yet authorized':records.some(a=>a.status==='claimed'||a.status==='suggested')?'Claim submitted; awaiting verification and authorization':records.some(a=>a.status==='rejected')?'Claim not verified; provide more evidence':'This capability is not registered for this provider yet'}</strong><p>${who.type==='agent'?'Capability declaration awaits validation; connect tools separately.':'Capability verification and execution authorization are managed separately.'}</p></div>${isAdmin()&&registered?button(allowed?'Revoke authorization':'Grant execution permission','grant-permission',`data-actor="${escape(actorId)}" data-capability="${escape(capId)}" data-allowed="${!allowed}"`,'small '+(allowed?'':'primary'),'lock'):''}</div>`:`<div class="skill-providers"><span>Associated providers</span>${providers.map(a=>button(escape(productName(a.name)),'view-skill',`data-id="${escape(capId)}" data-actor="${escape(a.id)}"`,'small',a.type==='human'?'person':'bot')).join('')||'<small>No registered providers</small>'}</div>`}${skillSpecificationHtml(cap,actorId)}${who?.type==='human'?`<section class="skill-section"><h3>Employee evidence and review</h3>${records.length?records.map(assessmentCard).join(''):'<p class="skill-muted">No evidence review recorded. This capability awaits verification.</p>'}${actorId===currentUser().actor_id?button('Add capability evidence','claim-capability',`data-id="${escape(capId)}"`,'small','plus'):''}</section>`:''}</div>`;
  if(!dialog.open)dialog.showModal();
}

function openSkillUpload(providerId) {
  skillUploadDraft={content:'',source_name:'SKILL.md',provider_actor_id:providerId||currentUser().actor_id,level:2,preview:null};
  renderSkillUploadSource();
}

function skillDialogHead(title,subtitle) {return `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p class="dialog-subtitle">${subtitle}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close window">${icon('close')}</button></div>`;}
function templateLinks(){return `<div class="skill-template-links"><span>Download template</span><a href="/api/skills/template?format=markdown" download="SKILL.md">${icon('download')}SKILL.md</a><a href="/api/skills/template?format=json" download="skill.json">${icon('download')}JSON</a></div>`;}

function renderSkillUploadSource() {
  const draft=skillUploadDraft,providers=skillProviders();
  dialog.classList.add('skill-dialog');
  dialog.innerHTML=skillDialogHead('Upload capability package','Parse the file and review its contents before registering')+`<div class="dialog-body">${templateLinks()}<form data-form="skill-preview"><div class="form-error" role="alert"></div><div class="file-import-zone"><label for="skill-file">${icon('file')}Choose a SKILL.md or JSON capability package</label><input id="skill-file" type="file" accept=".md,.json,text/markdown,application/json"><span>Upload a text file or paste its contents · Files are not executed as code</span></div><div class="form-two"><div class="form-field"><label for="skill-source-name">Source filename</label><input id="skill-source-name" name="source_name" required maxlength="500" value="${escape(draft.source_name)}" placeholder="SKILL.md or skill.json"></div><div class="form-field"><label for="skill-provider">Register for</label><select id="skill-provider" name="provider_actor_id" required>${providers.map(a=>`<option value="${escape(a.id)}" ${a.id===draft.provider_actor_id?'selected':''}>${escape(productName(a.name))} (${a.type==='agent'?'Agent':'Employee'})</option>`).join('')}</select></div></div><div class="form-field"><label for="skill-content">Capability package source</label><textarea id="skill-content" name="content" rows="14" maxlength="100000" required spellcheck="false" placeholder="Paste Markdown with frontmatter, or JSON that matches the template.">${escape(draft.content)}</textarea></div><div class="notice">Preview does not save. Employee capabilities require verification; Agent capabilities require validation. Execution permissions are granted separately.</div><div class="form-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary">${icon('search')}Parse and preview</button></div></form></div>`;
  if(!dialog.open)dialog.showModal();
}

function renderSkillPreview() {
  const draft=skillUploadDraft,preview=draft.preview,spec=draft.overrides||preview.skill||{},provider=actor(draft.provider_actor_id),human=provider?.type==='human';
  const field=(key,label,required=false,rows=3)=>`<div class="form-field"><label for="canonical-${key}">${label}${required?' *':''}</label><textarea id="canonical-${key}" name="${key}" rows="${rows}" ${required?'required':''} maxlength="${key==='description'?4000:50000}">${escape(skillText(spec[key]))}</textarea></div>`;
  dialog.classList.add('skill-dialog');
  dialog.innerHTML=skillDialogHead('Review capability specification','Saved after confirmation; the original file is retained')+`<div class="dialog-body"><div class="skill-preview-status"><span class="pill">${escape(preview.format||'Parsed')}</span><strong>${escape(draft.source_name)}</strong><span>Register for ${escape(productName(provider?.name||draft.provider_actor_id))}</span></div>${(preview.missing_fields||[]).length?`<div class="skill-warning"><strong>The source is missing fields. Complete them below</strong><p>${preview.missing_fields.map(escape).join(', ')}</p></div>`:''}${(preview.warnings||[]).length?`<div class="skill-warning"><strong>Format notes</strong><ul>${preview.warnings.map(w=>`<li>${escape(skillText(w))}</li>`).join('')}</ul></div>`:''}<form data-form="skill-import"><div class="form-error" role="alert"></div><div class="form-two"><div class="form-field"><label for="canonical-name">Capability name *</label><input id="canonical-name" name="name" value="${escape(spec.name)}" maxlength="200" required></div><div class="form-field"><label for="canonical-version">Version</label><input id="canonical-version" name="version" value="${escape(spec.version||'1.0')}" maxlength="80" required></div></div>${field('description','Description',true)}<div class="form-two"><div class="form-field"><label for="canonical-provider_type">Supported provider type</label><select id="canonical-provider_type" name="provider_type">${[['both','Employees and Agents'],['human','Employees only'],['agent','Agents only']].map(([value,label])=>`<option value="${value}" ${spec.provider_type===value?'selected':''}>${label}</option>`).join('')}</select></div>${human?`<div class="form-field"><label for="canonical-level">Employee self-assessed level (awaiting verification)</label><select id="canonical-level" name="level">${levelOptions(draft.level)}</select></div>`:'<div class="form-field"><label>Agent capability status</label><div class="notice">Pending validation · Not authorized</div></div>'}</div><div class="form-two">${field('inputs','Input requirements',true)}${field('outputs','Outputs and deliverables',true)}</div>${field('acceptance','Acceptance criteria',true)}${field('instructions','Steps and method',false,6)}${field('limitations','Scope and limitations',false,4)}<div class="form-two">${field('tags','Tags (one per line)')}${field('tools','Declared tool dependencies (one per line)')}</div><div class="form-field"><label for="canonical-examples">Input/output examples (JSON array)</label><textarea id="canonical-examples" name="examples" rows="6" spellcheck="false">${escape(JSON.stringify(spec.examples||[],null,2))}</textarea><small>Format: [{"input":"Input text","output":"Expected output"}]</small></div><details class="skill-original"><summary>View original source and summary</summary><code>${escape(preview.source_sha256||'')}</code><pre class="output">${escape(draft.content)}</pre></details><div class="notice">${human?'Register as an unverified claim. Execution permissions are granted separately.':'Register a capability declaration. This does not connect tools or grant permissions.'}</div><div class="form-actions"><button type="button" class="button" data-action="skill-back">Back to source</button><button type="submit" class="button primary">${human?'Submit claim for verification':'Register capability declaration'}</button></div></form></div>`;
  if(!dialog.open)dialog.showModal();
}

function readSkillOverrides(form) {
  const data=new FormData(form),get=name=>String(data.get(name)||'').trim();
  let examples;
  try {examples=JSON.parse(get('examples')||'[]');if(!Array.isArray(examples)||examples.some(e=>!e||typeof e!=='object'||typeof e.input!=='string'||typeof e.output!=='string'))throw new Error();}
  catch {throw new Error('Examples must be a JSON array of objects with input and output text fields. Your input is preserved.');}
  return {...Object.fromEntries(['name','description','version','provider_type','inputs','outputs','acceptance','instructions','limitations'].map(k=>[k,get(k)])),tags:get('tags').split(/[\n,\uFF0C]/).map(s=>s.trim()).filter(Boolean),tools:get('tools').split(/[\n,\uFF0C]/).map(s=>s.trim()).filter(Boolean),examples};
}

document.addEventListener('click',event=>{
  const el=event.target.closest('[data-action]');if(!el||busy)return;
  if(el.dataset.action==='matrix-filter'){matrixProviderFilter=el.dataset.id;render();return;}
  if(el.dataset.action==='view-skill')return showSkillDetail(el.dataset.id,el.dataset.actor);
  if(el.dataset.action==='upload-skill')return openSkillUpload(el.dataset.actor);
  if(el.dataset.action==='skill-back'){
    try {skillUploadDraft.overrides=readSkillOverrides(dialog.querySelector('form'));} catch {/* The source remains intact when invalid edited examples are discarded by an explicit back action. */}
    renderSkillUploadSource();
  }
});
document.addEventListener('change',async event=>{
  if(event.target.id!=='skill-file')return;const file=event.target.files?.[0];if(!file)return;
  try {if(!/\.(md|json)$/i.test(file.name))throw new Error('Choose a .md or .json capability package.');if(file.size>600000)throw new Error('File too large. Limit the capability package to 100,000 characters.');const content=await file.text();if(content.length>100000)throw new Error('Content exceeds 100,000 characters. Split the package into smaller parts.');dialog.querySelector('[name="source_name"]').value=file.name;dialog.querySelector('[name="content"]').value=content;notify('Capability package loaded. Click Parse and preview to check its format.');}catch(error){dialog.querySelector('.form-error').textContent=error.message;}
});
document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;const kind=form.dataset.form;
  if(kind!=='skill-preview'&&kind!=='skill-import')return;event.preventDefault();if(busy)return;
  const data=new FormData(form),get=name=>String(data.get(name)||'').trim(),errorBox=form.querySelector('.form-error');
  if(kind==='skill-preview') {
    skillUploadDraft={...skillUploadDraft,content:String(data.get('content')||''),source_name:get('source_name'),provider_actor_id:get('provider_actor_id'),overrides:null};
    busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
    try {const preview=await api('/api/skills/preview',{content:skillUploadDraft.content,source_name:skillUploadDraft.source_name});skillUploadDraft.preview=preview;busy=false;renderSkillPreview();}
    catch(error){busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);errorBox.textContent=error.message;errorBox.setAttribute('tabindex','-1');errorBox.focus();}
    return;
  }
  try {
    const overrides=readSkillOverrides(form),provider=actor(skillUploadDraft.provider_actor_id);
    if(overrides.provider_type!=='both'&&overrides.provider_type!==provider?.type)throw new Error('The capability provider type does not match the selected employee or Agent. Revise it or select the correct provider.');
    skillUploadDraft.overrides=overrides;skillUploadDraft.level=Number(get('level'))||2;
    const ok=await act({type:'import_skill',content:skillUploadDraft.content,source_name:skillUploadDraft.source_name,provider_actor_id:skillUploadDraft.provider_actor_id,overrides,level:skillUploadDraft.level},provider?.type==='human'?'Capability package saved. The employee claim awaits verification.':'Agent capability declaration registered. Separate authorization and validation are still required.',{close:true,route:'matrix'});
    if(ok)skillUploadDraft=null;
  } catch(error){errorBox.textContent=error.message;errorBox.setAttribute('tabindex','-1');errorBox.focus();}
});
dialog.addEventListener('close',()=>dialog.classList.remove('skill-dialog'));

