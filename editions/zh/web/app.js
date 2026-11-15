"use strict";

const paths = {
  network:'M12 3v5m0 8v5M3 12h5m8 0h5M5.6 5.6l3.5 3.5m5.8 5.8 3.5 3.5M5.6 18.4l3.5-3.5m5.8-5.8 3.5-3.5M15.5 12a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z',
  dashboard:'M3 3h7v7H3zM14 3h7v11h-7zM3 14h7v7H3zM14 18h7v3h-7z',
  cube:'m12 3 9 5-9 5-9-5 9-5Zm-9 5v9l9 5 9-5V8m-9 5v9m-4.5-16.5 9 5',
  people:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m14-11a4 4 0 0 0 0-8m6 19v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z',
  shield:'m12 3 8 4v5c0 5-8 9-8 9s-8-4-8-9V7l8-4Zm-4 9 3 3 5-6',
  book:'M4 3h14a2 2 0 0 1 2 2v16H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3m-3 15a3 3 0 0 1 3-3h14M8 7h8m-8 4h6',
  plus:'M12 5v14M5 12h14', play:'m8 5 11 7-11 7V5Z', pause:'M8 5v14M16 5v14', check:'m5 12 4 4L19 6',
  arrow:'M4 12h16m-6-6 6 6-6 6', close:'m6 6 12 12M6 18 18 6', refresh:'M20 7v5h-5M4 17v-5h5m-4.5-4a8 8 0 0 1 13.2-3.2L20 8M4 16l2.3 3.2A8 8 0 0 0 19.5 16',
  search:'M10.5 18a7.5 7.5 0 1 1 0-15 7.5 7.5 0 0 1 0 15Zm5.5-2 5 5',
  target:'M21 12a9 9 0 1 1-4.5-7.8M17 12a5 5 0 1 1-5-5m0 5 9-9m-5 0h5v5',
  bot:'M6 8h12a3 3 0 0 1 3 3v7H3v-7a3 3 0 0 1 3-3Zm6 0V3m-3 9h.01M15 12h.01M8 21h8M1 12v3m22-3v3',
  person:'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0Zm-3 8h-2a7 7 0 0 0-7 7h16a7 7 0 0 0-7-7Z',
  file:'M14 2H5v20h14V7l-5-5Zm0 0v6h5M8 12h8m-8 4h6',
  clock:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-5v5l3 2',
  info:'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9-1v6m0-10h.01',
  history:'M3 3v6h6m-5-1a9 9 0 1 1-1 8m9-9v5l3 2',
  layers:'m12 3 10 5-10 5L2 8l10-5ZM2 12l10 5 10-5M2 16l10 5 10-5',
  download:'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  edit:'m15 4 5 5M3 21l5-1L21 7a2 2 0 0 0-4-4L4 16l-1 5Z',
  lock:'M5 10h14v11H5zm3 0V6a4 4 0 0 1 8 0v4m-4 5v2'
};
const icon = name => `<svg class="icon" aria-hidden="true" viewBox="0 0 24 24"><path d="${paths[name] || paths.cube}"/></svg>`;
const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const textOutput = value => typeof value === 'string' ? value : value ? JSON.stringify(value, null, 2) : '';
const states = {queued:'待执行',running:'运行中',waiting_approval:'待人工处理',completed:'已完成',failed:'执行失败',blocked:'已阻塞',paused:'已暂停',rejected:'已驳回'};
const stateNames = Object.keys(states);
const badge = status => `<span class="pill ${stateNames.includes(status) ? status : ''}">${escape(states[status] || status || '待执行')}</span>`;
const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? escape(value || '') : d.toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}); };
const navs = [ ['collaboration','people','组织协作台'], ['matrix','network','能力矩阵'], ['my-capabilities','person','我的能力'], ['knowledge','book','知识接入'], ['overview','dashboard','运行总览'], ['capabilities','cube','能力目录'], ['actors','people','员工与 Agent'], ['approvals','shield','人工待办'], ['memories','history','复盘记忆'], ['model-settings','bot','模型配置'] ];
let state = null, activeGoal = '', activeTask = '', busy = false, searchText = '', toastTimer = null;
let authState = null, selectedDocument = '', knowledgeScope = 'all';
const currentUser = () => state?.current_user || authState?.user || {};
const isAdmin = () => currentUser().role==='admin';
const app = document.getElementById('app');
const dialog = document.getElementById('dialog');
const route = () => navs.some(n=>n[0]===location.hash.slice(1) && (n[0]!=='model-settings'||isAdmin())) ? location.hash.slice(1) : 'collaboration';
const getGoal = () => state.goals.find(g=>g.id===activeGoal) || state.goals[0];
const getTasks = goal => state.tasks.filter(t=>t.goal_id===goal?.id);
const actor = id => state.actors.find(a=>a.id===id);
const capability = id => state.capabilities.find(c=>c.id===id);
const pending = () => state.tasks.filter(t=>t.status==='waiting_approval' && t.actor_id===currentUser().actor_id);
const button = (label, action, data='', kind='', iconName='') => `<button type="button" class="button ${kind}" data-action="${action}" ${data}${busy?' disabled':''}>${iconName?icon(iconName):''}${label}</button>`;
const empty = (title, description, image='layers', action='') => `<div class="empty">${icon(image)}<h3>${title}</h3><p>${description}</p>${action}</div>`;

function notify(message, error=false) {
  const el = document.getElementById('toast');
  el.textContent = message;
  el.className = `toast visible${error?' error':''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{el.className='toast';}, error?6500:3500);
}

async function api(path, data) {
  const response = await fetch(path, data ? {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)} : {});
  let result;
  try { result = await response.json(); } catch { throw new Error('服务没有返回有效数据，请检查本地服务是否运行。'); }
  if(response.status===401 && !path.startsWith('/api/auth/')) {stopCoordination();busy=false;state=null;authState={authenticated:false,setup_required:false};if(dialog.open)dialog.close();renderAuth();throw new Error('登录已失效，请重新登录。');}
  if(!response.ok || result.error) {const error=new Error(typeof result.error==='string'?result.error:`请求失败（${response.status}）`);error.status=response.status;error.code=result.code;throw error;}
  return result;
}

async function load() {
  try { authState=await api('/api/auth/state');if(!authState.authenticated){stopCoordination();state=null;renderAuth();return;}state = await api('/api/state'); normalize(); startCoordination(state); render(); }
  catch(error) { if(authState && !authState.authenticated){renderAuth();return;}app.innerHTML=`<div class="page-error"><h2>暂时无法连接组织工作台</h2><p>${escape(error.message)}</p>${button('重新连接','reload','','primary','refresh')}</div>`; }
}

function normalize() {
  for(const key of ['goals','tasks','actors','capabilities','events','memories','documents','assessments','skill_packages']) if(!Array.isArray(state[key])) state[key]=[];
  state.settings ||= {};
  if(!state.goals.some(g=>g.id===activeGoal)) activeGoal=state.goals[0]?.id || '';
  const tasks = getTasks(getGoal());
  if(!tasks.some(t=>t.id===activeTask)) activeTask=tasks.find(t=>t.status==='waiting_approval'||t.status==='failed'||t.status==='blocked')?.id || tasks.find(t=>t.status!=='completed')?.id || tasks[0]?.id || '';
}

async function act(payload, message, options={}) {
  if(busy) return;
  busy=true;
  const focused = document.activeElement;
  document.querySelectorAll('button').forEach(b=>b.disabled=true);
  const status = document.getElementById('connection-status');
  if(status) status.innerHTML='<span class="busy-indicator">正在处理…</span>';
  try {
    const oldGoals=state.goals.map(g=>g.id),oldDocs=state.documents.map(d=>d.id),oldAssessments=state.assessments.map(a=>a.id);
    state=await api('/api/action',payload);
    coordinationApplySnapshot(state);
    if(payload.type==='import_document') selectedDocument=state.documents.find(d=>!oldDocs.includes(d.id))?.id || selectedDocument;
    if(payload.type==='suggest_capabilities') {const count=state.assessments.filter(a=>!oldAssessments.includes(a.id)).length;message=count?`本地规则找到 ${count} 条候选能力，仍需人工核验。`:'未发现新的候选能力。你可以根据资料手动申报。';}
    if(payload.type==='create_goal') {activeGoal=state.goals.find(g=>!oldGoals.includes(g.id))?.id || activeGoal;activeTask='';}
    if(payload.type==='step') activeTask=state.tasks.find(t=>t.goal_id===payload.goal_id && t.status==='waiting_approval')?.id || state.tasks.filter(t=>t.goal_id===payload.goal_id && t.status==='completed').at(-1)?.id || activeTask;
    if(options.close) dialog.close();
    busy=false;normalize();render();notify(message);
    const focusAction=focused?.dataset?.action;
    if(focusAction) document.querySelector(`[data-action="${focusAction}"]`)?.focus({preventScroll:true});
    if(options.route) location.hash=options.route;
    return true;
  } catch(error) {
    busy=false;
    if(error.status===409||error.code==='version_conflict')requestCoordinationRefresh();
    document.querySelectorAll('button').forEach(b=>b.disabled=false);
    if(status) status.textContent='本地运行';
    const inline=dialog.open?dialog.querySelector('.form-error'):options.errorTarget;
    if(inline) {inline.textContent=error.message;inline.setAttribute('tabindex','-1');inline.focus();} else {notify(error.message,true);focused?.focus();}
    return false;
  }
}

function render() {
  const current=route(), currentNav=navs.find(n=>n[0]===current), currentName=currentNav[2];
  const groups=[['工作空间',['collaboration','overview','approvals','memories']],['组织能力',['matrix','capabilities','actors']],['个人资料',['my-capabilities','knowledge']],['管理',['model-settings']]];
  const directory=state.coordination?.actors||state.actors, members=directory.filter(a=>a.type==='human'&&a.user_id).length;
  const name=productName(currentUser().display_name||currentUser().username||'组织成员');
  const navigation=groups.map(([label,ids])=>{
    const items=ids.map(id=>navs.find(n=>n[0]===id)).filter(n=>n&&(n[0]!=='model-settings'||isAdmin()));
    if(!items.length)return '';
    return `<section class="nav-group"><h2 class="nav-group-title">${label}</h2><div class="nav-group-items">${items.map(([id,i,label])=>`<a href="#${id}" class="${current===id?'active':''}" ${current===id?'aria-current="page"':''} title="${label}" aria-label="${label}">${icon(i)}<span class="nav-label">${label}</span>${id==='approvals'&&pending().length?`<span class="count">${pending().length}</span>`:''}</a>`).join('')}</div></section>`;
  }).join('');
  app.innerHTML=`<div class="shell">
    <aside class="sidebar"><a class="workspace-brand" href="#collaboration" aria-label="小辣椒智能组织工作空间"><span class="brand-mark"><img src="/brand-mark.svg" alt="" width="32" height="32"></span><span class="brand-text"><strong>小辣椒</strong><small>智能组织</small></span></a><div class="workspace-directory">${icon('people')}<span>${members} 位可见成员</span><span class="workspace-access">${isAdmin()?'管理权限':'成员权限'}</span></div>
      <nav class="nav" aria-label="主导航">${navigation}</nav>
      </aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumb">${icon(currentNav[1])}<strong>${currentName}</strong><span class="workspace-separator"></span><span>组织工作空间</span></div><div class="topbar-right"><button type="button" class="button ghost small" data-guide-open="">${icon('book')}使用指南</button>${runtimeBadgeHtml()}<small id="connection-status">本地运行</small><div class="workspace-member" role="group" aria-label="当前登录账号"><span class="member-initial" aria-hidden="true">${escape(name.slice(0,1))}</span><span><strong title="${escape(name)}">${escape(name)}</strong><small>${isAdmin()?'组织管理员':'组织成员'}</small></span>${button('退出','logout','','ghost small')}</div></div></header>
      <main class="main" id="main" data-page="${current}">${({collaboration:collaborationPage,matrix:matrixPage,'my-capabilities':myCapabilitiesPage,knowledge:knowledgePage,overview:overview,capabilities:capabilitiesPage,actors:actorsPage,approvals:approvalsPage,memories:memoriesPage,'model-settings':modelSettingsPage}[current])()}<footer class="footnote">小辣椒 <span>智能组织</span><details class="product-usage-note"><summary>使用说明</summary><div class="product-usage-content"><p>允许下载安装、使用与二次开发；未经授权不得售卖原版或修改版。</p><p>相关使用规则由执棋会AI提供说明，详见随软件提供的许可证。</p></div></details></footer></main>
    </div></div>`;
  if(current==='actors'&&isAdmin())loadAccountList();
  if(current==='model-settings')mountModelSettings();
}

function heading(title, subtitle, action='') {return `<div class="page-heading"><div class="page-heading-copy"><h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div>${action}</div>${usageGuideEntryHtml()}`;}
function modeHint() { return runtimeHintHtml(); }
function overview() {
  const g=getGoal(),tasks=getTasks(g),selected=tasks.find(t=>t.id===activeTask)||tasks[0],completed=state.tasks.filter(t=>t.status==='completed').length,available=state.actors.filter(a=>a.available).length;
  const header=heading('运行总览','目标执行、任务交付与运行记录',button('新建目标','new-goal','','primary','plus'));
  const runtimeView=runtimePresentation(),runtimeNotice=['warning','error'].includes(runtimeView.kind)?modeHint():'';
  const summary=`<div class="run-page-summary" aria-label="组织运行统计"><span><b>${state.goals.filter(g=>g.status!=='completed').length}</b>进行中目标</span><span><b>${pending().length}</b>待人工处理</span><span><b>${completed}</b>已完成任务</span><span><b>${available}</b>可用执行者</span></div>`;
  if(!g)return header+runtimeNotice+summary+`<section class="workspace-start"><div class="workspace-start-heading">${icon('target')}<div><h2>建立第一个组织目标</h2><p>明确预期结果和验收标准，开始分派与执行。</p></div>${button('创建目标','new-goal','','primary','plus')}</div><div class="workspace-shortcuts"><a href="#actors">${icon('people')}<span><strong>成员与执行者</strong><small>${isAdmin()?'管理成员账号、能力与授权':'查看成员与 Agent 的能力'}</small></span>${icon('arrow')}</a><a href="#knowledge">${icon('book')}<span><strong>接入工作资料</strong><small>导入文档，保留知识和工作依据</small></span>${icon('arrow')}</a>${isAdmin()?`<a href="#model-settings">${icon('bot')}<span><strong>配置模型连接</strong><small>管理 Agent 使用的模型服务</small></span>${icon('arrow')}</a>`:`<a href="#my-capabilities">${icon('cube')}<span><strong>登记我的能力</strong><small>提交工作证据与能力说明</small></span>${icon('arrow')}</a>`}</div></section>`;
  const done=tasks.filter(t=>t.status==='completed').length,origin=productSourceLabel(g);
  const actions=g.can_manage===false?`<span class="readonly-note">由目标负责人管理执行</span>${pending().some(t=>t.goal_id===g.id)?button('处理我的待办','go-approvals','','primary','shield'):''}`:`${g.status==='paused'?button('恢复目标','resume',`data-id="${escape(g.id)}"`,'','play'):g.status!=='completed'?button('暂停','pause',`data-id="${escape(g.id)}"`,'','pause'):''}${g.status!=='completed'?button('调整预算','budget',`data-id="${escape(g.id)}"`,'ghost small'):''}${g.status==='waiting_approval'?(pending().some(t=>t.goal_id===g.id)?button('处理待办','go-approvals','','primary','shield'):'<span class="readonly-note">等待指定成员处理</span>'):g.status==='completed'?button('查看复盘','go-memories','','','book'):g.status!=='paused'?button('运行下一步','step',`data-id="${escape(g.id)}"`,'primary','play'):''}`;
  return header+summary+`<section class="run-project"><header class="run-project-header"><div class="run-project-select"><label for="goal-select">当前目标</label><select id="goal-select" aria-label="切换当前目标">${state.goals.map(goal=>`<option value="${escape(goal.id)}" ${goal.id===g.id?'selected':''}>${escape(productName(goal.title))}</option>`).join('')}</select></div><div class="goal-actions">${actions}</div></header><div class="run-project-brief"><div class="run-project-identity">${badge(g.status)}<span class="priority">${escape(g.priority||'P2')}</span><span>${done} / ${tasks.length} 项完成</span><span>已用 ${g.used||0} / ${g.budget} 次调用</span>${origin?`<span class="record-origin">${escape(origin)}</span>`:''}<time>${date(g.created_at)}</time></div>${g.brief?(g.is_example?`<details class="run-original-brief"><summary>查看原始目标说明</summary><p>${escape(g.brief)}</p></details>`:`<p>${escape(g.brief)}</p>`):''}</div>${runtimeNotice}<div class="run-workspace"><aside class="run-task-index" aria-label="目标任务索引"><div class="run-index-heading"><h2>任务</h2><span>${tasks.length}</span></div><div class="run-task-list">${tasks.map((t,i)=>`<button type="button" class="run-task-row ${escape(t.status)}${selected?.id===t.id?' selected':''}" data-action="select-task" data-id="${escape(t.id)}" aria-pressed="${selected?.id===t.id}"><span class="run-task-status" aria-hidden="true">${t.status==='completed'?icon('check'):t.status==='failed'?icon('close'):t.status==='running'?icon('play'):String(i+1).padStart(2,'0')}</span><span class="run-task-label"><strong>${escape(t.title)}</strong><span>${escape(productName(actor(t.actor_id)?.name||'待分派'))}<span class="run-task-state">${runTaskBadge(t,g)}</span></span></span></button>`).join('')}</div><p class="run-index-note">${g.workflow==='custom'?'按任务依赖顺序执行':'标准工作流程'}</p></aside><section class="run-task-document">${taskDetail(selected,g)}<section class="run-activity"><header><div>${icon('history')}<h3>运行记录</h3></div>${isAdmin()?`<a class="button ghost small" href="/api/export" download="organization-export.json" title="导出全部运行数据">${icon('download')}导出</a>`:''}</header>${timeline(g)}</section></section></div></section>`;
}

function runTaskBadge(t,g) {
  if(!g?.collaborative)return badge(t.status);
  const phase=coordinationPhase(t);
  return `<span class="pill ${escape(phase)}">${escape(coordinationPhases[phase]||phase)}</span>`;
}

function taskDetail(t,g) {
  if(!t)return `<div class="task-document-empty"><h2>暂无任务</h2><p>此目标尚未建立任务流程。</p></div>`;
  const cap=capability(t.capability_id),who=actor(t.actor_id),output=textOutput(t.output),source=t.output_mode==='human'?'人工提交':(t.output_mode||g.mode||state.settings.mode)==='model'?'模型生成 · 待核验':g.is_example?'历史验证产物':'规则生成 · 待核验';
  return `<header class="task-document-header"><div class="task-document-title"><span>${escape(cap?.name||t.capability_id)}</span><h2>${escape(t.title)}</h2></div>${runTaskBadge(t,g)}</header><dl class="task-property-list"><div><dt>执行者</dt><dd>${who?icon(who.type==='human'?'person':'bot'):icon('person')}${escape(productName(who?.name||'待分派'))}</dd></div><div><dt>风险等级</dt><dd>${{low:'低风险',medium:'中风险',high:'高风险'}[t.risk]||escape(t.risk||'低风险')}</dd></div><div><dt>执行次数</dt><dd>${t.attempts||0} 次</dd></div><div><dt>前置任务</dt><dd>${(t.depends_on||[]).map(id=>escape(state.tasks.find(x=>x.id===id)?.title||id)).join('、')||'无'}</dd></div></dl>${t.error?`<div class="task-action-notice error"><span>${icon('info')}${escape(t.error)}</span>${t.status==='failed'&&g.can_manage!==false?button('重试任务','retry',`data-id="${escape(t.id)}"`,'small','refresh'):''}</div>`:t.status==='failed'&&g.can_manage!==false?`<div class="task-action-notice">${button('重试任务','retry',`data-id="${escape(t.id)}"`,'small','refresh')}</div>`:''}${t.status==='waiting_approval'&&t.actor_id===currentUser().actor_id?`<div class="task-action-notice"><span>${icon(t.capability_id==='approve'?'shield':'file')}${t.capability_id==='approve'?'等待你审核前序交付并提交验收意见。':'此任务由你执行，请提交实际结果与证据。'}</span>${button('处理人工待办','go-approvals','','small primary')}</div>`:''}<section class="task-delivery"><div class="task-delivery-heading"><h3>交付内容</h3>${output?`<span class="pill">${source}</span>`:'<span class="task-delivery-state">尚未交付</span>'}</div>${output?`<pre class="task-delivery-content">${escape(output)}</pre>`:`<div class="task-delivery-empty">${icon('file')}<div><strong>等待任务产出</strong><p>${t.status==='failed'?'处理执行错误后，可重试此任务。':t.status==='waiting_approval'?'由指定成员处理待办后，交付内容将保存在这里。':'任务执行完成后，交付内容将保存在这里。'}</p></div></div>`}</section><details class="task-context"><summary>验收标准与执行依据</summary><dl><div><dt>目标验收标准</dt><dd>${escape(g.criteria||'未填写')}</dd></div><div><dt>执行者匹配依据</dt><dd>${escape(t.route_reason||'按任务能力、授权和成员可用状态匹配。')}</dd></div></dl></details>${(t.artifacts||[]).length>1?`<details class="artifact-history"><summary>历史产物 <span>${t.artifacts.length}</span></summary>${t.artifacts.slice().reverse().map(a=>`<div class="output-label"><span>第 ${a.attempt} 次提交</span><span>${date(a.created_at)}</span></div><pre class="output">${escape(textOutput(a.content))}</pre>`).join('')}</details>`:''}`;
}

function timeline(g) {
  const events=state.events.filter(e=>e.goal_id===g.id).slice().reverse();
  return events.length?`<ol class="run-event-list">${events.map(e=>`<li><span class="run-event-dot" aria-hidden="true"></span><div><p>${escape(e.message||e.type)}</p><time>${date(e.created_at)}</time></div></li>`).join('')}</ol>`:`<p class="run-no-activity">暂无运行记录。任务开始执行后将在此记录。</p>`;
}

function searchBox(placeholder) { return `<div class="search">${icon('search')}<input id="search-input" type="search" value="${escape(searchText)}" placeholder="${placeholder}" aria-label="${placeholder}"></div>`; }
function capabilitiesPage() {return heading('原子能力与 Skill','以能力说明、输入输出和执行步骤，描述人和 Agent 可提供的具体能力。',`<div class="heading-actions">${isAdmin()?button('手动定义','new-capability','','','plus'):''}${button('上传能力包','upload-skill','','primary','file')}</div>`)+`<div class="toolbar">${searchBox('搜索能力名称或描述')}<span class="toolbar-info">${state.capabilities.length} 项能力 · 支持 SKILL.md / JSON</span></div><div id="filter-results">${capabilityList()}</div>`;}
function capabilityList() {
  const list=state.capabilities.filter(c=>(c.name+' '+c.description).toLowerCase().includes(searchText.toLowerCase()));
  return list.length?`<div class="registry-list">${list.map(c=>{const providers=skillProvidersForCapability(c.id);return `<article class="capability-row"><div class="capability-icon">${icon('cube')}</div><div class="capability-content"><div class="capability-name"><h3>${escape(c.name)}</h3><small>${escape(c.id)}</small></div><p>${escape(c.description)}</p>${!c.details_restricted?`<div class="capability-contract"><div><span>输入</span>${escape(textOutput(c.inputs||c.input_schema))}</div><div><span>输出</span>${escape(textOutput(c.outputs||c.output_schema))}</div><div class="acceptance"><span>验收规则</span>${escape(textOutput(c.acceptance))}</div></div>`:'<p>此能力的详细说明仅本人及管理员可见。</p>'}<div class="capability-row-actions">${button('查看 Skill 说明','view-skill',`data-id="${escape(c.id)}"`,'small','book')}</div></div><div class="provider-area"><span>关联提供者 / ${providers.length}</span>${providers.map(a=>`<button type="button" class="provider-chip provider-link${!a.available?' unavailable':''}" data-action="view-skill" data-id="${escape(c.id)}" data-actor="${escape(a.id)}">${icon(a.type==='human'?'person':'bot')}${escape(productName(a.name))}${!(a.permissions||[]).includes(c.id)?'（未授权）':!a.available?'（停用）':''}</button>`).join('') || '<div class="provider-chip">尚未分配执行者</div>'}</div></article>`;}).join('')}</div>`:empty('没有匹配的能力','换个关键词搜索，或上传一份能力包。','search');
}
function actorsPage() {return heading('员工与 Agent','人的经验与 Agent 的能力说明，都可以被查看、核验和授权。',(isAdmin()?`<div class="heading-actions">${button('添加 Agent','new-actor','','','bot')}${button('创建员工账号','new-user','','primary','plus')}</div>`:''))+`<div class="notice">${icon('info')} 员工能力以资料证据和评审说明为依据；Agent 能力以 Skill 声明和实际测试为依据。登记能力、授予权限和接通工具是不同步骤。</div><div class="toolbar">${searchBox('搜索成员或角色')}<span class="toolbar-info">${state.actors.filter(a=>a.type==='human'&&a.user_id).length} 位员工 · ${state.actors.filter(a=>a.type==='agent').length} 个 Agent</span></div><div id="filter-results">${actorsList()}</div>`;}
function actorsList() {
  const list=state.actors.filter(a=>(a.type==='agent'||a.user_id)&&(a.name+' '+a.role).toLowerCase().includes(searchText.toLowerCase()));
  return list.length?`<div class="people-grid">${list.map(a=>`<article class="panel person"><div class="person-top"><div class="person-avatar ${a.type==='human'?'human':''}">${icon(a.type==='human'?'person':'bot')}</div><div><h3>${escape(productName(a.name))}</h3><p>${escape(a.role)}</p></div></div><div class="provider-status-line"><span class="pill">${a.type==='human'?'员工':'Agent'}</span>${a.type==='agent'?`<span class="pill">${state.settings.mode==='model'?'模型适配器':'规则运行（不调用模型）'}</span><small>能力声明未实测</small>`:`<small>${state.assessments.filter(x=>x.actor_id===a.id&&x.status==='verified').length} 项核验记录</small>`}</div><p class="person-label">能力与 Skill 介绍</p><div class="actor-skills">${(a.capability_ids||[]).map(id=>`<button type="button" class="actor-skill" data-action="view-skill" data-id="${escape(id)}" data-actor="${escape(a.id)}"><strong>${escape(capability(id)?.name || id)}${(a.permissions||[]).includes(id)?'<span class="skill-permitted">已授权</span>':''}</strong><span>${escape(capability(id)?.description || '暂无能力说明，点击查看详情。')}</span></button>`).join('') || '<p class="actor-skills-empty">还未登记能力，可提交工作证据或上传能力包。</p>'}</div>${(isAdmin()||a.id===currentUser().actor_id)?button('为此提供者上传 Skill','upload-skill',`data-actor="${escape(a.id)}"`,'small','file'):''}<div class="person-status"><span>${a.available?'可参与调度':'已暂停调度'}</span>${isAdmin()?button(a.available?'停用':'启用','toggle-actor',`data-id="${escape(a.id)}" data-available="${!a.available}"`,'small'):''}</div></article>`).join('')}</div>`:empty('没有匹配的成员','换个关键词搜索，或添加员工与 Agent。','people');
}

function approvalsPage() {
  const list=pending().filter(t=>!state.goals.find(g=>g.id===t.goal_id)?.collaborative&&!coordinationTask(t.id)?.collaborative);
  return `<div class="notice">组织协作任务需要先接取、开始工作，再更新进展、交付或验收。${button('前往组织协作台','go-collaboration','','small primary','people')}</div>`+heading('人工待办','以下保留历史流程的个人待办；共同任务请在组织协作台处理。',`<span class="pill ${list.length?'waiting_approval':''}">${list.length} 项待处理</span>`)+`<div class="notice">人工任务提交的是交付内容；独立验收节点确认的是前序结果。提交任务不代表独立验收，需要审核时请单独设置验收节点。这里不会发布、发送或执行外部操作。</div>`+(list.length?`<div class="approval-grid">${list.map(t=>{
    const g=state.goals.find(x=>x.id===t.goal_id), predecessors=state.tasks.filter(x=>x.goal_id===t.goal_id&&x.status==='completed'),isReview=t.capability_id==='approve';
    return `<article class="panel approval-card"><div class="approval-header"><span class="pill waiting_approval">${isReview?'人工验收关口':'人工任务交付'}</span><span class="priority">${escape(g?.priority || 'P2')}</span></div><h3>${escape(t.title)}</h3><p class="subtitle">所属目标：${escape(productName(g?.title || ''))}</p><p class="subtitle">指定处理人：${escape(productName(actor(t.actor_id)?.name || '待匹配'))}</p><dl class="info-grid"><div class="info-item wide"><dt>目标验收标准</dt><dd>${escape(g?.criteria || '未填写')}</dd></div></dl>${predecessors.filter(x=>g?.workflow==='custom'||x.capability_id==='draft'||x.capability_id==='review').map(x=>`<details ${x.capability_id==='review'?'open':''}><summary>${escape(x.title)} · ${states[x.status]}</summary><pre class="output">${escape(textOutput(x.output))}</pre></details>`).join('')}${!isReview?'<div class="notice">请提交实际完成的工作内容和证据。此操作登记任务交付，不等于独立验收通过。</div>':''}<form class="approval-form" data-form="approval" data-task="${escape(t.id)}"><div class="form-error" role="alert"></div><label for="feedback-${escape(t.id)}">${isReview?'验收意见':'交付内容与证据'} <span aria-hidden="true">*</span></label><textarea id="feedback-${escape(t.id)}" name="feedback" required minlength="2" maxlength="5000" placeholder="${isReview?'说明通过的依据，或需要修订的具体内容。':'填写实际完成的结果、来源证据和仍需处理的问题。'}"></textarea><div class="form-actions"><button class="button danger" type="submit" name="decision" value="reject">${isReview?'驳回并返工':'退回待处理'}</button><button class="button success" type="submit" name="decision" value="approve">${icon('check')}${isReview?'确认通过':'提交结果'}</button></div></form></article>`;
  }).join('')}</div>`:`<section class="panel">${empty('当前没有人工待办','任务匹配给你后，会在这里等待交付或验收。','shield',button('回到运行总览','go-overview','','','dashboard'))}</section>`);
}

function memoriesPage() {return heading('复盘记忆','查看复盘结论、执行记录与来源任务',`<a class="button" href="/api/export" download="organization-export.json">${icon('download')}导出数据</a>`)+`<div class="toolbar">${searchBox('搜索目标或复盘内容')}<span class="toolbar-info">${state.memories.length} 条运行复盘</span></div><div id="filter-results">${memoriesList()}</div>`;}
function memoriesList() {
  const list=state.memories.filter(m=>(m.title+' '+m.content).toLowerCase().includes(searchText.toLowerCase())).slice().reverse();
  return list.length?`<div class="memory-list">${list.map(m=>`<article class="panel memory-entry"><div class="memory-header"><h3>${escape(m.title)}</h3><span class="pill">${m.mode==='model'?'模型运行记录':'规则运行记录'}</span></div><div class="memory-meta"><span>${date(m.created_at)}</span><span>来源目标：${escape(productName(state.goals.find(g=>g.id===m.goal_id)?.title || m.goal_id))}</span></div><pre class="output">${escape(textOutput(m.content))}</pre><div class="memory-actions">${button('查看来源任务','open-goal',`data-id="${escape(m.goal_id)}"`,'small','history')}</div></article>`).join('')}</div>`:`<section class="panel">${empty('暂无复盘记录','目标完成复盘后，可在此查看结论和来源任务。','book',button('运行一个目标','go-overview','','','play'))}</section>`;
}

function showDialog(kind, id) {
  let title='', intro='', form='';
  if(kind==='goal') {
    title='创建组织目标';intro='创建共同的组织目标。目标名称、任务流程、分派和公开进展对全员可见；私人资料与交付正文仍按权限访问。';
    form=`<div class="form-field"><label for="goal-title">目标名称</label><input id="goal-title" name="title" required maxlength="160" placeholder="例如：制定下季度的客户增长方案"></div><div class="form-field"><label for="goal-brief">背景与输入资料</label><textarea id="goal-brief" name="brief" required maxlength="20000" placeholder="说明现状、约束、已有资料和目标受众。"></textarea><small>仅提供这次任务允许使用的资料。可用工具和资料范围由当前配置决定。</small></div><div class="form-field"><label for="goal-criteria">验收标准</label><textarea id="goal-criteria" name="criteria" required maxlength="10000" placeholder="例如：包含三条行动建议、每项负责人、时间安排、风险及验证方法。"></textarea></div><div class="form-two"><div class="form-field"><label for="goal-priority">优先级</label><select id="goal-priority" name="priority"><option value="P0">P0 · 紧急</option><option value="P1">P1 · 高</option><option value="P2" selected>P2 · 常规</option><option value="P3">P3 · 低</option></select></div><div class="form-field"><label for="goal-budget">Agent 调用预算</label><input id="goal-budget" name="budget" type="number" min="1" max="1000" value="12" required><small>完整一轮需要 4 次；为返工留出余量。</small></div></div><div class="notice">将创建：需求分析 → 方案起草 → 质量检查 → 人工验收 → 复盘。当前使用固定流程模板。</div>`;
    form+=`<details class="custom-workflow"><summary>自定义流程（可选）</summary><p>留空使用五步模板。填写 JSON 数组：每个节点包含 key、title、capability_id、depends_on 和 risk。depends_on 引用节点 key；高风险节点需要已授权的人类执行者。</p><p>可用能力 ID：${state.capabilities.map(c=>`<code>${escape(c.id)}</code>`).join('、')}。未设置人工验收的流程会在复盘中标记为未经人工验收。</p><label for="goal-steps">任务依赖配置</label><textarea id="goal-steps" name="steps" rows="9" spellcheck="false" placeholder='[{"key":"a","title":"澄清目标","capability_id":"analyze","depends_on":[],"risk":"low"},{"key":"b","title":"人工验收","capability_id":"approve","depends_on":["a"],"risk":"high"}]'></textarea></details>`;
  } else if(kind==='capability') {
    title='注册原子能力';intro='以清晰的输入、输出和验收规则，描述一项可复用能力。';
    form=[['name','能力名称','例如：分析用户访谈'],['description','能力描述','说明能力的用途和边界。'],['input_schema','输入要求','例如：带来源的访谈记录与分析目标。'],['output_schema','输出要求','例如：发现、证据引用、待验证假设。'],['acceptance','验收规则','例如：每项发现至少关联一条原始记录。']].map(([name,label,placeholder])=>`<div class="form-field"><label for="cap-${name}">${label}</label>${name==='name'?`<input id="cap-${name}" name="${name}" required maxlength="160" placeholder="${placeholder}">`:`<textarea id="cap-${name}" name="${name}" required maxlength="3000" placeholder="${placeholder}"></textarea>`}</div>`).join('');
  } else if(kind==='actor') {
    title='添加 Agent';intro='登记 Agent 的能力和执行授权。人类员工请通过“创建员工账号”加入，再提交工作证据核验能力。';
    form=`<div class="form-two"><div class="form-field"><label for="actor-name">名称</label><input id="actor-name" name="name" required maxlength="100" placeholder="例如：市场分析 Agent"></div><div class="form-field"><label for="actor-type">执行者类型</label><select id="actor-type" name="actor_type"><option value="agent">Agent</option></select></div></div><div class="form-field"><label for="actor-role">角色职责</label><input id="actor-role" name="role" required maxlength="300" placeholder="例如：分析目标与业务资料，提供可追溯结论"></div><fieldset><legend>具备的能力</legend><div class="checkbox-list">${state.capabilities.filter(c=>c.id!=='approve').map(c=>`<label><input type="checkbox" name="capability_ids" value="${escape(c.id)}">${escape(c.name)}</label>`).join('')}</div></fieldset><fieldset><legend>获准执行的能力</legend><div class="checkbox-list">${state.capabilities.filter(c=>c.id!=='approve').map(c=>`<label><input type="checkbox" name="permissions" value="${escape(c.id)}">${escape(c.name)}</label>`).join('')}</div></fieldset><p class="dialog-intro">同一能力需要同时勾选“具备”与“获准执行”，才会用于路由。Agent 使用工作空间的统一执行适配器。</p>`;
  } else if(kind==='budget') {
    const g=state.goals.find(g=>g.id===id);if(!g)return;
    title='调整调用预算';intro=`${g.title}。已使用 ${g.used || 0} 次调用，增加预算后可继续执行。`;
    form=`<input type="hidden" name="goal_id" value="${escape(id)}"><div class="form-field"><label for="budget-total">新的调用总上限</label><input id="budget-total" name="budget" type="number" min="${Math.max(1,g.used || 0)}" max="1000" value="${g.budget}" required><small>设置的是总上限，不是增加次数。现有消费计数会保留。</small></div>`;
  }
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div><div class="dialog-body"><p class="dialog-intro">${escape(intro)}</p><form data-form="${kind}"><div class="form-error" role="alert"></div>${form}<div class="form-actions"><button type="button" class="button" data-action="close-dialog">取消</button><button type="submit" class="button primary">${{goal:'创建目标',capability:'注册能力',actor:'添加执行者',budget:'保存预算'}[kind]}</button></div></form></div>`;
  dialog.showModal();
  dialog.querySelector('input:not([type="hidden"]),select,textarea')?.focus();
}

document.addEventListener('click', async event=>{
  const el=event.target.closest('[data-action]');if(!el || busy)return;
  const action=el.dataset.action,id=el.dataset.id;
  if(action==='reload')return load();
  if(action==='close-dialog')return dialog.close();
  if(action==='new-goal')return showDialog('goal');
  if(action==='new-capability')return showDialog('capability');
  if(action==='new-actor')return showDialog('actor');
  if(action==='budget')return showDialog('budget',id);
  if(action==='select-task'){activeTask=id;render();document.querySelector(`[data-action="select-task"][data-id="${id}"]`)?.focus({preventScroll:true});return;}
  if(action.startsWith('go-')){location.hash=action.slice(3);return;}
  if(action==='open-goal'){activeGoal=id;activeTask='';normalize();location.hash='overview';render();return;}
  if(action==='step')return act({type:'step',goal_id:id},'执行状态已更新');
  if(action==='pause'||action==='resume')return act({type:action,goal_id:id},action==='pause'?'目标已暂停':'目标已恢复');
  if(action==='retry')return act({type:'retry',task_id:id},'已请求重试，请查看任务状态');
  if(action==='toggle-actor')return act({type:'set_actor_available',actor_id:id,available:el.dataset.available==='true'},el.dataset.available==='true'?'执行者已启用':'执行者已停用');
});

document.addEventListener('change', event=>{
  if(event.target.id==='goal-select'){activeGoal=event.target.value;activeTask='';normalize();render();}
});
document.addEventListener('input', event=>{
  if(event.target.id==='search-input'){searchText=event.target.value;const filter=({capabilities:capabilityList,actors:actorsList,memories:memoriesList,matrix:matrixList,'my-capabilities':myCapabilitiesList,knowledge:knowledgeList}[route()]);if(filter)document.getElementById('filter-results').innerHTML=filter();}
});
document.addEventListener('submit', async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;event.preventDefault();if(busy)return;
  const data=new FormData(form),kind=form.dataset.form,get=name=>String(data.get(name)||'').trim();
  if(kind==='approval') {const decision=event.submitter?.value;if(!['approve','reject'].includes(decision))return;const isReview=state.tasks.find(t=>t.id===form.dataset.task)?.capability_id==='approve';return act({type:decision,task_id:form.dataset.task,feedback:get('feedback')},decision==='approve'?(isReview?'验收已通过，可继续执行下游任务':'交付结果已提交；如需独立验收，请继续验收节点'):(isReview?'已驳回，相关任务将重新执行':'已退回待处理，意见已记录'),{errorTarget:form.querySelector('.form-error')});}
  if(kind==='goal') {
    const payload={type:'create_goal',collaborative:true,title:get('title'),brief:get('brief'),criteria:get('criteria'),priority:get('priority'),budget:Number(get('budget'))};
    if(get('steps')) {
      try { payload.steps=JSON.parse(get('steps')); if(!Array.isArray(payload.steps))throw new Error('必须是数组'); }
      catch {const error=form.querySelector('.form-error');error.textContent='自定义流程不是有效的 JSON 数组，请检查双引号、逗号和方括号。输入内容已保留。';error.setAttribute('tabindex','-1');error.focus();return;}
    }
    return act(payload,'组织目标已创建，所有员工可见协作状态',{close:true,route:'collaboration'});
  }
  if(kind==='budget')return act({type:'set_budget',goal_id:get('goal_id'),budget:Number(get('budget'))},'调用预算已更新',{close:true});
  if(kind==='capability')return act({type:'add_capability',...Object.fromEntries(['name','description','input_schema','output_schema','acceptance'].map(key=>[key,get(key)]))},'能力已注册',{close:true});
  if(kind==='actor')return act({type:'add_actor',name:get('name'),role:get('role'),actor_type:get('actor_type'),capability_ids:data.getAll('capability_ids'),permissions:data.getAll('permissions')},'执行者已添加',{close:true});
});
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
window.addEventListener('hashchange',()=>{searchText='';if(state)render();});
