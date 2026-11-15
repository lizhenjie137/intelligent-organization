"use strict";

const coordinationSync={epoch:0,userId:null,data:null,revision:-1,lastSync:null,status:'connecting',timer:null,inflight:false,requestId:0,appliedId:0,pendingRender:false,needsRefresh:false};
const coordinationFilters={goal:'all',actor:'all',phase:'all'};
let coordinationView='tasks';
const coordinationPhases={unassigned:'Unassigned',queued:'Queued',assigned:'Assigned',accepted:'Accepted',in_progress:'In progress',running:'Agent running',submitted:'Awaiting review',completed:'Completed',blocked:'Blocked',failed:'Failed',paused:'Paused',waiting_approval:'Awaiting human action'};
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
    if(a.available===false)blocking_reasons.push({code:'unavailable',message:'This provider is currently inactive'});
    if(!(a.capability_ids||[]).includes(task.capability_id))blocking_reasons.push({code:'capability_missing',message:'Required capability is not registered'});
    if(!(a.permissions||[]).includes(task.capability_id))blocking_reasons.push({code:'permission_missing',message:'Execution permission for this capability is missing'});
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
  if(compact)return status.reasons.length?`<small class="coordination-assignment-warning">${escape(status.reasons[0].message)}${status.reasons.length>1?` ; plus ${status.reasons.length-1} more`:''}</small>`:'';
  return `<section class="coordination-assignment-requirements"><strong>${status.metadata?'Requirements to resolve before execution':'Execution requirements not confirmed'}</strong>${status.reasons.length?`<ul>${status.reasons.map(reason=>`<li>${escape(reason.message||reason.code)}</li>`).join('')}</ul>`:''}<p>${status.metadata?'Assignment records responsibility only; it does not grant execution permission.':'This server does not provide complete execution requirements. All members and Agents are listed, but an assignment may be rejected under its existing rules. The server response remains authoritative.'}</p></section>`;
}
function coordinationAssignmentRowAction(task) {
  if(!coordinationCan(task,'assign')){const goal=coordinationGoal(task.goal_id);if(!goal?.can_manage)return '';const reason=task.assignment_disabled_reason||(goal.collaborative===false?'This goal uses the original workflow. Open the run to manage execution.':'Assignment is unavailable at this workflow stage. Open the run to view its controls.');return `<span class="coordination-assignment-unavailable"><small>${escape(reason)}</small>${goal.collaborative===false?button('Open execution','open-goal',`data-id="${escape(task.goal_id)}"`,'small'):''}</span>`;}
  return `<span class="coordination-assign-action">${coordButton(task.actor_id?'Reassign':'Assign task','assign',task,!task.actor_id)}</span>`;
}
function coordinationAssignmentSummary(task) {
  return `<div class="coordination-public-summary assignment-task-context"><dl><div><dt>Organization goal</dt><dd>${escape(productName(coordinationGoal(task.goal_id)?.title||task.goal_id))}</dd></div><div><dt>Current assignee</dt><dd>${escape(productName(task.actor_name||'Unassigned'))}</dd></div><div><dt>Version</dt><dd>v${task.version??0}</dd></div></dl></div>`;
}
function coordinationAssigneeBody(task) {
  return `${coordinationAssignmentSummary(task)}<div class="assignment-intro"><strong>Required capability: ${escape(task.capability_name||task.capability_id)}</strong><p>All account-linked members and registered Agents are shown. Assignment is separate from capability verification and execution authorization.</p></div><input type="hidden" name="actor_id" value="${escape(task.actor_id||'')}"><div class="assignment-picker"><div class="assignment-directory"><div class="form-field"><label for="coord-assignee-search">Find an assignee</label><input id="coord-assignee-search" type="search" autocomplete="off" placeholder="Search name, responsibilities or type"></div><div class="assignment-type-filter" role="group" aria-label="Choose an assignee">${[['all','All'],['human','Members'],['agent','Agents']].map(([id,label])=>`<button type="button" data-action="coord-assignee-filter" data-filter="${id}" aria-pressed="${id==='all'}">${label}</button>`).join('')}</div><fieldset class="assignment-roster"><legend>Choose an assignee</legend><div id="coord-assignee-list"></div></fieldset></div><section class="assignment-selection" id="coord-assignee-details" aria-label="Selected assignee"></section></div>${Array.isArray(task.assignment_candidates)?'':`<p class="assignment-compatibility">This server does not provide complete execution requirements. All members and Agents are listed, but an assignment may be rejected under its existing rules. The server response remains authoritative.</p>`}`;
}
function coordinationAssigneeRows(task,selected='',query='',type='all') {
  const candidates=coordinationAssignmentCandidates(task),term=query.trim().toLocaleLowerCase();
  const choices=candidates.filter(a=>(type==='all'||a.type===type)&&`${a.name||''} ${a.role||''} ${a.type==='human'?'Members':'Agents'}`.toLocaleLowerCase().includes(term));
  if(!choices.length)return '<p class="assignment-empty">No matching providers. Try another search or select All.</p>';
  return choices.map(a=>`<label class="assignment-candidate ${a.actor_id===selected?'selected':''}"><input type="radio" name="assignment_candidate" value="${escape(a.actor_id)}" ${a.actor_id===selected?'checked':''} ${a.can_assign===false?'disabled':''}><span class="assignment-person"><strong>${escape(productName(a.name||a.actor_id))}</strong><small>${a.type==='human'?'Member':'Agent'} · ${a.available===false?'Inactive':'Available'}</small><span class="assignment-readiness ${a.metadata&&a.ready_to_execute?'ready':'pending'}">${a.metadata?(a.ready_to_execute?'Execution requirements met':'Requirements to resolve before execution'):'Execution requirements not confirmed'}</span></span></label>`).join('');
}
function coordinationAssigneeDetail(task,selected) {
  if(!selected)return '<h3>No assignee selected</h3><p>Select a member or Agent from the list. Providers with unmet requirements are included; assigning does not grant permissions.</p>';
  const candidate=coordinationAssignmentCandidates(task).find(a=>a.actor_id===selected);
  if(!candidate)return '<h3>No assignee selected</h3><p>The selected provider is no longer in the current roster. Choose another assignee.</p>';
  const ready=candidate.metadata&&candidate.ready_to_execute;
  return `<span class="assignment-selection-label">Selected assignee</span><h3>${escape(productName(candidate.name||candidate.actor_id))}</h3><p>${candidate.type==='human'?'Member':'Agent'} · ${candidate.available===false?'Inactive':'Available'}</p><strong class="assignment-readiness ${ready?'ready':'pending'}">${candidate.metadata?(ready?'Execution requirements met':'Requirements to resolve before execution'):'Execution requirements not confirmed'}</strong>${candidate.blocking_reasons.length?`<ul>${candidate.blocking_reasons.map(reason=>`<li>${escape(reason.message||reason.code)}</li>`).join('')}</ul>`:''}<p>${ready?'Qualification checks have passed. Members must still accept the task and start work; an owner must initiate Agent execution.':candidate.metadata?'You can assign responsibility now. Resolve the listed requirements before execution. Assignment does not grant permissions or switch to another provider.':'This server does not provide complete execution requirements. All members and Agents are listed, but an assignment may be rejected under its existing rules. The server response remains authoritative.'}</p>${candidate.can_assign===false?'<p class="inline-error">The current task state or your permissions do not allow assignment</p>':''}`;
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
  stopCoordination();state=null;authState={authenticated:false,setup_required:false};busy=false;if(dialog.open)dialog.close();renderAuth();notify('Your session has expired. Please sign in again.',true);
}

async function coordinationFetch(path,epoch) {
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),10000);
  try {const response=await fetch(path,{signal:controller.signal,credentials:'same-origin',cache:'no-store'});if(epoch!==coordinationSync.epoch)return null;if(response.status===401){coordinationExpire(epoch);return null;}const value=await response.json();if(!response.ok||value.error)throw new Error(typeof value.error==='string'?value.error:'Sync temporarily unavailable');return value;}
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
    if(wasOffline)notify('Reconnected. Organization progress is up to date.');
    updateCoordinationChrome();
  } catch(error) {
    if(epoch!==coordinationSync.epoch)return;
    const first=coordinationSync.status!=='disconnected';coordinationSync.status='disconnected';updateCoordinationChrome();
    if(first)notify('Connection interrupted. Showing the last data and reconnecting automatically; submissions are paused.',true);
  } finally {
    if(epoch===coordinationSync.epoch){coordinationSync.inflight=false;const retry=coordinationSync.needsRefresh;coordinationSync.needsRefresh=false;coordinationSync.timer=setTimeout(requestCoordinationRefresh,retry?150:2000);}
  }
}

function coordinationStatusHtml() {
  const status=coordinationSync.status,label=({connecting:'Connecting',connected:'Connected',updating:'Updating',disconnected:'Disconnected'})[status],last=coordinationSync.lastSync?coordinationSync.lastSync.toLocaleTimeString('en-US',{hour12:false}):'Not synced yet';
  return `<span class="sync-state ${status}"><i></i>${status==='connected'?'Synced':label}</span><details class="sync-details"><summary aria-label="View sync details">${icon('info')}</summary><div><span>Last synced ${last}</span><span>Organization revision v${Math.max(0,coordinationSync.revision)}</span><span>Syncs every 2 seconds</span></div></details>${status==='disconnected'?'<strong class="sync-stale">Showing last data; reconnecting</strong>':''}`;
}

function updateCoordinationChrome() {
  const overview=document.getElementById('coordination-overview');if(overview)overview.innerHTML=coordinationOverviewHtml();
  const status=document.getElementById('coordination-sync-content');if(status){const opened=status.querySelector('details')?.open,focused=status.contains(document.activeElement);status.innerHTML=coordinationStatusHtml();if(opened)status.querySelector('details').open=true;if(focused)status.querySelector('summary')?.focus({preventScroll:true});}
  const notice=document.getElementById('coordination-update-notice');if(notice){notice.hidden=!coordinationSync.pendingRender;notice.querySelector('span').textContent='Organization progress has changed. Your current position is preserved. Apply the latest state when ready.';}
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
  const data=coordinationData(),options={goal:[['all','All organization goals'],...(data.goals||[]).map(g=>[g.id,g.title])],actor:[['all','All assignees'],['unassigned','Unassigned'],...(data.actors||[]).map(a=>[a.id,a.name])]};
  for(const name of ['goal','actor']){const select=document.getElementById('coordination-filter-'+name);if(!select||select===document.activeElement)continue;if(!options[name].some(([id])=>id===coordinationFilters[name]))coordinationFilters[name]='all';select.innerHTML=options[name].map(([id,label])=>`<option value="${escape(id)}" ${coordinationFilters[name]===id?'selected':''}>${escape(productName(label))}</option>`).join('');}
}

function coordinationOverviewHtml() {
  const tasks=coordinationData().tasks||[],working=tasks.filter(t=>['in_progress','running'].includes(coordinationPhase(t))).length,complete=tasks.filter(t=>coordinationPhase(t)==='completed').length;
  return `<span><i class="overview-working-dot"></i><strong>${working}</strong> in progress</span><span><strong>${complete}</strong> completed</span>`;
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
  return heading('Organization workspace','Shared goals, tasks and delivery progress',button('New goal','new-goal','','primary','plus'))+`<div id="coordination-workspace" class="coordination-workspace" data-view="${coordinationView}">

    <div id="coordination-update-notice" class="coordination-update-notice" ${coordinationSync.pendingRender?'':'hidden'}><span>Organization progress has changed. Your current position is preserved. Apply the latest state when ready.</span>${button('Apply latest state','coord-apply','','small')}</div>
    <div class="coordination-view-bar"><div class="coord-view-tabs" role="group" aria-label="Workspace views">${[['tasks','layers','Task board'],['results','file','Deliverables & handoffs'],['activity','history','Activity']].map(([id,i,name])=>`<button type="button" data-action="coord-view" data-view="${id}" class="${coordinationView===id?'active':''}" aria-pressed="${coordinationView===id}">${icon(i)}${name}</button>`).join('')}</div><div class="coordination-view-tools"><div class="coordination-overview" id="coordination-overview">${coordinationOverviewHtml()}</div><div class="coordination-sync"><div id="coordination-sync-content">${coordinationStatusHtml()}</div>${button('Refresh','coord-refresh','','ghost small','refresh')}</div></div></div>
    <section class="coordination-filters" aria-label="Filter collaborative tasks"><div><label for="coordination-filter-goal">Organization goal</label><select id="coordination-filter-goal" data-coord-filter="goal"><option value="all">All organization goals</option>${(data.goals||[]).map(g=>`<option value="${escape(g.id)}" ${coordinationFilters.goal===g.id?'selected':''}>${escape(productName(g.title))}</option>`).join('')}</select></div><div><label for="coordination-filter-actor">Assignee</label><select id="coordination-filter-actor" data-coord-filter="actor"><option value="all">All assignees</option><option value="unassigned" ${coordinationFilters.actor==='unassigned'?'selected':''}>Unassigned</option>${(data.actors||[]).map(a=>`<option value="${escape(a.id)}" ${coordinationFilters.actor===a.id?'selected':''}>${escape(productName(a.name))}</option>`).join('')}</select></div><div><label for="coordination-filter-phase">Work status</label><select id="coordination-filter-phase" data-coord-filter="phase"><option value="all">All statuses</option>${Object.entries(coordinationPhases).map(([id,name])=>`<option value="${id}" ${coordinationFilters.phase===id?'selected':''}>${name}</option>`).join('')}</select></div>${button('Clear filters','coord-clear','','ghost small')}</section>
    ${workboardShellHtml()}<div id="coordination-live">${coordinationLiveHtml()}</div></div>`;
}

function coordinationLiveHtml() {
  const data=coordinationData(),goals=data.goals||[],allTasks=data.tasks||[],tasks=allTasks.filter(t=>(coordinationFilters.goal==='all'||t.goal_id===coordinationFilters.goal)&&(coordinationFilters.actor==='all'||(coordinationFilters.actor==='unassigned'?!t.actor_id:t.actor_id===coordinationFilters.actor))&&(coordinationFilters.phase==='all'||coordinationPhase(t)===coordinationFilters.phase));
  const history=allTasks.flatMap(t=>(t.history||[]).map(h=>({...h,task_title:t.title,goal_id:t.goal_id}))).filter(h=>coordinationFilters.goal==='all'||h.goal_id===coordinationFilters.goal).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)).slice(0,12);
  return `<section class="coordination-goals" aria-label="Shared goals">${goals.length?goals.map(g=>{const gt=allTasks.filter(t=>t.goal_id===g.id),done=gt.filter(t=>coordinationPhase(t)==='completed').length,percent=gt.length?Math.round(gt.reduce((sum,t)=>sum+(coordinationPhase(t)==='completed'?100:Math.min(99,Number(t.progress)||0)),0)/gt.length):0;return `<button type="button" data-action="coord-select-goal" data-id="${escape(g.id)}" class="coordination-goal ${coordinationFilters.goal===g.id?'selected':''}"><div><strong>${escape(productName(g.title))}</strong>${badge(g.status)}</div><p>${escape(productName(g.owner_name||'Unspecified'))}<span>${done} / ${gt.length} completed</span>${productSourceLabel(g)?`<span class="record-origin">${escape(productSourceLabel(g))}</span>`:''}</p><div class="coordination-progress-line"><progress value="${percent}" max="100" aria-label="${escape(productName(g.title))} completion progress">${percent}%</progress><b>${percent}%</b></div></button>`;}).join(''):`<div class="panel">${empty('Create your first organization goal','Any member can propose a goal. Owners can assign qualified employees and Agents.','target')}</div>`}</section><section class="panel coordination-task-panel"><div class="panel-header"><div><h2>Tasks</h2><p>Assignee, status and current progress</p></div><span class="pill">${tasks.length} tasks</span></div>${coordinationStatusStrip(allTasks)}${tasks.length?`<div class="coordination-table-scroll" id="coordination-table-scroll"><table class="coordination-table"><thead><tr><th>Task / Goal</th><th>Assignee</th><th>Work status</th><th>Progress</th><th>Public update</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${tasks.map(coordinationTaskRow).join('')}</tbody></table></div>`:empty('No matching tasks','Adjust the goal, assignee or status filters.','layers')}</section><section class="panel coordination-history"><div class="panel-header"><div><h2>Activity</h2><p>Task transitions and public updates</p></div></div>${history.length?`<ol>${history.map(h=>`<li><time>${date(h.created_at)}</time><div><strong>${escape(productName(h.actor_name||'System'))}</strong><span>${escape(productActivityLabel(h.type))}</span><details class="activity-original"><summary>View original record</summary><p>${escape(h.message||h.type)}</p></details><small>${escape(h.task_title)}</small></div></li>`).join('')}</ol>`:empty('Waiting for the first activity','Assignments, acceptance, progress and reviews will appear here.','history')}</section>`;
}

function coordButton(label,kind,task,primary=false) {return `<button type="button" class="button small ${primary?'primary':''}" data-action="coord-task" data-kind="${kind}" data-id="${escape(task.id)}" ${kind==='detail'?'':'data-coordination-write'} ${kind!=='detail'&&(!coordinationConnected()||busy)?'disabled':''}>${label}</button>`;}
function coordinationTaskRow(task) {
  const phase=coordinationPhase(task),percent=phase==='completed'?100:Math.min(99,Math.max(0,Number(task.progress)||0)),goal=coordinationGoal(task.goal_id),actions=[];
  if(coordinationCan(task,'accept'))actions.push(coordButton('Accept task','accept',task,true));
  if(coordinationCan(task,'start'))actions.push(coordButton('Start work','start',task,true));
  if(coordinationCan(task,'progress'))actions.push(coordButton('Update progress','progress',task));
  if(coordinationCan(task,'submit')&&!coordinationApproval(task))actions.push(coordButton('Submit deliverable','submit',task,true));
  if(coordinationCan(task,'approval'))actions.push(coordButton('Independent review','approval',task,true));
  if(coordinationCan(task,'review')&&!coordinationApproval(task))actions.push(coordButton('Review deliverable','review',task,true));
  if(task.actor_type==='agent'&&goal?.can_manage&&['assigned','queued'].includes(phase))actions.push(button('Open execution','open-goal',`data-id="${escape(task.goal_id)}"`,'small'));
  if(task.can_publish)actions.push(button('Publish update','workboard-publish',`data-id="${escape(task.id)}"`,'small','plus'));
  if(task.can_handoff&&workboardUpdates(task.id).length)actions.push(button('Hand off deliverables','workboard-handoff',`data-id="${escape(task.id)}"`,'small','arrow'));
  actions.push(button('Deliverable details','workboard-detail',`data-id="${escape(task.id)}"`,'small','history'));
  return `<tr><td><button type="button" class="task-title-link" data-action="workboard-detail" data-id="${escape(task.id)}">${escape(task.title)}</button><small>${escape(productName(goal?.title||task.goal_id))}</small><span class="coordination-capability">${escape(task.capability_name||task.capability_id)}</span></td><td>${task.actor_id?`<span class="coordination-assignee">${icon(task.actor_type==='agent'?'bot':'person')}${escape(productName(task.actor_name||task.actor_id))}</span>${coordinationAssignmentRequirements(task,true)}`:'<span class="coordination-muted">Unassigned</span>'}</td><td><span class="coordination-phase ${escape(phase)}">${task.dependencies_ready===false&&['queued','assigned','blocked'].includes(phase)?'Waiting for dependencies':task.actor_type==='agent'&&phase==='assigned'?'Awaiting Agent execution':escape(coordinationPhases[phase]||phase)}</span>${task.dependencies_ready===false?`<small>${escape(task.blocked_reason||'Dependencies are not complete')}</small>`:''}${coordinationApproval(task)?'<small>Independent review step</small>':''}</td><td><div class="coordination-task-progress"><progress value="${percent}" max="100" aria-label="${escape(task.title)} progress">${percent}%</progress><span>${percent}%</span></div></td><td><p class="coordination-public-note">${escape(productProgress(task.public_note||task.progress_note||'No public update yet',goal))}</p></td><td><time>${date(task.updated_at)}</time><small>Task v${task.version??0}</small></td><td><div class="coordination-row-actions">${coordinationAssignmentRowAction(task)}${actions.length>2?actions[0]+`<details class="task-action-menu"><summary aria-label="${escape(task.title)}: more actions">More${icon('arrow')}</summary><div>${actions.slice(1).join('')}</div></details>`:actions.join('')}</div></td></tr>`;
}

function markCoordinationDialogUpdates() {
  const form=dialog.querySelector('form[data-form="coordination"]');if(!form)return;
  const task=coordinationTask(form.dataset.task),notice=dialog.querySelector('.coordination-dialog-update');if(!task||!notice)return;
  if(form.dataset.kind==='assign'&&form.dataset.assignmentFingerprint!==JSON.stringify(coordinationAssignmentCandidates(task)))refreshCoordinationAssignees(form);
  const changed=Number(task.version)!==Number(form.dataset.version);
    if(changed){form.dataset.conflicted='true';notice.hidden=false;notice.querySelector('button').hidden=false;notice.querySelector('span').textContent='Another collaborator updated this task. Your input is preserved. Load the latest version and confirm before continuing.';form.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=true;b.dataset.versionBlocked='true';});}
    else if(!form.dataset.conflicted){notice.hidden=false;notice.querySelector('button').hidden=true;notice.querySelector('span').textContent='Other organization tasks changed. This task version is unchanged; your input is preserved and you can continue.';}
}

function coordinationPublicDetail(task) {
  const goal=coordinationGoal(task.goal_id);
  return `<div class="coordination-public-summary"><dl class="coordination-detail-meta"><div><dt>Organization goal</dt><dd>${escape(coordinationGoal(task.goal_id)?.title||task.goal_id)}</dd></div><div><dt>Assignee</dt><dd>${escape(productName(task.actor_name||'Unassigned'))}</dd></div><div><dt>Work status</dt><dd>${escape(coordinationPhases[coordinationPhase(task)]||coordinationPhase(task))}</dd></div><div><dt>Synced version and progress</dt><dd>v${task.version??0} · ${Math.min(100,Math.max(0,Number(task.progress)||0))}%</dd></div></dl>${coordinationAssignmentRequirements(task)}<div class="coordination-public-content"><strong>Public update (visible to everyone)</strong><p>${escape(productProgress(task.public_note||task.progress_note||'No public update yet',goal))}</p></div></div>`;
}

function coordinationStatusStrip(allTasks) {
  const scope=allTasks.filter(t=>(coordinationFilters.goal==='all'||t.goal_id===coordinationFilters.goal)&&(coordinationFilters.actor==='all'||(coordinationFilters.actor==='unassigned'?!t.actor_id:t.actor_id===coordinationFilters.actor)));
  const counts={};for(const task of scope){const phase=coordinationPhase(task);counts[phase]=(counts[phase]||0)+1;}
  const phases=['unassigned','assigned','accepted','in_progress','submitted','completed',...['blocked','failed'].filter(phase=>counts[phase])];
  return `<div class="coordination-status-strip" role="group" aria-label="Filter by work status"><button type="button" data-action="coord-select-phase" data-id="all" aria-pressed="${coordinationFilters.phase==='all'}" class="${coordinationFilters.phase==='all'?'active':''}"><span>All</span><b>${scope.length}</b></button>${phases.map(phase=>`<button type="button" data-action="coord-select-phase" data-id="${phase}" aria-pressed="${coordinationFilters.phase===phase}" class="${coordinationFilters.phase===phase?'active':''}"><span>${coordinationPhases[phase]}</span><b>${counts[phase]||0}</b></button>`).join('')}</div>`;
}

async function openCoordinationDialog(kind,taskId) {
  let task=coordinationTask(taskId);if(!task)return;
  const serial=++coordinationDialogSerial;
  if(['review','approval','submit'].includes(kind)){try{await refreshCoordinationPrivate();}catch{notify('Unable to read task content available to this account. Reconnect and try again.',true);return;}if(serial!==coordinationDialogSerial||!state)return;task=coordinationTask(taskId);}
  if(!task)return;
  if(kind!=='detail'&&!coordinationCan(task,kind)){notify('The task status or your permissions changed. Refresh and choose an available action.',true);requestCoordinationRefresh();return;}
  const privateTask=state.tasks.find(t=>t.id===task.id),privateGoal=state.goals.find(g=>g.id===task.goal_id),submission=privateTask?.submission?.output;
  let title=({detail:'Shared task details',assign:'Assign collaborative task',progress:'Update public progress',submit:'Submit task deliverable',review:'Review task deliverable',approval:'Independent review decision'})[kind],body='',submitLabel='Save';
  if(kind==='detail'){body=`<div class="notice">This shared summary is visible to everyone. It does not include private documents, input text or deliverable content.</div>${coordinationPublicDetail(task)}<h3 class="coordination-detail-heading">Public activity</h3><div class="timeline">${(task.history||[]).slice().reverse().map(h=>`<div class="timeline-item"><p>${escape(productName(h.actor_name||'System'))}: ${escape(h.message||h.type)}</p><time>${date(h.created_at)}</time></div>`).join('')||'<p class="skill-muted">No activity yet.</p>'}</div>`;}
  if(kind==='assign'){body=coordinationAssigneeBody(task);submitLabel='Confirm assignment';}
  if(kind==='progress'){body=`${coordinationPublicDetail(task)}<div class="form-field"><label for="coord-progress">Current progress (0–99%)</label><input id="coord-progress" name="progress" type="number" min="0" max="99" step="1" required value="${Math.min(99,Number(task.progress)||0)}"><small>Progress reaches 100% only after review.</small></div><div class="form-field"><label for="coord-note">Public update (visible to everyone)</label><textarea id="coord-note" name="note" maxlength="2000" required rows="5" placeholder="Describe completed work, next steps or help needed. Do not paste private information into a public update.">${escape(task.public_note||task.progress_note||'')}</textarea></div>`;submitLabel='Update organization progress';}
  if(kind==='submit'){body=`${coordinationPublicDetail(task)}<div class="form-field"><label for="coord-output">Deliverable content and evidence</label><textarea id="coord-output" name="output" required maxlength="100000" rows="12" placeholder="Submit the actual result, supporting sources and anything still requiring confirmation.">${escape(submission||'')}</textarea><small>The content is available to you, the goal owner and administrators according to permissions. It is not included in the public workspace summary.</small></div><div class="notice">Submission moves the task to Awaiting review. A goal owner or administrator must review it independently; you cannot review your own submission.</div>`;submitLabel='Submit for review';}
  if(kind==='review') {
    body=`${coordinationPublicDetail(task)}<div class="notice">The content below is accessible to this account. Only the goal owner or an administrator can review it independently. Submitters cannot review their own work.</div><div class="form-field"><label>Deliverable content</label><pre class="output">${escape(submission||'This account has not loaded the deliverable content yet. Refresh and try again.')}</pre></div><div class="form-field"><label for="coord-review-decision">Review decision</label><select id="coord-review-decision" name="approved"><option value="true">Approve and complete</option><option value="false">Return for more work</option></select></div><div class="form-field"><label for="coord-feedback">Review feedback</label><textarea id="coord-feedback" name="feedback" rows="5" required maxlength="5000" placeholder="Explain the basis for approval, or the specific changes required."></textarea></div>`;submitLabel='Submit review decision';
  }
  if(kind==='approval'){
    const previous=state.tasks.filter(t=>t.goal_id===task.goal_id&&(privateTask?.depends_on||[]).includes(t.id));
    body=`${coordinationPublicDetail(task)}<div class="form-field"><label>Goal acceptance criteria</label><p class="skill-muted">${escape(privateGoal?.criteria||'Review against the goal criteria you are authorized to view.')}</p></div>${previous.map(t=>`<details open><summary>${escape(t.title)}</summary><pre class="output">${escape(t.submission?.output||textOutput(t.output)||'This account cannot access this deliverable content.')}</pre></details>`).join('')}<div class="form-field"><label for="coord-approval-decision">Independent review decision</label><select id="coord-approval-decision" name="decision"><option value="approve">Approve</option><option value="reject">Return for rework</option></select></div><div class="form-field"><label for="coord-approval-feedback">Review feedback</label><textarea id="coord-approval-feedback" name="feedback" rows="5" required maxlength="5000"></textarea></div>`;submitLabel='Submit independent review';
  }
  dialog.classList.add('coordination-dialog');dialog.classList.toggle('coordination-assignment-dialog',kind==='assign');
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2><p class="dialog-subtitle">${escape(task.title)}</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close window">${icon('close')}</button></div><div class="dialog-body">${kind==='detail'?body:`<form data-form="coordination" data-kind="${kind}" data-task="${escape(task.id)}" data-version="${task.version}">${kind==='assign'?'<div class="assignment-form-content">':''}<div class="form-error" role="alert"></div><div class="coordination-dialog-update" hidden><span></span><button class="button small" type="button" data-action="coord-rebase">Load latest version and keep input</button></div>${body}${kind==='assign'?'</div>':''}<div class="form-actions"><button class="button" type="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary" data-coordination-write ${kind==='review'&&(!submission||Number(privateTask?.version)!==Number(task.version))?'data-version-blocked="true" disabled':!coordinationConnected()?'disabled':''}>${submitLabel}</button></div></form>`}</div>`;
  if(kind==='assign')refreshCoordinationAssignees(dialog.querySelector('form'));
  if(!dialog.open)dialog.showModal();dialog.querySelector('input:not([type="hidden"]),select,textarea')?.focus();
}

async function coordinationMutate(payload,success,{close=false,form=null}={}) {
  if(busy||!coordinationConnected()){notify('Wait for the connection to recover before submitting.',true);return false;}
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
      if(form){form.dataset.conflicted='true';const notice=form.querySelector('.coordination-dialog-update');notice.hidden=false;notice.querySelector('button').hidden=false;notice.querySelector('span').textContent='Task version conflict: another collaborator updated this task. Your input is preserved. Load the latest version and confirm again.';form.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=true;b.dataset.versionBlocked='true';});}
      notify('Another collaborator updated this task. Load the latest version and retry.',true);await requestCoordinationRefresh();
    } else if(error instanceof TypeError||error.name==='AbortError'){
      coordinationSync.status='disconnected';if(form){form.dataset.conflicted='true';const notice=form.querySelector('.coordination-dialog-update');notice.hidden=false;notice.querySelector('button').hidden=false;notice.querySelector('span').textContent='Connection interrupted. The submission outcome is unknown. Reconnect and load the latest task version before deciding whether to submit again.';form.querySelectorAll('button[type="submit"]').forEach(b=>{b.disabled=true;b.dataset.versionBlocked='true';});}notify('Submission outcome is uncertain. Reconnect and check the status; do not submit again yet.',true);
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
    if(kind==='accept'||kind==='start'){if(!coordinationCan(task,kind))return;return coordinationMutate({type:kind==='accept'?'accept_task':'start_task',task_id:task.id,expected_version:task.version},kind==='accept'?'Task accepted. Organization members can see your acceptance.':'Work started. Organization progress is updated.');}
    return openCoordinationDialog(kind,task.id);
  }
  if(action==='coord-rebase') {
    const form=dialog.querySelector('form[data-form="coordination"]');if(!form)return;
    try{await refreshCoordinationPrivate();}catch{notify('Not reconnected yet. Try loading the latest version shortly.',true);return;}const task=coordinationTask(form.dataset.task);if(!task||!coordinationConnected())return;
    const summary=form.querySelector('.coordination-public-summary');if(summary)summary.outerHTML=form.dataset.kind==='assign'?coordinationAssignmentSummary(task):coordinationPublicDetail(task);
    if(!coordinationCan(task,form.dataset.kind)){form.querySelector('.form-error').textContent='The task moved to another state and this action no longer applies. Your input is preserved; copy it before closing and reviewing the latest task.';return;}
    if(['review','approval'].includes(form.dataset.kind)) {form.querySelector('.form-error').textContent='The deliverable or review content may have changed. Copy your feedback, close this window and reopen it to review the latest content before deciding.';return;}
    if(form.dataset.kind==='assign')refreshCoordinationAssignees(form);
    form.dataset.version=String(task.version);delete form.dataset.conflicted;form.querySelector('.coordination-dialog-update').hidden=true;form.querySelectorAll('button[type="submit"]').forEach(b=>{delete b.dataset.versionBlocked;b.disabled=busy||!coordinationConnected()||b.dataset.assignmentBlocked==='true';});notify('Latest version loaded. The summary shows the current state and your input is preserved. Compare them before submitting.');
  }
});
document.addEventListener('change',event=>{const name=event.target.dataset?.coordFilter;if(!name)return;coordinationFilters[name]=event.target.value;patchCoordinationLive(true);});
document.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form="coordination"]');if(!form)return;event.preventDefault();if(busy||form.dataset.conflicted==='true')return;
  const kind=form.dataset.kind,data=new FormData(form),get=name=>String(data.get(name)||'').trim(),payload={task_id:form.dataset.task,expected_version:Number(form.dataset.version)};
  if(kind==='assign'){const selected=get('actor_id'),candidate=coordinationAssignmentCandidates(coordinationTask(form.dataset.task)||{}).find(a=>a.actor_id===selected);if(!candidate||candidate.can_assign===false){form.querySelector('.form-error').textContent=candidate?(coordinationTask(form.dataset.task)?.assignment_disabled_reason||'The current task state or your permissions do not allow assignment'):(selected?'The selected provider is no longer in the current roster. Choose another assignee.':'Choose a member or Agent first.');form.querySelector('#coord-assignee-search').focus();return;}Object.assign(payload,{type:'assign_task',actor_id:selected});}
  if(kind==='progress')Object.assign(payload,{type:'update_progress',progress:Number(get('progress')),note:get('note')});
  if(kind==='submit')Object.assign(payload,{type:'submit_task',output:get('output')});
  if(kind==='review')Object.assign(payload,{type:'review_task',approved:get('approved')==='true',feedback:get('feedback')});
  if(kind==='approval')Object.assign(payload,{type:get('decision'),feedback:get('feedback')});
  if(!payload.type)return;
  coordinationMutate(payload,{assign:'Task assigned. The assignment is visible to organization members.',progress:'Public progress updated and visible to everyone.',submit:'Deliverable submitted. Awaiting independent review by the owner.',review:'Review decision saved. Organization status is updated.',approval:'Independent review decision saved.'}[kind],{close:true,form});
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
