"use strict";

// Read-only product help. Navigation uses the existing pages; no task is changed here.
const usageGuideTopics = [
  ['start','开始协作'], ['work','处理我的任务'], ['resources','能力与资料'],
  ['model','运行 Agent'], ['status','看懂状态']
];
const usageGuideContexts = {
  collaboration:['start','从一个共同目标开始','建目标 → 分派 → 接取与工作 → 交付验收'],
  overview:['model','这里查看执行结果','人工任务在协作台推进，Agent 由有权限的负责人运行'],
  actors:['resources','先认识成员，再安排工作','员工使用自己的账号，能力说明与执行授权分别管理'],
  capabilities:['resources','把能力说明白','说明能做什么、需要什么输入，以及交付如何验收'],
  matrix:['resources','用证据判断可承担的工作','核验能力与执行授权就绪后，成员才能承接对应任务'],
  'my-capabilities':['resources','让团队了解你能做什么','补充个人介绍、工作证据，再提交能力核验'],
  knowledge:['resources','为工作提供可追溯资料','导入资料后，确认内容、归属和允许使用的范围'],
  'model-settings':['model','为 Agent 连接模型','选择云端 API 或本地服务，测试后保存并启用'],
  approvals:['work','共同任务在协作台处理','接取、工作、交付与验收，每一步都有独立状态'],
  memories:['status','从结果回看过程','查看复盘结论，也可以回到来源任务核对执行记录']
};

function usageGuideEntryHtml() {
  const context=usageGuideContexts[route()];
  if(!context)return '';
  return `<aside class="usage-guide-entry" aria-label="本页使用提示">${icon('book')}<div><strong>${escape(context[1])}</strong><span>${escape(context[2])}</span></div><button type="button" class="button ghost small" data-guide-open="${context[0]}">查看步骤 ${icon('arrow')}</button></aside>`;
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
    title:'把目标变成大家能接续的工作',
    intro:'先建一个目标，再围绕任务协作。目标、负责人、状态和公开进展在组织协作台共同展示。',
    steps:[
      ['写清目标和完成标准','在「组织协作台」点击「新建目标」，填写目标名称、背景资料和验收标准。组织成员都可以提出目标。'],
      ['确认工作流程','默认生成需求分析、方案起草、质量检查、人工验收、复盘五个节点。需要其他流程时，可在创建窗口展开「自定义流程」配置任务及依赖。'],
      ['安排谁来做','目标负责人或管理员在任务行点击「分派任务」或「重新分派」，按姓名搜索，或筛选员工、Agent，选定具体负责人。名单会显示所有已建立账号的员工和已登记 Agent；缺少的执行条件会单独说明。'],
      ['让过程留在协作台','员工用自己的账号接取任务、开始工作，再更新进展和发布成果。「成果与交接」看说明和文件，「协作记录」看任务流转。']
    ],
    links:[['collaboration','前往组织协作台'],['actors','查看员工与 Agent']],
    note:'可以先分派，再补齐执行条件。分派不会自动核验能力或授予权限；员工需补充能力证据并由管理员核验、授权，前置任务完成后才能接取与工作。Agent 仍需符合任务要求并配置模型连接。'
  };
  if(topic==='work')return {
    title:'接到任务后，按这五步推进',
    intro:'每位员工使用自己的账号操作。其他成员看到的是共享状态；私人资料和交付正文仍按权限访问。',
    steps:[
      ['找到分给自己的任务','打开「组织协作台」，在「负责人」筛选自己的名字。点击任务标题或「成果详情」，先看当前进展、公开成果和交接要求；需要核对验收标准和前置任务时，到「运行总览」查看。'],
      ['接取，再开始工作','点击「接取任务」表示你已认领；准备执行时再点「开始工作」。前置任务未完成时，先等待或联系目标负责人处理。'],
      ['记录做到哪一步','用「更新进展」填写当前进度和公开说明；有图片、视频或文件时，点「发布成果」，填写工作方向、所处阶段、已完成内容及下一步，再「发布到组织」。上传暂存不会自动公开。'],
      ['提交交付，等待验收','普通人工任务完成后点「提交交付」，填写实际结果与证据；由有权限的其他人「验收交付」。如果你承担的是专门的人工验收节点，使用「独立验收」审阅前序交付。'],
      ['把成果交给下一位','任务完成且已有公开成果后，点「交接成果」或「交给下一位」，选择成果版本和已分派给员工的直接下游任务，写明接续要求。接收人可「确认接收」或「退回补充」。']
    ],
    links:[['collaboration','前往组织协作台']],
    note:'发布成果不代表任务完成；接收资料也不会自动开工。验收通过后才记为 100%。附件每次最多 10 个，每个不超过 32 MB。'
  };
  if(topic==='resources')return {
    title:admin?'先把人、资料和能力准备好':'让你的经验有说明、有证据',
    intro:'Skill 说明回答“能做什么”，工作证据帮助判断“做到了什么”，执行授权决定“可以接什么任务”。',
    steps:[
      ...(admin?[['为员工建立登录身份','员工可在登录页点击「注册」自行创建本地账号，你也可到「员工与 Agent」点击「创建员工账号」。每位员工使用独立账号；Agent 则通过「添加 Agent」登记名称、职责、能力及执行授权。']]:[]),
      ['导入工作资料','到「知识接入」点「接入资料」，上传 .md / .txt 文件或粘贴正文，检查导入内容。管理员可存为组织知识，员工存为个人资料；私人知识不会自动变成全员公开成果。'],
      ['提交自己的能力证据','到「我的能力」补充经验介绍和能力申报，关联工作资料及证据。管理员核验后，能力矩阵会显示相应结果。'],
      ['上传可复用的 Skill','在「能力目录」点「上传能力包」，或在成员卡片点「为此提供者上传 Skill」。支持 SKILL.md / JSON，先「解析并预览」，补齐能力介绍、输入、输出、步骤与验收要求后登记。'],
      ['确认核验与授权','在「能力矩阵」查看证据、核验状态和授权情况。上传资料或 Skill 本身不会自动授予执行权限；Agent 的能力声明也需要实际运行验证。']
    ],
    links:[['my-capabilities','完善我的能力'],['knowledge','导入知识资料'],['capabilities','查看能力目录']],
    note:admin?'管理员可在「能力矩阵」评审能力，通过后再授予执行权限；不能核验自己的申报。授权前请核对资料与能力边界。':'如果任务分派列表里找不到你，请联系管理员核对能力、授权和可参与状态。'
  };
  if(topic==='model')return {
    title:'让 Agent 参与具体任务',
    intro:'Agent 使用工作空间配置的模型连接执行获准的任务。员工协作与模型连接分别管理。',
    steps:[
      ['配置模型连接',admin?'进入「模型配置」，选择云端 API 或本地模型服务，填写协议、API 根地址、模型名称和所需密钥。先「测试当前连接」，再「保存并启用」；测试本身不会保存配置。':'请管理员在「模型配置」中连接云端 API 或本地模型服务。普通成员不需要填写工作空间的模型凭据。'],
      ['准备任务与能力','在「员工与 Agent」查看 Agent 的能力说明。目标负责人或管理员将任务分派给具备能力且已授权的 Agent，并确认输入资料和验收标准。'],
      ['运行一个就绪节点','目标负责人或管理员在任务行点「进入执行」，或进入「运行总览」选择目标，再点「运行下一步」。每次推进一个可执行节点；前置条件、预算或人工关口会影响能否继续。'],
      ['检查产出，再推进','在运行总览查看选中任务的交付内容与运行记录。需要人的处理时返回协作台；涉及验收的任务按原流程确认后再继续。']
    ],
    links:[...(admin?[['model-settings','配置模型连接']]:[]),['overview','前往运行总览']],
    note:'连接成功不代表所有外部工具已接通。模型生成的文本是交付内容，不代表已经替你发消息、发布或执行外部业务操作。'
  };
  return {
    title:'每个状态都对应一个明确动作',
    intro:'状态看当前责任，进度看工作推进，成果看实际产出。三者一起看，下一位才知道如何接续。',
    statuses:[
      ['待分派','等待目标负责人或管理员安排合适的执行者。'],
      ['待接取','已分给员工，等待本人点击「接取任务」。'],
      ['已接取','本人已认领，准备好后点击「开始工作」。'],
      ['工作中','正在处理，可更新进展、发布阶段成果并提交交付。'],
      ['待验收','普通人工任务已经提交，等待有权限的其他人验收。'],
      ['已完成','任务已按对应流程完成；需要交接时再确认成果和下游接收人。']
    ],
    links:[['collaboration','查看组织当前状态']],
    note:'Agent 会显示待执行、运行中等执行状态。暂停、阻塞或执行失败时，查看任务详情和运行记录中的原因。没有操作按钮通常与当前账号权限、任务阶段或前置依赖有关。'
  };
}

function renderUsageGuide(topic) {
  const content=usageGuideContent(topic);
  const body=content.steps?usageGuideSteps(content.steps):`<dl class="usage-guide-status-grid">${content.statuses.map(([label,text])=>`<div class="usage-guide-status"><dt>${escape(label)}</dt><dd>${escape(text)}</dd></div>`).join('')}</dl>`;
  dialog.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">使用指南</h2><p class="dialog-subtitle">小辣椒 · 智能组织</p></div><button class="icon-button" type="button" data-action="close-dialog" aria-label="关闭使用指南">${icon('close')}</button></div>
    <div class="dialog-body usage-guide-panel"><div class="usage-guide-tabs" role="group" aria-label="选择使用主题">${usageGuideTopics.map(([key,label])=>`<button class="button small ${key===topic?'active':''}" type="button" data-guide-topic="${key}" aria-pressed="${key===topic}">${label}</button>`).join('')}</div>
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
