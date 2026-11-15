"use strict";

// Organization-visible work evidence; private task outputs stay in their existing views.
const workboardState={signature:'',pending:false,selectedTask:'',userSelected:false,draft:null,drafts:{},uploading:false,xhr:null,dialogSerial:0};
const workboardUpdates=taskId=>(coordinationData().work_updates||[]).filter(update=>!taskId||update.task_id===taskId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
const workboardHandoffs=taskId=>(coordinationData().handoffs||[]).filter(h=>!taskId||h.task_id===taskId||h.to_task_id===taskId).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at));
const workboardAttachment=id=>(coordinationData().attachments||[]).find(a=>a.id===id);
const workboardHandoffName=status=>({pending:'待接收',accepted:'已接收',returned:'退回补充'})[status]||status;
const workboardActorName=id=>productName((coordinationData().actors||[]).find(a=>a.id===id)?.name||'已分派成员');
const workboardSize=size=>size>=1048576?(size/1048576).toFixed(1)+' MB':Math.max(1,Math.round(size/1024))+' KB';
function resetWorkboard() {
  workboardState.xhr?.abort();Object.assign(workboardState,{signature:'',pending:false,selectedTask:'',userSelected:false,draft:null,drafts:{},uploading:false,xhr:null});workboardState.dialogSerial++;
}
function workboardScopeTasks() {
  return (coordinationData().tasks||[]).filter(task=>(coordinationFilters.goal==='all'||task.goal_id===coordinationFilters.goal)&&(coordinationFilters.actor==='all'||(coordinationFilters.actor==='unassigned'?!task.actor_id:task.actor_id===coordinationFilters.actor))&&(coordinationFilters.phase==='all'||coordinationPhase(task)===coordinationFilters.phase));
}
function workboardShellHtml() {
  return `<section class="panel workboard" aria-label="组织成果展示板"><div class="panel-header"><div><h2>成果与交接</h2><p>阶段成果、交付文件与接续要求</p></div>${button('发布阶段成果','workboard-publish','','small primary','plus')}</div><div class="workboard-update" id="workboard-update" hidden><span>组织成果有更新，当前播放与填写位置保持不变。</span>${button('载入最新成果','workboard-refresh','','small','refresh')}</div><div id="workboard-content">${workboardOverviewHtml()}</div></section>`;
}
function workboardOverviewHtml() {
  const tasks=workboardScopeTasks(),chosen=workboardState.userSelected?tasks.find(t=>t.id===workboardState.selectedTask):null,latest=workboardUpdates().find(u=>tasks.some(t=>t.id===u.task_id)),selected=chosen||tasks.find(t=>t.id===latest?.task_id)||tasks.find(t=>coordinationPhase(t)==='in_progress')||tasks.find(t=>coordinationPhase(t)!=='completed')||tasks[0];
  if(!chosen)workboardState.userSelected=false;
  if(!selected)return `<div class="workboard-empty"><strong>当前范围内还没有任务</strong><p>建立组织目标并分派任务后，工作状态与发布的阶段成果会集中展示在这里。</p>${button('新建组织目标','new-goal','','small','plus')}</div>`;
  workboardState.selectedTask=selected.id;
  return `<div class="workboard-browser"><div class="workboard-task-index"><div class="workboard-index-heading">任务成果<span>${tasks.length}</span></div><div class="workboard-task-strip" role="group" aria-label="查看任务成果">${tasks.map(t=>`<button type="button" data-action="workboard-select" data-id="${escape(t.id)}" class="${t.id===selected.id?'selected':''}" aria-pressed="${t.id===selected.id}"><strong>${escape(t.title)}</strong><span>${escape(productName(t.actor_name||'待分派'))}</span><span class="coordination-phase ${escape(coordinationPhase(t))}">${escape(coordinationPhases[coordinationPhase(t)]||coordinationPhase(t))}</span></button>`).join('')}</div></div><div class="workboard-task-surface">${workboardTaskHtml(selected)}</div></div>`;
}
function workboardTaskHtml(task) {
  const phase=coordinationPhase(task),percent=phase==='completed'?100:Math.min(99,Math.max(0,Number(task.progress)||0));
  const latest=workboardUpdates(task.id)[0],handoffs=workboardHandoffs(task.id),outgoing=handoffs.find(h=>h.task_id===task.id);
  return `<div class="workboard-layout"><div class="workboard-main"><div class="workboard-task-heading"><div class="workboard-task-title"><span>${escape(productName(coordinationGoal(task.goal_id)?.title||'组织目标'))}</span><h3>${escape(task.title)}</h3>${productSourceLabel(coordinationGoal(task.goal_id))?`<span class="record-origin">${escape(productSourceLabel(coordinationGoal(task.goal_id)))}</span>`:''}</div><div class="workboard-owner">${icon(task.actor_type==='agent'?'bot':'person')}<div><span class="workboard-label">当前负责人</span><strong>${escape(productName(task.actor_name||'尚未分派'))}</strong></div></div></div>${latest?workboardReportHtml(latest):`<div class="workboard-no-media"><div>${icon('file')}</div><strong>尚未发布阶段成果</strong><p>${escape(productProgress(task.public_note||task.progress_note||'发布阶段说明并附上文件，让下一位协作者清楚如何继续。',coordinationGoal(task.goal_id)))}</p>${task.can_publish?button('发布这项任务的成果','workboard-publish',`data-id="${escape(task.id)}"`,'small','plus'):''}</div>`}<div class="workboard-footer-actions">${button('查看成果与交接时间线','workboard-detail',`data-id="${escape(task.id)}"`,'small','history')}${task.can_publish&&latest?button('发布新阶段成果','workboard-publish',`data-id="${escape(task.id)}"`,'small','plus'):''}${task.can_handoff&&latest?button('交接给下一位','workboard-handoff',`data-id="${escape(task.id)}"`,'small','arrow'):''}</div></div><aside class="workboard-context"><section><span class="workboard-label">当前进展</span><div class="workboard-phase"><span class="coordination-phase ${escape(phase)}">${escape(coordinationPhases[phase]||phase)}</span><strong>${percent}%</strong></div><progress value="${percent}" max="100" aria-label="${escape(task.title)}进度">${percent}%</progress><p>${escape(latest?.stage||productProgress(task.public_note||task.progress_note||'尚未填写公开进展。',coordinationGoal(task.goal_id)))}</p></section><section><span class="workboard-label">工作方向</span><p>${escape(latest?.direction||'尚未发布方向说明。')}</p></section><section><span class="workboard-label">下一步</span><p>${escape(latest?.next_step||(task.dependencies_ready===false?task.blocked_reason||'等待前置任务完成。':'尚未发布下一步说明。'))}</p></section><section><span class="workboard-label">待补材料</span><p class="workboard-material-needs">${escape(latest?.needs||'尚未提出补充材料要求。')}</p></section><section><span class="workboard-label">下一位交接</span>${outgoing?`<strong>${escape(workboardActorName(outgoing.to_actor_id))} · ${escape(workboardHandoffName(outgoing.status))}</strong><p>${escape(coordinationTask(outgoing.to_task_id)?.title||'下游任务')}</p>${outgoing.invalid_reason?`<p>暂不可接收：${escape(outgoing.invalid_reason)}</p>`:''}`:'<p>尚无成果交接记录。</p>'}${handoffs.filter(h=>h.can_accept||h.can_return).map(workboardReceiptActions).join('')}</section></aside></div>`;
}
function workboardReportHtml(update) {
  return `<article class="workboard-report"><h4>${escape(update.stage||'阶段成果')}</h4><div class="workboard-report-meta"><span>${escape(productName(update.actor_name||update.author_name||'组织成员'))}</span><time>${date(update.created_at)}</time><span>阶段进度 ${Number(update.progress)||0}%</span></div><p>${escape(update.summary||'')}</p>${workboardMediaHtml(update.attachment_ids||[])}</article>`;
}
function workboardMediaHtml(ids) {
  if(!ids.length)return '';
  return `<div class="workboard-media">${ids.map(id=>{const file=workboardAttachment(id);if(!file)return '<div class="workboard-file">附件暂不可用，请刷新后重试。</div>';const content='/api/attachments/'+encodeURIComponent(file.id)+'/content',download=content+'?download=1';if(file.kind==='image')return `<figure><a href="${content}" target="_blank" rel="noopener" aria-label="打开图片：${escape(file.name)}"><img src="${content}" alt="${escape(file.name)}" loading="lazy"></a><figcaption>${escape(file.name)} · ${workboardSize(file.size)} <a href="${download}" download>下载</a></figcaption></figure>`;if(file.kind==='video')return `<figure><video src="${content}" controls preload="metadata" playsinline aria-label="${escape(file.name)}"></video><figcaption>${escape(file.name)} · ${workboardSize(file.size)} <a href="${download}" download>下载</a></figcaption></figure>`;return `<a class="workboard-file" href="${download}" download>${icon('file')}<span>${escape(file.name)}<small>${workboardSize(file.size)} · 下载文件</small></span></a>`;}).join('')}</div>`;
}
function workboardReceiptActions(handoff) {
  return `<div class="workboard-handoff"><strong>${escape(coordinationTask(handoff.task_id)?.title||'上游任务')} → ${escape(coordinationTask(handoff.to_task_id)?.title||'下一任务')}</strong><p>${escape(handoff.note||'等待接收成果资料。')}</p><div class="heading-actions">${handoff.can_accept?button('接收资料','workboard-respond',`data-id="${escape(handoff.id)}" data-decision="accept"`,'small primary','check'):''}${handoff.can_return?button('退回补充','workboard-respond',`data-id="${escape(handoff.id)}" data-decision="return"`,'small'):''}</div></div>`;
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
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${escape(title)}</h2><p class="dialog-subtitle">${escape(subtitle)}</p></div><button type="button" class="icon-button" data-action="close-dialog" aria-label="关闭窗口">${icon('close')}</button></div><div class="dialog-body">${body}</div>`;
  if(!dialog.open)dialog.showModal();dialog.querySelector('input,textarea,select,button')?.focus();updateCoordinationChrome();
}
function workboardTimelineHtml(task) {
  const records=(task.history||[]).filter(h=>!['work_update_published','handoff_created','handoff_responded'].includes(h.type)).map(h=>({time:h.created_at,html:`<strong>${escape(productName(h.actor_name||'系统'))} · ${escape(h.message||h.type)}</strong><small>${date(h.created_at)}</small>`}));
  for(const update of workboardUpdates(task.id))records.push({time:update.created_at,html:`<strong>发布阶段成果</strong>${workboardReportHtml(update)}<p>工作方向：${escape(update.direction||'—')}<br>下一步：${escape(update.next_step||'—')}<br>待补材料：${escape(update.needs||'未提出')}</p>`});
  for(const h of workboardHandoffs(task.id)){
    records.push({time:h.created_at,html:`<strong>成果交接给 ${escape(workboardActorName(h.to_actor_id))}</strong><small>${date(h.created_at)} · ${escape(coordinationTask(h.to_task_id)?.title||'下游任务')}</small><p>${escape(h.note)}</p>${h.invalid_reason?`<p>暂不可接收：${escape(h.invalid_reason)}</p>`:''}${h.update_snapshot?`<details><summary>查看交接时的成果版本</summary>${workboardReportHtml(h.update_snapshot)}</details>`:''}${(h.can_accept||h.can_return)?workboardReceiptActions(h):''}`});
    if(h.responded_at)records.push({time:h.responded_at,html:`<strong>${escape(workboardActorName(h.to_actor_id))} · ${escape(workboardHandoffName(h.status))}</strong><small>${date(h.responded_at)}</small><p>${escape(h.reply||'')}</p>`});
  }
  return `<div class="workboard-timeline">${records.sort((a,b)=>new Date(b.time)-new Date(a.time)).map(r=>`<article class="workboard-timeline-entry">${r.html}</article>`).join('')||'<p class="skill-muted">尚无进展记录。</p>'}</div>`;
}
function openWorkboardDetail(taskId) {
  const task=coordinationTask(taskId);if(!task)return;
  workboardDialog('任务成果与交接',task.title,`<div class="workboard-publish-note">这里展示主动发布给组织的阶段成果。私人文档和原有交付正文继续按权限访问。接收交接只确认资料，不代表任务验收。</div>${workboardTaskHtml(task)}<h3 class="workboard-history-title">工作时间线</h3>${workboardTimelineHtml(task)}`);
}
function workboardSelectPublishTask() {
  const tasks=(coordinationData().tasks||[]).filter(t=>t.can_publish);
  workboardDialog('选择发布成果的任务','只有获准发布的任务会出现在这里。',tasks.length?`<div class="workboard-task-chooser">${tasks.map(t=>button(`${escape(t.title)} · ${escape(productName(t.actor_name||'尚未分派'))}`,'workboard-publish',`data-id="${escape(t.id)}"`,'','plus')).join('')}</div>`:empty('当前没有可发布的任务','完成任务分派并开始获准工作后，可以发布阶段成果。','file'));
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
  return `<form data-form="workboard" data-kind="${d.kind}" data-version="${d.version}"><div class="form-error" tabindex="-1"></div><div class="coordination-dialog-update" hidden><span></span><button type="button" class="button small" data-action="workboard-rebase">读取最新状态，保留草稿</button></div>${body}<div class="form-actions"><button type="button" class="button" data-action="close-dialog">关闭并保留草稿</button><button type="submit" class="button primary" data-coordination-write>${label}</button></div></form>`;
}
function openWorkboardPublish(taskId) {
  if(!taskId)return workboardSelectPublishTask();
  const task=coordinationTask(taskId);if(!task?.can_publish){notify('当前任务不可发布成果，请刷新状态后重试。',true);return;}
  const d=workboardDraft('publish',taskId),done=coordinationPhase(task)==='completed';
  const field=(name,label,limit,rows=2,required=true)=>`<div class="form-field"><label for="work-${name}">${label}${required?' *':''}</label><textarea id="work-${name}" name="${name}" rows="${rows}" maxlength="${limit}" ${required?'required':''}>${escape(d[name])}</textarea></div>`;
  workboardDialog('发布阶段成果',task.title,workboardFormFrame(d,`<div class="notice">发布后，这份说明及所选附件对全体组织成员可见。上传暂存本身不会公开；请只发布适合共享的工作成果。</div><div class="workboard-latest-summary">${coordinationPublicDetail(task)}</div>${field('direction','工作方向：当前在推进什么',500)}<div class="form-two"><div class="form-field"><label for="work-stage">所处阶段 *</label><input id="work-stage" name="stage" required maxlength="80" value="${escape(d.stage)}" placeholder="例如：初稿完成，待补充数据"></div><div class="form-field"><label for="work-progress">当前进度（%） *</label><input id="work-progress" name="progress" type="number" min="0" max="${done?100:99}" required value="${done?100:Number(d.progress)||0}" ${done?'readonly':''}><small>${done?'任务已完成，保持 100%。':'仅填写 0–99；任务验收完成后才记为 100%。'}</small></div></div>${field('summary','已经完成的工作与成果说明',4000,4)}${field('next_step','下一步准备做什么',2000)}${field('needs','仍需补充什么材料（没有可留空）',2000,2,false)}<div class="workboard-upload-zone"><label for="work-files">添加图片、视频或文件</label><input id="work-files" type="file" multiple accept=".png,.jpg,.jpeg,.gif,.webp,.mp4,.webm,.pdf,.txt,.md,.csv,.json,.zip,.docx,.xlsx,.pptx"><small>每次最多 10 个附件，每个文件最大 32 MB。图片、MP4 / WebM 视频可直接预览；其他支持的文件供下载。所有附件在点击发布前仅暂存。</small><div id="work-upload-control" hidden>${button('取消当前上传','workboard-cancel-upload','','small')}</div><ul id="work-upload-list" class="workboard-upload-list">${workboardUploadRows(d)}</ul></div><small class="form-note">补材料时发布一条新成果并添加附件，原有记录会保留在时间线。发布不等于完成或通过验收。</small>`,'发布到组织'));
  checkWorkboardDraftVersion();
}
function workboardUploadRows(d) {
  return d.files.map((row,index)=>`<li><div><strong>${escape(row.name)}</strong><small>${workboardSize(row.size)} · ${escape(row.status==='uploaded'?'已暂存，尚未公开':row.status==='uploading'?'正在上传 '+row.percent+'%':row.error||'等待上传')}</small>${row.status==='uploading'?`<progress value="${row.percent}" max="100" aria-label="${escape(row.name)}上传进度">${row.percent}%</progress>`:''}</div>${row.status!=='uploading'?`${row.status!=='uploaded'?button('重试上传','workboard-retry-file',`data-index="${index}"`,'small'):''}${button('移除','workboard-remove-file',`data-index="${index}"`,'small ghost')}`:''}</li>`).join('');
}
function updateWorkboardUploadRows() {
  const list=document.getElementById('work-upload-list');if(list&&workboardState.draft?.kind==='publish')list.innerHTML=workboardUploadRows(workboardState.draft);
  const control=document.getElementById('work-upload-control');if(control)control.hidden=!workboardState.uploading;
}
function openWorkboardHandoff(taskId) {
  const task=coordinationTask(taskId);if(!task?.can_handoff){notify('只有可交接的已完成任务才能传递成果。',true);return;}
  const updates=workboardUpdates(taskId),choices=(coordinationData().tasks||[]).filter(t=>Array.isArray(task.handoff_target_ids)?task.handoff_target_ids.includes(t.id):(t.depends_on||[]).includes(taskId)&&t.actor_type==='human'&&t.actor_id&&coordinationPhase(t)!=='completed'&&!['paused','completed'].includes(coordinationGoal(t.goal_id)?.status));
  if(!updates.length||!choices.length){workboardDialog('交接给下一位',task.title,empty('还没有可以交接的成果或接收任务','先发布阶段成果，并由负责人为直接下游任务分派员工。','arrow'));return;}
  const d=workboardDraft('handoff',taskId);
  workboardDialog('交接给下一位',task.title,workboardFormFrame(d,`<div class="notice">把已完成上游的成果交给下一任务的执行者。接收只确认资料，不更改任务负责人、不自动开始或验收任务，也不解锁其他前置条件。</div><div class="workboard-latest-summary">${coordinationPublicDetail(task)}</div><div class="form-field"><label for="work-update">选择交接的成果版本 *</label><select id="work-update" name="update_id" required>${updates.map(u=>`<option value="${escape(u.id)}" ${u.id===d.update_id?'selected':''}>${escape(u.stage)} · ${date(u.created_at)}</option>`).join('')}</select></div><div class="form-field"><label for="work-to-task">下一任务与接收人 *</label><select id="work-to-task" name="to_task_id" required><option value="">选择直接下游任务</option>${choices.map(t=>`<option value="${escape(t.id)}" ${t.id===d.to_task_id?'selected':''}>${escape(t.title)} → ${escape(productName(t.actor_name))}</option>`).join('')}</select></div><div class="form-field"><label for="work-note">交接说明与接续要求 *</label><textarea id="work-note" name="note" required maxlength="2000" rows="5">${escape(d.note)}</textarea></div>`,'发送成果交接'));
  checkWorkboardDraftVersion();
}
function openWorkboardResponse(handoffId,decision) {
  const h=(coordinationData().handoffs||[]).find(item=>item.id===handoffId);if(!h||(decision==='accept'?!h.can_accept:!h.can_return)){notify('当前账号或交接状态不允许此操作。',true);return;}
  const d=workboardDraft('respond',handoffId,decision),receiving=coordinationTask(h.to_task_id);
  workboardDialog(decision==='accept'?'接收成果资料':'退回补充资料',receiving?.title||'下游任务',workboardFormFrame(d,`<div class="notice">本次决定仅针对交接资料。接收后仍需按原任务流程接取、工作和独立验收。</div><div class="workboard-latest-summary"><div class="workboard-handoff"><strong>${escape(workboardActorName(h.from_actor_id))} → ${escape(workboardActorName(h.to_actor_id))}</strong><p>${escape(h.note)}</p><small>交接版本 v${h.version}</small></div>${h.update_snapshot?workboardReportHtml(h.update_snapshot):''}</div><div class="form-field"><label for="work-reply">${decision==='accept'?'接收说明':'需要补充或修订的具体内容'} *</label><textarea id="work-reply" name="reply" required maxlength="2000" rows="5">${escape(d.reply)}</textarea></div>`,decision==='accept'?'确认接收资料':'退回并说明'));
  checkWorkboardDraftVersion();
}
function workboardConflict(message) {
  const form=dialog.querySelector('form[data-form="workboard"]');if(!form)return;
  form.dataset.conflicted='true';const notice=form.querySelector('.coordination-dialog-update');notice.hidden=false;notice.querySelector('span').textContent=message;const submit=form.querySelector('button[type="submit"]');submit.disabled=true;submit.dataset.versionBlocked='true';
}
function checkWorkboardDraftVersion() {
  const d=workboardState.draft,form=dialog.querySelector('form[data-form="workboard"]');if(!d||!form)return;
  const latest=d.kind==='respond'?(coordinationData().handoffs||[]).find(h=>h.id===d.handoff_id):coordinationTask(d.task_id);
  if(latest&&Number(latest.version)!==Number(d.version))workboardConflict('这项工作已被其他成员更新，草稿和已暂存附件已保留。请读取新状态后核对再提交。');
}
function workboardFormError(message) {const box=dialog.querySelector('form[data-form="workboard"] .form-error');if(box){box.textContent=message;box.focus();}else notify(message,true);}
async function workboardSend(payload,message) {
  if(busy||!coordinationConnected()){workboardFormError('请等待连接恢复后再提交。');return;}
  const epoch=coordinationSync.epoch,d=workboardState.draft;busy=true;dialog.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=true);
  try{const snapshot=await api('/api/action',payload);if(epoch!==coordinationSync.epoch||snapshot.current_user?.id!==coordinationSync.userId)return;state=snapshot;normalize();coordinationApplySnapshot(snapshot);delete workboardState.drafts[d.key];workboardState.draft=null;busy=false;dialog.close();refreshWorkboard(true);patchCoordinationLive(true);notify(message);}
  catch(error){if(epoch!==coordinationSync.epoch)return;busy=false;if(error.status===409||error.code==='version_conflict'){workboardConflict('提交时发现版本冲突，草稿和附件保留。请读取最新状态并核对后重试。');await requestCoordinationRefresh();}else if(error instanceof TypeError){workboardConflict('连接中断，提交结果尚不确定。请恢复连接并读取新状态，检查是否已经发布，避免重复提交。');}else workboardFormError(error.message);}
  finally{if(epoch===coordinationSync.epoch){busy=false;const form=dialog.querySelector('form[data-form="workboard"]');if(form&&!form.dataset.conflicted)form.querySelector('button[type="submit"]').disabled=false;updateCoordinationChrome();}}
}
function uploadWorkboardFile(row,d) {
  return new Promise((resolve,reject)=>{
    const xhr=new XMLHttpRequest();workboardState.xhr=xhr;
    xhr.open('POST','/api/tasks/'+encodeURIComponent(d.task_id)+'/attachments?expected_version='+encodeURIComponent(d.version)+'&filename='+encodeURIComponent(row.name));
    xhr.setRequestHeader('Content-Type',row.file.type||'application/octet-stream');xhr.timeout=300000;
    xhr.upload.onprogress=event=>{if(event.lengthComputable){row.percent=Math.round(event.loaded/event.total*100);updateWorkboardUploadRows();}};
    xhr.onload=()=>{let result;try{result=JSON.parse(xhr.responseText);}catch{reject(new Error('上传服务没有返回有效结果，请重试。'));return;}if(xhr.status>=200&&xhr.status<300&&result.attachment){resolve(result.attachment);return;}const error=new Error(result.error||'文件上传失败。');error.status=xhr.status;reject(error);};
    xhr.onerror=()=>reject(new Error('上传连接中断；文件尚未发布，可稍后重试。'));xhr.ontimeout=()=>reject(new Error('上传超时，文件尚未发布。'));xhr.onabort=()=>reject(new Error('已取消上传，文件尚未发布。'));xhr.send(row.file);
  });
}
async function runWorkboardUploads(rows,d) {
  if(busy||workboardState.uploading)return;
  workboardState.uploading=true;busy=true;const epoch=coordinationSync.epoch;dialog.querySelectorAll('button[type="submit"]').forEach(b=>b.disabled=true);
  try{for(const row of rows){if(epoch!==coordinationSync.epoch)break;row.status='uploading';row.percent=0;row.error='';updateWorkboardUploadRows();try{row.attachment=await uploadWorkboardFile(row,d);row.status='uploaded';}catch(error){row.status='failed';row.error=error.message;if(error.status===409)workboardConflict('任务版本已变化，已上传附件保持暂存。请读取最新状态后重试未成功的文件。');if(error.status===401){coordinationExpire(epoch);break;}if(error.status===409||error.message.startsWith('已取消'))break;}finally{updateWorkboardUploadRows();}}}
  finally{if(epoch===coordinationSync.epoch){workboardState.uploading=false;workboardState.xhr=null;busy=false;updateWorkboardUploadRows();const form=dialog.querySelector('form[data-form="workboard"]');if(form&&!form.dataset.conflicted)form.querySelector('button[type="submit"]').disabled=false;requestCoordinationRefresh();}}
}
document.addEventListener('input',event=>{const form=event.target.closest('form[data-form="workboard"]'),d=workboardState.draft;if(form&&d&&Object.hasOwn(d,event.target.name))d[event.target.name]=event.target.value;});
document.addEventListener('change',event=>{
  const d=workboardState.draft;if(!d)return;
  if(event.target.closest('form[data-form="workboard"]')&&Object.hasOwn(d,event.target.name))d[event.target.name]=event.target.value;
  if(event.target.id!=='work-files'||busy)return;
  const rows=[];for(const file of event.target.files){if(d.files.length>=10){workboardFormError('每次最多发布 10 个附件，请先移除部分文件。');break;}if(file.size>32*1024*1024){workboardFormError(file.name+' 超过 32 MB，请压缩或选择较小文件。');continue;}if(!/\.(png|jpe?g|gif|webp|mp4|webm|pdf|txt|md|csv|json|zip|docx|xlsx|pptx)$/i.test(file.name)){workboardFormError(file.name+' 的类型不受支持，请选择列表中支持的图片、视频或文档格式。');continue;}const row={file,name:file.name,size:file.size,status:'queued',percent:0,error:'',attachment:null};d.files.push(row);rows.push(row);}event.target.value='';if(rows.length)runWorkboardUploads(rows,d);
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
      if(d.kind==='respond'){workboardFormError('交接资料或状态可能变化。回复草稿已保留，请关闭后重新打开交接，核对最新成果版本再决定。');d.version=latest.version;return;}
      if(!(d.kind==='publish'?latest.can_publish:latest.can_handoff)){workboardFormError('任务已进入其他状态，当前操作不可用。输入与附件仍保留。');return;}
      form.querySelector('.workboard-latest-summary').innerHTML=coordinationPublicDetail(latest);d.version=latest.version;if(coordinationPhase(latest)==='completed'&&d.kind==='publish'){d.progress=100;form.elements.progress.value=100;form.elements.progress.max=100;form.elements.progress.readOnly=true;}
      form.dataset.version=String(latest.version);delete form.dataset.conflicted;form.querySelector('.coordination-dialog-update').hidden=true;delete form.querySelector('button[type="submit"]').dataset.versionBlocked;form.querySelector('button[type="submit"]').disabled=false;notify('已读取最新状态，草稿与附件保持不变，请核对后提交。');
    }catch(error){workboardFormError(error.message);}
  }
});
document.addEventListener('submit',event=>{
  const form=event.target.closest('form[data-form="workboard"]');if(!form)return;event.preventDefault();const d=workboardState.draft;if(!d||busy||form.dataset.conflicted==='true')return;
  const values=Object.fromEntries(new FormData(form));for(const [key,value] of Object.entries(values))if(Object.hasOwn(d,key))d[key]=value;
  if(d.kind==='publish'){if(d.files.some(row=>row.status!=='uploaded')){workboardFormError('有文件尚未成功上传，请重试或移除后发布。');return;}return workboardSend({type:'publish_work_update',task_id:d.task_id,expected_version:d.version,direction:d.direction.trim(),stage:d.stage.trim(),progress:Number(d.progress),summary:d.summary.trim(),next_step:d.next_step.trim(),needs:d.needs.trim(),attachment_ids:d.files.map(row=>row.attachment.id)},'阶段成果已发布，组织成员可查看说明和附件。');}
  if(d.kind==='handoff')return workboardSend({type:'create_handoff',task_id:d.task_id,expected_version:d.version,update_id:d.update_id,to_task_id:d.to_task_id,note:d.note.trim()},'成果已交接给下一任务的执行者，等待对方确认资料。');
  if(d.kind==='respond')return workboardSend({type:'respond_handoff',handoff_id:d.handoff_id,expected_version:d.version,decision:d.decision,reply:d.reply.trim()},d.decision==='accept'?'已确认接收资料，任务仍按原流程继续。':'已退回补充资料，原因已记录。');
});
dialog.addEventListener('close',()=>{dialog.classList.remove('workboard-dialog');workboardState.dialogSerial++;if(workboardState.pending)refreshWorkboard();});
