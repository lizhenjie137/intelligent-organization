"use strict";

const assessmentNames={claimed:'Self-reported',suggested:'Suggested',verified:'Verified',rejected:'Not verified'};
const assessmentBadge=status=>`<span class="assessment-badge ${escape(status)}">${escape(assessmentNames[status] || status)}</span>`;
const levelNames=['','Basic understanding','Works independently','Proficient','Guides others','Expert in complex cases'];
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
  app.innerHTML=`<div class="auth-layout"><section class="auth-story"><div class="auth-brand"><img src="/brand-mark.svg" alt="" width="32" height="32"><span>Xiaolajiao <small>Intelligent Organization</small></span></div><div class="auth-story-content"><span class="auth-label">Organization workspace</span><h1>Clear goals.<br>Coordinated delivery.</h1><p>Manage goals and tasks, capture interim results,<br>and keep handoffs and reviews traceable.</p><div class="auth-chain"><div>${icon('target')}<span><strong>Shared goals</strong><small>Define goals and owners</small></span></div><div>${icon('people')}<span><strong>Collaborative delivery</strong><small>Share progress and deliverables</small></span></div><div>${icon('shield')}<span><strong>Independent review</strong><small>Verify completed work independently</small></span></div></div></div><small class="auth-foot">Organization workspace · Locally stored data</small></section><section class="auth-form-panel"><div class="auth-form-wrap auth-account-access"><div class="auth-mode-switch" role="group" aria-label="Account access"><button type="button" data-auth-mode="login" aria-controls="auth-account-form" aria-pressed="${!registering}">Login</button><button type="button" data-auth-mode="register" aria-controls="auth-account-form" aria-pressed="${registering}">Register</button></div><h2>${registering?(setup?'Create administrator account':'Create a local account'):'Sign in to workspace'}</h2><p>${registering?(setup?'The first account becomes a workspace administrator. If someone registers first, your account will be a member.':'Register to join the workspace. Capability verification and execution permissions remain administrator-managed.'):'Use your local account for this workspace to continue.'}</p><form id="auth-account-form" data-form="${registering?'auth-register':'auth-login'}" aria-label="${registering?'Register a local account':'Sign in with a local account'}"><div class="form-error" role="alert"></div>${registering?'<div class="form-field"><label for="auth-display">Name or display name</label><input id="auth-display" name="display_name" maxlength="80" autocomplete="name" required placeholder="For example: Alex Chen"></div>':''}<div class="form-field"><label for="auth-username">Username</label><input id="auth-username" name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\\-]{3,40}" autocomplete="username" spellcheck="false" required placeholder="3–40 letters, numbers, periods, underscores, or hyphens"></div><div class="form-field"><label for="auth-password">Password</label><input id="auth-password" name="password" type="password" ${registering?'minlength="12" aria-describedby="auth-password-help"':''} maxlength="256" autocomplete="${registering?'new-password':'current-password'}" required placeholder="${registering?'Choose a password of at least 12 characters':'Enter your password'}">${registering?'<small id="auth-password-help">Use 12–256 characters. Paste and password managers are supported.</small>':''}</div>${registering?'<div class="form-field"><label for="auth-confirm-password">Confirm password</label><input id="auth-confirm-password" name="confirm_password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required aria-describedby="auth-confirm-error" aria-invalid="false" placeholder="Enter your password again"><small id="auth-confirm-error" class="auth-field-error" hidden>The passwords do not match. Check them and try again.</small></div>':''}<button class="button primary auth-submit" type="submit"><span data-auth-submit-label>${registering?(setup?'Register administrator and continue':'Register and continue'):'Sign in to workspace'}</span>${icon('arrow')}</button></form><p class="auth-help auth-local-help"><strong>Local accounts</strong><span>Accounts are stored on the computer hosting this workspace. Passwords are stored as salted hashes. No email or cloud account is required. The first account is a workspace administrator; later accounts are members.</span></p></div></section></div>`;
  const form=app.querySelector('form');
  for(const [name,value] of Object.entries(authDrafts[authViewMode])){const field=form.elements.namedItem(name);if(field)field.value=value;}
  if(focusMode)app.querySelector(`[data-auth-mode="${authViewMode}"]`)?.focus();
}


let matrixProviderFilter='all';
function matrixPage() {
  const humans=state.actors.filter(a=>a.type==='human'&&a.user_id&&(isAdmin()||a.id===currentUser().actor_id)),agents=state.actors.filter(a=>a.type==='agent');
  return heading('Capability matrix','View member capabilities, verification, and execution permissions.',`<div class="heading-actions">${button('Claim a capability','claim-capability','','','plus')}${button('Upload capability package','upload-skill','','primary','file')}</div>`)+
    `<section class="capability-overview"><div><strong>${humans.length}</strong><span>${isAdmin()?'member identities':'visible members'}</span></div><div><strong>${agents.length}</strong><span>Agent providers</span></div><div><strong>${state.capabilities.length}</strong><span>atomic capabilities</span></div><div><strong>${state.skill_packages.length}</strong><span>imported Skill packages</span></div><p>${icon('shield')}Capability verification and execution permissions are managed separately.</p></section><div class="knowledge-summary"><div class="scope-tabs" role="group" aria-label="Provider type">${[['all','All providers'],['human','Member'],['agent','Agent']].map(([value,label])=>`<button type="button" data-action="matrix-filter" data-id="${value}" class="${matrixProviderFilter===value?'active':''}" aria-pressed="${matrixProviderFilter===value}">${label}</button>`).join('')}</div><span>Select a capability to view its description and permissions</span></div>
    <div class="toolbar">${searchBox('Search members, Agents, or roles')}<div class="matrix-legend"><span class="assessment-badge claimed">Self-reported</span><span class="assessment-badge verified">Verified</span><span class="assessment-badge agent-declared">Agent declaration</span><span class="permission-mark">${icon('lock')}Authorized</span></div></div><div id="filter-results">${matrixList()}</div><p class="matrix-note">Member capabilities are assessed at L1–L5. Agent capabilities still require verification, and tools must be connected separately.</p>`;
}
function matrixCapabilities() {
  const score=id=>state.assessments.filter(a=>a.capability_id===id).length*2+state.skill_packages.filter(p=>p.capability_id===id).length;
  return state.capabilities.slice().sort((a,b)=>score(b.id)-score(a.id));
}
function matrixList() {
  const people=state.actors.filter(a=>(a.type==='agent'||a.type==='human'&&a.user_id&&(isAdmin()||a.id===currentUser().actor_id))&&(matrixProviderFilter==='all'||a.type===matrixProviderFilter)&&(a.name+' '+a.role).toLowerCase().includes(searchText.toLowerCase())).sort((a,b)=>(a.type==='human'?0:1)-(b.type==='human'?0:1));
  if(!people.length)return `<section class="panel">${empty('No matching capability providers','Change the filters, or add members and Agents.','people')}</section>`;
  return `<div class="panel matrix-wrap"><table class="capability-matrix"><thead><tr><th scope="col">Provider / responsibilities</th>${matrixCapabilities().map(c=>`<th scope="col"><button class="column-skill-link" type="button" data-action="view-skill" data-id="${escape(c.id)}">${escape(c.name)}</button><small>${escape(c.id)}</small></th>`).join('')}</tr></thead><tbody>${people.map(p=>`<tr><th scope="row"><div class="matrix-person"><span class="person-avatar ${p.type==='human'?'human':''}">${icon(p.type==='human'?'person':'bot')}</span><div><strong>${escape(productName(p.name))}</strong><small>${p.type==='human'?'Member':'Agent'} · ${escape(p.role)}</small></div></div></th>${matrixCapabilities().map(c=>{
    const records=state.assessments.filter(a=>a.actor_id===p.id&&a.capability_id===c.id),approved=records.filter(a=>a.status==='verified').sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0],latest=approved||records.slice().sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0],allowed=(p.permissions||[]).includes(c.id),registered=(p.capability_ids||[]).includes(c.id),isAgent=p.type==='agent';
    const status=isAgent?(registered?'Agent declared':'Not registered'):(latest?assessmentNames[latest.status]+' L'+latest.level:registered?'Role registered':'No records');
    return `<td><button class="matrix-cell ${isAgent?(registered?'agent-declared':'unrecorded'):latest?escape(latest.status):registered?'preset':'unrecorded'}" type="button" data-action="assessment-detail" data-actor="${escape(p.id)}" data-capability="${escape(c.id)}" aria-label="${escape(productName(p.name))} — ${escape(c.name)}: ${status}"><span class="matrix-cell-main">${isAgent?(registered?`${icon('bot')}<span>Capability declared</span>`:'<span class="matrix-dash">—</span>'):latest?`<strong>L${latest.level}</strong><span>${assessmentNames[latest.status]}</span>`:registered?'<span>Role registered</span>':'<span class="matrix-dash">—</span>'}</span><span class="matrix-cell-bottom">${allowed?`${icon('lock')}Authorized`:registered||latest?'Not authorized':'View specification'}${!isAgent&&records.length>1?` · ${records.length} records`:''}</span>${isAgent&&registered?`<span class="agent-cell-note">${state.settings.mode==='model'?'Model mode':'Rule-based execution (no model calls)'} · Unverified</span>`:''}</button></td>`;
  }).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function myCapabilitiesPage() {
  const list=myAssessments(),me=myActor();
  return heading('My capabilities','Submit work evidence and track verification and permissions.',button('Claim a capability','claim-capability','','primary','plus'))+
    `<section class="panel personal-banner"><div class="personal-identity"><div class="person-avatar human">${icon('person')}</div><div><h2>${escape(productName(currentUser().display_name || me?.name))}</h2><p>${escape(me?.role || 'Member')}<span>Username: ${escape(currentUser().username)}</span></p></div></div><div class="personal-numbers"><span><b>${list.filter(a=>a.status==='verified').length}</b>Verified</span><span><b>${list.filter(a=>a.status==='claimed'||a.status==='suggested').length}</b>Awaiting review</span><span><b>${me?.permissions?.length || 0}</b>Authorized</span></div></section>
    <div class="capability-process"><span>${icon('file')}Import work documents</span>${icon('arrow')}<span>${icon('cube')}Claim or discover capabilities</span>${icon('arrow')}<span>${icon('shield')}Administrator verifies evidence</span>${icon('arrow')}<span>${icon('lock')}Grant execution permission separately</span></div><div class="toolbar">${searchBox('Search capabilities or claims')}<span class="toolbar-info">Document suggestions require human verification</span></div><div id="filter-results">${myCapabilitiesList()}</div>`;
}

function myCapabilitiesList() {
  const list=myAssessments().filter(a=>(capability(a.capability_id)?.name+' '+a.description).toLowerCase().includes(searchText.toLowerCase())).slice().reverse();
  return list.length?`<div class="assessment-list">${list.map(a=>assessmentCard(a)).join('')}</div>`:`<section class="panel">${empty('Add your first capability evidence','Import a work document, cite evidence, and submit a capability claim.','file',button('Import first document','new-document','','primary','plus'))}</section>`;
}

function assessmentCard(a) {
  const doc=documentById(a.evidence_doc_id),cap=capability(a.capability_id);
  return `<article class="panel assessment-card"><div class="assessment-card-head"><div><h3>${escape(cap?.name || a.capability_id)}</h3><p>${escape(personName(a.actor_id))} · ${date(a.created_at)}</p></div><div>${assessmentBadge(a.status)}<span class="level-chip">L${a.level} · ${levelNames[a.level]||''}</span></div></div><p class="assessment-description">${escape(a.description || 'A capability description and evidence are needed.')}</p><div class="evidence-block"><div>${icon('file')}<strong>Evidence excerpt</strong><span>${escape(doc?.title || 'Source document unavailable')}</span></div><blockquote>${escape(a.evidence_excerpt)}</blockquote></div>${a.review_note?`<div class="review-note"><strong>Review notes</strong><p>${escape(a.review_note)}</p></div>`:''}<div class="assessment-card-actions">${isAdmin()&&['claimed','suggested'].includes(a.status)?button('Review capability','review-assessment',`data-id="${escape(a.id)}"`,'small primary','shield'):''}${doc?button('View source document','open-document',`data-id="${escape(doc.id)}"`,'small','file'):''}${a.actor_id===currentUser().actor_id&&a.status==='suggested'?button('Complete and submit claim','claim-capability',`data-id="${escape(a.capability_id)}" data-document="${escape(a.evidence_doc_id)}" data-assessment="${escape(a.id)}"`,'small','edit'):''}</div></article>`;
}

function knowledgePage() {
  return heading('Knowledge','Manage organization knowledge and personal work evidence.',button('Import document','new-document','','primary','plus'))+
    `<div class="knowledge-summary"><div class="scope-tabs" role="group" aria-label="Document scope">${[['all','All visible'],['organization','Organization knowledge'],['personal','Personal resources']].map(([id,label])=>`<button type="button" data-action="knowledge-scope" data-id="${id}" class="${knowledgeScope===id?'active':''}" aria-pressed="${knowledgeScope===id}">${label}</button>`).join('')}</div><span>${state.documents.length} visible documents</span></div><div class="toolbar">${searchBox('Search document titles or content')}<span class="toolbar-info">Supports .md / .txt · Imports a snapshot; source files are not synchronized</span></div><div id="filter-results">${knowledgeList()}</div>`;
}

function knowledgeList() {
  const list=state.documents.filter(d=>(knowledgeScope==='all'||d.scope===knowledgeScope)&&(d.title+' '+d.content).toLowerCase().includes(searchText.toLowerCase()));
  if(!list.length)return `<section class="panel">${empty('No documents yet','Import work notes, retrospectives, or methods for task reference and capability verification.','book',button('Import document','new-document','','primary','plus'))}</section>`;
  let selected=list.find(d=>d.id===selectedDocument)||list[0];selectedDocument=selected.id;
  return `<section class="panel knowledge-browser"><div class="document-list" aria-label="Documents">${list.map(d=>`<button type="button" class="document-item ${d.id===selected.id?'active':''}" data-action="select-document" data-id="${escape(d.id)}"><span class="document-item-title">${icon('file')}${escape(d.title)}</span><span class="document-meta"><span>${d.scope==='organization'?'Organization knowledge':'Personal resources'}</span><span>${date(d.created_at)}</span></span></button>`).join('')}</div><article class="document-preview"><div class="document-preview-head"><div><h2>${escape(selected.title)}</h2><p>${selected.scope==='organization'?'Organization-wide':'Personal resources'} · ${escape(selected.source_name || 'Pasted text')} · ${selected.content.length.toLocaleString('en-US')} characters</p></div><div class="heading-actions">${button('Discover capability suggestions','suggest-capabilities',`data-id="${escape(selected.id)}"`,'small primary','network')}${button('Use as claim evidence','claim-capability',`data-document="${escape(selected.id)}"`,'small','plus')}</div></div><div class="document-note">Suggestions use keyword matching. Add evidence and submit them for human verification.</div><pre class="document-content">${escape(selected.content)}</pre></article></section>`;
}

function workforceDialog(kind, options={}) {
  let title='',intro='',form='',submit='Save';
  if(kind==='document') {
    title='Import knowledge and work documents';intro='Import a text snapshot without synchronizing the source file. This saves the document only and does not call a model.';submit='Save document';
    form=`<div class="file-import-zone"><label for="document-file">${icon('file')}Choose an .md or .txt file</label><input id="document-file" type="file" accept=".md,.txt,text/plain,text/markdown"><span>Or paste content below · Up to 100,000 characters</span></div><div class="form-two"><div class="form-field"><label for="document-title">Document title</label><input id="document-title" name="title" maxlength="200" required placeholder="For example: Customer interview retrospective"></div><div class="form-field"><label for="document-scope">Visibility</label><select id="document-scope" name="scope"><option value="personal">Personal resources</option>${isAdmin()?'<option value="organization">Organization knowledge</option>':''}</select></div></div><input type="hidden" name="source_name" value="Pasted text"><div class="form-field"><label for="document-content">Document content</label><textarea id="document-content" name="content" rows="12" maxlength="100000" required placeholder="Paste work notes, methods, or project results. Include evidence of what you actually completed."></textarea></div><small class="form-note">${isAdmin()?'Organization knowledge is visible to members; personal resources retain their owner.':'Personal resources are for your use. Administrators can access them for capability review.'} Authorized tasks may reference these documents. If an external model is connected, provide only content permitted by your organization.</small>`;
  } else if(kind==='claim') {
    if(!state.documents.length){notify('First import a work document that can be cited.');workforceDialog('document');return;}
    title='Claim capability';intro='Select a capability and cite work evidence for administrator verification.';submit='Submit capability claim';
    const assessment=state.assessments.find(a=>a.id===options.assessment),capId=options.capability||assessment?.capability_id,docId=options.document||assessment?.evidence_doc_id||state.documents[0].id;
    form=`<div class="form-two"><div class="form-field"><label for="claim-capability">Claim capability</label><select id="claim-capability" name="capability_id" required>${state.capabilities.map(c=>`<option value="${escape(c.id)}" ${c.id===capId?'selected':''}>${escape(c.name)}</option>`).join('')}</select></div><div class="form-field"><label for="claim-level">Self-assessed level</label><select id="claim-level" name="level">${levelOptions(assessment?.level||2)}</select></div></div><div class="form-field"><label for="claim-description">Describe your experience</label><textarea id="claim-description" name="description" required maxlength="5000" placeholder="For example: Independently interviewed 12 users, analyzed their needs, and delivered a research report.">${escape(assessment?.description || '')}</textarea></div><div class="form-field"><label for="claim-document">Evidence source</label><select id="claim-document" name="evidence_doc_id">${state.documents.map(d=>`<option value="${escape(d.id)}" ${d.id===docId?'selected':''}>${escape(d.title)} (${d.scope==='organization'?'Organization':'Personal'})</option>`).join('')}</select></div><details class="evidence-source"><summary>Open the source and copy the relevant evidence</summary><pre id="claim-source" class="output">${escape(documentById(docId)?.content)}</pre></details><div class="form-field"><label for="claim-excerpt">Exact evidence excerpt</label><textarea id="claim-excerpt" name="evidence_excerpt" required maxlength="10000" placeholder="Copy an existing passage from the selected source. Do not rewrite it or add text.">${escape(assessment?.evidence_excerpt || '')}</textarea><small>The excerpt is checked against the source content on submission.</small></div>`;
  } else if(kind==='review') {
    const a=state.assessments.find(a=>a.id===options.id);if(!a)return;
    title='Verify member capability';intro=`${personName(a.actor_id)} / ${capability(a.capability_id)?.name || a.capability_id}`;submit='Save review decision';
    form=`<input type="hidden" name="assessment_id" value="${escape(a.id)}"><div class="evidence-block"><div>${icon('file')}<strong>${escape(documentById(a.evidence_doc_id)?.title || 'Source document')}</strong></div><blockquote>${escape(a.evidence_excerpt)}</blockquote></div><p class="assessment-description">${escape(a.description)}</p><div class="form-two"><div class="form-field"><label for="review-decision">Review decision</label><select id="review-decision" name="decision"><option value="verify">Evidence sufficient — verify</option><option value="reject">Evidence insufficient — do not verify</option></select></div><div class="form-field"><label for="review-level">Confirmed capability level</label><select id="review-level" name="level">${levelOptions(a.level)}</select></div></div><div class="form-field"><label for="review-note">Review rationale</label><textarea id="review-note" name="review_note" required maxlength="5000" placeholder="Explain the supported capability scope, limitations, and level."></textarea></div><div class="notice">After verification, grant execution permission separately in the capability details.</div>`;
  } else if(kind==='user') {
    title='Create member account';intro='The account can sign in and submit documents. Capability verification and authorization are required before task execution.';submit='Create member account';
    form=`<div class="form-field"><label for="user-display">Member name</label><input id="user-display" name="display_name" maxlength="80" required autocomplete="off" placeholder="For example: Jordan Lee"></div><div class="form-field"><label for="user-name">Username</label><input id="user-name" name="username" minlength="3" maxlength="40" pattern="[A-Za-z0-9_.\-]{3,40}" autocomplete="off" required placeholder="Letters, numbers, periods, underscores, or hyphens"></div><div class="form-field"><label for="user-password">Initial password</label><input id="user-password" name="password" type="password" minlength="12" maxlength="256" autocomplete="new-password" required placeholder="Choose a password of at least 12 characters"><small>Share the credentials with the member through an appropriate channel. The system does not send a notification.</small></div>`;
  }
  dialog.innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${title}</h2><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body"><p class="dialog-intro">${escape(intro)}</p><form data-form="workforce-${kind}"><div class="form-error" role="alert"></div>${form}<div class="form-actions"><button type="button" class="button" data-action="close-dialog">Cancel</button><button type="submit" class="button primary">${submit}</button></div></form></div>`;
  if(!dialog.open)dialog.showModal();dialog.querySelector('input:not([type="hidden"]):not([type="file"]),select,textarea')?.focus();
}

function showAssessmentDetail(actorId,capId) { showSkillDetail(capId,actorId); }

async function loadAccountList() {
  const main=document.getElementById('main');
  const container=document.createElement('section');container.id='account-list';container.className='panel account-panel';container.innerHTML='<div class="panel-header"><div><h2>Member accounts</h2><p>Each account is linked to an executor identity. Passwords are never displayed.</p></div></div><div class="empty">Loading accounts…</div>';
  main.querySelector('.toolbar')?.before(container);
  try {const result=await api('/api/auth/users');if(!document.getElementById('account-list'))return;container.innerHTML=`<div class="panel-header"><div><h2>Member accounts</h2><p>Manage member accounts and executor roles.</p></div><span class="pill">${result.users.length} accounts</span></div><table class="account-table"><thead><tr><th>Name</th><th>Username</th><th>Account role</th><th>Executor identity</th></tr></thead><tbody>${result.users.map(u=>`<tr><td>${escape(productName(u.display_name))}</td><td>${escape(u.username)}</td><td><span class="pill">${u.role==='admin'?'Workspace administrator':'Member'}</span></td><td>${escape(productName(actor(u.actor_id)?.name || u.actor_id))}</td></tr>`).join('')}</tbody></table>`;}
  catch(error){if(document.getElementById('account-list'))container.innerHTML=`<div class="empty">${escape(error.message)}</div>`;}
}

async function authAction(path,payload,form,success) {
  if(busy)return;busy=true;form.querySelectorAll('button').forEach(b=>b.disabled=true);
  const accountAction=form.dataset.form.startsWith('auth-'),label=form.querySelector('[data-auth-submit-label]'),originalLabel=label?.textContent;
  if(accountAction){captureAuthDraft();form.setAttribute('aria-busy','true');app.querySelectorAll('[data-auth-mode]').forEach(b=>b.disabled=true);if(label)label.textContent='Submitting…';}
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
  if(action==='grant-permission'){const ok=await act({type:'grant_permission',actor_id:el.dataset.actor,capability_id:el.dataset.capability,allowed:el.dataset.allowed==='true'},el.dataset.allowed==='true'?'Execution permission granted':'Execution permission revoked');if(ok)showAssessmentDetail(el.dataset.actor,el.dataset.capability);return;}
  if(action==='select-document'){selectedDocument=el.dataset.id;document.getElementById('filter-results').innerHTML=knowledgeList();return;}
  if(action==='open-document'){selectedDocument=el.dataset.id;knowledgeScope='all';searchText='';if(dialog.open)dialog.close();location.hash='knowledge';render();return;}
  if(action==='knowledge-scope'){knowledgeScope=el.dataset.id;render();return;}
  if(action==='suggest-capabilities')return act({type:'suggest_capabilities',document_id:el.dataset.id},'Local matching complete. View suggestions in My capabilities; suggestions are not verified capabilities.',{route:'my-capabilities'});
});

document.addEventListener('change',async event=>{
  if(event.target.id==='claim-document'){const doc=documentById(event.target.value);document.getElementById('claim-source').textContent=doc?.content||'';document.getElementById('claim-excerpt').value='';}
  if(event.target.id==='document-file') {
    const file=event.target.files?.[0];if(!file)return;
    try {if(!/\.(md|txt)$/i.test(file.name))throw new Error('Choose an .md or .txt text file.');if(file.size>600000)throw new Error('The file is too large. Split it into documents of at most 100,000 characters.');const content=await file.text();if(content.length>100000)throw new Error('The document exceeds 100,000 characters. Split it before importing.');document.getElementById('document-content').value=content;document.getElementById('document-title').value=file.name.replace(/\.(md|txt)$/i,'').slice(0,200);dialog.querySelector('[name="source_name"]').value=file.name;notify('File loaded. Review the content before saving.');}
    catch(error){dialog.querySelector('.form-error').textContent=error.message;}
  }
});

document.addEventListener('submit',async event=>{
  const form=event.target.closest('form[data-form]');if(!form)return;const kind=form.dataset.form;
  if(!kind.startsWith('auth-')&&!kind.startsWith('workforce-'))return;event.preventDefault();if(busy)return;
  const data=new FormData(form),get=name=>String(data.get(name)||'').trim();
  if(kind==='auth-register'){if(!validateAuthConfirmation(form,true))return;return authAction('/api/auth/register',{username:get('username'),display_name:get('display_name'),password:String(data.get('password')||'')},form);}
  if(kind==='auth-login'||kind==='auth-setup')return authAction(kind==='auth-setup'?'/api/auth/setup':'/api/auth/login',{username:get('username'),password:String(data.get('password')||''),...(kind==='auth-setup'?{display_name:get('display_name')}:{})},form);
  if(kind==='workforce-user')return authAction('/api/auth/users',{username:get('username'),display_name:get('display_name'),password:String(data.get('password')||'')},form,'Member account created and ready to sign in.');
  if(kind==='workforce-document')return act({type:'import_document',title:get('title'),content:String(data.get('content')||''),scope:get('scope'),source_name:get('source_name')},'Document saved. You can cite evidence and discover suggested capabilities.',{close:true,route:'knowledge'});
  if(kind==='workforce-claim')return act({type:'claim_capability',capability_id:get('capability_id'),level:Number(get('level')),description:get('description'),evidence_doc_id:get('evidence_doc_id'),evidence_excerpt:get('evidence_excerpt')},'Capability claim submitted for administrator verification.',{close:true,route:'my-capabilities'});
  if(kind==='workforce-review')return act({type:'review_assessment',assessment_id:get('assessment_id'),decision:get('decision'),level:Number(get('level')),review_note:get('review_note')},get('decision')==='verify'?'Capability verified. Execution permission must be granted separately.':'Review recorded. The claim was not verified.',{close:true});
});


document.addEventListener('focusout',event=>{
  if(event.target.id!=='auth-confirm-password')return;
  event.target.dataset.touched='true';validateAuthConfirmation(event.target.form);
});
document.addEventListener('input',event=>{
  if(!['auth-password','auth-confirm-password'].includes(event.target.id))return;
  const form=event.target.form;if(form?.dataset.form==='auth-register')validateAuthConfirmation(form);
});
