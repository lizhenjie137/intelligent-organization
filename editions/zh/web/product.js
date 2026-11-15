"use strict";

// Product labels are presentation-only. Original records and evidence stay intact.
function productName(value) {
  return String(value ?? '')
    .replace(/^(?:演示|示例)[：:]\s*/u, '')
    .replace(/\s*[（(](?:演示|示例)[）)]\s*$/u, '');
}

function productSourceLabel(record) {
  if (record?.is_example === true) return '历史验证记录';
  if (record?.mode === 'demo' || record?.output_mode === 'demo') return '规则运行';
  return '';
}

function productProgress(value, goal) {
  const text=String(value ?? '');
  return goal?.is_example === true ? text.replace(/^公开演示进展[：:]\s*/u, '') : text;
}

function productActivityLabel(type) {
  return ({assigned:'分派任务',accepted:'接取任务',work_started:'开始工作',progress_updated:'更新工作进展',work_submitted:'提交交付',review_passed:'验收通过',review_rejected:'退回返工',work_update_published:'发布阶段成果',handoff_created:'发送成果交接',handoff_responded:'回复成果交接'})[type] || '更新任务记录';
}
