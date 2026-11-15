"use strict";

// Read-only product help. Navigation uses the existing pages; no task is changed here.
const usageGuideTopics = [
  ['start','Getting started'], ['work','My tasks'], ['resources','Capabilities and knowledge'],
  ['model','Run Agents'], ['status','Task statuses']
];
const usageGuideContexts = {
  collaboration:['start','Start with a shared goal','Create a goal → Assign → Accept and work → Submit and review'],
  overview:['model','Review execution results here','Handle manual tasks in the workspace; authorized owners run Agents'],
  actors:['resources','Know your team before assigning work','Members use separate accounts; capabilities and permissions are managed separately'],
  capabilities:['resources','Describe each capability clearly','State what it does, the required input, and how the output is reviewed'],
  matrix:['resources','Use evidence to assess capabilities','Members can take matching tasks once capabilities are verified and authorized'],
  'my-capabilities':['resources','Show the team what you can do','Add a capability description and work evidence, then submit a capability claim'],
  knowledge:['resources','Keep work grounded in traceable sources','After importing, check the content, ownership, and permitted use'],
  'model-settings':['model','Connect a model for Agents','Choose a cloud API or local service, test it, then save and activate'],
  approvals:['work','Handle shared tasks in the workspace','Acceptance, work, delivery, and review each have a distinct status'],
  memories:['status','Trace results back to the process','Read retrospective conclusions or open source tasks to check the activity']
};

function usageGuideEntryHtml() {
  const context=usageGuideContexts[route()];
  if(!context)return '';
  return `<aside class="usage-guide-entry" aria-label="Help for this page">${icon('book')}<div><strong>${escape(context[1])}</strong><span>${escape(context[2])}</span></div><button type="button" class="button ghost small" data-guide-open="${context[0]}">View steps ${icon('arrow')}</button></aside>`;
}

function usageGuideSteps(steps) {
  return `<ol class="usage-guide-steps">${steps.map(([title,text],index)=>`<li class="usage-guide-step"><span class="usage-guide-number" aria-hidden="true">${index+1}</span><div><h3>${escape(title)}</h3><p>${escape(text)}</p></div></li>`).join('')}</ol>`;
}

function usageGuideLinks(links) {
  return `<div class="usage-guide-links">${links.map(([page,label])=>`<a class="button small" href="#${page}" data-guide-route="${page}">${escape(label)}${icon('arrow')}</a>`).join('')}</div>`;
}

function usageGuideContent(topic) {
  const admin=isAdmin();
  if(topic==='start')return {
    title:'Turn a goal into work the team can carry forward',
    intro:'Create a goal, then collaborate on its tasks. Goals, owners, statuses, and public progress are shared in the Organization workspace.',
    steps:[
      ['Define the goal and completion criteria','In Organization workspace, select New goal and enter the goal name, background, and acceptance criteria. Any member can propose a goal.'],
      ['Confirm the workflow','The default workflow has five nodes: requirements analysis, drafting, quality review, human review, and retrospective. Expand Custom workflow in the creation dialog to define different tasks and dependencies.'],
      ['Assign the work','The goal owner or an administrator selects Assign task or Reassign directly in the task row. Search by name or filter members and Agents, then select an assignee. All account-linked members and registered Agents appear; missing execution requirements are explained separately.'],
      ['Keep progress in the workspace','Members accept tasks and start work using their own accounts, then update progress and publish results. Deliverables & handoffs contains descriptions and files; Activity shows task transitions.']
    ],
    links:[['collaboration','Open Organization workspace'],['actors','View People & Agents']],
    note:'You can assign work before execution requirements are met. Assignment does not verify capabilities or grant permissions. Members need verified capabilities, execution permission and completed dependencies before accepting and starting work. Agents still need to meet task requirements and have a model connection configured.'
  };
  if(topic==='work')return {
    title:'Follow these five steps for an assigned task',
    intro:'Every member uses their own account. Other members see shared status; private documents and deliverables remain permission-controlled.',
    steps:[
      ['Find your assigned tasks','Open Organization workspace and select your name in the Assignee filter. Open the task title or Deliverable details to read progress, published results, and handoff requirements. Check acceptance criteria and prerequisites in Run overview.'],
      ['Accept the task, then start work','Select Accept task to acknowledge the assignment, then Start work when ready. If prerequisites are incomplete, wait or contact the goal owner.'],
      ['Record your progress','Use Update progress to enter a percentage and public note. To share images, video, or files, select Publish update, describe the direction, stage, completed work, and next step, then Publish to organization. Staged uploads are not automatically public.'],
      ['Submit the deliverable for review','For an ordinary manual task, select Submit deliverable and provide the actual result and evidence. An authorized person other than the submitter reviews it with Review deliverable. If you are assigned a dedicated human review node, use Independent review to assess the preceding deliverables.'],
      ['Hand the result to the next person','Once the task is complete and has a published result, select Hand off deliverables or Hand off to the next person. Choose the result version and a directly dependent task assigned to a member, then explain what comes next. The recipient can Confirm receipt or Return for more information.']
    ],
    links:[['collaboration','Open Organization workspace']],
    note:'Publishing a result does not complete the task, and receiving material does not start work. Progress becomes 100% only after approval. You can attach up to 10 files per publication, each no larger than 32 MB.'
  };
  if(topic==='resources')return {
    title:admin?'Prepare people, documents, and capabilities':'Describe your experience and support it with evidence',
    intro:'A Skill describes what can be done. Work evidence shows what has been done. Execution permissions determine which tasks can be assigned.',
    steps:[
      ...(admin?[['Create member accounts','Members can select Register on the sign-in page to create a local account. You can also select Create member account in People & Agents. Each member uses a separate account. Use Add Agent to register an Agent name, responsibilities, capabilities, and execution permissions.']]:[]),
      ['Import work documents','In Knowledge, select Import document. Upload an .md or .txt file or paste text, then check the imported content. Administrators can save organization knowledge; members save personal resources. Private knowledge does not automatically become a public result.'],
      ['Submit capability evidence','In My capabilities, add your experience and capability claim, linking relevant documents and evidence. After administrator verification, the result appears in Capability matrix.'],
      ['Upload a reusable Skill','In Capability catalog, select Upload capability package, or use Upload Skill for this provider on a member card. SKILL.md and JSON are supported. Select Parse and preview, complete the description, inputs, outputs, steps, and acceptance criteria, then register it.'],
      ['Check verification and permissions','Use Capability matrix to check evidence, verification, and authorization. Uploading a document or Skill does not grant execution permission. Agent capability declarations also require actual testing.']
    ],
    links:[['my-capabilities','Update My capabilities'],['knowledge','Import knowledge documents'],['capabilities','Open Capability catalog']],
    note:admin?'Administrators can review capabilities in Capability matrix and then grant execution permissions. They cannot verify their own claims. Check the evidence and capability limits before granting permission.':'If you are missing from the assignment list, ask an administrator to check your capability, permission, and availability.'
  };
  if(topic==='model')return {
    title:'Assign concrete tasks to Agents',
    intro:'Agents use the model connection configured for the workspace to execute authorized tasks. Member collaboration and model connections are managed separately.',
    steps:[
      ['Configure the model connection',admin?'Open Model settings, choose a cloud API or local model service, and enter the protocol, API base URL, model name, and required key. Select Test current connection, then Save and activate. Testing alone does not save the configuration.':'Ask an administrator to connect a cloud API or local model service in Model settings. Members do not need to enter model credentials for the workspace.'],
      ['Prepare the task and capability','Review Agent capabilities in People & Agents. The goal owner or an administrator assigns a task to a capable, authorized Agent and confirms the input documents and acceptance criteria.'],
      ['Run a ready task','The goal owner or an administrator selects Open execution in the task row, or opens Run overview, chooses a goal, and selects Run next step. Each action advances one ready node. Prerequisites, budget, or human review gates may prevent execution.'],
      ['Review the output before continuing','Check the selected task deliverable and activity in Run overview. Return to the workspace when a person must act. Complete the required review before advancing.']
    ],
    links:[...(admin?[['model-settings','Configure the model connection']]:[]),['overview','Open Run overview']],
    note:'A successful connection does not mean external tools are connected. Model-generated text is a deliverable; it does not mean messages were sent, content was published, or external business actions were performed.'
  };
  return {
    title:'Each status has a clear next action',
    intro:'Status identifies responsibility, progress shows advancement, and results show the actual output. Together, they tell the next person how to continue.',
    statuses:[
      ['Unassigned','Waiting for the goal owner or an administrator to assign an eligible executor.'],
      ['Assigned','Assigned to a member, who must select Accept task.'],
      ['Accepted','The assignee has acknowledged the task and selects Start work when ready.'],
      ['In progress','Work has started. The assignee can update progress, publish interim results, and submit a deliverable.'],
      ['Awaiting review','A manual task has been submitted and awaits review by another authorized person.'],
      ['Completed','The task has completed its workflow. Confirm the result and downstream recipient if a handoff is needed.']
    ],
    links:[['collaboration','View organization status']],
    note:'Agents show execution statuses such as Ready to run and Running. For paused, blocked, or failed tasks, check the details and activity for the reason. Missing actions usually reflect account permissions, task stage, or prerequisites.'
  };
}

function renderUsageGuide(topic) {
  const content=usageGuideContent(topic);
  const body=content.steps?usageGuideSteps(content.steps):`<dl class="usage-guide-status-grid">${content.statuses.map(([label,text])=>`<div class="usage-guide-status"><dt>${escape(label)}</dt><dd>${escape(text)}</dd></div>`).join('')}</dl>`;
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">User guide</h2><p class="dialog-subtitle">Xiaolajiao · Intelligent Organization</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="Close user guide">${icon('close')}</button></div>
    <div class="dialog-body usage-guide-panel"><div class="usage-guide-tabs" role="group" aria-label="Choose a guide topic">${usageGuideTopics.map(([key,label])=>`<button class="button small ${key===topic?'active':''}" type="button" data-guide-topic="${key}" aria-pressed="${key===topic}">${label}</button>`).join('')}</div>
    <section class="usage-guide-body" aria-labelledby="usage-guide-heading"><h3 id="usage-guide-heading">${escape(content.title)}</h3><p class="usage-guide-intro">${escape(content.intro)}</p>${body}<p class="usage-guide-note">${icon('info')}<span>${escape(content.note)}</span></p>${usageGuideLinks(content.links)}</section></div>`;
}

function openUsageGuide(topic) {
  if(!state||dialog.open)return;
  const trigger=document.activeElement;
  const selected=usageGuideTopics.some(([key])=>key===topic)?topic:(usageGuideContexts[route()]?.[0]||'start');
  dialog.classList.add('usage-guide-dialog');
  renderUsageGuide(selected);
  dialog.addEventListener('close',()=>{
    dialog.classList.remove('usage-guide-dialog');
    if(trigger?.isConnected)trigger.focus({preventScroll:true});
  },{once:true});
  dialog.showModal();
  dialog.querySelector('[data-guide-topic][aria-pressed="true"]')?.focus();
}

document.addEventListener('click',event=>{
  const opener=event.target.closest('[data-guide-open]');
  if(opener){openUsageGuide(opener.dataset.guideOpen);return;}
  const topic=event.target.closest('[data-guide-topic]');
  if(topic&&dialog.classList.contains('usage-guide-dialog')&&usageGuideTopics.some(([key])=>key===topic.dataset.guideTopic)){
    const key=topic.dataset.guideTopic;
    renderUsageGuide(key);
    dialog.querySelector(`[data-guide-topic="${key}"]`)?.focus();
    return;
  }
  const link=event.target.closest('[data-guide-route]');
  if(link&&dialog.classList.contains('usage-guide-dialog'))dialog.close();
});
