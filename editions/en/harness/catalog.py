"""The small initial capability vocabulary and explicit workflow template."""

CAPABILITIES = [
    {"id": "analyze", "name": "Clarify goals and constraints", "description": "Turn goals and source material into scope, constraints and questions to verify.", "input_schema": "Goal, background material, acceptance criteria", "output_schema": "Goal interpretation, known facts, missing information, work boundaries", "acceptance": "Distinguish supplied facts, assumptions and open questions.", "version": "1.0"},
    {"id": "draft", "name": "Draft an action plan", "description": "Create a reviewable action plan from the clarified goal.", "input_schema": "Goal interpretation, constraints, acceptance criteria, revision feedback", "output_schema": "Action steps, deliverables, suggested owners, validation methods", "acceptance": "Map actions to acceptance criteria; do not claim external business actions have been performed.", "version": "1.0"},
    {"id": "review", "name": "Review deliverable quality", "description": "Check coverage against the criteria and identify unresolved issues.", "input_schema": "Plan, acceptance criteria, source material", "output_schema": "Coverage, gaps, risks, human review checklist", "acceptance": "Record specific issues and evidence; do not replace final human approval.", "version": "1.0"},
    {"id": "approve", "name": "Human review and approval", "description": "A member reviews the plan and quality findings, then approves or requests changes.", "input_schema": "Plan, quality review, acceptance criteria", "output_schema": "Explicit review decision and rationale", "acceptance": "A member must submit review feedback; changes require a new draft and review.", "version": "1.0"},
    {"id": "reflect", "name": "Document the retrospective", "description": "Create a traceable record of workflow results, review feedback and improvements.", "input_schema": "Complete execution history and human review feedback", "output_schema": "Execution summary, candidate lessons, limitations and follow-up checks", "acceptance": "Reference the source goal, distinguish workflow completion from business results, and identify the actual execution mode and sources.", "version": "1.0"},
    {"id": "business_research", "name": "Conduct business research", "description": "Compare traceable sources to develop evidence-based findings for a business question.", "input_schema": "Research question, scope of materials, sources", "output_schema": "Evidence list, comparative findings, limitations and recommendations", "acceptance": "Trace conclusions to sources and distinguish facts from inferences.", "version": "1.0"},
    {"id": "data_analysis", "name": "Analyze business data", "description": "Clean and interpret data using explicit definitions to support business decisions.", "input_schema": "Data, field definitions, analysis questions", "output_schema": "Definitions, analysis method, results, anomalies and validation methods", "acceptance": "Preserve original sources, make calculations reproducible, and avoid overstating causality.", "version": "1.0"},
    {"id": "content_writing", "name": "Write business content", "description": "Create reviewable content for a defined audience and purpose.", "input_schema": "Audience, purpose, sources, style and constraints", "output_schema": "Content draft, cited sources, revision notes", "acceptance": "Meet audience needs and requirements, keep facts verifiable, and retain human editorial review.", "version": "1.0"},
]

SUGGESTION_KEYWORDS = {
    "analyze": ["requirements analysis", "goal analysis", "requirements clarification", "constraints", "需求分析", "目标分析", "需求澄清", "约束条件"],
    "draft": ["action plan", "project plan", "implementation plan", "planning", "行动方案", "项目方案", "计划编制", "实施计划"],
    "review": ["quality review", "acceptance checklist", "quality assurance", "test report", "质量检查", "验收清单", "质量审核", "测试报告"],
    "reflect": ["retrospective", "lessons learned", "improvement recommendations", "复盘", "经验总结", "改进建议"],
    "business_research": ["market research", "competitor analysis", "business research", "user interview", "市场调研", "竞品分析", "业务研究", "用户访谈"],
    "data_analysis": ["data analysis", "data cleaning", "statistical analysis", "数据分析", "数据清洗", "统计分析", "SQL", "Excel"],
    "content_writing": ["copywriting", "content writing", "article", "content creation", "editing", "文案", "内容写作", "文章", "内容创作", "编辑"],
}

ACTORS = [
    {"id": "analyst", "name": "Goal Analysis Agent", "type": "agent", "role": "Clarify goals and identify information gaps", "capability_ids": ["analyze"], "permissions": ["analyze"], "available": True},
    {"id": "planner", "name": "Planning Agent", "type": "agent", "role": "Create reviewable action plans", "capability_ids": ["draft"], "permissions": ["draft"], "available": True},
    {"id": "reviewer", "name": "Quality Review Agent", "type": "agent", "role": "Check deliverables against acceptance criteria", "capability_ids": ["review"], "permissions": ["review"], "available": True},
    {"id": "owner", "name": "Goal owner", "type": "human", "role": "Human review, requests for changes and final decisions", "capability_ids": ["approve"], "permissions": ["approve"], "available": True},
    {"id": "librarian", "name": "Retrospective Agent", "type": "agent", "role": "Organize candidate lessons and source records", "capability_ids": ["reflect"], "permissions": ["reflect"], "available": True},
]

WORKFLOW = [
    ("Clarify the goal", "analyze", "low"),
    ("Draft the action plan", "draft", "medium"),
    ("Review the plan", "review", "medium"),
    ("Human review", "approve", "high"),
    ("Record the retrospective", "reflect", "low"),
]

for capability in CAPABILITIES:
    capability.setdefault("provider_type", "human" if capability["id"] == "approve" else "both")
    capability.setdefault("instructions", "Prepare the required inputs, produce the specified output and check each acceptance criterion. Do not perform unauthorized external actions.")
    capability.setdefault("limitations", "Text deliverables require verification. Tools and business actions need separate integration and authorization.")
    capability.setdefault("tools", [])
    capability.setdefault("tags", [])
    capability.setdefault("examples", [])
    capability.setdefault("scope", "organization")

for actor in ACTORS:
    actor.setdefault("profile", actor["role"])
