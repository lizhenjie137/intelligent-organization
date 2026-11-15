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
const states = {queued:'Ready to run',running:'Running',waiting_approval:'Awaiting manual action',completed:'Completed',failed:'Execution failed',blocked:'Blocked',paused:'Paused',rejected:'Rejected'};
const stateNames = Object.keys(states);
const badge = status => `<span class="pill ${stateNames.includes(status) ? status : ''}">${escape(states[status] || status || 'Ready to run')}</span>`;
const date = value => { const d = new Date(value); return Number.isNaN(d.getTime()) ? escape(value || '') : d.toLocaleString('en-US', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}); };
const navs = [ ['collaboration','people','Organization workspace'], ['matrix','network','Capability matrix'], ['my-capabilities','person','My capabilities'], ['knowledge','book','Knowledge'], ['overview','dashboard','Run overview'], ['capabilities','cube','Capability catalog'], ['actors','people','People & Agents'], ['approvals','shield','Reviews'], ['memories','history','Retrospectives'], ['model-settings','bot','Model settings'] ];
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
  try { result = await response.json(); } catch { throw new Error('The service returned invalid data. Check that the local server is running.'); }
  if(response.status===401 && !path.startsWith('/api/auth/')) {stopCoordination();busy=false;state=null;authState={authenticated:false,setup_required:false};if(dialog.open)dialog.close();renderAuth();throw new Error('Your session has expired. Sign in again.');}
  if(!response.ok || result.error) {const error=new Error(typeof result.error==='string'?result.error:`Request failed (${response.status})`);error.status=response.status;error.code=result.code;throw error;}
  return result;
}

async function load() {
  try { authState=await api('/api/auth/state');if(!authState.authenticated){stopCoordination();state=null;renderAuth();return;}state = await api('/api/state'); normalize(); startCoordination(state); render(); }
  catch(error) { if(authState && !authState.authenticated){renderAuth();return;}app.innerHTML=`<div class="page-error"><h2>Unable to connect to the organization workspace</h2><p>${escape(error.message)}</p>${button('Reconnect','reload','','primary','refresh')}</div>`; }
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
  if(status) status.innerHTML='<span class="busy-indicator">Processing…</span>';
  try {
    const oldGoals=state.goals.map(g=>g.id),oldDocs=state.documents.map(d=>d.id),oldAssessments=state.assessments.map(a=>a.id);
    state=await api('/api/action',payload);
    coordinationApplySnapshot(state);
    if(payload.type==='import_document') selectedDocument=state.documents.find(d=>!oldDocs.includes(d.id))?.id || selectedDocument;
    if(payload.type==='suggest_capabilities') {const count=state.assessments.filter(a=>!oldAssessments.includes(a.id)).length;message=count?`Local matching found ${count}  suggested capabilities. Human verification is still required.`:'No new capability suggestions. You can submit a claim using the document as evidence.';}
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
    if(status) status.textContent='Local workspace';
    const inline=dialog.open?dialog.querySelector('.form-error'):options.errorTarget;
    if(inline) {inline.textContent=error.message;inline.setAttribute('tabindex','-1');inline.focus();} else {notify(error.message,true);focused?.focus();}
    return false;
  }
}

function render() {
  const current=route(), currentNav=navs.find(n=>n[0]===current), currentName=currentNav[2];
  const groups=[['Workspace',['collaboration','overview','approvals','memories']],['Organization capabilities',['matrix','capabilities','actors']],['Personal resources',['my-capabilities','knowledge']],['Management',['model-settings']]];
  const directory=state.coordination?.actors||state.actors, members=directory.filter(a=>a.type==='human'&&a.user_id).length;
  const name=productName(currentUser().display_name||currentUser().username||'Member');
  const navigation=groups.map(([label,ids])=>{
    const items=ids.map(id=>navs.find(n=>n[0]===id)).filter(n=>n&&(n[0]!=='model-settings'||isAdmin()));
    if(!items.length)return '';
    return `<section class="nav-group"><h2 class="nav-group-title">${label}</h2><div class="nav-group-items">${items.map(([id,i,label])=>`<a href="#${id}" class="${current===id?'active':''}" ${current===id?'aria-current="page"':''} title="${label}" aria-label="${label}">${icon(i)}<span class="nav-label">${label}</span>${id==='approvals'&&pending().length?`<span class="count">${pending().length}</span>`:''}</a>`).join('')}</div></section>`;
  }).join('');
  app.innerHTML=`<div class="shell">
    <aside class="sidebar"><a class="workspace-brand" href="#collaboration" aria-label="Xiaolajiao Intelligent Organization workspace"><span class="brand-mark"><img src="/brand-mark.svg" alt="" width="32" height="32"></span><span class="brand-text"><strong>Xiaolajiao</strong><small>Intelligent Organization</small></span></a><div class="workspace-directory">${icon('people')}<span>${members} visible members</span><span class="workspace-access">${isAdmin()?'Administrator':'Member'}</span></div>
      <nav class="nav" aria-label="Main navigation">${navigation}</nav>
      </aside>
    <div class="workspace"><header class="topbar"><div class="breadcrumb">${icon(currentNav[1])}<strong>${currentName}</strong><span class="workspace-separator"></span><span>Organization workspace</span></div><div class="topbar-right"><button type="button" class="button ghost small" data-guide-open="">${icon('book')}User guide</button>${runtimeBadgeHtml()}<small id="connection-status">Local workspace</small><div class="workspace-member" role="group" aria-label="Signed-in account"><span class="member-initial" aria-hidden="true">${escape(name.slice(0,1))}</span><span><strong title="${escape(name)}">${escape(name)}</strong><small>${isAdmin()?'Workspace administrator':'Member'}</small></span>${button('Sign out','logout','','ghost small')}</div></div></header>
      <main class="main" id="main" data-page="${current}">${({collaboration:collaborationPage,matrix:matrixPage,'my-capabilities':myCapabilitiesPage,knowledge:knowledgePage,overview:overview,capabilities:capabilitiesPage,actors:actorsPage,approvals:approvalsPage,memories:memoriesPage,'model-settings':modelSettingsPage}[current])()}<footer class="footnote">Xiaolajiao <span>Intelligent Organization</span><details class="product-usage-note"><summary>Usage notice</summary><div class="product-usage-content"><p>Download, installation, use and modification are permitted. Unauthorized resale of original or modified versions is prohibited.</p><p>Zhiqihui AI provides explanations of these rules. See the license supplied with the software.</p></div></details></footer></main>
    </div></div>`;
  if(current==='actors'&&isAdmin())loadAccountList();
  if(current==='model-settings')mountModelSettings();
}

function heading(title, subtitle, action='') {return `<div class="page-heading"><div class="page-heading-copy"><h1>${title}</h1>${subtitle?`<p>${subtitle}</p>`:''}</div>${action}</div>${usageGuideEntryHtml()}`;}
function modeHint() { return runtimeHintHtml(); }
function overview() {
  const g=getGoal(),tasks=getTasks(g),selected=tasks.find(t=>t.id===activeTask)||tasks[0],completed=state.tasks.filter(t=>t.status==='completed').length,available=state.actors.filter(a=>a.available).length;
  const header=heading('Run overview','Goal execution, task deliverables, and activity',button('New goal','new-goal','','primary','plus'));
  const runtimeView=runtimePresentation(),runtimeNotice=['warning','error'].includes(runtimeView.kind)?modeHint():'';
  const summary=`<div class="run-page-summary" aria-label="Organization activity summary"><span><b>${state.goals.filter(g=>g.status!=='completed').length}</b>active goals</span><span><b>${pending().length}</b>Awaiting manual action</span><span><b>${completed}</b>completed tasks</span><span><b>${available}</b>available executors</span></div>`;
  if(!g)return header+runtimeNotice+summary+`<section class="workspace-start"><div class="workspace-start-heading">${icon('target')}<div><h2>Create your first organization goal</h2><p>Define the expected outcome and acceptance criteria, then assign and run tasks.</p></div>${button('Create goal','new-goal','','primary','plus')}</div><div class="workspace-shortcuts"><a href="#actors">${icon('people')}<span><strong>Members and executors</strong><small>${isAdmin()?'Manage member accounts, capabilities, and permissions':'View member and Agent capabilities'}</small></span>${icon('arrow')}</a><a href="#knowledge">${icon('book')}<span><strong>Import work documents</strong><small>Import documents to preserve knowledge and evidence</small></span>${icon('arrow')}</a>${isAdmin()?`<a href="#model-settings">${icon('bot')}<span><strong>Configure model connection</strong><small>Manage the model service used by Agents</small></span>${icon('arrow')}</a>`:`<a href="#my-capabilities">${icon('cube')}<span><strong>Register my capabilities</strong><small>Submit work evidence and capability descriptions</small></span>${icon('arrow')}</a>`}</div></section>`;
  const done=tasks.filter(t=>t.status==='completed').length,origin=productSourceLabel(g);
  const actions=g.can_manage===false?`<span class="readonly-note">Execution is managed by the goal owner</span>${pending().some(t=>t.goal_id===g.id)?button('Open my reviews','go-approvals','','primary','shield'):''}`:`${g.status==='paused'?button('Resume goal','resume',`data-id="${escape(g.id)}"`,'','play'):g.status!=='completed'?button('Pause','pause',`data-id="${escape(g.id)}"`,'','pause'):''}${g.status!=='completed'?button('Adjust budget','budget',`data-id="${escape(g.id)}"`,'ghost small'):''}${g.status==='waiting_approval'?(pending().some(t=>t.goal_id===g.id)?button('Open reviews','go-approvals','','primary','shield'):'<span class="readonly-note">Waiting for the assigned member</span>'):g.status==='completed'?button('View retrospective','go-memories','','','book'):g.status!=='paused'?button('Run next step','step',`data-id="${escape(g.id)}"`,'primary','play'):''}`;
  return header+summary+`<section class="run-project"><header class="run-project-header"><div class="run-project-select"><label for="goal-select">Current goal</label><select id="goal-select" aria-label="Select goal">${state.goals.map(goal=>`<option value="${escape(goal.id)}" ${goal.id===g.id?'selected':''}>${escape(productName(goal.title))}</option>`).join('')}</select></div><div class="goal-actions">${actions}</div></header><div class="run-project-brief"><div class="run-project-identity">${badge(g.status)}<span class="priority">${escape(g.priority||'P2')}</span><span>${done} / ${tasks.length} completed</span><span>Used ${g.used||0} / ${g.budget} calls</span>${origin?`<span class="record-origin">${escape(origin)}</span>`:''}<time>${date(g.created_at)}</time></div>${g.brief?(g.is_example?`<details class="run-original-brief"><summary>View original goal brief</summary><p>${escape(g.brief)}</p></details>`:`<p>${escape(g.brief)}</p>`):''}</div>${runtimeNotice}<div class="run-workspace"><aside class="run-task-index" aria-label="Goal task index"><div class="run-index-heading"><h2>Tasks</h2><span>${tasks.length}</span></div><div class="run-task-list">${tasks.map((t,i)=>`<button type="button" class="run-task-row ${escape(t.status)}${selected?.id===t.id?' selected':''}" data-action="select-task" data-id="${escape(t.id)}" aria-pressed="${selected?.id===t.id}"><span class="run-task-status" aria-hidden="true">${t.status==='completed'?icon('check'):t.status==='failed'?icon('close'):t.status==='running'?icon('play'):String(i+1).padStart(2,'0')}</span><span class="run-task-label"><strong>${escape(t.title)}</strong><span>${escape(productName(actor(t.actor_id)?.name||'Unassigned'))}<span class="run-task-state">${runTaskBadge(t,g)}</span></span></span></button>`).join('')}</div><p class="run-index-note">${g.workflow==='custom'?'Execute in dependency order':'Standard workflow'}</p></aside><section class="run-task-document">${taskDetail(selected,g)}<section class="run-activity"><header><div>${icon('history')}<h3>Activity</h3></div>${isAdmin()?`<a class="button ghost small" href="/api/export" download="organization-export.json" title="Export all workspace data">${icon('download')}Export</a>`:''}</header>${timeline(g)}</section></section></div></section>`;
}

function runTaskBadge(t,g) {
  if(!g?.collaborative)return badge(t.status);
  const phase=coordinationPhase(t);
  return `<span class="pill ${escape(phase)}">${escape(coordinationPhases[phase]||phase)}</span>`;
}

function taskDetail(t,g) {
  if(!t)return `<div class="task-document-empty"><h2>No tasks</h2><p>No task workflow has been created for this goal.</p></div>`;
  const cap=capability(t.capability_id),who=actor(t.actor_id),output=textOutput(t.output),source=t.output_mode==='human'?'Submitted by a person':(t.output_mode||g.mode||state.settings.mode)==='model'?'Model generated · Unverified':g.is_example?'Historical validation output':'Rule generated · Unverified';
  return `<header class="task-document-header"><div class="task-document-title"><span>${escape(cap?.name||t.capability_id)}</span><h2>${escape(t.title)}</h2></div>${runTaskBadge(t,g)}</header><dl class="task-property-list"><div><dt>Executor</dt><dd>${who?icon(who.type==='human'?'person':'bot'):icon('person')}${escape(productName(who?.name||'Unassigned'))}</dd></div><div><dt>Risk level</dt><dd>${{low:'Low risk',medium:'Medium risk',high:'High risk'}[t.risk]||escape(t.risk||'Low risk')}</dd></div><div><dt>Attempts</dt><dd>${t.attempts||0} times</dd></div><div><dt>Prerequisites</dt><dd>${(t.depends_on||[]).map(id=>escape(state.tasks.find(x=>x.id===id)?.title||id)).join(', ')||'None'}</dd></div></dl>${t.error?`<div class="task-action-notice error"><span>${icon('info')}${escape(t.error)}</span>${t.status==='failed'&&g.can_manage!==false?button('Retry task','retry',`data-id="${escape(t.id)}"`,'small','refresh'):''}</div>`:t.status==='failed'&&g.can_manage!==false?`<div class="task-action-notice">${button('Retry task','retry',`data-id="${escape(t.id)}"`,'small','refresh')}</div>`:''}${t.status==='waiting_approval'&&t.actor_id===currentUser().actor_id?`<div class="task-action-notice"><span>${icon(t.capability_id==='approve'?'shield':'file')}${t.capability_id==='approve'?'Review the preceding deliverables and submit your decision.':'You are assigned to this task. Submit the actual result and evidence.'}</span>${button('Open reviews','go-approvals','','small primary')}</div>`:''}<section class="task-delivery"><div class="task-delivery-heading"><h3>Deliverable</h3>${output?`<span class="pill">${source}</span>`:'<span class="task-delivery-state">Not submitted</span>'}</div>${output?`<pre class="task-delivery-content">${escape(output)}</pre>`:`<div class="task-delivery-empty">${icon('file')}<div><strong>Waiting for an output</strong><p>${t.status==='failed'?'Resolve the execution error, then retry this task.':t.status==='waiting_approval'?'The deliverable will appear here after the assigned member completes the action.':'The deliverable will appear here when the task has run.'}</p></div></div>`}</section><details class="task-context"><summary>Acceptance criteria and execution context</summary><dl><div><dt>Goal acceptance criteria</dt><dd>${escape(g.criteria||'Not provided')}</dd></div><div><dt>Assignment rationale</dt><dd>${escape(t.route_reason||'Match by required capability, permissions, and member availability.')}</dd></div></dl></details>${(t.artifacts||[]).length>1?`<details class="artifact-history"><summary>Output history <span>${t.artifacts.length}</span></summary>${t.artifacts.slice().reverse().map(a=>`<div class="output-label"><span>Submission ${a.attempt}</span><span>${date(a.created_at)}</span></div><pre class="output">${escape(textOutput(a.content))}</pre>`).join('')}</details>`:''}`;
}

function timeline(g) {
  const events=state.events.filter(e=>e.goal_id===g.id).slice().reverse();
  return events.length?`<ol class="run-event-list">${events.map(e=>`<li><span class="run-event-dot" aria-hidden="true"></span><div><p>${escape(e.message||e.type)}</p><time>${date(e.created_at)}</time></div></li>`).join('')}</ol>`:`<p class="run-no-activity">No activity yet. Execution events will appear here.</p>`;
}

function searchBox(placeholder) { return `<div class="search">${icon('search')}<input id="search-input" type="search" value="${escape(searchText)}" placeholder="${placeholder}" aria-label="${placeholder}"></div>`; }
function capabilitiesPage() {return heading('Capability catalog','Describe what people and Agents can do, including inputs, outputs, and execution steps.',`<div class="heading-actions">${isAdmin()?button('Define capability','new-capability','','','plus'):''}${button('Upload capability package','upload-skill','','primary','file')}</div>`)+`<div class="toolbar">${searchBox('Search capability names or descriptions')}<span class="toolbar-info">${state.capabilities.length} capabilities · Supports SKILL.md / JSON</span></div><div id="filter-results">${capabilityList()}</div>`;}
function capabilityList() {
  const list=state.capabilities.filter(c=>(c.name+' '+c.description).toLowerCase().includes(searchText.toLowerCase()));
  return list.length?`<div class="registry-list">${list.map(c=>{const providers=skillProvidersForCapability(c.id);return `<article class="capability-row"><div class="capability-icon">${icon('cube')}</div><div class="capability-content"><div class="capability-name"><h3>${escape(c.name)}</h3><small>${escape(c.id)}</small></div><p>${escape(c.description)}</p>${!c.details_restricted?`<div class="capability-contract"><div><span>Input</span>${escape(textOutput(c.inputs||c.input_schema))}</div><div><span>Output</span>${escape(textOutput(c.outputs||c.output_schema))}</div><div class="acceptance"><span>Acceptance criteria</span>${escape(textOutput(c.acceptance))}</div></div>`:'<p>Detailed instructions are visible only to the owner and administrators.</p>'}<div class="capability-row-actions">${button('View Skill specification','view-skill',`data-id="${escape(c.id)}"`,'small','book')}</div></div><div class="provider-area"><span>Providers / ${providers.length}</span>${providers.map(a=>`<button type="button" class="provider-chip provider-link${!a.available?' unavailable':''}" data-action="view-skill" data-id="${escape(c.id)}" data-actor="${escape(a.id)}">${icon(a.type==='human'?'person':'bot')}${escape(productName(a.name))}${!(a.permissions||[]).includes(c.id)?' (not authorized)':!a.available?' (inactive)':''}</button>`).join('') || '<div class="provider-chip">No executor assigned</div>'}</div></article>`;}).join('')}</div>`:empty('No matching capabilities','Try another search or upload a capability package.','search');
}
function actorsPage() {return heading('People & Agents','Review, verify, and authorize the capabilities offered by people and Agents.',(isAdmin()?`<div class="heading-actions">${button('Add Agent','new-actor','','','bot')}${button('Create member account','new-user','','primary','plus')}</div>`:''))+`<div class="notice">${icon('info')} Member capabilities are supported by evidence and review. Agent capabilities are supported by Skill specifications and testing. Registration, authorization, and tool connections are separate steps.</div><div class="toolbar">${searchBox('Search people or roles')}<span class="toolbar-info">${state.actors.filter(a=>a.type==='human'&&a.user_id).length} members · ${state.actors.filter(a=>a.type==='agent').length} Agents</span></div><div id="filter-results">${actorsList()}</div>`;}
function actorsList() {
  const list=state.actors.filter(a=>(a.type==='agent'||a.user_id)&&(a.name+' '+a.role).toLowerCase().includes(searchText.toLowerCase()));
  return list.length?`<div class="people-grid">${list.map(a=>`<article class="panel person"><div class="person-top"><div class="person-avatar ${a.type==='human'?'human':''}">${icon(a.type==='human'?'person':'bot')}</div><div><h3>${escape(productName(a.name))}</h3><p>${escape(a.role)}</p></div></div><div class="provider-status-line"><span class="pill">${a.type==='human'?'Member':'Agent'}</span>${a.type==='agent'?`<span class="pill">${state.settings.mode==='model'?'Model adapter':'Rule-based execution (no model calls)'}</span><small>Declared capability; not tested</small>`:`<small>${state.assessments.filter(x=>x.actor_id===a.id&&x.status==='verified').length} verified assessments</small>`}</div><p class="person-label">Capabilities and Skills</p><div class="actor-skills">${(a.capability_ids||[]).map(id=>`<button type="button" class="actor-skill" data-action="view-skill" data-id="${escape(id)}" data-actor="${escape(a.id)}"><strong>${escape(capability(id)?.name || id)}${(a.permissions||[]).includes(id)?'<span class="skill-permitted">Authorized</span>':''}</strong><span>${escape(capability(id)?.description || 'No capability description. Open the details.')}</span></button>`).join('') || '<p class="actor-skills-empty">No capabilities registered. Submit work evidence or upload a capability package.</p>'}</div>${(isAdmin()||a.id===currentUser().actor_id)?button('Upload Skill for this provider','upload-skill',`data-actor="${escape(a.id)}"`,'small','file'):''}<div class="person-status"><span>${a.available?'Available for assignment':'Assignment paused'}</span>${isAdmin()?button(a.available?'Deactivate':'Activate','toggle-actor',`data-id="${escape(a.id)}" data-available="${!a.available}"`,'small'):''}</div></article>`).join('')}</div>`:empty('No matching people','Try another search, or add members and Agents.','people');
}

function approvalsPage() {
  const list=pending().filter(t=>!state.goals.find(g=>g.id===t.goal_id)?.collaborative&&!coordinationTask(t.id)?.collaborative);
  return `<div class="notice">Accept an organization task and start work before updating progress, submitting a deliverable, or reviewing.${button('Open organization workspace','go-collaboration','','small primary','people')}</div>`+heading('Reviews','Legacy workflow actions are listed below. Handle shared tasks in the Organization workspace.',`<span class="pill ${list.length?'waiting_approval':''}">${list.length} pending items</span>`)+`<div class="notice">Manual tasks submit deliverables. Independent review nodes assess preceding results. Submission is not independent approval; add a separate review node where required. This page does not publish, send, or perform external actions.</div>`+(list.length?`<div class="approval-grid">${list.map(t=>{
    const g=state.goals.find(x=>x.id===t.goal_id), predecessors=state.tasks.filter(x=>x.goal_id===t.goal_id&&x.status==='completed'),isReview=t.capability_id==='approve';
    return `<article class="panel approval-card"><div class="approval-header"><span class="pill waiting_approval">${isReview?'Independent review':'Manual task delivery'}</span><span class="priority">${escape(g?.priority || 'P2')}</span></div><h3>${escape(t.title)}</h3><p class="subtitle">Goal: ${escape(productName(g?.title || ''))}</p><p class="subtitle">Assigned to: ${escape(productName(actor(t.actor_id)?.name || 'Pending assignment'))}</p><dl class="info-grid"><div class="info-item wide"><dt>Goal acceptance criteria</dt><dd>${escape(g?.criteria || 'Not provided')}</dd></div></dl>${predecessors.filter(x=>g?.workflow==='custom'||x.capability_id==='draft'||x.capability_id==='review').map(x=>`<details ${x.capability_id==='review'?'open':''}><summary>${escape(x.title)} · ${states[x.status]}</summary><pre class="output">${escape(textOutput(x.output))}</pre></details>`).join('')}${!isReview?'<div class="notice">Submit your completed work and evidence. This records a deliverable; it does not constitute independent approval.</div>':''}<form class="approval-form" data-form="approval" data-task="${escape(t.id)}"><div class="form-error" role="alert"></div><label for="feedback-${escape(t.id)}">${isReview?'Review feedback':'Deliverable and evidence'} <span aria-hidden="true">*</span></label><textarea id="feedback-${escape(t.id)}" name="feedback" required minlength="2" maxlength="5000" placeholder="${isReview?'Explain the grounds for approval or the specific changes required.':'Provide the actual result, supporting evidence, and outstanding issues.'}"></textarea><div class="form-actions"><button class="button danger" type="submit" name="decision" value="reject">${isReview?'Reject and rework':'Return for action'}</button><button class="button success" type="submit" name="decision" value="approve">${icon('check')}${isReview?'Approve':'Submit deliverable'}</button></div></form></article>`;
  }).join('')}</div>`:`<section class="panel">${empty('No pending reviews','Tasks assigned to you will appear here for delivery or review.','shield',button('Back to Run overview','go-overview','','','dashboard'))}</section>`);
}

function memoriesPage() {return heading('Retrospectives','Review lessons, activity, and source tasks',`<a class="button" href="/api/export" download="organization-export.json">${icon('download')}Export data</a>`)+`<div class="toolbar">${searchBox('Search goals or retrospectives')}<span class="toolbar-info">${state.memories.length} retrospectives</span></div><div id="filter-results">${memoriesList()}</div>`;}
function memoriesList() {
  const list=state.memories.filter(m=>(m.title+' '+m.content).toLowerCase().includes(searchText.toLowerCase())).slice().reverse();
  return list.length?`<div class="memory-list">${list.map(m=>`<article class="panel memory-entry"><div class="memory-header"><h3>${escape(m.title)}</h3><span class="pill">${m.mode==='model'?'Model execution record':'Rule-based execution record'}</span></div><div class="memory-meta"><span>${date(m.created_at)}</span><span>Source goal: ${escape(productName(state.goals.find(g=>g.id===m.goal_id)?.title || m.goal_id))}</span></div><pre class="output">${escape(textOutput(m.content))}</pre><div class="memory-actions">${button('View source tasks','open-goal',`data-id="${escape(m.goal_id)}"`,'small','history')}</div></article>`).join('')}</div>`:`<section class="panel">${empty('No retrospectives','When a goal has been reviewed, its conclusions and source tasks appear here.','book',button('Run a goal','go-overview','','','play'))}</section>`;
}

function showDialog(kind, id) {
  let title='', intro='', form='';
  if(kind==='goal') {
    title='Create organization goal';intro='Create a shared organization goal. Its name, workflow, assignments, and public progress are visible to all members. Private documents and deliverables remain permission-controlled.';
    form=`<div class="form-field"><label for="goal-title">Goal name</label><input id="goal-title" name="title" required maxlength="160" placeholder="For example: Plan customer growth for next quarter"></div><div class="form-field"><label for="goal-brief">Background and input documents</label><textarea id="goal-brief" name="brief" required maxlength="20000" placeholder="Describe the situation, constraints, available information, and intended audience."></textarea><small>Provide only information this task is allowed to use. Available tools and document access depend on the current configuration.</small></div><div class="form-field"><label for="goal-criteria">Acceptance criteria</label><textarea id="goal-criteria" name="criteria" required maxlength="10000" placeholder="For example: Three recommendations, each with an owner, schedule, risks, and validation method."></textarea></div><div class="form-two"><div class="form-field"><label for="goal-priority">Priority</label><select id="goal-priority" name="priority"><option value="P0">P0 · Urgent</option><option value="P1">P1 · High</option><option value="P2" selected>P2 · Normal</option><option value="P3">P3 · Low</option></select></div><div class="form-field"><label for="goal-budget">Agent call budget</label><input id="goal-budget" name="budget" type="number" min="1" max="1000" value="12" required><small>A complete standard workflow uses 4 calls. Allow extra calls for rework.</small></div></div><div class="notice">Creates: Requirements analysis → Draft → Quality review → Human review → Retrospective. This uses a fixed workflow template.</div>`;
    form+=`<details class="custom-workflow"><summary>Custom workflow (optional)</summary><p>Leave blank to use the five-step template. Enter a JSON array. Each node contains key, title, capability_id, depends_on and risk. depends_on references a node key; High-risk nodes require an authorized human executor.</p><p>Available capability IDs: ${state.capabilities.map(c=>`<code>${escape(c.id)}</code>`).join(', ')}. Workflows without a human review node are marked as not independently reviewed in the retrospective.</p><label for="goal-steps">Task dependency configuration</label><textarea id="goal-steps" name="steps" rows="9" spellcheck="false" placeholder='[{"key":"a","title":"Clarify the goal","capability_id":"analyze","depends_on":[],"risk":"low"},{"key":"b","title":"Human review","capability_id":"approve","depends_on":["a"],"risk":"high"}]'></textarea></details>`;
  } else if(kind==='capability') {
    title='Register atomic capability';intro='Describe a reusable capability with clear inputs, outputs, and acceptance criteria.';
    form=[['name','Capability name','For example: Analyze user interviews'],['description','Capability description','Describe what the capability does and its limits.'],['input_schema','Input requirements','For example: Interview transcripts with sources and an analysis goal.'],['output_schema','Output requirements','For example: Findings, evidence citations, and hypotheses to validate.'],['acceptance','Acceptance criteria','For example: Link every finding to at least one source record.']].map(([name,label,placeholder])=>`<div class="form-field"><label for="cap-${name}">${label}</label>${name==='name'?`<input id="cap-${name}" name="${name}" required maxlength="160" placeholder="${placeholder}">`:`<textarea id="cap-${name}" name="${name}" required maxlength="3000" placeholder="${placeholder}"></textarea>`}</div>`).join('');
  } else if(kind==='actor') {
    title='Add Agent';intro='Register Agent capabilities and execution permissions. Add people with Create member account, then verify their capabilities using work evidence.';
    form=`<div class="form-two"><div class="form-field"><label for="actor-name">Name</label><input id="actor-name" name="name" required maxlength="100" placeholder="For example: Market research Agent"></div><div class="form-field"><label for="actor-type">Executor type</label><select id="actor-type" name="actor_type"><option value="agent">Agent</option></select></div></div><div class="form-field"><label for="actor-role">Role and responsibilities</label><input id="actor-role" name="role" required maxlength="300" placeholder="For example: Analyze goals and business documents to produce traceable conclusions"></div><fieldset><legend>Registered capabilities</legend><div class="checkbox-list">${state.capabilities.filter(c=>c.id!=='approve').map(c=>`<label><input type="checkbox" name="capability_ids" value="${escape(c.id)}">${escape(c.name)}</label>`).join('')}</div></fieldset><fieldset><legend>Authorized capabilities</legend><div class="checkbox-list">${state.capabilities.filter(c=>c.id!=='approve').map(c=>`<label><input type="checkbox" name="permissions" value="${escape(c.id)}">${escape(c.name)}</label>`).join('')}</div></fieldset><p class="dialog-intro">A capability must be both registered and authorized before it can be used for task routing. Agents use the execution adapter configured for this workspace.</p>`;
  } else if(kind==='budget') {
    const g=state.goals.find(g=>g.id===id);if(!g)return;
    title='Adjust call budget';intro=`${g.title}. Used ${g.used || 0} calls. Increase the budget to continue execution.`;
    form=`<input type="hidden" name="goal_id" value="${escape(id)}"><div class="form-field"><label for="budget-total">New total call limit</label><input id="budget-total" name="budget" type="number" min="${Math.max(1,g.used || 0)}" max="1000" value="${g.budget}" required><small>Set the total limit, not an additional allowance. Existing usage is preserved.</small></div>`;
  }
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body"><p class="dialog-intro">${escape(intro)}</p><form data-form="${kind}"><div class="form-error" role="alert"></div>${form}<div class="form-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary">${{goal:'Create goal',capability:'Register capability',actor:'Add executor',budget:'Save budget'}[kind]}</button></div></form></div>`;
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
  if(action==='step')return act({type:'step',goal_id:id},'Execution status updated');
  if(action==='pause'||action==='resume')return act({type:action,goal_id:id},action==='pause'?'Goal paused':'Goal resumed');
  if(action==='retry')return act({type:'retry',task_id:id},'Retry requested. Check the task status.');
  if(action==='toggle-actor')return act({type:'set_actor_available',actor_id:id,available:el.dataset.available==='true'},el.dataset.available==='true'?'Executor activated':'Executor deactivated');
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
  if(kind==='approval') {const decision=event.submitter?.value;if(!['approve','reject'].includes(decision))return;const isReview=state.tasks.find(t=>t.id===form.dataset.task)?.capability_id==='approve';return act({type:decision,task_id:form.dataset.task,feedback:get('feedback')},decision==='approve'?(isReview?'Approved. Downstream tasks can continue.':'Deliverable submitted. Continue to the review node if independent review is required.'):(isReview?'Rejected. Affected tasks will be rerun.':'Returned for action. Feedback recorded.'),{errorTarget:form.querySelector('.form-error')});}
  if(kind==='goal') {
    const payload={type:'create_goal',collaborative:true,title:get('title'),brief:get('brief'),criteria:get('criteria'),priority:get('priority'),budget:Number(get('budget'))};
    if(get('steps')) {
      try { payload.steps=JSON.parse(get('steps')); if(!Array.isArray(payload.steps))throw new Error('Must be an array'); }
      catch {const error=form.querySelector('.form-error');error.textContent='The custom workflow is not a valid JSON  array. Check double quotes, commas, and brackets. Your input has been preserved.';error.setAttribute('tabindex','-1');error.focus();return;}
    }
    return act(payload,'Organization goal created. Its collaboration status is visible to all members.',{close:true,route:'collaboration'});
  }
  if(kind==='budget')return act({type:'set_budget',goal_id:get('goal_id'),budget:Number(get('budget'))},'Call budget updated',{close:true});
  if(kind==='capability')return act({type:'add_capability',...Object.fromEntries(['name','description','input_schema','output_schema','acceptance'].map(key=>[key,get(key)]))},'Capability registered',{close:true});
  if(kind==='actor')return act({type:'add_actor',name:get('name'),role:get('role'),actor_type:get('actor_type'),capability_ids:data.getAll('capability_ids'),permissions:data.getAll('permissions')},'Executor added',{close:true});
});
dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
window.addEventListener('hashchange',()=>{searchText='';if(state)render();});
