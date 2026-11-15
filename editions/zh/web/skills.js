"use strict";

let skillUploadDraft=null;
const skillProviders=()=>state.actors.filter(a=>(a.type==='agent'||a.type==='human'&&a.user_id)&&(isAdmin()||a.id===currentUser().actor_id));
const skillText=value=>Array.isArray(value)?value.map(v=>typeof v==='string'?v:JSON.stringify(v)).join('\n'):textOutput(value);
const providerTypeLabel=value=>({human:'员工能力',agent:'Agent 能力',both:'员工与 Agent 均适用'}[value]||value||'未指定');
const packagesFor=(capId,actorId)=>state.skill_packages.filter(p=>p.capability_id===capId&&(!actorId||p.provider_actor_id===actorId)).slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
const skillProvidersForCapability=capId=>state.actors.filter(a=>(a.type==='agent'||a.user_id)&&((a.capability_ids||[]).includes(capId)||state.skill_packages.some(p=>p.capability_id===capId&&p.provider_actor_id===a.id)));

function capabilitySpecification(cap,actorId) {
  const pkg=packagesFor(cap.id,actorId)[0],normalized=pkg?.normalized||cap.normalized||cap.skill||{};
  return {...normalized,name:normalized.name||cap.name,description:normalized.description||cap.description,version:normalized.version||cap.version||'1.0',provider_type:normalized.provider_type||cap.provider_type||'both',inputs:normalized.inputs||cap.inputs||cap.input_schema,outputs:normalized.outputs||cap.outputs||cap.output_schema,acceptance:normalized.acceptance||cap.acceptance,instructions:normalized.instructions||cap.instructions,limitations:normalized.limitations||cap.limitations,tags:normalized.tags||cap.tags||[],tools:normalized.tools||cap.tools||[],examples:normalized.examples||cap.examples||[]};
}

function skillSpecificationHtml(cap,actorId) {
  if(cap.details_restricted)return `<section class="skill-section"><h3>能力介绍</h3><p>${escape(cap.description)}</p><div class="notice">此能力的详细步骤、资料正文和来源文件仅本人及管理员可见。</div></section>`;
  const spec=capabilitySpecification(cap,actorId),packages=packagesFor(cap.id,actorId);
  return `<section class="skill-section"><div class="skill-section-title"><h3>能力说明</h3><span class="pill">${escape(providerTypeLabel(spec.provider_type))}</span><span class="pill">v${escape(spec.version)}</span></div><p class="skill-description">${escape(spec.description)}</p>${spec.tags.length?`<div class="tag-list">${spec.tags.map(t=>`<span class="tag">${escape(t)}</span>`).join('')}</div>`:''}<div class="skill-contract-grid"><div><h4>输入要求</h4><pre>${escape(skillText(spec.inputs)||'尚未提供输入说明')}</pre></div><div><h4>输出交付</h4><pre>${escape(skillText(spec.outputs)||'尚未提供输出说明')}</pre></div><div class="wide"><h4>验收标准</h4><pre>${escape(skillText(spec.acceptance)||'尚未提供验收标准')}</pre></div></div></section><section class="skill-section"><h3>执行步骤与方法</h3><pre class="skill-prose">${escape(skillText(spec.instructions)||'尚未填写执行步骤，可上传能力包补充。')}</pre></section><section class="skill-section"><h3>适用边界与限制</h3><pre class="skill-prose">${escape(skillText(spec.limitations)||'尚未填写适用边界。执行受授权、预算与人工验收约束。')}</pre></section><section class="skill-section"><h3>工具声明</h3>${spec.tools.length?`<div class="tag-list">${spec.tools.map(t=>`<span class="tag">${escape(typeof t==='string'?t:JSON.stringify(t))}</span>`).join('')}</div>`:'<p class="skill-muted">未声明依赖工具。</p>'}<p class="skill-muted">工具仅作声明，需另行接入并授权。</p></section><section class="skill-section"><h3>输入与输出参考</h3>${spec.examples.length?spec.examples.map((e,i)=>`<div class="skill-example"><strong>参考 ${i+1}</strong><dl><dt>输入</dt><dd><pre>${escape(skillText(e.input))}</pre></dd><dt>输出</dt><dd><pre>${escape(skillText(e.output))}</pre></dd></dl></div>`).join(''):'<p class="skill-muted">尚未提供输入输出参考。</p>'}</section><section class="skill-section"><h3>来源与版本</h3>${packages.length?packages.map(p=>`<div class="skill-source"><div><strong>${escape(p.source_name||'能力包')}</strong><p>提供者：${escape(productName(actor(p.provider_actor_id)?.name||p.provider_actor_id))} · v${escape(p.version||p.normalized?.version||'1.0')} · ${date(p.created_at)}</p><details><summary>查看来源摘要</summary><code>${escape(p.source_sha256||'未提供')}</code></details></div><a class="button small" href="/api/skills/${encodeURIComponent(p.id)}/source" download>${icon('download')}下载原文件</a></div>`).join(''):'<p class="skill-muted">工作空间登记项，无上传源文件。</p>'}</section>`;
}

function showSkillDetail(capId,actorId) {
  const cap=capability(capId),who=actor(actorId);if(!cap)return;
  const providers=skillProvidersForCapability(capId);
  const allowed=who?.permissions?.includes(capId),registered=who?.capability_ids?.includes(capId),records=who?.type==='human'?state.assessments.filter(a=>a.actor_id===actorId&&a.capability_id===capId).slice().reverse():[];
  dialog.classList.add('skill-dialog');
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${escape(cap.name)}</h2><p class="dialog-subtitle">${who?`${escape(productName(who.name))}的能力说明`:'组织能力详情'}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div><div class="dialog-body">${who?`<section class="skill-provider-intro"><span class="person-avatar ${who.type==='human'?'human':''}">${icon(who.type==='human'?'person':'bot')}</span><div><h3>${escape(productName(who.name))} <span class="pill">${who.type==='human'?'员工':'Agent'}</span></h3><p>${escape(who.role)}</p>${who.type==='agent'?`<p class="skill-muted">${state.settings.mode==='model'?'模型模式':'规则运行（不调用模型）'} · 能力待验证</p>`:''}</div></section><div class="permission-panel"><div><strong>${allowed?'已获得执行授权':registered?'能力已登记，尚未授权':records.some(a=>a.status==='claimed'||a.status==='suggested')?'已提交能力申报，等待核验与授权':records.some(a=>a.status==='rejected')?'能力申报未通过，请补充证据':'尚未为此提供者登记该能力'}</strong><p>${who.type==='agent'?'能力声明待验证，工具需单独接入。':'能力核验与执行授权分开管理。'}</p></div>${isAdmin()&&registered?button(allowed?'撤销授权':'授予执行权限','grant-permission',`data-actor="${escape(actorId)}" data-capability="${escape(capId)}" data-allowed="${!allowed}"`,'small '+(allowed?'':'primary'),'lock'):''}</div>`:`<div class="skill-providers"><span>关联提供者</span>${providers.map(a=>button(escape(productName(a.name)),'view-skill',`data-id="${escape(capId)}" data-actor="${escape(a.id)}"`,'small',a.type==='human'?'person':'bot')).join('')||'<small>尚无提供者登记</small>'}</div>`}${skillSpecificationHtml(cap,actorId)}${who?.type==='human'?`<section class="skill-section"><h3>员工证据与评审</h3>${records.length?records.map(assessmentCard).join(''):'<p class="skill-muted">暂无证据评审记录，能力待核验。</p>'}${actorId===currentUser().actor_id?button('补充能力证据','claim-capability',`data-id="${escape(capId)}"`,'small','plus'):''}</section>`:''}</div>`;
  if(!dialog.open)dialog.showModal();
}

function openSkillUpload(providerId) {
  skillUploadDraft={content:'',source_name:'SKILL.md',provider_actor_id:providerId||currentUser().actor_id,level:2,preview:null};
  renderSkillUploadSource();
}

function skillDialogHead(title,subtitle) {return `<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p class="dialog-subtitle">${subtitle}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div>`;}
function templateLinks(){return `<div class="skill-template-links"><span>下载规范模板</span><a href="/api/skills/template?format=markdown" download="SKILL.md">${icon('download')}SKILL.md</a><a href="/api/skills/template?format=json" download="skill.json">${icon('download')}JSON</a></div>`;}

function renderSkillUploadSource() {
  const draft=skillUploadDraft,providers=skillProviders();
  dialog.classList.add('skill-dialog');
  dialog.innerHTML=skillDialogHead('上传能力包','解析文件，核对内容后登记')+`<div class="dialog-body">${templateLinks()}<form data-form="skill-preview"><div class="form-error" role="alert"></div><div class="file-import-zone"><label for="skill-file">${icon('file')}选择 SKILL.md 或 JSON 能力包</label><input id="skill-file" type="file" accept=".md,.json,text/markdown,application/json"><span>支持文本文件或粘贴 · 文件不会作为代码执行</span></div><div class="form-two"><div class="form-field"><label for="skill-source-name">来源文件名</label><input id="skill-source-name" name="source_name" required maxlength="500" value="${escape(draft.source_name)}" placeholder="SKILL.md 或 skill.json"></div><div class="form-field"><label for="skill-provider">登记给谁</label><select id="skill-provider" name="provider_actor_id" required>${providers.map(a=>`<option value="${escape(a.id)}" ${a.id===draft.provider_actor_id?'selected':''}>${escape(productName(a.name))}（${a.type==='agent'?'Agent':'员工'}）</option>`).join('')}</select></div></div><div class="form-field"><label for="skill-content">能力包原文</label><textarea id="skill-content" name="content" rows="14" maxlength="100000" required spellcheck="false" placeholder="粘贴带 frontmatter 的 Markdown，或符合模板的 JSON。">${escape(draft.content)}</textarea></div><div class="notice">预览不保存。员工能力需核验，Agent 能力需验证；执行权限另行授予。</div><div class="form-actions"><button type="button" class="button" data-action="close-dialog">取消</button><button type="submit" class="button primary">${icon('search')}解析并预览</button></div></form></div>`;
  if(!dialog.open)dialog.showModal();
}

function renderSkillPreview() {
  const draft=skillUploadDraft,preview=draft.preview,spec=draft.overrides||preview.skill||{},provider=actor(draft.provider_actor_id),human=provider?.type==='human';
  const field=(key,label,required=false,rows=3)=>`<div class="form-field"><label for="canonical-${key}">${label}${required?' *':''}</label><textarea id="canonical-${key}" name="${key}" rows="${rows}" ${required?'required':''} maxlength="${key==='description'?4000:50000}">${escape(skillText(spec[key]))}</textarea></div>`;
  dialog.classList.add('skill-dialog');
  dialog.innerHTML=skillDialogHead('核对能力说明','确认登记后保存，原文件保留')+`<div class="dialog-body"><div class="skill-preview-status"><span class="pill">${escape(preview.format||'已解析')}</span><strong>${escape(draft.source_name)}</strong><span>登记给 ${escape(productName(provider?.name||draft.provider_actor_id))}</span></div>${(preview.missing_fields||[]).length?`<div class="skill-warning"><strong>原文件缺少字段，请在下方补全</strong><p>${preview.missing_fields.map(escape).join('、')}</p></div>`:''}${(preview.warnings||[]).length?`<div class="skill-warning"><strong>格式提示</strong><ul>${preview.warnings.map(w=>`<li>${escape(skillText(w))}</li>`).join('')}</ul></div>`:''}<form data-form="skill-import"><div class="form-error" role="alert"></div><div class="form-two"><div class="form-field"><label for="canonical-name">能力名称 *</label><input id="canonical-name" name="name" value="${escape(spec.name)}" maxlength="200" required></div><div class="form-field"><label for="canonical-version">版本</label><input id="canonical-version" name="version" value="${escape(spec.version||'1.0')}" maxlength="80" required></div></div>${field('description','功能介绍',true)}<div class="form-two"><div class="form-field"><label for="canonical-provider_type">适用提供者</label><select id="canonical-provider_type" name="provider_type">${[['both','员工与 Agent'],['human','仅员工'],['agent','仅 Agent']].map(([value,label])=>`<option value="${value}" ${spec.provider_type===value?'selected':''}>${label}</option>`).join('')}</select></div>${human?`<div class="form-field"><label for="canonical-level">员工自评等级（待核验）</label><select id="canonical-level" name="level">${levelOptions(draft.level)}</select></div>`:'<div class="form-field"><label>Agent 能力状态</label><div class="notice">待验证 · 未授权</div></div>'}</div><div class="form-two">${field('inputs','输入要求',true)}${field('outputs','输出交付',true)}</div>${field('acceptance','验收标准',true)}${field('instructions','执行步骤与方法',false,6)}${field('limitations','边界与限制',false,4)}<div class="form-two">${field('tags','标签（每行一个）')}${field('tools','工具依赖声明（每行一个）')}</div><div class="form-field"><label for="canonical-examples">输入输出参考（JSON 数组）</label><textarea id="canonical-examples" name="examples" rows="6" spellcheck="false">${escape(JSON.stringify(spec.examples||[],null,2))}</textarea><small>格式：[{"input":"输入内容","output":"预期输出"}]</small></div><details class="skill-original"><summary>查看原文与来源摘要</summary><code>${escape(preview.source_sha256||'')}</code><pre class="output">${escape(draft.content)}</pre></details><div class="notice">${human?'登记为待核验申报，执行权限另行授予。':'登记能力声明，不自动接入工具或授予权限。'}</div><div class="form-actions"><button type="button" class="button" data-action="skill-back">返回修改原文</button><button type="submit" class="button primary">${human?'提交待核验申报':'确认登记能力声明'}</button></div></form></div>`;
  if(!dialog.open)dialog.showModal();
}

function readSkillOverrides(form) {
  const data=new FormData(form),get=name=>String(data.get(name)||'').trim();
  let examples;
  try {examples=JSON.parse(get('examples')||'[]');if(!Array.isArray(examples)||examples.some(e=>!e||typeof e!=='object'||typeof e.input!=='string'||typeof e.output!=='string'))throw new Error();}
  catch {throw new Error('输入输出参考必须是包含 input 和 output 文本字段的 JSON 数组。输入已保留。');}
  return {...Object.fromEntries(['name','description','version','provider_type','inputs','outputs','acceptance','instructions','limitations'].map(k=>[k,get(k)])),tags:get('tags').split(/[\n,，]/).map(s=>s.trim()).filter(Boolean),tools:get('tools').split(/[\n,，]/).map(s=>s.trim()).filter(Boolean),examples};
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
  try {if(!/\.(md|json)$/i.test(file.name))throw new Error('请选择 .md 或 .json 能力包。');if(file.size>600000)throw new Error('文件过大，请将能力包限制在 100,000 字符内。');const content=await file.text();if(content.length>100000)throw new Error('内容超过 100,000 字符，请拆分能力包。');dialog.querySelector('[name="source_name"]').value=file.name;dialog.querySelector('[name="content"]').value=content;notify('已读取能力包；点击“解析并预览”检查格式。');}catch(error){dialog.querySelector('.form-error').textContent=error.message;}
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
    if(overrides.provider_type!=='both'&&overrides.provider_type!==provider?.type)throw new Error('能力的适用提供者类型与所选员工 / Agent 不一致，请修订或返回选择正确的提供者。');
    skillUploadDraft.overrides=overrides;skillUploadDraft.level=Number(get('level'))||2;
    const ok=await act({type:'import_skill',content:skillUploadDraft.content,source_name:skillUploadDraft.source_name,provider_actor_id:skillUploadDraft.provider_actor_id,overrides,level:skillUploadDraft.level},provider?.type==='human'?'能力包已保存，员工申报等待核验。':'Agent 能力声明已登记；仍需单独授权和实测。',{close:true,route:'matrix'});
    if(ok)skillUploadDraft=null;
  } catch(error){errorBox.textContent=error.message;errorBox.setAttribute('tabindex','-1');errorBox.focus();}
});
dialog.addEventListener('close',()=>dialog.classList.remove('skill-dialog'));

