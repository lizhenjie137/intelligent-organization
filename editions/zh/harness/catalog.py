"""The small initial capability vocabulary and explicit workflow template."""

CAPABILITIES = [
    {"id": "analyze", "name": "澄清目标与约束", "description": "将目标和已有资料整理为范围、约束和待验证问题。", "input_schema": "目标、背景资料、验收标准", "output_schema": "目标解释、已知信息、缺失信息、工作边界", "acceptance": "明确区分提供的事实、假设和待确认事项", "version": "1.0"},
    {"id": "draft", "name": "编制行动方案", "description": "根据已澄清的目标形成可评审的工作方案。", "input_schema": "目标解释、约束、验收标准、返工意见", "output_schema": "行动步骤、交付清单、责任建议、验证方法", "acceptance": "行动与验收标准逐项对应；不声称已执行外部业务动作", "version": "1.0"},
    {"id": "review", "name": "检查交付质量", "description": "对照标准指出方案的覆盖情况和待处理问题。", "input_schema": "方案、验收标准、来源资料", "output_schema": "覆盖情况、缺口、风险、人工复核清单", "acceptance": "保留具体问题与证据；不能代替人的最终验收", "version": "1.0"},
    {"id": "approve", "name": "人工验收与决策", "description": "由人审阅方案及检查结果，给出通过或退回意见。", "input_schema": "方案、质量检查、验收标准", "output_schema": "明确的验收决定及理由", "acceptance": "人工提交非空验收意见；退回后重新起草和评审", "version": "1.0"},
    {"id": "reflect", "name": "整理执行复盘", "description": "将流程结果、验收意见和改进建议整理成可追溯记录。", "input_schema": "完整执行记录与人工验收意见", "output_schema": "执行摘要、经验候选、局限和后续验证点", "acceptance": "引用来源目标；区分流程完成和业务结果；标明实际执行方式和来源", "version": "1.0"},
    {"id": "business_research", "name": "开展业务研究", "description": "围绕业务问题比较可追溯资料，形成有依据的研究结论。", "input_schema": "研究问题、资料范围、来源", "output_schema": "证据清单、比较结论、限制与建议", "acceptance": "结论可追溯到来源，区分事实与推断", "version": "1.0"},
    {"id": "data_analysis", "name": "分析业务数据", "description": "清洗并解释数据，以明确口径支持业务判断。", "input_schema": "数据、字段定义、分析问题", "output_schema": "口径、分析过程、结果、异常与复核方法", "acceptance": "保留原始数据来源，计算可复核，不夸大因果", "version": "1.0"},
    {"id": "content_writing", "name": "创作业务内容", "description": "面向明确受众与目的形成可审阅的内容交付。", "input_schema": "受众、目的、资料、风格与限制", "output_schema": "内容稿、引用来源、修订说明", "acceptance": "符合受众与要求，事实可核验，保留人工审校", "version": "1.0"},
]

SUGGESTION_KEYWORDS = {
    "analyze": ["需求分析", "目标分析", "需求澄清", "约束条件"],
    "draft": ["行动方案", "项目方案", "计划编制", "实施计划"],
    "review": ["质量检查", "验收清单", "质量审核", "测试报告"],
    "reflect": ["复盘", "经验总结", "改进建议"],
    "business_research": ["市场调研", "竞品分析", "业务研究", "用户访谈"],
    "data_analysis": ["数据分析", "数据清洗", "统计分析", "SQL", "Excel"],
    "content_writing": ["文案", "内容写作", "文章", "内容创作", "编辑"],
}

ACTORS = [
    {"id": "analyst", "name": "目标分析 Agent", "type": "agent", "role": "澄清目标，识别信息缺口", "capability_ids": ["analyze"], "permissions": ["analyze"], "available": True},
    {"id": "planner", "name": "方案 Agent", "type": "agent", "role": "生成可评审行动方案", "capability_ids": ["draft"], "permissions": ["draft"], "available": True},
    {"id": "reviewer", "name": "质量 Agent", "type": "agent", "role": "对照验收标准检查交付", "capability_ids": ["review"], "permissions": ["review"], "available": True},
    {"id": "owner", "name": "目标负责人", "type": "human", "role": "人工验收、退回与最终决策", "capability_ids": ["approve"], "permissions": ["approve"], "available": True},
    {"id": "librarian", "name": "复盘 Agent", "type": "agent", "role": "整理经验候选与来源记录", "capability_ids": ["reflect"], "permissions": ["reflect"], "available": True},
]

WORKFLOW = [
    ("澄清目标", "analyze", "low"),
    ("形成行动方案", "draft", "medium"),
    ("检查方案质量", "review", "medium"),
    ("人工验收", "approve", "high"),
    ("复盘与沉淀", "reflect", "low"),
]

for capability in CAPABILITIES:
    capability.setdefault("provider_type", "human" if capability["id"] == "approve" else "both")
    capability.setdefault("instructions", "按输入要求准备资料，形成指定输出，并逐项对照验收标准；不执行未获授权的外部动作。")
    capability.setdefault("limitations", "文本交付须核验；工具与业务动作需要独立适配和授权。")
    capability.setdefault("tools", [])
    capability.setdefault("tags", [])
    capability.setdefault("examples", [])
    capability.setdefault("scope", "organization")

for actor in ACTORS:
    actor.setdefault("profile", actor["role"])
