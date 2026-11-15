"use strict";

const coordinationSync={epoch:0,userId:null,data:null,revision:-1,lastSync:null,status:'connecting',timer:null,inflight:false,requestId:0,appliedId:0,pendingRender:false,needsRefresh:false};
const coordinationFilters={goal:'all',actor:'all',phase:'all'};
let coordinationView='tasks';
const coordinationPhases={unassigned:'待分派',queued:'待调度',assigned:'待接取',accepted:'已接取',in_progress:'工作中',running:'Agent 执行中',submitted:'待验收',completed:'已完成',blocked:'阻塞',failed:'失败',paused:'暂停',waiting_approval:'待人工处理'};
const coordinationPhase=t=>{const phase=t.phase||t.work_status||t.status||'unassigned';return phase==='queued'&&!t.actor_id?'unassigned':phase;};
const coordinationData=()=>coordinationSync.data||state?.coordination||{goals:[],tasks:[],actors:[],capabilities:[],revision:0};
const coordinationTask=id=>(coordinationData().tasks||[]).find(t=>t.id===id);
const coordinationGoal=id=>(coordinationData().goals||[]).find(g=>g.id===id);
const coordinationConnected=()=>coordinationSync.status==='connected'||coordinationSync.status==='updating';
const coordinationCan=(task,action)=>{
  const aliases={assign:['can_assign'],accept:['can_accept'],start:['can_start'],progress:['can_update_progress','can_update'],submit:['can_submit'],review:['can_review'],approval:['can_approve','can_decide']};
  return (aliases[action]||[]).some(key=>task[key]===true);
};
const coordinationApproval=t=>t.is_approval===true||t.capability_id==='approve';
function coordinationAssignmentCandidates(task) {
  if(Array.isArray(task.assignment_candidates))return task.assignment_candidates.map(candidate=>({...candidate,role:(coordinationData().actors||[]).find(a=>a.id===candidate.actor_id)?.role||'',blocking_reasons:Array.isArray(candidate.blocking_reasons)?candidate.blocking_reasons:[],metadata:true})).sort((a,b)=>Number(a.type!=='human')-Number(b.type!=='human'));
  return (coordinationData().actors||[]).filter(a=>a.type==='agent'||(a.type==='human'&&a.user_id)).map(a=>{
    const blocking_reasons=[];
    if(a.available===false)blocking_reasons.push({code:'unavailable',message:'当前成员已停用'});
    if(!(a.capability_ids||[]).includes(task.capability_id))blocking_reasons.push({code:'capability_missing',message:'尚未登记任务要求的能力'});
    if(!(a.permissions||[]).includes(task.capability_id))blocking_reasons.push({code:'permission_missing',message:'尚未获得该能力的执行授权'});
    return {actor_id:a.id,name:a.name,type:a.type,role:a.role,available:a.available,can_assign:coordinationCan(task,'assign'),ready_to_execute:null,blocking_reasons,metadata:false};
  }).sort((a,b)=>Number(a.type!=='human')-Number(b.type!=='human'));
}
function coordinationAssignmentState(task) {
  if(!task.actor_id||['completed','submitted'].includes(coordinationPhase(task)))return null;
  const candidate=coordinationAssignmentCandidates(task).find(a=>a.actor_id===task.actor_id);
  const reasons=Array.isArray(task.assignment_blocking_reasons)?task.assignment_blocking_reasons:candidate?.blocking_reasons||[];
  return {reasons,ready:task.assignment_ready_to_execute??candidate?.ready_to_execute,metadata:Array.isArray(task.assignment_blocking_reasons)||candidate?.metadata};
}
function coordinationAssignmentRequirements(task,compact=false) {
  const status=coordinationAssignmentState(task);if(!status||status.ready===true)return '';
  if(compact)return status.reasons.length?`<small class="coordination-assignment-warning">${escape(status.reasons[0].message)}${status.reasons.length>1?` ，另有 ${status.reasons.length-1} 项`:''}</small>`:'';
  return `<section class="coordination-assignment-requirements"><strong>${status.metadata?'执行前需补齐条件':'执行条件待确认'}</strong>${status.reasons.length?`<ul>${status.reasons.map(reason=>`<li>${escape(reason.message||reason.code)}</li>`).join('')}</ul>`:''}<p>${status.metadata?'分派仅确认负责人，不会自动授予执行权限。':'当前服务未提供完整的执行条件。名单包含全部员工和 Agent，提交后可能按现有规则被拒绝；请以服务端校验结果为准。'}</p></section>`;
}
function coordinationAssignmentRowAction(task) {
  if(!coordinationCan(task,'assign')){const goal=coordinationGoal(task.goal_id);if(!goal?.can_manage)return '';const reason=task.assignment_disabled_reason||(goal.collaborative===false?'此目标使用旧版流程，请进入运行总览管理执行。':'当前流程阶段不支持改派，可进入运行总览查看可用操作。');return `<span class="coordination-assignment-unavailable"><small>${escape(reason)}</small>${goal.collaborative===false?button('进入执行','open-goal',`data-id="${escape(task.goal_id)}"`,'small'):''}</span>`;}
  return `<span class="coordination-assign-action">${coordButton(task.actor_id?'重新分派':'分派任务','assign',task,!task.actor_id)}</span>`;
}
function coordinationAssignmentSummary(task) {
  return `<div class="coordination-public-summary assignment-task-context"><dl><div><dt>组织目标</dt><dd>${escape(productName(coordinationGoal(task.goal_id)?.title||task.goal_id))}</dd></div><div><dt>当前负责人</dt><dd>${escape(productName(task.actor_name||'尚未分派'))}</dd></div><div><dt>任务版本</dt><dd>v${task.version??0}</dd></div></dl></div>`;
}
function coordinationAssigneeBody(task) {
  return `${coordinationAssignmentSummary(task)}<div class="assignment-intro"><strong>任务要求能力: ${escape(task.capability_name||task.capability_id)}</strong><p>显示全部已建立账号的员工与已登记 Agent。指派责任与能力核验、执行授权分开管理。</p></div><input type="hidden" name="actor_id" value="${escape(task.actor_id||'')}"><div class="assignment-picker"><div class="assignment-directory"><div class="form-field"><label for="coord-assignee-search">搜索负责人</label><input id="coord-assignee-search" type="search" autocomplete="off" placeholder="搜索姓名、职责或类型"></div><div class="assignment-type-filter" role="group" aria-label="选择负责人">${[['all','全部'],['human','员工'],['agent','Agent']].map(([id,label])=>`<button type="button" data-action="coord-assignee-filter" data-filter="${id}" aria-pressed="${id==='all'}">${label}</button>`).join('')}</div><fieldset class="assignment-roster"><legend>选择负责人</legend><div id="coord-assignee-list"></div></fieldset></div><section class="assignment-selection" id="coord-assignee-details" aria-label="已选择"></section></div>${Array.isArray(task.assignment_candidates)?'':`<p class="assignment-compatibility">当前服务未提供完整的执行条件。名单包含全部员工和 Agent，提交后可能按现有规则被拒绝；请以服务端校验结果为准。</p>`}`;
}
function coordinationAssigneeRows(task,selected='',query='',type='all') {
  const candidates=coordinationAssignmentCandidates(task),term=query.trim().toLocaleLowerCase();
  const choices=candidates.filter(a=>(type==='all'||a.type===type)&&`${a.name||''} ${a.role||''} ${a.type==='human'?'员工':'Agent'}`.toLocaleLowerCase().includes(term));
  if(!choices.length)return '<p class="assignment-empty">没有匹配的成员。请更换关键词，或切换到“全部”。</p>';
  return choices.map(a=>`<label class="assignment-candidate ${a.actor_id===selected?'selected':''}"><input type="radio" name="assignment_candidate" value="${escape(a.actor_id)}" ${a.actor_id===selected?'checked':''} ${a.can_assign===false?'disabled':''}><span class="assignment-person"><strong>${escape(productName(a.name||a.actor_id))}</strong><small>${a.type==='human'?'员工':'Agent'} · ${a.available===false?'当前停用':'当前可用'}</small><span class="assignment-readiness ${a.metadata&&a.ready_to_execute?'ready':'pending'}">${a.metadata?(a.ready_to_execute?'执行条件已满足':'执行前需补齐条件'):'执行条件待确认'}</span></span></label>`).join('');
}
function coordinationAssigneeDetail(task,selected) {
  if(!selected)return '<h3>尚未选择负责人</h3><p>从左侧名单选择一位员工或 Agent。资格不足的成员也会列出，分派不会自动授予权限。</p>';
  const candidate=coordinationAssignmentCandidates(task).find(a=>a.actor_id===selected);
  if(!candidate)return '<h3>尚未选择负责人</h3><p>已选成员已不在当前名单中，请重新选择。</p>';
  const ready=candidate.metadata&&candidate.ready_to_execute;
  return `<span class="assignment-selection-label">已选择</span><h3>${escape(productName(candidate.name||candidate.actor_id))}</h3><p>${candidate.type==='human'?'员工':'Agent'} · ${candidate.available===false?'当前停用':'当前可用'}</p><strong class="assignment-readiness ${ready?'ready':'pending'}">${candidate.metadata?(ready?'执行条件已满足':'执行前需补齐条件'):'执行条件待确认'}</strong>${candidate.blocking_reasons.length?`<ul>${candidate.blocking_reasons.map(reason=>`<li>${escape(reason.message||reason.code)}</li>`).join('')}</ul>`:''}<p>${ready?'资格检查已通过。员工仍需亲自接取并开始工作；Agent 仍由负责人发起执行。':candidate.metadata?'可以先明确负责人，补齐所列条件后才能执行。分派不会授予权限，也不会自动切换为其他执行者。':'当前服务未提供完整的执行条件。名单包含全部员工和 Agent，提交后可能按现有规则被拒绝；请以服务端校验结果为准。'}</p>${candidate.can_assign===false?'<p class="inline-error">当前任务状态或权限不允许分派</p>':''}`;
}
function updateCoordinationAssignmentSubmit(form) {
  if(!form||form.dataset.kind!=='assign')return;
  const task=coordinationTask(form.dataset.task),selected=form.querySelector('[name="actor_id"]').value;
  const candidate=task&&coordinationAssignmentCandidates(task).find(a=>a.actor_id===selected);
  form.querySelectorAll('button[type="submit"]').forEach(button=>{
    button.dataset.assignmentBlocked=String(!candidate||candidate.can_assign===false);
    button.disabled=busy||!coordinationConnected()||button.dataset.versionBlocked==='true'||form.dataset.conflicted==='true'||button.dataset.assignmentBlocked==='true';
  });
}
function refreshCoordinationAssignees(form) {
  if(!form||form.dataset.kind!=='assign')return;
  const task=coordinationTask(form.dataset.task);if(!task)return;
  const focused=document.activeElement,restoreFocus=focused?.name==='assignment_candidate'?focused.value:null;
  form.dataset.assignmentFingerprint=JSON.stringify(coordinationAssignmentCandidates(task));
  const selected=form.querySelector('[name="actor_id"]').value,query=form.querySelector('#coord-assignee-search').value,type=form.dataset.assigneeFilter||'all';
  form.querySelector('#coord-assignee-list').innerHTML=coordinationAssigneeRows(task,selected,query,type);
  form.querySelector('#coord-assignee-details').innerHTML=coordinationAssigneeDetail(task,selected);
  form.querySelectorAll('[data-action="coord-assignee-filter"]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.filter===type)));
  updateCoordinationAssignmentSubmit(form);
  if(restoreFocus)[...form.querySelectorAll('[name="assignment_candidate"]')].find(input=>input.value===restoreFocus)?.focus({preventScroll:true});
}

let coordinationDialogSerial=0;

function stopCoordination() {
  resetWorkboard();coordinationView='tasks';
  coordinationSync.epoch++;clearTimeout(coordinationSync.timer);coordinationSync.timer=null;coordinationSync.inflight=false;coordinationSync.userId=null;coordinationSync.data=null;coordinationSync.revision=-1;coordinationSync.pendingRender=false;coordinationSync.needsRefresh=false;coordinationSync.status='disconnected';coordinationDialogSerial++;
}

function startCoordination(snapshot) {
  const userId=snapshot?.current_user?.id||currentUser().id;if(!userId)return;
  if(coordinationSync.userId!==userId){stopCoordination();coordinationSync.userId=userId;coordinationSync.status='connecting';coordinationSync.lastSync=null;coordinationFilters.goal='all';coordinationFilters.actor='all';coordinationFilters.phase='all';}
  coordinationApplySnapshot(snapshot);
  if(!coordinationSync.timer&&!coordinationSync.inflight)requestCoordinationRefresh();
}

function coordinationApplySnapshot(snapshot) {
  if(!snapshot?.coordination)return;
  const data=snapshot.coordination,revision=Number(data.revision??snapshot.revision??0);
  if(revision<coordinationSync.revision)return;
  coordinationSync.data=data;coordinationSync.revision=revision;coordinationSync.lastSync=new Date();coordinationSync.status='connected';
}

function coordinationExpire(epoch) {
  if(epoch!==coordinationSync.epoch)return;
  stopCoordination();state=null;authState={authenticated:false,setup_required:false};busy=false;if(dialog.open)dialog.close();renderAuth();notify('登录已失效，请重新登录。',true);
}

async function coordinationFetch(path,epoch) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try {const response=await fetch(path,{signal:controller.signal,credentials:'same-origin',cache:'no-store'});if(epoch!==coordinationSync.epoch)return null;if(response.status===401){coordinationExpire(epoch);return null;}const value=await response.json();if(!response.ok||value.error)throw new Error(typeof value.error==='string'?value.error:'同步暂时失败');return value;}
  finally {clearTimeout(timeout);}
}

async function refreshCoordinationPrivate(epoch=coordinationSync.epoch) {
  const userId=coordinationSync.userId,snapshot=await coordinationFetch('/api/state',epoch);
  if(!snapshot||epoch!==coordinationSync.epoch||snapshot.current_user?.id!==userId||busy)return false;
  const revision=Number(snapshot.revision??snapshot.coordination?.revision??0);
  if(revision<Number(state?.revision??0)||revision<coordinationSync.revision)return false;
  state=snapshot;normalize();coordinationApplySnapshot(snapshot);return true;
}

async function requestCoordinationRefresh() {
  if(!state||!authState?.authenticated||!coordinationSync.userId)return;
  clearTimeout(coordinationSync.timer);coordinationSync.timer=null;
  if(coordinationSync.inflight){coordinationSync.needsRefresh=true;return;}
  if(busy){coordinationSync.timer=setTimeout(requestCoordinationRefresh,400);return;}
  const epoch=coordinationSync.epoch,requestId=++coordinationSync.requestId,userId=coordinationSync.userId;
  coordinationSync.inflight=true;
  if(coordinationSync.status==='connected')coordinationSync.status='updating';updateCoordinationChrome();
  try {
    const data=await coordinationFetch('/api/coordination',epoch);
    if(!data||epoch!==coordinationSync.epoch||userId!==coordinationSync.userId||requestId<coordinationSync.appliedId)return;
    if(data.current_user?.id&&data.current_user.id!==userId){coordinationExpire(epoch);return;}
    const revision=Number(data.revision||0),changed=revision>coordinationSync.revision,wasOffline=coordinationSync.status==='disconnected';
    const runtimeReadinessChanged=revision>=coordinationSync.revision&&data.runtime?.available!==coordinationData().runtime?.available;
    if(data.runtime)modelSettingsApplyRuntime(data.runtime);
    coordinationSync.appliedId=requestId;
    if(revision>=coordinationSync.revision){coordinationSync.data=data;coordinationSync.revision=revision;}
    coordinationSync.status='connected';coordinationSync.lastSync=new Date();
    if(changed||Number(state?.revision??-1)<revision)await refreshCoordinationPrivate(epoch);
    if(epoch!==coordinationSync.epoch)return;
    if(changed){coordinationSync.pendingRender=true;patchCoordinationLive();refreshWorkboard();markCoordinationDialogUpdates();checkWorkboardDraftVersion();}
    else if(runtimeReadinessChanged){coordinationSync.pendingRender=true;patchCoordinationLive();refreshCoordinationAssignees(dialog.querySelector('form[data-form="coordination"]'));}
    if(wasOffline)notify('已恢复连接，组织进度已同步。');
    updateCoordinationChrome();
  } catch(error) {
    if(epoch!==coordinationSync.epoch)return;
    const first=coordinationSync.status!=='disconnected';coordinationSync.status='disconnected';updateCoordinationChrome();
    if(first)notify('连接暂时中断，保留上次数据并自动重连；提交操作已暂停。',true);
  } finally {
    if(epoch===coordinationSync.epoch){coordinationSync.inflight=false;const retry=coordinationSync.needsRefresh;coordinationSync.needsRefresh=false;coordinationSync.timer=setTimeout(requestCoordinationRefresh,retry?150:2000);}
  }
}

function coordinationStatusHtml() {
  const status=coordinationSync.status,label=({connecting:'连接中',connected:'已连接',updating:'更新中',disconnected:'连接中断'})[status],last=coordinationSync.lastSync?coordinationSync.lastSync.toLocaleTimeString('zh-CN',{hour12:false}):'尚未同步';
  return `<span class="sync-state ${status}"><i></i>${status==='connected'?'已同步':label}</span><details class="sync-details"><summary aria-label="查看同步详情">${icon('info')}</summary><div><span>最后同步 ${last}</span><span>组织状态 v${Math.max(0,coordinationSync.revision)}</span><span>约每 2 秒自动同步</span></div></details>${status==='disconnected'?'<strong class="sync-stale">显示上次数据，正在重连</strong>':''}`;
}

function updateCoordinationChrome() {
  const overview=document.getElementById('coordination-overview');if(overview)overview.innerHTML=coordinationOverviewHtml();
  const status=document.getElementById('coordination-sync-content');if(status){const opened=status.querySelector('details')?.open,focused=status.contains(document.activeElement);status.innerHTML=coordinationStatusHtml();if(opened)status.querySelector('details').open=true;if(focused)status.querySelector('summary')?.focus({preventScroll:true});}
  const notice=document.getElementById('coordination-update-notice');if(notice){notice.hidden=!coordinationSync.pendingRender;notice.querySelector('span').textContent='组织进度已有更新。当前操作位置保持不变，点击应用最新状态。';}
  document.querySelectorAll('[data-coordination-write]').forEach(button=>{button.disabled=busy||!coordinationConnected()||button.dataset.versionBlocked==='true'||button.dataset.assignmentBlocked==='true';});
}

function patchCoordinationLive(force=false) {
  if(route()!=='collaboration')return;
  const live=document.getElementById('coordination-live');if(!live)return;
  const active=document.activeElement,inside=live.contains(active),editing=inside&&(active.matches('input,textarea,select,[contenteditable="true"]')||active.closest('.task-action-menu[open],.activity-original[open]'));
  if(!force&&(dialog.open||editing)){coordinationSync.pendingRender=true;updateCoordinationChrome();return;}
  const focus=inside&&active.dataset?.action?{action:active.dataset.action,id:active.dataset.id,kind:active.dataset.kind}:null;
  const scroll=document.getElementById('coordination-table-scroll'),x=scroll?.scrollLeft||0,y=scroll?.scrollTop||0;
  live.innerHTML=coordinationLiveHtml();const next=document.getElementById('coordination-table-scroll');if(next){next.scrollLeft=x;next.scrollTop=y;}
  if(focus){const buttons=Array.from(live.querySelectorAll('button[data-action]'));const exact=buttons.find(b=>b.dataset.action===focus.action&&b.dataset.id===focus.id&&b.dataset.kind===focus.kind),fallback=buttons.find(b=>b.dataset.id===focus.id);(exact||fallback)?.focus({preventScroll:true});}
  coordinationSync.pendingRender=false;updateCoordinationFilters();updateCoordinationChrome();refreshWorkboard();
}

function updateCoordinationFilters() {
  const data=coordinationData(),options={goal:[['all','全部组织目标'],...(data.goals||[]).map(g=>[g.id,g.title])],actor:[['all','全部负责人'],['unassigned','尚未分派'],...(data.actors||[]).map(a=>[a.id,a.name])]};
  for(const name of ['goal','actor']){const select=document.getElementById('coordination-filter-'+name);if(!select||select===document.activeElement)continue;if(!options[name].some(([id])=>id===coordinationFilters[name]))coordinationFilters[name]='all';select.innerHTML=options[name].map(([id,label])=>`<option value="${escape(id)}" ${coordinationFilters[name]===id?'selected':''}>${escape(productName(label))}</option>`).join('');}
}

function coordinationOverviewHtml() {
  const tasks=coordinationData().tasks||[],working=tasks.filter(t=>['in_progress','running'].includes(coordinationPhase(t))).length,complete=tasks.filter(t=>coordinationPhase(t)==='completed').length;
  return `<span><i class="overview-working-dot"></i><strong>${working}</strong> 项进行中</span><span><strong>${complete}</strong> 项已完成</span>`;
}

function setCoordinationView(view) {
  if(!['tasks','results','activity'].includes(view))return;
  const workspace=document.getElementById('coordination-workspace');if(!workspace)return;
  if(view!=='results')workspace.querySelectorAll('video,audio').forEach(media=>media.pause());
  coordinationView=view;workspace.dataset.view=view;
  workspace.querySelectorAll('[data-action="coord-view"]').forEach(button=>{const active=button.dataset.view===view;button.classList.toggle('active',active);button.setAttribute('aria-pressed',String(active));});
  if(view==='results'){refreshWorkboard();revealWorkboardSelection();}
}

function collaborationPage() {
  const data=coordinationData();
  return heading('组织协作台','共享目标、任务与交付进展',button('新建目标','new-goal','','primary','plus'))+`<div id="coordination-workspace" class="coordination-workspace" data-view="${coordinationView}">

    <div id="coordination-update-notice" class="coordination-update-notice" ${coordinationSync.pendingRender?'':'hidden'}><span>组织进度已有更新。当前操作位置保持不变，点击应用最新状态。</span>${button('应用最新状态','coord-apply','','small')}</div>
    <div class="coordination-view-bar"><div class="coord-view-tabs" role="group" aria-label="协作视图">${[['tasks','layers','任务看板'],['results','file','成果与交接'],['activity','history','协作记录']].map(([id,i,name])=>`<button type="button" data-action="coord-view" data-view="${id}" class="${coordinationView===id?'active':''}" aria-pressed="${coordinationView===id}">${icon(i)}${name}</button>`).join('')}</div><div class="coordination-view-tools"><div class="coordination-overview" id="coordination-overview">${coordinationOverviewHtml()}</div><div class="coordination-sync"><div id="coordination-sync-content">${coordinationStatusHtml()}</div>${button('刷新','coord-refresh','','ghost small','refresh')}</div></div></div>
    <section class="coordination-filters" aria-label="筛选协作任务"><div><label for="coordination-filter-goal">组织目标</label><select id="coordination-filter-goal" data-coord-filter="goal"><option value="all">全部组织目标</option>${(data.goals||[]).map(g=>`<option value="${escape(g.id)}" ${coordinationFilters.goal===g.id?'selected':''}>${escape(productName(g.title))}</option>`).join('')}</select></div><div><label for="coordination-filter-actor">负责人</label><select id="coordination-filter-actor" data-coord-filter="actor"><option value="all">全部负责人</option><option value="unassigned" ${coordinationFilters.actor==='unassigned'?'selected':''}>尚未分派</option>${(data.actors||[]).map(a=>`<option value="${escape(a.id)}" ${coordinationFilters.actor===a.id?'selected':''}>${escape(productName(a.name))}</option>`).join('')}</select></div><div><label for="coordination-filter-phase">协作状态</label><select id="coordination-filter-phase" data-coord-filter="phase"><option value="all">全部状态</option>${Object.entries(coordinationPhases).map(([id,name])=>`<option value="${id}" ${coordinationFilters.phase===id?'selected':''}>${name}</option>`).join('')}</select></div>${button('清除筛选','coord-clear','','ghost small')}</section>
    ${workboardShellHtml()}<div id="coordination-live">${coordinationLiveHtml()}</div></div>`;
}

function coordinationLiveHtml() {
  const data=coordinationData(),goals=data.goals||[],allTasks=data.tasks||[],tasks=allTasks.filter(t=>(coordinationFilters.goal==='all'||t.goal_id===coordinationFilters.goal)&&(coordinationFilters.actor==='all'||(coordinationFilters.actor==='unassigned'?!t.actor_id:t.actor_id===coordinationFilters.actor))&&(coordinationFilters.phase==='all'||coordinationPhase(t)===coordinationFilters.phase));
  const history=allTasks.flatMap(t=>(t.history||[]).map(h=>({...h,task_title:t.title,goal_id:t.goal_id}))).filter(h=>coordinationFilters.goal==='all'||h.goal_id===coordinationFilters.goal).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,12);
  return `<section class="coordination-goals" aria-label="共同目标">${goals.length?goals.map(g=>{const gt=allTasks.filter(t=>t.goal_id===g.id),done=gt.filter(t=>coordinationPhase(t)==='completed').length,percent=gt.length?Math.round(gt.reduce((sum,t)=>sum+(coordinationPhase(t)==='completed'?100:Math.min(99,Number(t.progress)||0)),0)/gt.length):0;return `<button type="button" data-action="coord-select-goal" data-id="${escape(g.id)}" class="coordination-goal ${coordinationFilters.goal===g.id?'selected':''}"><div><strong>${escape(productName(g.title))}</strong>${badge(g.status)}</div><p>${escape(productName(g.owner_name||'未指定'))}<span>${done} / ${gt.length} 项完成</span>${productSourceLabel(g)?`<span class="record-origin">${escape(productSourceLabel(g))}</span>`:''}</p><div class="coordination-progress-line"><progress value="${percent}" max="100" aria-label="${escape(productName(g.title))}完成进度">${percent}%</progress><b>${percent}%</b></div></button>`;}).join(''):`<div class="panel">${empty('一起建立第一个组织目标','任何员工都可以提出目标，目标负责人可以分派能力匹配的员工与 Agent。','target')}</div>`}</section><section class="panel coordination-task-panel"><div class="panel-header"><div><h2>任务</h2><p>负责人、状态与当前进展</p></div><span class="pill">${tasks.length} 项任务</span></div>${coordinationStatusStrip(allTasks)}${tasks.length?`<div class="coordination-table-scroll" id="coordination-table-scroll"><table class="coordination-table"><thead><tr><th>任务 / 所属目标</th><th>负责人</th><th>协作状态</th><th>进度</th><th>公开进展</th><th>更新时间</th><th>操作</th></tr></thead><tbody>${tasks.map(coordinationTaskRow).join('')}</tbody></table></div>`:empty('没有匹配的协作任务','调整目标、负责人或状态筛选。','layers')}</section><section class="panel coordination-history"><div class="panel-header"><div><h2>协作记录</h2><p>任务流转与公开更新</p></div></div>${history.length?`<ol>${history.map(h=>`<li><time>${date(h.created_at)}</time><div><strong>${escape(productName(h.actor_name||'系统'))}</strong><span>${escape(productActivityLabel(h.type))}</span><details class="activity-original"><summary>查看原始记录</summary><p>${escape(h.message||h.type)}</p></details><small>${escape(h.task_title)}</small></div></li>`).join('')}</ol>`:empty('等待第一次协作','分派、接取、工作进度与验收会在这里留下共同记录。','history')}</section>`;
}

function coordButton(label,kind,task,primary=false) {return `<button type="button" class="button small ${primary?'primary':''}" data-action="coord-task" data-kind="${kind}" data-id="${escape(task.id)}" ${kind==='detail'?'':'data-coordination-write'} ${kind!=='detail'&&(!coordinationConnected()||busy)?'disabled':''}>${label}</button>`;}
function coordinationTaskRow(task) {
  const phase=coordinationPhase(task),percent=phase==='completed'?100:Math.min(99,Math.max(0,Number(task.progress)||0)),goal=coordinationGoal(task.goal_id),actions=[];
  if(coordinationCan(task,'accept'))actions.push(coordButton('接取任务','accept',task,true));
  if(coordinationCan(task,'start'))actions.push(coordButton('开始工作','start',task,true));
  if(coordinationCan(task,'progress'))actions.push(coordButton('更新进展','progress',task));
  if(coordinationCan(task,'submit')&&!coordinationApproval(task))actions.push(coordButton('提交交付','submit',task,true));
  if(coordinationCan(task,'approval'))actions.push(coordButton('独立验收','approval',task,true));
  if(coordinationCan(task,'review')&&!coordinationApproval(task))actions.push(coordButton('验收交付','review',task,true));
  if(task.actor_type==='agent'&&goal?.can_manage&&['assigned','queued'].includes(phase))actions.push(button('进入执行','open-goal',`data-id="${escape(task.goal_id)}"`,'small'));
  if(task.can_publish)actions.push(button('发布成果','workboard-publish',`data-id="${escape(task.id)}"`,'small','plus'));
  if(task.can_handoff&&workboardUpdates(task.id).length)actions.push(button('交接成果','workboard-handoff',`data-id="${escape(task.id)}"`,'small','arrow'));
  actions.push(button('成果详情','workboard-detail',`data-id="${escape(task.id)}"`,'small','history'));
  return `<tr><td><button type="button" class="task-title-link" data-action="workboard-detail" data-id="${escape(task.id)}">${escape(task.title)}</button><small>${escape(productName(goal?.title||task.goal_id))}</small><span class="coordination-capability">${escape(task.capability_name||task.capability_id)}</span></td><td>${task.actor_id?`<span class="coordination-assignee">${icon(task.actor_type==='agent'?'bot':'person')}${escape(productName(task.actor_name||task.actor_id))}</span>${coordinationAssignmentRequirements(task,true)}`:'<span class="coordination-muted">尚未分派</span>'}</td><td><span class="coordination-phase ${escape(phase)}">${task.dependencies_ready===false&&['queued','assigned','blocked'].includes(phase)?'等待前置任务':task.actor_type==='agent'&&phase==='assigned'?'待 Agent 执行':escape(coordinationPhases[phase]||phase)}</span>${task.dependencies_ready===false?`<small>${escape(task.blocked_reason||'前置任务尚未完成')}</small>`:''}${coordinationApproval(task)?'<small>独立验收节点</small>':''}</td><td><div class="coordination-task-progress"><progress value="${percent}" max="100" aria-label="${escape(task.title)}进度">${percent}%</progress><span>${percent}%</span></div></td><td><p class="coordination-public-note">${escape(productProgress(task.public_note||task.progress_note||'尚未更新公开进展',goal))}</p></td><td><time>${date(task.updated_at)}</time><small>任务 v${task.version??0}</small></td><td><div class="coordination-row-actions">${coordinationAssignmentRowAction(task)}${actions.length>2?actions[0]+`<details class="task-action-menu"><summary aria-label="${escape(task.title)}的更多操作">更多${icon('arrow')}</summary><div>${actions.slice(1).join('')}</div></details>`:actions.join('')}</div></td></tr>`;
}

function markCoordinationDialogUpdates() {
  const form=dialog.querySelector('form[data-form="coordination"]');if(!form)return;
  const task=coordinationTask(form.dataset.task),notice=dialog.querySelector('.coordination-dialog-update');if(!task||!notice)return;
  if(form.dataset.kind==='assign'&&form.dataset.assignmentFingerprint!==JSON.stringify(coordinationAssignmentCandidates(task)))refreshCoordinationAssignees(form);
  const changed=Number(task.version)!==Number(form.dataset.version);
    if(changed){form.dataset.conflicted='true';notice.hidden=false;notice.querySelector('button').hidden=false;notice.querySelector('span').textContent='此任务已被其他协作者更新。你的输入已保留，请先读取新版本并确认。';form.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=true;b.dataset.versionBlocked='true';});}
    else if(!form.dataset.conflicted){notice.hidden=false;notice.querySelector('button').hidden=true;notice.querySelector('span').textContent='组织其他任务已有更新，当前任务版本未变化。你的输入已保留，可继续填写。';}
}

function coordinationPublicDetail(task) {
  const goal=coordinationGoal(task.goal_id);
  return `<div class="coordination-public-summary"><dl class="coordination-detail-meta"><div><dt>组织目标</dt><dd>${escape(coordinationGoal(task.goal_id)?.title||task.goal_id)}</dd></div><div><dt>分派给谁</dt><dd>${escape(productName(task.actor_name||'尚未分派'))}</dd></div><div><dt>协作状态</dt><dd>${escape(coordinationPhases[coordinationPhase(task)]||coordinationPhase(task))}</dd></div><div><dt>当前已同步的版本与进度</dt><dd>v${task.version??0} · ${Math.min(100,Math.max(0,Number(task.progress)||0))}%</dd></div></dl>${coordinationAssignmentRequirements(task)}<div class="coordination-public-content"><strong>公开进展（全员可见）</strong><p>${escape(productProgress(task.public_note||task.progress_note||'尚未更新公开进展',goal))}</p></div></div>`;
}

function coordinationStatusStrip(allTasks) {
  const scope=allTasks.filter(t=>(coordinationFilters.goal==='all'||t.goal_id===coordinationFilters.goal)&&(coordinationFilters.actor==='all'||(coordinationFilters.actor==='unassigned'?!t.actor_id:t.actor_id===coordinationFilters.actor)));
  const counts={};for(const task of scope){const phase=coordinationPhase(task);counts[phase]=(counts[phase]||0)+1;}
  const phases=['unassigned','assigned','accepted','in_progress','submitted','completed',...['blocked','failed'].filter(phase=>counts[phase])];
  return `<div class="coordination-status-strip" role="group" aria-label="按协作状态筛选"><button type="button" data-action="coord-select-phase" data-id="all" aria-pressed="${coordinationFilters.phase==='all'}" class="${coordinationFilters.phase==='all'?'active':''}"><span>全部</span><b>${scope.length}</b></button>${phases.map(phase=>`<button type="button" data-action="coord-select-phase" data-id="${phase}" aria-pressed="${coordinationFilters.phase===phase}" class="${coordinationFilters.phase===phase?'active':''}"><span>${coordinationPhases[phase]}</span><b>${counts[phase]||0}</b></button>`).join('')}</div>`;
}

async function openCoordinationDialog(kind,taskId) {
  let task=coordinationTask(taskId);if(!task)return;
  const serial=++coordinationDialogSerial;
  if(['review','approval','submit'].includes(kind)){try{await refreshCoordinationPrivate();}catch{notify('无法读取当前账号可见的任务内容，请恢复连接后重试。',true);return;}if(serial!==coordinationDialogSerial||!state)return;task=coordinationTask(taskId);}
  if(!task)return;
  if(kind!=='detail'&&!coordinationCan(task,kind)){notify('当前任务状态或权限已变化，请刷新后选择可用操作。',true);requestCoordinationRefresh();return;}
  const privateTask=state.tasks.find(t=>t.id===task.id),privateGoal=state.goals.find(g=>g.id===task.goal_id),submission=privateTask?.submission?.output;
  let title=({detail:'共同任务详情',assign:'分派协作任务',progress:'更新公开进展',submit:'提交任务交付',review:'验收任务交付',approval:'独立验收决定'})[kind],body='',submitLabel='保存';
  if(kind==='detail'){body=`<div class="notice">这是全员可见的协作摘要，不展示私人资料、输入正文或交付内容。</div>${coordinationPublicDetail(task)}<h3 class="coordination-detail-heading">公开过程记录</h3><div class="timeline">${(task.history||[]).slice().reverse().map(h=>`<div class="timeline-item"><p>${escape(productName(h.actor_name||'系统'))}：${escape(h.message||h.type)}</p><time>${date(h.created_at)}</time></div>`).join('')||'<p class="skill-muted">尚无过程记录。</p>'}</div>`;}
  if(kind==='assign'){body=coordinationAssigneeBody(task);submitLabel='确认分派';}
  if(kind==='progress'){body=`${coordinationPublicDetail(task)}<div class="form-field"><label for="coord-progress">当前进度（0–99%）</label><input id="coord-progress" name="progress" type="number" min="0" max="99" step="1" required value="${Math.min(99,Number(task.progress)||0)}"><small>完成验收后才记为 100%。</small></div><div class="form-field"><label for="coord-note">公开进展（对全员可见）</label><textarea id="coord-note" name="note" maxlength="2000" required rows="5" placeholder="说明已完成的工作、下一步或需要协助的问题。不要在公开进展中粘贴私人资料。">${escape(task.public_note||task.progress_note||'')}</textarea></div>`;submitLabel='更新组织进度';}
  if(kind==='submit'){body=`${coordinationPublicDetail(task)}<div class="form-field"><label for="coord-output">交付内容与证据</label><textarea id="coord-output" name="output" required maxlength="100000" rows="12" placeholder="提交实际完成的结果、来源依据和仍需确认的事项。">${escape(submission||'')}</textarea><small>正文按权限向本人、目标负责人及管理员提供，不会写进公共协作摘要。</small></div><div class="notice">提交后进入“待验收”，需要目标负责人或管理员独立确认。提交不是自行验收。</div>`;submitLabel='提交并等待验收';}
  if(kind==='review') {
    body=`${coordinationPublicDetail(task)}<div class="notice">下面是当前账号获准查看的交付内容。只有目标负责人或管理员可以独立验收，提交人不能验收自己。</div><div class="form-field"><label>交付正文</label><pre class="output">${escape(submission||'当前账号尚未获取这份交付正文，请刷新后重试。')}</pre></div><div class="form-field"><label for="coord-review-decision">验收决定</label><select id="coord-review-decision" name="approved"><option value="true">通过，标记完成</option><option value="false">退回，继续工作</option></select></div><div class="form-field"><label for="coord-feedback">验收意见</label><textarea id="coord-feedback" name="feedback" rows="5" required maxlength="5000" placeholder="填写通过的依据，或需要补充的具体事项。"></textarea></div>`;submitLabel='提交验收决定';
  }
  if(kind==='approval'){
    const previous=state.tasks.filter(t=>t.goal_id===task.goal_id&&(privateTask?.depends_on||[]).includes(t.id));
    body=`${coordinationPublicDetail(task)}<div class="form-field"><label>目标验收标准</label><p class="skill-muted">${escape(privateGoal?.criteria||'请依据获准查看的目标标准验收。')}</p></div>${previous.map(t=>`<details open><summary>${escape(t.title)}</summary><pre class="output">${escape(t.submission?.output||textOutput(t.output)||'此交付正文不在当前账号的可见范围。')}</pre></details>`).join('')}<div class="form-field"><label for="coord-approval-decision">独立验收决定</label><select id="coord-approval-decision" name="decision"><option value="approve">通过</option><option value="reject">退回返工</option></select></div><div class="form-field"><label for="coord-approval-feedback">验收意见</label><textarea id="coord-approval-feedback" name="feedback" rows="5" required maxlength="5000"></textarea></div>`;submitLabel='提交独立验收';
  }
  dialog.classList.add('coordination-dialog');dialog.classList.toggle('coordination-assignment-dialog',kind==='assign');
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p class="dialog-subtitle">${escape(task.title)}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div><div class="dialog-body">${kind==='detail'?body:`<form data-form="coordination" data-kind="${kind}" data-task="${escape(task.id)}" data-version="${task.version}">${kind==='assign'?'<div class="assignment-form-content">':''}<div class="form-error" role="alert"></div><div class="coordination-dialog-update" hidden><span></span><button class="button small" type="button" data-action="coord-rebase">读取新版本，保留输入</button></div>${body}${kind==='assign'?'</div>':''}<div class="form-actions"><button class="button" type="button" data-action="close-dialog">取消</button><button type="submit" class="button primary" data-coordination-write ${kind==='review'&&(!submission||Number(privateTask?.version)!==Number(task.version))?'data-version-blocked="true" disabled':!coordinationConnected()?'disabled':''}>${submitLabel}</button></div></form>`}</div>`;
  if(kind==='assign')refreshCoordinationAssignees(dialog.querySelector('form'));
  if(!dialog.open)dialog.showModal();dialog.querySelector('input:not([type="hidden"]),select,textarea')?.focus();
}

async function coordinationMutate(payload,success,{close=false,form=null}={}) {
  if(busy||!coordinationConnected()){notify('请等待连接恢复后再提交。',true);return false;}
  const epoch=coordinationSync.epoch,userId=coordinationSync.userId;busy=true;updateCoordinationChrome();
  try {
    const snapshot=await api('/api/action',payload);
    if(epoch!==coordinationSync.epoch||snapshot.current_user?.id!==userId)return false;
    state=snapshot;normalize();coordinationApplySnapshot(snapshot);busy=false;
    if(close)dialog.close();coordinationSync.pendingRender=true;patchCoordinationLive(true);notify(success);requestCoordinationRefresh();return true;
  } catch(error) {
    if(epoch!==coordinationSync.epoch)return false;
    busy=false;
    if(error.status===409||error.code==='version_conflict'){
      if(form){form.dataset.conflicted='true';const notice=form.querySelector('.coordination-dialog-update');notice.hidden=false;notice.querySelector('button').hidden=false;notice.querySelector('span').textContent='任务版本冲突：其他协作者已经更新此任务。输入已保留，请读取新版本并重新确认。';form.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=true;b.dataset.versionBlocked='true';});}
      notify('任务已被其他协作者更新，请读取新版本后重试。',true);await requestCoordinationRefresh();
    } else if(error instanceof TypeError||error.name==='AbortError'){
      coordinationSync.status='disconnected';if(form){form.dataset.conflicted='true';const notice=form.querySelector('.coordination-dialog-update');notice.hidden=false;notice.querySelector('button').hidden=false;notice.querySelector('span').textContent='连接中断，无法确认本次提交是否已保存。请重连并读取任务新版本，再决定是否需要重新提交。';form.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=true;b.dataset.versionBlocked='true';});}notify('提交结果暂不确定，请重连后检查状态，勿重复提交。',true);
    } else {const errorBox=form?.querySelector('.form-error');if(errorBox){errorBox.textContent=error.message;errorBox.setAttribute('tabindex','-1');errorBox.focus();}else notify(error.message,true);}
    return false;
  } finally {if(epoch===coordinationSync.epoch){busy=false;updateCoordinationChrome();}}
}

document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el||busy)return;const action=el.dataset.action;
  if(action==='coord-assignee-filter'){const form=el.closest('form');form.dataset.assigneeFilter=el.dataset.filter;refreshCoordinationAssignees(form);return;}
  if(action==='coord-view'){setCoordinationView(el.dataset.view);return;}
  if(action==='coord-refresh'){requestCoordinationRefresh();return;}
  if(action==='coord-apply'){patchCoordinationLive(true);return;}
  if(action==='coord-clear'){coordinationFilters.goal='all';coordinationFilters.actor='all';coordinationFilters.phase='all';render();return;}
  if(action==='coord-select-goal'){coordinationFilters.goal=el.dataset.id;patchCoordinationLive(true);updateCoordinationFilters();return;}
  if(action==='coord-select-phase'){coordinationFilters.phase=el.dataset.id;patchCoordinationLive(true);const select=document.getElementById('coordination-filter-phase');if(select)select.value=el.dataset.id;return;}
  if(action==='coord-task'){
    const task=coordinationTask(el.dataset.id),kind=el.dataset.kind;if(!task)return;
    if(kind==='accept'||kind==='start'){if(!coordinationCan(task,kind))return;return coordinationMutate({type:kind==='accept'?'accept_task':'start_task',task_id:task.id,expected_version:task.version},kind==='accept'?'已接取任务，组织成员将看到你的接取状态。':'已开始工作，组织进度已更新。');}
    return openCoordinationDialog(kind,task.id);
  }
  if(action==='coord-rebase') {
    const form=dialog.querySelector('form[data-form="coordination"]');if(!form)return;
    try{await refreshCoordinationPrivate();}catch{notify('尚未恢复连接，请稍后读取新版本。',true);return;}const task=coordinationTask(form.dataset.task);if(!task||!coordinationConnected())return;
    const summary=form.querySelector('.coordination-public-summary');if(summary)summary.outerHTML=form.dataset.kind==='assign'?coordinationAssignmentSummary(task):coordinationPublicDetail(task);
    if(!coordinationCan(task,form.dataset.kind)){form.querySelector('.form-error').textContent='任务已进入其他状态，当前操作不再适用。输入仍保留，可复制后关闭窗口查看最新任务。';return;}
    if(['review','approval'].includes(form.dataset.kind)) {form.querySelector('.form-error').textContent='交付或验收内容可能已经变化。请复制保留意见，关闭窗口后重新打开，核对最新内容再验收。';return;}
    if(form.dataset.kind==='assign')refreshCoordinationAssignees(form);
    form.dataset.version=String(task.version);delete form.dataset.conflicted;form.querySelector('.coordination-dialog-update').hidden=true;form.querySelectorAll('button[type="submit"]').forEach(b=>{delete b.dataset.versionBlocked;b.disabled=busy||!coordinationConnected()||b.dataset.assignmentBlocked==='true';});notify('已载入新版本，顶部已显示最新状态。你的输入保持不变，请对照核对后提交。');
  }
});
document.addEventListener('change',event=>{const name=event.target.dataset?.coordFilter;if(!name)return;coordinationFilters[name]=event.target.value;patchCoordinationLive(true);});
document.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form="coordination"]');if(!form)return;event.preventDefault();if(busy||form.dataset.conflicted==='true')return;
  const kind=form.dataset.kind,data=new FormData(form),get=name=>String(data.get(name)||'').trim(),payload={task_id:form.dataset.task,expected_version:Number(form.dataset.version)};
  if(kind==='assign'){const selected=get('actor_id'),candidate=coordinationAssignmentCandidates(coordinationTask(form.dataset.task)||{}).find(a=>a.actor_id===selected);if(!candidate||candidate.can_assign===false){form.querySelector('.form-error').textContent=candidate?(coordinationTask(form.dataset.task)?.assignment_disabled_reason||'当前任务状态或权限不允许分派'):(selected?'已选成员已不在当前名单中，请重新选择。':'请先选择一位员工或 Agent。');form.querySelector('#coord-assignee-search').focus();return;}Object.assign(payload,{type:'assign_task',actor_id:selected});}
  if(kind==='progress')Object.assign(payload,{type:'update_progress',progress:Number(get('progress')),note:get('note')});
  if(kind==='submit')Object.assign(payload,{type:'submit_task',output:get('output')});
  if(kind==='review')Object.assign(payload,{type:'review_task',approved:get('approved')==='true',feedback:get('feedback')});
  if(kind==='approval')Object.assign(payload,{type:get('decision'),feedback:get('feedback')});
  if(!payload.type)return;
  coordinationMutate(payload,{assign:'任务已分派，组织成员可见。',progress:'公开进展已更新，对全员可见。',submit:'交付已提交，等待负责人独立验收。',review:'验收决定已保存，组织状态已更新。',approval:'独立验收决定已保存。'}[kind],{close:true,form});
});
document.addEventListener('focusout',()=>{if(coordinationSync.pendingRender)setTimeout(()=>patchCoordinationLive(),0);});
document.addEventListener('toggle',event=>{if(event.target.matches?.('.task-action-menu,.activity-original')&&!event.target.open&&coordinationSync.pendingRender)patchCoordinationLive();},true);
dialog.addEventListener('close',()=>{dialog.classList.remove('coordination-dialog','coordination-assignment-dialog');coordinationDialogSerial++;if(coordinationSync.pendingRender)setTimeout(()=>patchCoordinationLive(),0);});
window.addEventListener('online',()=>requestCoordinationRefresh());
window.addEventListener('offline',()=>{if(coordinationSync.userId){coordinationSync.status='disconnected';updateCoordinationChrome();}});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)requestCoordinationRefresh();});

load();

document.addEventListener('input',event=>{
  if(event.target.id==='coord-assignee-search')refreshCoordinationAssignees(event.target.closest('form'));
});
document.addEventListener('change',event=>{
  if(event.target.name!=='assignment_candidate')return;
  const form=event.target.closest('form');if(form?.dataset.kind!=='assign')return;
  form.querySelector('[name="actor_id"]').value=event.target.value;
  form.querySelector('.form-error').textContent='';
  const task=coordinationTask(form.dataset.task);
  form.querySelector('#coord-assignee-details').innerHTML=coordinationAssigneeDetail(task,event.target.value);
  updateCoordinationAssignmentSubmit(form);
  form.querySelectorAll('.assignment-candidate').forEach(label=>label.classList.toggle('selected',label.querySelector('input').value===event.target.value));
});
