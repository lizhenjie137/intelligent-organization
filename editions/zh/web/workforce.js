"use strict";

const assessmentNames={claimed:'员工自报',suggested:'资料候选',verified:'已核验',rejected:'未通过'};
const assessmentBadge=status=>`<span class="assessment-badge ${escape(status)}">${escape(assessmentNames[status] || status)}</span>`;
const levelNames=['','了解基础','独立完成','熟练解决','指导他人','复杂场景专家'];
const levelOptions=(selected=2)=>[1,2,3,4,5].map(n=>`<option value="${n}" ${Number(selected)===n?'selected':''}>L${n} · ${levelNames[n]}</option>`).join('');
const myActor=()=>actor(currentUser().actor_id);
const personName=id=>productName(actor(id)?.name || id);
const documentById=id=>state.documents.find(d=>d.id===id);
const myAssessments=()=>state.assessments.filter(a=>a.actor_id===currentUser().actor_id);

let authViewMode='';
const authDrafts={login:{username:'',password:''},register:{display_name:'',username:'',password:'',confirm_password:''}};
function resetAuthDrafts() {
  authViewMode='';
  for(const draft of Object.values(authDrafts))for(const key of Object.keys(draft))draft[key]='';
  const form=app.querySelector('form[data-form="auth-login"],form[data-form="auth-register"]');
  if(form)for(const name of ['username','display_name','password','confirm_password']){const field=form.elements.namedItem(name);if(field)field.value='';}
}
function captureAuthDraft() {
  const form=app.querySelector('form[data-form="auth-login"],form[data-form="auth-register"]');
  if(!form)return;
  const draft=authDrafts[form.dataset.form==='auth-register'?'register':'login'];
  for(const key of Object.keys(draft)){const field=form.elements.namedItem(key);if(field)draft[key]=field.value;}
}
function validateAuthConfirmation(form,force=false) {
  if(form.dataset.form!=='auth-register')return true;
  const password=form.elements.namedItem('password'),confirmation=form.elements.namedItem('confirm_password');
  const mismatch=password.value!==confirmation.value;
  const show=mismatch&&(force||confirmation.dataset.touched==='true');
  confirmation.setAttribute('aria-invalid',String(show));
  const error=form.querySelector('#auth-confirm-error');
  error.hidden=!show;
  if(force&&mismatch)confirmation.focus();
  return !mismatch;
}
function renderAuth(mode,focusMode=false) {
  resetModelSettings();
  captureAuthDraft();
  const setup=Boolean(authState?.setup_required);
  authViewMode=mode||authViewMode||(setup?'register':'login');
  const registering=authViewMode==='register';
  app.innerHTML=`<div class="auth-layout"><section class="auth-story"><div class="auth-brand"><img src="/brand-mark.svg" alt="" width="32" height="32"><span>小辣椒 <small>智能组织</small></span></div><div class="auth-story-content"><span class="auth-label">组织协作工作空间</span><h1>目标清晰，<br>交付有序。</h1><p>管理目标与任务，记录阶段成果，<br>让交接和验收有据可查。</p><div class="auth-chain"><div>${icon('target')}<span><strong>共享目标</strong><small>明确目标与负责人</small></span></div><div>${icon('people')}<span><strong>协作交付</strong><small>共享进展与交付资料</small></span></div><div>${icon('shield')}<span><strong>独立验收</strong><small>独立核对完成结果</small></span></div></div></div><small class="auth-foot">组织工作空间 · 本地数据存储</small></section><section class="auth-form-panel"><div class="auth-form-wrap auth-account-access"><div class="auth-mode-switch" role="group" aria-label="账号操作"><button type="button" data-auth-mode="login" aria-controls="auth-account-form" aria-pressed="${!registering}">登录</button><button type="button" data-auth-mode="register" aria-controls="auth-account-form" aria-pressed="${registering}">注册</button></div><h2>${registering?(setup?'创建管理员账号':'注册本地账号'):'登录工作空间'}</h2><p>${registering?(setup?'首个注册账号将成为管理员；若已有其他人先完成注册，此账号将成为员工。':'注册后进入协作空间。能力核验与执行授权仍由管理员管理。'):'使用此工作空间的本地账号继续工作。'}</p><form id="auth-account-form" data-form="${registering?'auth-register':'auth-login'}" aria-label="${registering?'注册本地账号':'登录本地账号'}"><div class="form-error" role="alert"></div>${registering?'<div class="form-field"><label for="auth-display">姓名或显示名称</label><input id="auth-display" name="display_name" maxlength="80" autocomplete="name" required placeholder="例如：张老师"></div>':''}<div class="form-field"><label for="auth-username">登录账号</label><input id="auth-username" name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]{3,40}" autocomplete="username" spellcheck="false" required placeholder="3–40 位字母、数字、点、下划线或短横线"></div><div class="form-field"><label for="auth-password">密码</label><input id="auth-password" name="password" type="password" ${registering?'minlength="12" aria-describedby="auth-password-help"':''} maxlength="256" autocomplete="${registering?'new-password':'current-password'}" required placeholder="${registering?'至少 12 位，请自行设置':'输入密码'}">${registering?'<small id="auth-password-help">密码至少 12 位，最多 256 位。支持粘贴和密码管理器。</small>':''}</div>${registering?'<div class="form-field"><label for="auth-confirm-password">确认密码</label><input id="auth-confirm-password" name="confirm_password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required aria-describedby="auth-confirm-error" aria-invalid="false" placeholder="再次输入密码"><small id="auth-confirm-error" class="auth-field-error" hidden>两次输入的密码不一致，请检查后重试。</small></div>':''}<button class="button primary auth-submit" type="submit"><span data-auth-submit-label>${registering?(setup?'注册管理员并进入':'注册并进入'):'登录工作空间'}</span>${icon('arrow')}</button></form><p class="auth-help auth-local-help"><strong>本机账号</strong><span>账号保存在运行此工作空间的电脑上，密码经加盐哈希后保存。无需邮箱或云端账号。首个注册账号是管理员，后续账号为员工。</span></p></div></section></div>`;
  const form=app.querySelector('form');
  for(const [name,value] of Object.entries(authDrafts[authViewMode])){const field=form.elements.namedItem(name);if(field)field.value=value;}
  if(focusMode)app.querySelector(`[data-auth-mode="${authViewMode}"]`)?.focus();
}


let matrixProviderFilter='all';
function matrixPage() {
  const humans=state.actors.filter(a=>a.type==='human'&&a.user_id&&(isAdmin()||a.id===currentUser().actor_id)),agents=state.actors.filter(a=>a.type==='agent');
  return heading('能力矩阵','查看成员能力、核验状态与执行权限。',`<div class="heading-actions">${button('我的能力申报','claim-capability','','','plus')}${button('上传能力包','upload-skill','','primary','file')}</div>`)+
    `<section class="capability-overview"><div><strong>${humans.length}</strong><span>${isAdmin()?'员工身份':'可见员工'}</span></div><div><strong>${agents.length}</strong><span>Agent 提供者</span></div><div><strong>${state.capabilities.length}</strong><span>原子能力定义</span></div><div><strong>${state.skill_packages.length}</strong><span>已接入 Skill 包</span></div><p>${icon('shield')}能力核验与执行授权分开管理。</p></section><div class="knowledge-summary"><div class="scope-tabs" role="group" aria-label="提供者类型">${[['all','全部提供者'],['human','员工'],['agent','Agent']].map(([value,label])=>`<button type="button" data-action="matrix-filter" data-id="${value}" class="${matrixProviderFilter===value?'active':''}" aria-pressed="${matrixProviderFilter===value}">${label}</button>`).join('')}</div><span>选择能力，查看说明与授权</span></div>
    <div class="toolbar">${searchBox('搜索员工、Agent 或角色')}<div class="matrix-legend"><span class="assessment-badge claimed">员工自报</span><span class="assessment-badge verified">已核验</span><span class="assessment-badge agent-declared">Agent 声明</span><span class="permission-mark">${icon('lock')}已授权</span></div></div><div id="filter-results">${matrixList()}</div><p class="matrix-note">员工能力按 L1–L5 评审；Agent 能力仍需验证，工具需单独接入。</p>`;
}
function matrixCapabilities() {
  const score=id=>state.assessments.filter(a=>a.capability_id===id).length*2+state.skill_packages.filter(p=>p.capability_id===id).length;
  return state.capabilities.slice().sort((a,b)=>score(b.id)-score(a.id));
}
function matrixList() {
  const people=state.actors.filter(a=>(a.type==='agent'||a.type==='human'&&a.user_id&&(isAdmin()||a.id===currentUser().actor_id))&&(matrixProviderFilter==='all'||a.type===matrixProviderFilter)&&(a.name+' '+a.role).toLowerCase().includes(searchText.toLowerCase())).sort((a,b)=>(a.type==='human'?0:1)-(b.type==='human'?0:1));
  if(!people.length)return `<section class="panel">${empty('没有匹配的能力提供者','更换筛选条件，或添加员工与 Agent。','people')}</section>`;
  return `<div class="panel matrix-wrap"><table class="capability-matrix"><thead><tr><th scope="col">能力提供者 / 职责</th>${matrixCapabilities().map(c=>`<th scope="col"><button class="column-skill-link" type="button" data-action="view-skill" data-id="${escape(c.id)}">${escape(c.name)}</button><small>${escape(c.id)}</small></th>`).join('')}</tr></thead><tbody>${people.map(p=>`<tr><th scope="row"><div class="matrix-person"><span class="person-avatar ${p.type==='human'?'human':''}">${icon(p.type==='human'?'person':'bot')}</span><div><strong>${escape(productName(p.name))}</strong><small>${p.type==='human'?'员工':'Agent'} · ${escape(p.role)}</small></div></div></th>${matrixCapabilities().map(c=>{
    const records=state.assessments.filter(a=>a.actor_id===p.id&&a.capability_id===c.id),approved=records.filter(a=>a.status==='verified').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0],latest=approved||records.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0],allowed=(p.permissions||[]).includes(c.id),registered=(p.capability_ids||[]).includes(c.id),isAgent=p.type==='agent';
    const status=isAgent?(registered?'Agent 已声明':'未登记'):(latest?assessmentNames[latest.status]+' L'+latest.level:registered?'角色已登记':'暂无记录');
    return `<td><button class="matrix-cell ${isAgent?(registered?'agent-declared':'unrecorded'):latest?escape(latest.status):registered?'preset':'unrecorded'}" type="button" data-action="assessment-detail" data-actor="${escape(p.id)}" data-capability="${escape(c.id)}" aria-label="${escape(productName(p.name))}的${escape(c.name)}：${status}"><span class="matrix-cell-main">${isAgent?(registered?`${icon('bot')}<span>能力已声明</span>`:'<span class="matrix-dash">—</span>'):latest?`<strong>L${latest.level}</strong><span>${assessmentNames[latest.status]}</span>`:registered?'<span>角色已登记</span>':'<span class="matrix-dash">—</span>'}</span><span class="matrix-cell-bottom">${allowed?`${icon('lock')}已授权`:registered||latest?'未授权':'查看说明'}${!isAgent&&records.length>1?` · ${records.length} 条记录`:''}</span>${isAgent&&registered?`<span class="agent-cell-note">${state.settings.mode==='model'?'模型模式':'规则运行（不调用模型）'} · 待验证</span>`:''}</button></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function myCapabilitiesPage() {
  const list=myAssessments(),me=myActor();
  return heading('我的能力','提交工作证据，跟踪核验与授权。',button('申报一项能力','claim-capability','','primary','plus'))+
    `<section class="panel personal-banner"><div class="personal-identity"><div class="person-avatar human">${icon('person')}</div><div><h2>${escape(productName(currentUser().display_name || me?.name))}</h2><p>${escape(me?.role || '组织员工')}<span>账号：${escape(currentUser().username)}</span></p></div></div><div class="personal-numbers"><span><b>${list.filter(a=>a.status==='verified').length}</b>已核验</span><span><b>${list.filter(a=>a.status==='claimed'||a.status==='suggested').length}</b>待评审</span><span><b>${me?.permissions?.length || 0}</b>已授权</span></div></section>
    <div class="capability-process"><span>${icon('file')}接入工作资料</span>${icon('arrow')}<span>${icon('cube')}自报或发现候选能力</span>${icon('arrow')}<span>${icon('shield')}管理员核验证据</span>${icon('arrow')}<span>${icon('lock')}单独授予执行权限</span></div><div class="toolbar">${searchBox('搜索能力或申报说明')}<span class="toolbar-info">资料候选需人工核验</span></div><div id="filter-results">${myCapabilitiesList()}</div>`;
}

function myCapabilitiesList() {
  const list=myAssessments().filter(a=>(capability(a.capability_id)?.name+' '+a.description).toLowerCase().includes(searchText.toLowerCase())).slice().reverse();
  return list.length?`<div class="assessment-list">${list.map(a=>assessmentCard(a)).join('')}</div>`:`<section class="panel">${empty('先留下一份能力证据','接入工作资料，引用证据后提交能力申报。','file',button('接入第一份资料','new-document','','primary','plus'))}</section>`;
}

function assessmentCard(a) {
  const doc=documentById(a.evidence_doc_id),cap=capability(a.capability_id);
  return `<article class="panel assessment-card"><div class="assessment-card-head"><div><h3>${escape(cap?.name || a.capability_id)}</h3><p>${escape(personName(a.actor_id))} · ${date(a.created_at)}</p></div><div>${assessmentBadge(a.status)}<span class="level-chip">L${a.level} · ${levelNames[a.level]||''}</span></div></div><p class="assessment-description">${escape(a.description || '待补充能力说明与证据。')}</p><div class="evidence-block"><div>${icon('file')}<strong>证据摘录</strong><span>${escape(doc?.title || '来源资料不可见')}</span></div><blockquote>${escape(a.evidence_excerpt)}</blockquote></div>${a.review_note?`<div class="review-note"><strong>评审意见</strong><p>${escape(a.review_note)}</p></div>`:''}<div class="assessment-card-actions">${isAdmin()&&['claimed','suggested'].includes(a.status)?button('评审此能力','review-assessment',`data-id="${escape(a.id)}"`,'small primary','shield'):''}${doc?button('查看来源资料','open-document',`data-id="${escape(doc.id)}"`,'small','file'):''}${a.actor_id===currentUser().actor_id&&a.status==='suggested'?button('补充说明并申报','claim-capability',`data-id="${escape(a.capability_id)}" data-document="${escape(a.evidence_doc_id)}" data-assessment="${escape(a.id)}"`,'small','edit'):''}</div></article>`;
}

function knowledgePage() {
  return heading('知识与工作证据','管理组织知识与个人工作证据。',button('接入资料','new-document','','primary','plus'))+
    `<div class="knowledge-summary"><div class="scope-tabs" role="group" aria-label="资料范围">${[['all','全部可见'],['organization','组织知识'],['personal','个人资料']].map(([id,label])=>`<button type="button" data-action="knowledge-scope" data-id="${id}" class="${knowledgeScope===id?'active':''}" aria-pressed="${knowledgeScope===id}">${label}</button>`).join('')}</div><span>${state.documents.length} 份可见资料</span></div><div class="toolbar">${searchBox('搜索资料标题或正文')}<span class="toolbar-info">支持 .md / .txt · 导入快照，不自动同步源文件</span></div><div id="filter-results">${knowledgeList()}</div>`;
}

function knowledgeList() {
  const list=state.documents.filter(d=>(knowledgeScope==='all'||d.scope===knowledgeScope)&&(d.title+' '+d.content).toLowerCase().includes(searchText.toLowerCase()));
  if(!list.length)return `<section class="panel">${empty('这里还没有资料','接入工作记录、复盘或方法文档，供任务引用和能力核验。','book',button('接入资料','new-document','','primary','plus'))}</section>`;
  let selected=list.find(d=>d.id===selectedDocument)||list[0];selectedDocument=selected.id;
  return `<section class="panel knowledge-browser"><div class="document-list" aria-label="资料列表">${list.map(d=>`<button type="button" class="document-item ${d.id===selected.id?'active':''}" data-action="select-document" data-id="${escape(d.id)}"><span class="document-item-title">${icon('file')}${escape(d.title)}</span><span class="document-meta"><span>${d.scope==='organization'?'组织知识':'个人资料'}</span><span>${date(d.created_at)}</span></span></button>`).join('')}</div><article class="document-preview"><div class="document-preview-head"><div><h2>${escape(selected.title)}</h2><p>${selected.scope==='organization'?'组织可见':'个人资料'} · ${escape(selected.source_name || '粘贴录入')} · ${selected.content.length.toLocaleString('zh-CN')} 字符</p></div><div class="heading-actions">${button('发现候选能力','suggest-capabilities',`data-id="${escape(selected.id)}"`,'small primary','network')}${button('用作申报证据','claim-capability',`data-document="${escape(selected.id)}"`,'small','plus')}</div></div><div class="document-note">候选基于关键词匹配，补充证据后提交人工核验。</div><pre class="document-content">${escape(selected.content)}</pre></article></section>`;
}

function workforceDialog(kind, options={}) {
  let title='',intro='',form='',submit='保存';
  if(kind==='document') {
    title='接入知识与工作资料';intro='导入文本快照，不同步源文件。此操作仅保存资料，不调用模型。';submit='保存资料';
    form=`<div class="file-import-zone"><label for="document-file">${icon('file')}选择 .md 或 .txt 文件</label><input id="document-file" type="file" accept=".md,.txt,text/plain,text/markdown"><span>或在下方粘贴正文 · 最多 100,000 字符</span></div><div class="form-two"><div class="form-field"><label for="document-title">资料标题</label><input id="document-title" name="title" maxlength="200" required placeholder="例如：客户访谈项目复盘"></div><div class="form-field"><label for="document-scope">可见范围</label><select id="document-scope" name="scope"><option value="personal">个人资料</option>${isAdmin()?'<option value="organization">组织知识</option>':''}</select></div></div><input type="hidden" name="source_name" value="粘贴录入"><div class="form-field"><label for="document-content">资料正文</label><textarea id="document-content" name="content" rows="12" maxlength="100000" required placeholder="粘贴工作记录、方法说明或项目成果。保留能证明你具体完成了什么的内容。"></textarea></div><small class="form-note">${isAdmin()?'组织知识对员工可见；个人资料保留个人归属。':'个人资料供本人使用，管理员可为能力评审查看。'} 已授权的任务执行可能引用资料；连接外部模型后，请按组织约定提供可使用的内容。</small>`;
  } else if(kind==='claim') {
    if(!state.documents.length){notify('请先接入一份可引用的工作资料。');workforceDialog('document');return;}
    title='申报能力';intro='选择能力并引用工作证据，提交管理员核验。';submit='提交能力申报';
    const assessment=state.assessments.find(a=>a.id===options.assessment),capId=options.capability||assessment?.capability_id,docId=options.document||assessment?.evidence_doc_id||state.documents[0].id;
    form=`<div class="form-two"><div class="form-field"><label for="claim-capability">申报能力</label><select id="claim-capability" name="capability_id" required>${state.capabilities.map(c=>`<option value="${escape(c.id)}" ${c.id===capId?'selected':''}>${escape(c.name)}</option>`).join('')}</select></div><div class="form-field"><label for="claim-level">自评等级</label><select id="claim-level" name="level">${levelOptions(assessment?.level||2)}</select></div></div><div class="form-field"><label for="claim-description">说明你的具体经验</label><textarea id="claim-description" name="description" required maxlength="5000" placeholder="例如：独立完成了 12 位用户的访谈，整理需求并交付研究报告。">${escape(assessment?.description || '')}</textarea></div><div class="form-field"><label for="claim-document">证据来源</label><select id="claim-document" name="evidence_doc_id">${state.documents.map(d=>`<option value="${escape(d.id)}" ${d.id===docId?'selected':''}>${escape(d.title)}（${d.scope==='organization'?'组织':'个人'}）</option>`).join('')}</select></div><details class="evidence-source"><summary>展开来源正文，复制需要的证据片段</summary><pre id="claim-source" class="output">${escape(documentById(docId)?.content)}</pre></details><div class="form-field"><label for="claim-excerpt">原文证据摘录</label><textarea id="claim-excerpt" name="evidence_excerpt" required maxlength="10000" placeholder="必须从所选资料复制真实存在的原文片段，不能改写或新增。">${escape(assessment?.evidence_excerpt || '')}</textarea><small>提交时会检查摘录是否确实出现在来源正文中。</small></div>`;
  } else if(kind==='review') {
    const a=state.assessments.find(a=>a.id===options.id);if(!a)return;
    title='核验员工能力';intro=`${personName(a.actor_id)} / ${capability(a.capability_id)?.name || a.capability_id}`;submit='保存评审决定';
    form=`<input type="hidden" name="assessment_id" value="${escape(a.id)}"><div class="evidence-block"><div>${icon('file')}<strong>${escape(documentById(a.evidence_doc_id)?.title || '来源资料')}</strong></div><blockquote>${escape(a.evidence_excerpt)}</blockquote></div><p class="assessment-description">${escape(a.description)}</p><div class="form-two"><div class="form-field"><label for="review-decision">评审决定</label><select id="review-decision" name="decision"><option value="verify">证据充分，核验通过</option><option value="reject">证据不足，暂不通过</option></select></div><div class="form-field"><label for="review-level">确认能力等级</label><select id="review-level" name="level">${levelOptions(a.level)}</select></div></div><div class="form-field"><label for="review-note">评审依据</label><textarea id="review-note" name="review_note" required maxlength="5000" placeholder="说明证据支持的能力范围、局限与等级依据。"></textarea></div><div class="notice">核验通过后，仍需在能力详情中单独授予执行权限。</div>`;
  } else if(kind==='user') {
    title='创建员工登录账号';intro='新账号可登录和提交资料；执行任务前需完成能力核验与授权。';submit='创建员工账号';
    form=`<div class="form-field"><label for="user-display">员工姓名</label><input id="user-display" name="display_name" maxlength="80" required autocomplete="off" placeholder="例如：李明"></div><div class="form-field"><label for="user-name">登录账号</label><input id="user-name" name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\-]{3,40}" autocomplete="off" required placeholder="字母、数字、点、下划线或短横线"></div><div class="form-field"><label for="user-password">初始密码</label><input id="user-password" name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required placeholder="至少 12 位，请自行设置"><small>通过合适的方式告知员工账号与密码。系统不会自动发送通知。</small></div>`;
  }
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div><div class="dialog-body"><p class="dialog-intro">${escape(intro)}</p><form data-form="workforce-${kind}"><div class="form-error" role="alert"></div>${form}<div class="form-actions"><button type="button" class="button" data-action="close-dialog">取消</button><button type="submit" class="button primary">${submit}</button></div></form></div>`;
  if(!dialog.open)dialog.showModal();dialog.querySelector('input:not([type="hidden"]):not([type="file"]),select,textarea')?.focus();
}

function showAssessmentDetail(actorId,capId) { showSkillDetail(capId,actorId); }

async function loadAccountList() {
  const main=document.getElementById('main');
  const container=document.createElement('section');container.id='account-list';container.className='panel account-panel';container.innerHTML='<div class="panel-header"><div><h2>员工登录账号</h2><p>账号与执行身份对应，密码不展示。</p></div></div><div class="empty">正在读取账号…</div>';
  main.querySelector('.toolbar')?.before(container);
  try {const result=await api('/api/auth/users');if(!document.getElementById('account-list'))return;container.innerHTML=`<div class="panel-header"><div><h2>员工登录账号</h2><p>管理成员的登录身份与执行角色。</p></div><span class="pill">${result.users.length} 个账号</span></div><table class="account-table"><thead><tr><th>姓名</th><th>登录账号</th><th>账号角色</th><th>执行身份</th></tr></thead><tbody>${result.users.map(u=>`<tr><td>${escape(productName(u.display_name))}</td><td>${escape(u.username)}</td><td><span class="pill">${u.role==='admin'?'管理员':'员工'}</span></td><td>${escape(productName(actor(u.actor_id)?.name || u.actor_id))}</td></tr>`).join('')}</tbody></table>`;}
  catch(error){if(document.getElementById('account-list'))container.innerHTML=`<div class="empty">${escape(error.message)}</div>`;}
}

async function authAction(path,payload,form,success) {
  if(busy)return;busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  const accountAction=form.dataset.form.startsWith('auth-'),label=form.querySelector('[data-auth-submit-label]'),originalLabel=label?.textContent;
  if(accountAction){captureAuthDraft();form.setAttribute('aria-busy','true');app.querySelectorAll('[data-auth-mode]').forEach(b=>b.disabled=true);if(label)label.textContent='正在提交…';}
  try {await api(path,payload);busy=false;if(dialog.open)dialog.close();if(path==='/api/auth/login'||path==='/api/auth/setup'||path==='/api/auth/register'){resetAuthDrafts();activeGoal='';activeTask='';selectedDocument='';searchText='';knowledgeScope='all';location.hash='collaboration';}await load();if(success)notify(success);}
  catch(error) {busy=false;form.querySelectorAll('button').forEach(b=>b.disabled=false);if(accountAction){form.setAttribute('aria-busy','false');app.querySelectorAll('[data-auth-mode]').forEach(b=>b.disabled=false);if(label)label.textContent=originalLabel;}const errorBox=form.querySelector('.form-error');if(errorBox){errorBox.textContent=error.message;errorBox.setAttribute('tabindex','-1');errorBox.focus();}else notify(error.message,true);}
}

document.addEventListener('click',async event=>{
  const modeButton=event.target.closest('[data-auth-mode]');
  if(modeButton){if(!busy&&['login','register'].includes(modeButton.dataset.authMode)&&modeButton.dataset.authMode!==authViewMode)renderAuth(modeButton.dataset.authMode,true);return;}
  const el=event.target.closest('[data-action]');if(!el||busy)return;const action=el.dataset.action;
  if(action==='logout'){try{stopCoordination();await api('/api/auth/logout',{});state=null;activeGoal='';activeTask='';selectedDocument='';searchText='';knowledgeScope='all';authState={authenticated:false,setup_required:false};resetAuthDrafts();if(dialog.open)dialog.close();renderAuth();}catch(error){notify(error.message,true);}return;}
  if(action==='new-user')return workforceDialog('user');
  if(action==='new-document')return workforceDialog('document');
  if(action==='claim-capability')return workforceDialog('claim',{capability:el.dataset.id,document:el.dataset.document,assessment:el.dataset.assessment});
  if(action==='review-assessment')return workforceDialog('review',{id:el.dataset.id});
  if(action==='assessment-detail')return showAssessmentDetail(el.dataset.actor,el.dataset.capability);
  if(action==='grant-permission'){const ok=await act({type:'grant_permission',actor_id:el.dataset.actor,capability_id:el.dataset.capability,allowed:el.dataset.allowed==='true'},el.dataset.allowed==='true'?'执行权限已授予':'执行权限已撤销');if(ok)showAssessmentDetail(el.dataset.actor,el.dataset.capability);return;}
  if(action==='select-document'){selectedDocument=el.dataset.id;document.getElementById('filter-results').innerHTML=knowledgeList();return;}
  if(action==='open-document'){selectedDocument=el.dataset.id;knowledgeScope='all';searchText='';if(dialog.open)dialog.close();location.hash='knowledge';render();return;}
  if(action==='knowledge-scope'){knowledgeScope=el.dataset.id;render();return;}
  if(action==='suggest-capabilities')return act({type:'suggest_capabilities',document_id:el.dataset.id},'已完成本地规则匹配；请到“我的能力”查看候选，候选不代表认证',{route:'my-capabilities'});
});

document.addEventListener('change',async event=>{
  if(event.target.id==='claim-document'){const doc=documentById(event.target.value);document.getElementById('claim-source').textContent=doc?.content||'';document.getElementById('claim-excerpt').value='';}
  if(event.target.id==='document-file') {
    const file=event.target.files?.[0];if(!file)return;
    try {if(!/\.(md|txt)$/i.test(file.name))throw new Error('请选择 .md 或 .txt 文本文件。');if(file.size>600000)throw new Error('文件过大，请拆分为不超过 100,000 字符的资料。');const content=await file.text();if(content.length>100000)throw new Error('资料超过 100,000 字符，请拆分后导入。');document.getElementById('document-content').value=content;document.getElementById('document-title').value=file.name.replace(/\.(md|txt)$/i,'').slice(0,200);dialog.querySelector('[name="source_name"]').value=file.name;notify('文件已读取，检查内容后保存。');}
    catch(error){dialog.querySelector('.form-error').textContent=error.message;}
  }
});

document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;const kind=form.dataset.form;
  if(!kind.startsWith('auth-')&&!kind.startsWith('workforce-'))return;event.preventDefault();if(busy)return;
  const data=new FormData(form),get=name=>String(data.get(name)||'').trim();
  if(kind==='auth-register'){if(!validateAuthConfirmation(form,true))return;return authAction('/api/auth/register',{username:get('username'),display_name:get('display_name'),password:String(data.get('password')||'')},form);}
  if(kind==='auth-login'||kind==='auth-setup')return authAction(kind==='auth-setup'?'/api/auth/setup':'/api/auth/login',{username:get('username'),password:String(data.get('password')||''),...(kind==='auth-setup'?{display_name:get('display_name')}:{})},form);
  if(kind==='workforce-user')return authAction('/api/auth/users',{username:get('username'),display_name:get('display_name'),password:String(data.get('password')||'')},form,'员工账号已创建，可使用该账号登录。');
  if(kind==='workforce-document')return act({type:'import_document',title:get('title'),content:String(data.get('content')||''),scope:get('scope'),source_name:get('source_name')},'资料已保存，可引用证据并发现候选能力',{close:true,route:'knowledge'});
  if(kind==='workforce-claim')return act({type:'claim_capability',capability_id:get('capability_id'),level:Number(get('level')),description:get('description'),evidence_doc_id:get('evidence_doc_id'),evidence_excerpt:get('evidence_excerpt')},'能力申报已提交，等待管理员核验',{close:true,route:'my-capabilities'});
  if(kind==='workforce-review')return act({type:'review_assessment',assessment_id:get('assessment_id'),decision:get('decision'),level:Number(get('level')),review_note:get('review_note')},get('decision')==='verify'?'能力已核验；执行授权需单独授予':'评审意见已记录，该申报未通过',{close:true});
});


document.addEventListener('focusout',event=>{
  if(event.target.id!=='auth-confirm-password')return;
  event.target.dataset.touched='true';validateAuthConfirmation(event.target.form);
});
document.addEventListener('input',event=>{
  if(!['auth-password','auth-confirm-password'].includes(event.target.id))return;
  const form=event.target.form;if(form?.dataset.form==='auth-register')validateAuthConfirmation(form);
});
