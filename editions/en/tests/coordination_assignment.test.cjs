"use strict";

// Contract-level UI checks with an isolated DOM shim; no live assignments or server.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function harness(file) {
  const handlers={},mutations=[];
  const actors=[...Array.from({length:13},(_,i)=>({id:`human-${i}`,user_id:`user-${i}`,name:`Member ${i}`,type:'human',role:i===2?'Research specialist':'Member',available:i!==0,capability_ids:[],permissions:[]})),...Array.from({length:4},(_,i)=>({id:`agent-${i}`,name:`Agent ${i}`,type:'agent',available:true,capability_ids:['analyze'],permissions:['analyze']}))];
  const goal={id:'goal',title:'Shared goal',can_manage:true,collaborative:true};
  const task={id:'task',goal_id:'goal',title:'Analyze source',capability_id:'analyze',capability_name:'Analysis',actor_id:null,phase:'queued',version:9,can_assign:true,can_publish:true,can_handoff:true,
    assignment_candidates:actors.map(a=>({actor_id:a.id,name:a.name,type:a.type,available:a.available,can_assign:true,ready_to_execute:a.type==='agent',blocking_reasons:a.type==='human'?[{code:'permission_missing',message:'Permission required <admin>'}]:[]}))};
  const context=vm.createContext({state:{coordination:{actors,goals:[goal],tasks:[task]},tasks:[task],goals:[goal]},busy:false,
    document:{activeElement:null,addEventListener(type,fn){(handlers[type]??=[]).push(fn);}},window:{addEventListener(){}},dialog:{addEventListener(){}},
    load(){},escape,productName:value=>value,productProgress:value=>value,date:()=>'',icon:()=>'<svg></svg>',
    button:(label,action,attrs='')=>`<button data-action="${action}" ${attrs}>${label}</button>`,workboardUpdates:()=>[{}],
    FormData:class{constructor(form){this.form=form;}get(name){return this.form.values[name];}}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context,{filename:file});
  vm.runInContext("coordinationSync.status='connected'",context);
  context.coordinationMutate=(payload,message,options)=>mutations.push({payload,message,options});
  function form(selected='human-0') {
    const submitButton={dataset:{},disabled:false};
    const fields={
      '[name="actor_id"]':{value:selected},'#coord-assignee-search':{value:'',focus(){this.focused=true;}},
      '#coord-assignee-list':{innerHTML:''},'#coord-assignee-details':{innerHTML:''},'.form-error':{textContent:''}
    };
    return {dataset:{kind:'assign',task:'task',version:'9',assigneeFilter:'all'},values:{actor_id:selected},fields,submitButton,
      closest(){return this;},querySelector:selector=>fields[selector],querySelectorAll:selector=>selector==='button[type="submit"]'?[submitButton]:[]};
  }
  return {context,actors,goal,task,handlers,mutations,form,
    submit(form){handlers.submit[0]({target:form,preventDefault(){}});}};
}

for(const file of ['web/coordination.js']) {
  test(`${file}: full roster includes all 13 members and 4 Agents with requirements`,()=>{
    const h=harness(file),c=h.context.coordinationAssignmentCandidates(h.task);
    assert.equal(c.length,17);assert.equal(c.filter(a=>a.type==='human').length,13);
    assert.equal(c.filter(a=>a.type==='agent').length,4);assert.equal(c[0].type,'human');
    assert.equal(c.find(a=>a.actor_id==='human-2').role,'Research specialist');
    const html=h.context.coordinationAssigneeRows(h.task);
    assert.equal((html.match(/type="radio"/g)||[]).length,17);
    assert.ok(!html.includes('disabled'));assert.ok(html.includes('value="human-0"'));
  });
  test(`${file}: search and type filters are explicit and do not remove the selected value`,()=>{
    const h=harness(file),form=h.form('human-0');
    form.fields['#coord-assignee-search'].value='research';
    h.context.refreshCoordinationAssignees(form);
    assert.match(form.fields['#coord-assignee-list'].innerHTML,/value="human-2"/);
    assert.ok(!form.fields['#coord-assignee-list'].innerHTML.includes('value="human-0"'));
    assert.equal(form.fields['[name="actor_id"]'].value,'human-0');
    assert.match(form.fields['#coord-assignee-details'].innerHTML,/Member 0/);
    form.fields['#coord-assignee-search'].value='';form.dataset.assigneeFilter='agent';
    h.context.refreshCoordinationAssignees(form);
    assert.equal((form.fields['#coord-assignee-list'].innerHTML.match(/type="radio"/g)||[]).length,4);
    assert.equal(form.fields['[name="actor_id"]'].value,'human-0');
    assert.match(h.context.coordinationAssigneeRows(h.task,'','not-present'),/assignment-empty/);
  });
  test(`${file}: old-server fallback keeps inactive and unqualified people but excludes unbound humans`,()=>{
    const h=harness(file);delete h.task.assignment_candidates;
    h.actors.push({id:'legacy-owner',type:'human',name:'Unbound placeholder',available:true});
    const candidates=h.context.coordinationAssignmentCandidates(h.task);
    assert.equal(candidates.length,17);assert.ok(candidates.some(a=>a.actor_id==='human-0'));
    assert.ok(!candidates.some(a=>a.actor_id==='legacy-owner'));
    assert.ok(candidates.every(a=>a.ready_to_execute===null&&!a.metadata));
    assert.equal(candidates[0].blocking_reasons.length,3);
    assert.match(h.context.coordinationAssigneeBody(h.task),/assignment-compatibility/);
  });
  test(`${file}: Assign stays outside More; unavailable managers see a reason and legacy run link`,()=>{
    const h=harness(file),html=h.context.coordinationTaskRow(h.task);
    assert.ok(html.indexOf('data-kind="assign"')>=0);
    assert.ok(html.indexOf('data-kind="assign"')<html.indexOf('<details class="task-action-menu">'));
    h.task.can_assign=false;h.goal.collaborative=false;h.task.assignment_disabled_reason='Original workflow; use the run';
    const legacy=h.context.coordinationAssignmentRowAction(h.task);
    assert.match(legacy,/Original workflow/);assert.match(legacy,/data-action="open-goal"/);
    h.goal.can_manage=false;assert.equal(h.context.coordinationAssignmentRowAction(h.task),'');
  });
  test(`${file}: selected requirements and assigned-row warnings escape server text`,()=>{
    const h=harness(file);h.task.actor_id='human-0';h.task.phase='assigned';
    h.task.assignment_ready_to_execute=false;h.task.assignment_blocking_reasons=[{code:'permission_missing',message:'Permission required <admin>'}];
    const detail=h.context.coordinationAssigneeDetail(h.task,'human-0'),summary=h.context.coordinationPublicDetail(h.task),row=h.context.coordinationTaskRow(h.task);
    for(const html of [detail,summary,row]){assert.ok(html.includes('Permission required &lt;admin&gt;'));assert.ok(!html.includes('<admin>'));}
    assert.match(summary,/coordination-assignment-requirements/);assert.match(row,/coordination-assignment-warning/);
  });
  test(`${file}: selecting a provider changes only the selected actor and detail`,()=>{
    const h=harness(file),form=h.form('human-0');
    for(const handler of h.handlers.change)handler({target:{name:'assignment_candidate',value:'agent-1',closest:()=>form}});
    assert.equal(form.fields['[name="actor_id"]'].value,'agent-1');
    assert.match(form.fields['#coord-assignee-details'].innerHTML,/Agent 1/);
    assert.equal(h.mutations.length,0);
  });
  test(`${file}: unqualified assignment sends only actor ID and optimistic task version`,()=>{
    const h=harness(file),form=h.form('human-0');form.dataset.version='8';
    h.submit(form);
    assert.equal(h.mutations.length,1);
    assert.deepEqual(JSON.parse(JSON.stringify(h.mutations[0].payload)),{task_id:'task',expected_version:8,type:'assign_task',actor_id:'human-0'});
    assert.equal(h.task.assignment_candidates[0].ready_to_execute,false);
    assert.deepEqual(h.actors[0].permissions,[]);
  });
  test(`${file}: conflict and busy state block requests; refresh preserves assignee and form version`,()=>{
    const h=harness(file),form=h.form('human-0');form.dataset.conflicted='true';
    h.submit(form);assert.equal(h.mutations.length,0);
    delete form.dataset.conflicted;h.context.busy=true;h.submit(form);assert.equal(h.mutations.length,0);
    h.context.busy=false;form.dataset.version='8';
    h.task.assignment_candidates[0].blocking_reasons=[{code:'new_rule',message:'New requirement'}];
    h.context.refreshCoordinationAssignees(form);
    assert.equal(form.fields['[name="actor_id"]'].value,'human-0');
    assert.equal(form.dataset.version,'8');assert.match(form.fields['#coord-assignee-details'].innerHTML,/New requirement/);
  });
  test(`${file}: missing or nonassignable selection is rejected without a request`,()=>{
    const h=harness(file),missing=h.form('');h.context.refreshCoordinationAssignees(missing);h.submit(missing);
    assert.equal(h.mutations.length,0);assert.ok(missing.fields['.form-error'].textContent);
    assert.equal(missing.submitButton.disabled,true);
    const unqualified=h.form('human-0');h.context.refreshCoordinationAssignees(unqualified);
    assert.equal(unqualified.submitButton.disabled,false);
    const forbidden=h.form('human-0');h.task.assignment_candidates[0].can_assign=false;h.submit(forbidden);
    assert.equal(h.mutations.length,0);assert.ok(forbidden.fields['.form-error'].textContent);
  });
  test(`${file}: same-revision runtime availability refreshes requirements without changing the assignment draft`,async()=>{
    const h=harness(file),form=h.form('agent-0');
    h.context.state.revision=4;h.context.state.coordination.revision=4;
    h.context.state.coordination.runtime={available:false};
    h.context.authState={authenticated:true};h.context.clearTimeout=()=>{};h.context.setTimeout=()=>1;
    vm.runInContext("coordinationSync.userId='user';coordinationSync.revision=4;coordinationSync.data=state.coordination",h.context);
    let patches=0,privateRefreshes=0,conflictChecks=0;
    h.context.updateCoordinationChrome=()=>{};h.context.modelSettingsApplyRuntime=()=>{};
    h.context.patchCoordinationLive=()=>{patches++;};h.context.refreshCoordinationPrivate=()=>{privateRefreshes++;};
    h.context.markCoordinationDialogUpdates=()=>{conflictChecks++;};h.context.dialog.querySelector=()=>form;
    const data=JSON.parse(JSON.stringify(h.context.state.coordination));
    data.runtime.available=true;data.current_user={id:'user'};
    data.tasks[0].assignment_candidates.find(a=>a.actor_id==='agent-0').blocking_reasons=[];
    h.context.coordinationFetch=async()=>data;
    await h.context.requestCoordinationRefresh();
    assert.equal(patches,1);assert.equal(privateRefreshes,0);assert.equal(conflictChecks,0);
    assert.equal(form.fields['[name="actor_id"]'].value,'agent-0');assert.equal(form.dataset.version,'9');
    assert.equal(form.dataset.conflicted,undefined);assert.match(form.fields['#coord-assignee-details'].innerHTML,/Agent 0/);
    assert.ok(form.dataset.assignmentFingerprint);assert.equal(form.submitButton.disabled,false);
  });
}
