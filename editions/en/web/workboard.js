"use strict";

// Organization-visible work evidence; private task outputs stay in their existing views.
const workboardState={signature:'',pending:false,selectedTask:'',userSelected:false,draft:null,drafts:{},uploading:false,xhr:null,dialogSerial:0};
const workboardUpdates=taskId=>(coordinationData().work_updates||[]).filter(update=>!taskId||update.task_id===taskId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
const workboardHandoffs=taskId=>(coordinationData().handoffs||[]).filter(h=>!taskId||h.task_id===taskId||h.to_task_id===taskId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
const workboardAttachment=id=>(coordinationData().attachments||[]).find(a=>a.id===id);
const workboardHandoffName=status=>({pending:'Awaiting receipt',accepted:'Received',returned:'Returned for more information'})[status]||status;
const workboardActorName=id=>productName((coordinationData().actors||[]).find(a=>a.id===id)?.name||'Assigned member');
const workboardSize=size=>size>=1048576?(size/1048576).toFixed(1)+' MB':Math.max(1,Math.round(size/1024))+' KB';
function resetWorkboard() {
  workboardState.xhr?.abort();Object.assign(workboardState,{signature:'',pending:false,selectedTask:'',userSelected:false,draft:null,drafts:{},uploading:false,xhr:null});workboardState.dialogSerial++;
}
function workboardScopeTasks() {
  return (coordinationData().tasks||[]).filter(task=>(coordinationFilters.goal==='all'||task.goal_id===coordinationFilters.goal)&&(coordinationFilters.actor==='all'||(coordinationFilters.actor==='unassigned'?!task.actor_id:task.actor_id===coordinationFilters.actor))&&(coordinationFilters.phase==='all'||coordinationPhase(task)===coordinationFilters.phase));
}
function workboardShellHtml() {
  return `<section class="panel workboard" aria-label="Organization deliverables board"><div class="panel-header"><div><h2>Deliverables & handoffs</h2><p>Progress updates, delivered files and next steps</p></div>${button('Publish update','workboard-publish','','small primary','plus')}</div><div class="workboard-update" id="workboard-update" hidden><span>Deliverables have changed. Playback and your current input are preserved.</span>${button('Load latest deliverables','workboard-refresh','','small','refresh')}</div><div id="workboard-content">${workboardOverviewHtml()}</div></section>`;
}
function workboardOverviewHtml() {
  const tasks=workboardScopeTasks(),chosen=workboardState.userSelected?tasks.find(t=>t.id===workboardState.selectedTask):null,latest=workboardUpdates().find(u=>tasks.some(t=>t.id===u.task_id)),selected=chosen||tasks.find(t=>t.id===latest?.task_id)||tasks.find(t=>coordinationPhase(t)==='in_progress')||tasks.find(t=>coordinationPhase(t)!=='completed')||tasks[0];
  if(!chosen)workboardState.userSelected=false;
  if(!selected)return `<div class="workboard-empty"><strong>No tasks in this view</strong><p>Create a goal and assign tasks to see work status and published updates here.</p>${button('New organization goal','new-goal','','small','plus')}</div>`;
  workboardState.selectedTask=selected.id;
  return `<div class="workboard-browser"><div class="workboard-task-index"><div class="workboard-index-heading">Task deliverables<span>${tasks.length}</span></div><div class="workboard-task-strip" role="group" aria-label="View task deliverables">${tasks.map(t=>`<button type="button" data-action="workboard-select" data-id="${escape(t.id)}" class="${t.id===selected.id?'selected':''}" aria-pressed="${t.id===selected.id}"><strong>${escape(t.title)}</strong><span>${escape(productName(t.actor_name||'Unassigned'))}</span><span class="coordination-phase ${escape(coordinationPhase(t))}">${escape(coordinationPhases[coordinationPhase(t)]||coordinationPhase(t))}</span></button>`).join('')}</div></div><div class="workboard-task-surface">${workboardTaskHtml(selected)}</div></div>`;
}
function workboardTaskHtml(task) {
  const phase=coordinationPhase(task),percent=phase==='completed'?100:Math.min(99,Math.max(0,Number(task.progress)||0));
  const latest=workboardUpdates(task.id)[0],handoffs=workboardHandoffs(task.id),outgoing=handoffs.find(h=>h.task_id===task.id);
  return `<div class="workboard-layout"><div class="workboard-main"><div class="workboard-task-heading"><div class="workboard-task-title"><span>${escape(productName(coordinationGoal(task.goal_id)?.title||'Organization goal'))}</span><h3>${escape(task.title)}</h3>${productSourceLabel(coordinationGoal(task.goal_id))?`<span class="record-origin">${escape(productSourceLabel(coordinationGoal(task.goal_id)))}</span>`:''}</div><div class="workboard-owner">${icon(task.actor_type==='agent'?'bot':'person')}<div><span class="workboard-label">Current assignee</span><strong>${escape(productName(task.actor_name||'Unassigned'))}</strong></div></div></div>${latest?workboardReportHtml(latest):`<div class="workboard-no-media"><div>${icon('file')}</div><strong>No published update yet</strong><p>${escape(productProgress(task.public_note||task.progress_note||'Publish a progress update and attach files so the next collaborator knows how to continue.',coordinationGoal(task.goal_id)))}</p>${task.can_publish?button('Publish an update for this task','workboard-publish',`data-id="${escape(task.id)}"`,'small','plus'):''}</div>`}<div class="workboard-footer-actions">${button('View deliverable and handoff timeline','workboard-detail',`data-id="${escape(task.id)}"`,'small','history')}${task.can_publish&&latest?button('Publish another update','workboard-publish',`data-id="${escape(task.id)}"`,'small','plus'):''}${task.can_handoff&&latest?button('Hand off to the next person','workboard-handoff',`data-id="${escape(task.id)}"`,'small','arrow'):''}</div></div><aside class="workboard-context"><section><span class="workboard-label">Current progress</span><div class="workboard-phase"><span class="coordination-phase ${escape(phase)}">${escape(coordinationPhases[phase]||phase)}</span><strong>${percent}%</strong></div><progress value="${percent}" max="100" aria-label="${escape(task.title)} progress">${percent}%</progress><p>${escape(latest?.stage||productProgress(task.public_note||task.progress_note||'No public update yet.',coordinationGoal(task.goal_id)))}</p></section><section><span class="workboard-label">Work direction</span><p>${escape(latest?.direction||'No direction published yet.')}</p></section><section><span class="workboard-label">Next step</span><p>${escape(latest?.next_step||(task.dependencies_ready===false?task.blocked_reason||'Waiting for dependencies to complete.':'No next step published yet.'))}</p></section><section><span class="workboard-label">Information needed</span><p class="workboard-material-needs">${escape(latest?.needs||'No additional information requested.')}</p></section><section><span class="workboard-label">Next handoff</span>${outgoing?`<strong>${escape(workboardActorName(outgoing.to_actor_id))} · ${escape(workboardHandoffName(outgoing.status))}</strong><p>${escape(coordinationTask(outgoing.to_task_id)?.title||'Downstream task')}</p>${outgoing.invalid_reason?`<p>Cannot receive yet: ${escape(outgoing.invalid_reason)}</p>`:''}`:'<p>No handoff recorded yet.</p>'}${handoffs.filter(h=>h.can_accept||h.can_return).map(workboardReceiptActions).join('')}</section></aside></div>`;
}
function workboardReportHtml(update) {
  return `<article class="workboard-report"><h4>${escape(update.stage||'Progress update')}</h4><div class="workboard-report-meta"><span>${escape(productName(update.actor_name||update.author_name||'Organization member'))}</span><time>${date(update.created_at)}</time><span>Stage progress ${Number(update.progress)||0}%</span></div><p>${escape(update.summary||'')}</p>${workboardMediaHtml(update.attachment_ids||[])}</article>`;
}
function workboardMediaHtml(ids) {
  if(!ids.length)return '';
  return `<div class="workboard-media">${ids.map(id=>{const file=workboardAttachment(id);if(!file)return '<div class="workboard-file">Attachment unavailable. Refresh and try again.</div>';const content='/api/attachments/'+encodeURIComponent(file.id)+'/content',download=content+'?download=1';if(file.kind==='image')return `<figure><a href="${content}" target="_blank" rel="noopener" aria-label="Open image: ${escape(file.name)}"><img src="${content}" alt="${escape(file.name)}" loading="lazy"></a><figcaption>${escape(file.name)} · ${workboardSize(file.size)} <a href="${download}" download>Download</a></figcaption></figure>`;if(file.kind==='video')return `<figure><video src="${content}" controls preload="metadata" playsinline aria-label="${escape(file.name)}"></video><figcaption>${escape(file.name)} · ${workboardSize(file.size)} <a href="${download}" download>Download</a></figcaption></figure>`;return `<a class="workboard-file" href="${download}" download>${icon('file')}<span>${escape(file.name)}<small>${workboardSize(file.size)} · Download file</small></span></a>`;}).join('')}</div>`;
}
function workboardReceiptActions(handoff) {
  return `<div class="workboard-handoff"><strong>${escape(coordinationTask(handoff.task_id)?.title||'Upstream task')} → ${escape(coordinationTask(handoff.to_task_id)?.title||'Next task')}</strong><p>${escape(handoff.note||'Waiting to receive deliverable materials.')}</p><div class="heading-actions">${handoff.can_accept?button('Receive materials','workboard-respond',`data-id="${escape(handoff.id)}" data-decision="accept"`,'small primary','check'):''}${handoff.can_return?button('Return for more information','workboard-respond',`data-id="${escape(handoff.id)}" data-decision="return"`,'small'):''}</div></div>`;
}
function refreshWorkboard(force=false) {
  if(route()!=='collaboration')return;
  const area=document.getElementById('workboard-content');if(!area)return;
  const signature=JSON.stringify([coordinationFilters.goal,coordinationFilters.actor,coordinationFilters.phase,coordinationData().revision]);
  if(!force&&signature===workboardState.signature)return;
  const playing=Array.from(area.querySelectorAll('video,audio')).some(media=>!media.paused&&!media.ended);
  if(!force&&(playing||dialog.open||workboardState.uploading)){workboardState.pending=true;document.getElementById('workboard-update').hidden=false;return;}
  const strip=area.querySelector('.workboard-task-strip'),scrollLeft=strip?.scrollLeft||0,scrollTop=strip?.scrollTop||0;
  area.innerHTML=workboardOverviewHtml();const next=area.querySelector('.workboard-task-strip');if(next){next.scrollLeft=scrollLeft;next.scrollTop=scrollTop;}
  workboardState.signature=signature;workboardState.pending=false;document.getElementById('workboard-update').hidden=true;
}
function revealWorkboardSelection() {
  const strip=document.querySelector('#workboard-content .workboard-task-strip'),selected=strip?.querySelector('button.selected');
  if(!strip||!selected||!strip.clientHeight)return;
  const container=strip.getBoundingClientRect(),item=selected.getBoundingClientRect();
  if(item.top<container.top)strip.scrollTop-=container.top-item.top;
  else if(item.bottom>container.bottom)strip.scrollTop+=item.bottom-container.bottom;
}
function workboardDialog(title,subtitle,body) {
  workboardState.dialogSerial++;dialog.classList.add('workboard-dialog');
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${escape(title)}</h2><p class="dialog-subtitle">${escape(subtitle)}</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="Close window">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;
  if(!dialog.open)dialog.showModal();dialog.querySelector('input,textarea,select,button')?.focus();updateCoordinationChrome();
}
function workboardTimelineHtml(task) {
  const records=(task.history||[]).filter(h=>!['work_update_published','handoff_created','handoff_responded'].includes(h.type)).map(h=>({time:h.created_at,html:`<strong>${escape(productName(h.actor_name||'System'))} · ${escape(h.message||h.type)}</strong><small>${date(h.created_at)}</small>`}));
  for(const update of workboardUpdates(task.id))records.push({time:update.created_at,html:`<strong>Publish update</strong>${workboardReportHtml(update)}<p>Direction: ${escape(update.direction||'—')}<br>Next step: ${escape(update.next_step||'—')}<br>Information needed: ${escape(update.needs||'None requested')}</p>`});
  for(const h of workboardHandoffs(task.id)){
    records.push({time:h.created_at,html:`<strong>Deliverables handed off to ${escape(workboardActorName(h.to_actor_id))}</strong><small>${date(h.created_at)} · ${escape(coordinationTask(h.to_task_id)?.title||'Downstream task')}</small><p>${escape(h.note)}</p>${h.invalid_reason?`<p>Cannot receive yet: ${escape(h.invalid_reason)}</p>`:''}${h.update_snapshot?`<details><summary>View deliverable version at handoff</summary>${workboardReportHtml(h.update_snapshot)}</details>`:''}${(h.can_accept||h.can_return)?workboardReceiptActions(h):''}`});
    if(h.responded_at)records.push({time:h.responded_at,html:`<strong>${escape(workboardActorName(h.to_actor_id))} · ${escape(workboardHandoffName(h.status))}</strong><small>${date(h.responded_at)}</small><p>${escape(h.reply||'')}</p>`});
  }
  return `<div class="workboard-timeline">${records.sort((a,b)=>new Date(b.time)-new Date(a.time)).map(r=>`<article class="workboard-timeline-entry">${r.html}</article>`).join('')||'<p class="skill-muted">No progress recorded yet.</p>'}</div>`;
}
function openWorkboardDetail(taskId) {
  const task=coordinationTask(taskId);if(!task)return;
  workboardDialog('Task deliverables & handoffs',task.title,`<div class="workboard-publish-note">This view shows updates explicitly published to the organization. Private documents and original deliverable content remain permission-controlled. Receiving a handoff acknowledges the materials, not task approval.</div>${workboardTaskHtml(task)}<h3 class="workboard-history-title">Work timeline</h3>${workboardTimelineHtml(task)}`);
}
function workboardSelectPublishTask() {
  const tasks=(coordinationData().tasks||[]).filter(t=>t.can_publish);
  workboardDialog('Choose a task to publish an update','Only tasks you may publish are listed here.',tasks.length?`<div class="workboard-task-chooser">${tasks.map(t=>button(`${escape(t.title)} · ${escape(productName(t.actor_name||'Unassigned'))}`,'workboard-publish',`data-id="${escape(t.id)}"`,'','plus')).join('')}</div>`:empty('No tasks available to publish','Once you are assigned and have started authorized work, you can publish progress updates.','file'));
}
function workboardDraft(kind,id,decision='') {
  const key=kind+':'+id+':'+decision;
  if(!workboardState.drafts[key]){
    const task=coordinationTask(id),latest=workboardUpdates(id)[0];
    workboardState.drafts[key]=kind==='publish'?{kind,key,task_id:id,version:task.version,direction:latest?.direction||'',stage:'',progress:coordinationPhase(task)==='completed'?100:task.progress||0,summary:'',next_step:'',needs:latest?.needs||'',files:[]}:
      kind==='handoff'?{kind,key,task_id:id,version:task.version,update_id:latest?.id||'',to_task_id:'',note:''}:
      {kind,key,handoff_id:id,version:(coordinationData().handoffs||[]).find(h=>h.id===id)?.version,decision,reply:''};
  }
  workboardState.draft=workboardState.drafts[key];return workboardState.draft;
}
function workboardFormFrame(d,body,label) {
  return `<form data-form="workboard" data-kind="${d.kind}" data-version="${d.version}"><div class="form-error" tabindex="-1"></div><div class="coordination-dialog-update" hidden><span></span><button type="button" class="button small" data-action="workboard-rebase">Load latest state and keep draft</button></div>${body}<div class="form-actions"><button type="button" class="button" data-action="close-dialog">Close and keep draft</button><button type="submit" class="button primary" data-coordination-write>${label}</button></div></form>`;
}
function openWorkboardPublish(taskId) {
  if(!taskId)return workboardSelectPublishTask();
  const task=coordinationTask(taskId);if(!task?.can_publish){notify('This task cannot publish updates right now. Refresh and try again.',true);return;}
  const d=workboardDraft('publish',taskId),done=coordinationPhase(task)==='completed';
  const field=(name,label,limit,rows=2,required=true)=>`<div class="form-field"><label for="work-${name}">${label}${required?' *':''}</label><textarea id="work-${name}" name="${name}" rows="${rows}" maxlength="${limit}" ${required?'required':''}>${escape(d[name])}</textarea></div>`;
  workboardDialog('Publish update',task.title,workboardFormFrame(d,`<div class="notice">After publication, this update and its selected attachments are visible to everyone in the organization. Staged uploads are not public. Publish only materials suitable for sharing.</div><div class="workboard-latest-summary">${coordinationPublicDetail(task)}</div>${field('direction','Work direction: what are you working toward?',500)}<div class="form-two"><div class="form-field"><label for="work-stage">Current stage *</label><input id="work-stage" name="stage" required maxlength="80" value="${escape(d.stage)}" placeholder="For example: Draft complete; additional data needed"></div><div class="form-field"><label for="work-progress">Current progress (%) *</label><input id="work-progress" name="progress" type="number" min="0" max="${done?100:99}" required value="${done?100:Number(d.progress)||0}" ${done?'readonly':''}><small>${done?'Task complete; keep progress at 100%.':'Enter 0–99. Progress reaches 100% after review.'}</small></div></div>${field('summary','Completed work and deliverable summary',4000,4)}${field('next_step','What happens next?',2000)}${field('needs','What information is still needed? (optional)',2000,2,false)}<div class="workboard-upload-zone"><label for="work-files">Add images, videos or files</label><input id="work-files" type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt,.md,.csv,.json,.zip,.docx,.xlsx,.pptx"><small>Up to 10 attachments per update, each up to 32 MB. Images and MP4 / WebM videos can be previewed; other supported files can be downloaded. All attachments remain staged until you publish.</small><div id="work-upload-control" hidden>${button('Cancel current upload','workboard-cancel-upload','','small')}</div><ul id="work-upload-list" class="workboard-upload-list">${workboardUploadRows(d)}</ul></div><small class="form-note">Publish a new update with attachments when adding materials. Earlier records remain in the timeline. Publishing does not complete or approve the task.</small>`,'Publish to organization'));
  checkWorkboardDraftVersion();
}
function workboardUploadRows(d) {
  return d.files.map((row,index)=>`<li><div><strong>${escape(row.name)}</strong><small>${workboardSize(row.size)} · ${escape(row.status==='uploaded'?'Staged; not public yet':row.status==='uploading'?'Uploading '+row.percent+'%':row.error||'Waiting to upload')}</small>${row.status==='uploading'?`<progress value="${row.percent}" max="100" aria-label="${escape(row.name)} upload progress">${row.percent}%</progress>`:''}</div>${row.status!=='uploading'?`${row.status!=='uploaded'?button('Retry upload','workboard-retry-file',`data-index="${index}"`,'small'):''}${button('Remove','workboard-remove-file',`data-index="${index}"`,'small ghost')}`:''}</li>`).join('');
}
function updateWorkboardUploadRows() {
  const list=document.getElementById('work-upload-list');if(list&&workboardState.draft?.kind==='publish')list.innerHTML=workboardUploadRows(workboardState.draft);
  const control=document.getElementById('work-upload-control');if(control)control.hidden=!workboardState.uploading;
}
function openWorkboardHandoff(taskId) {
  const task=coordinationTask(taskId);if(!task?.can_handoff){notify('Only completed tasks eligible for handoff can pass on deliverables.',true);return;}
  const updates=workboardUpdates(taskId),choices=(coordinationData().tasks||[]).filter(t=>Array.isArray(task.handoff_target_ids)?task.handoff_target_ids.includes(t.id):(t.depends_on||[]).includes(taskId)&&t.actor_type==='human'&&t.actor_id&&coordinationPhase(t)!=='completed'&&!['paused','completed'].includes(coordinationGoal(t.goal_id)?.status));
  if(!updates.length||!choices.length){workboardDialog('Hand off to the next person',task.title,empty('No deliverable or receiving task is available for handoff','Publish an update first, and ask the owner to assign an employee to the direct downstream task.','arrow'));return;}
  const d=workboardDraft('handoff',taskId);
  workboardDialog('Hand off to the next person',task.title,workboardFormFrame(d,`<div class="notice">Pass completed upstream deliverables to the next task's assignee. Receiving only acknowledges the materials; it does not reassign, start or approve tasks, or bypass other dependencies.</div><div class="workboard-latest-summary">${coordinationPublicDetail(task)}</div><div class="form-field"><label for="work-update">Choose a deliverable version *</label><select id="work-update" name="update_id" required>${updates.map(u=>`<option value="${escape(u.id)}" ${u.id===d.update_id?'selected':''}>${escape(u.stage)} · ${date(u.created_at)}</option>`).join('')}</select></div><div class="form-field"><label for="work-to-task">Next task and recipient *</label><select id="work-to-task" name="to_task_id" required><option value="">Choose a direct downstream task</option>${choices.map(t=>`<option value="${escape(t.id)}" ${t.id===d.to_task_id?'selected':''}>${escape(t.title)} → ${escape(productName(t.actor_name))}</option>`).join('')}</select></div><div class="form-field"><label for="work-note">Handoff notes and next steps *</label><textarea id="work-note" name="note" required maxlength="2000" rows="5">${escape(d.note)}</textarea></div>`,'Send handoff'));
  checkWorkboardDraftVersion();
}
function openWorkboardResponse(handoffId,decision) {
  const h=(coordinationData().handoffs||[]).find(item=>item.id===handoffId);if(!h||(decision==='accept'?!h.can_accept:!h.can_return)){notify('Your account or the handoff status does not allow this action.',true);return;}
  const d=workboardDraft('respond',handoffId,decision),receiving=coordinationTask(h.to_task_id);
  workboardDialog(decision==='accept'?'Receive deliverable materials':'Return for more information',receiving?.title||'Downstream task',workboardFormFrame(d,`<div class="notice">This decision applies only to the handoff materials. Task acceptance, work and independent review still follow the original workflow.</div><div class="workboard-latest-summary"><div class="workboard-handoff"><strong>${escape(workboardActorName(h.from_actor_id))} → ${escape(workboardActorName(h.to_actor_id))}</strong><p>${escape(h.note)}</p><small>Handoff version v${h.version}</small></div>${h.update_snapshot?workboardReportHtml(h.update_snapshot):''}</div><div class="form-field"><label for="work-reply">${decision==='accept'?'Receipt notes':'Specific additions or revisions needed'} *</label><textarea id="work-reply" name="reply" required maxlength="2000" rows="5">${escape(d.reply)}</textarea></div>`,decision==='accept'?'Confirm receipt':'Return with feedback'));
  checkWorkboardDraftVersion();
}
function workboardConflict(message) {
  const form=dialog.querySelector('form[data-form="workboard"]');if(!form)return;
  form.dataset.conflicted='true';const notice=form.querySelector('.coordination-dialog-update');notice.hidden=false;notice.querySelector('span').textContent=message;const submit=form.querySelector('button[type="submit"]');submit.disabled=true;submit.dataset.versionBlocked='true';
}
function checkWorkboardDraftVersion() {
  const d=workboardState.draft,form=dialog.querySelector('form[data-form="workboard"]');if(!d||!form)return;
  const latest=d.kind==='respond'?(coordinationData().handoffs||[]).find(h=>h.id===d.handoff_id):coordinationTask(d.task_id);
  if(latest&&Number(latest.version)!==Number(d.version))workboardConflict('Another member updated this work. Your draft and staged attachments are preserved. Load the latest state and review it before submitting.');
}
function workboardFormError(message) {const box=dialog.querySelector('form[data-form="workboard"] .form-error');if(box){box.textContent=message;box.focus();}else notify(message,true);}
async function workboardSend(payload,message) {
  if(busy||!coordinationConnected()){workboardFormError('Wait for the connection to recover before submitting.');return;}
  const epoch=coordinationSync.epoch,d=workboardState.draft;busy=true;dialog.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=true);
  try{const snapshot=await api('/api/action',payload);if(epoch!==coordinationSync.epoch||snapshot.current_user?.id!==coordinationSync.userId)return;state=snapshot;normalize();coordinationApplySnapshot(snapshot);delete workboardState.drafts[d.key];workboardState.draft=null;busy=false;dialog.close();refreshWorkboard(true);patchCoordinationLive(true);notify(message);}
  catch(error){if(epoch!==coordinationSync.epoch)return;busy=false;if(error.status===409||error.code==='version_conflict'){workboardConflict('Version conflict detected. Your draft and attachments are preserved. Load and review the latest state before retrying.');await requestCoordinationRefresh();}else if(error instanceof TypeError){workboardConflict('Connection interrupted. The submission outcome is uncertain. Reconnect and load the latest state to check whether it was published before submitting again.');}else workboardFormError(error.message);}
  finally{if(epoch===coordinationSync.epoch){busy=false;const form=dialog.querySelector('form[data-form="workboard"]');if(form&&!form.dataset.conflicted)form.querySelector('button[type="submit"]').disabled=false;updateCoordinationChrome();}}
}
function uploadWorkboardFile(row,d) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();workboardState.xhr=xhr;
    xhr.open('POST','/api/tasks/'+encodeURIComponent(d.task_id)+'/attachments?expected_version='+encodeURIComponent(d.version)+'&filename='+encodeURIComponent(row.name));
    xhr.setRequestHeader('Content-Type',row.file.type||'application/octet-stream');xhr.timeout=300000;
    xhr.upload.onprogress=event=>{if(event.lengthComputable){row.percent=Math.round(event.loaded/event.total*100);updateWorkboardUploadRows();}};
    xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText);}catch{reject(new Error('The upload service did not return a valid result. Try again.'));return;}if(xhr.status>=200&&xhr.status<300&&result.attachment){resolve(result.attachment);return;}const error=new Error(result.error||'File upload failed.');error.status=xhr.status;reject(error);};
    xhr.onerror=()=>reject(new Error('Upload connection interrupted. The file has not been published; you can retry later.'));xhr.ontimeout=()=>reject(new Error('Upload timed out. The file has not been published.'));xhr.onabort=()=>reject(new Error('Upload canceled. The file has not been published.'));xhr.send(row.file);
  });
}
async function runWorkboardUploads(rows,d) {
  if(busy||workboardState.uploading)return;
  workboardState.uploading=true;busy=true;const epoch=coordinationSync.epoch;dialog.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=true);
  try{for(const row of rows){if(epoch!==coordinationSync.epoch)break;row.status='uploading';row.percent=0;row.error='';updateWorkboardUploadRows();try{row.attachment=await uploadWorkboardFile(row,d);row.status='uploaded';}catch(error){row.status='failed';row.error=error.message;if(error.status===409)workboardConflict('The task version changed. Uploaded attachments remain staged. Load the latest state before retrying unsuccessful files.');if(error.status===401){coordinationExpire(epoch);break;}if(error.status===409||error.message.startsWith('Upload canceled'))break;}finally{updateWorkboardUploadRows();}}}
  finally{if(epoch===coordinationSync.epoch){workboardState.uploading=false;workboardState.xhr=null;busy=false;updateWorkboardUploadRows();const form=dialog.querySelector('form[data-form="workboard"]');if(form&&!form.dataset.conflicted)form.querySelector('button[type="submit"]').disabled=false;requestCoordinationRefresh();}}
}
document.addEventListener('input',event=>{const form=event.target.closest('form[data-form="workboard"]'),d=workboardState.draft;if(form&&d&&Object.hasOwn(d,event.target.name))d[event.target.name]=event.target.value;});
document.addEventListener('change',event=>{
  const d=workboardState.draft;if(!d)return;
  if(event.target.closest('form[data-form="workboard"]')&&Object.hasOwn(d,event.target.name))d[event.target.name]=event.target.value;
  if(event.target.id!=='work-files'||busy)return;
  const rows=[];for(const file of event.target.files){if(d.files.length>=10){workboardFormError('You can publish up to 10 attachments per update. Remove some files first.');break;}if(file.size>32*1024*1024){workboardFormError(file.name+' exceeds 32 MB. Compress it or choose a smaller file.');continue;}if(!/\.(png|jpe?g|gif|webp|mp4|webm|pdf|txt|md|csv|json|zip|docx|xlsx|pptx)$/i.test(file.name)){workboardFormError(file.name+' is not a supported file type. Choose a listed image, video or document format.');continue;}const row={file,name:file.name,size:file.size,status:'queued',percent:0,error:'',attachment:null};d.files.push(row);rows.push(row);}event.target.value='';if(rows.length)runWorkboardUploads(rows,d);
});
document.addEventListener('click',async event=>{
  const el=event.target.closest('[data-action]');if(!el)return;const action=el.dataset.action,id=el.dataset.id;
  if(action==='workboard-cancel-upload'){workboardState.xhr?.abort();return;}
  if(busy)return;
  if(action==='workboard-select'){workboardState.selectedTask=id;workboardState.userSelected=true;refreshWorkboard(true);revealWorkboardSelection();}
  if(action==='workboard-refresh')refreshWorkboard(true);
  if(action==='workboard-publish')openWorkboardPublish(id);
  if(action==='workboard-detail')openWorkboardDetail(id);
  if(action==='workboard-handoff')openWorkboardHandoff(id);
  if(action==='workboard-respond')openWorkboardResponse(id,el.dataset.decision);
  if(action==='workboard-remove-file'){workboardState.draft?.files.splice(Number(el.dataset.index),1);updateWorkboardUploadRows();}
  if(action==='workboard-retry-file'){const d=workboardState.draft,row=d?.files[Number(el.dataset.index)];if(row)runWorkboardUploads([row],d);}
  if(action==='workboard-rebase'){
    try{await requestCoordinationRefresh();const d=workboardState.draft,form=dialog.querySelector('form[data-form="workboard"]');if(!d||!form||!coordinationConnected())return;const latest=d.kind==='respond'?(coordinationData().handoffs||[]).find(h=>h.id===d.handoff_id):coordinationTask(d.task_id);if(!latest)return;
      if(d.kind==='respond'){workboardFormError('Handoff materials or status may have changed. Your reply draft is preserved. Close and reopen the handoff to review the latest deliverable version before deciding.');d.version=latest.version;return;}
      if(!(d.kind==='publish'?latest.can_publish:latest.can_handoff)){workboardFormError('The task moved to another state and this action is unavailable. Your input and attachments are preserved.');return;}
      form.querySelector('.workboard-latest-summary').innerHTML=coordinationPublicDetail(latest);d.version=latest.version;if(coordinationPhase(latest)==='completed'&&d.kind==='publish'){d.progress=100;form.elements.progress.value=100;form.elements.progress.max=100;form.elements.progress.readOnly=true;}
      form.dataset.version=String(latest.version);delete form.dataset.conflicted;form.querySelector('.coordination-dialog-update').hidden=true;delete form.querySelector('button[type="submit"]').dataset.versionBlocked;form.querySelector('button[type="submit"]').disabled=false;notify('Latest state loaded. Your draft and attachments are unchanged; review them before submitting.');
    }catch(error){workboardFormError(error.message);}
  }
});
document.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form="workboard"]');if(!form)return;event.preventDefault();const d=workboardState.draft;if(!d||busy||form.dataset.conflicted==='true')return;
  const values=Object.fromEntries(new FormData(form));for(const [key,value] of Object.entries(values))if(Object.hasOwn(d,key))d[key]=value;
  if(d.kind==='publish'){if(d.files.some(row=>row.status!=='uploaded')){workboardFormError('Some files have not uploaded successfully. Retry or remove them before publishing.');return;}return workboardSend({type:'publish_work_update',task_id:d.task_id,expected_version:d.version,direction:d.direction.trim(),stage:d.stage.trim(),progress:Number(d.progress),summary:d.summary.trim(),next_step:d.next_step.trim(),needs:d.needs.trim(),attachment_ids:d.files.map(row=>row.attachment.id)},'Update published. Organization members can view the summary and attachments.');}
  if(d.kind==='handoff')return workboardSend({type:'create_handoff',task_id:d.task_id,expected_version:d.version,update_id:d.update_id,to_task_id:d.to_task_id,note:d.note.trim()},'Deliverables handed off to the next assignee. Awaiting their acknowledgment.');
  if(d.kind==='respond')return workboardSend({type:'respond_handoff',handoff_id:d.handoff_id,expected_version:d.version,decision:d.decision,reply:d.reply.trim()},d.decision==='accept'?'Receipt confirmed. The task continues through its original workflow.':'Returned for additional information. The reason has been recorded.');
});
dialog.addEventListener('close',()=>{dialog.classList.remove('workboard-dialog');workboardState.dialogSerial++;if(workboardState.pending)refreshWorkboard();});
