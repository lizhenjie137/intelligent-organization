"use strict";

// Product labels are presentation-only. Original records and evidence stay intact.
function productName(value) {
  return String(value ?? '')
    .replace(/^(?:演示|示例)[：:]\s*/u, '')
    .replace(/\s*[（(](?:演示|示例)[）)]\s*$/u, '');
}

function productSourceLabel(record) {
  if (record?.is_example === true) return 'Historical test record';
  if (record?.mode === 'demo' || record?.output_mode === 'demo') return 'Rule-based run';
  return '';
}

function productProgress(value, goal) {
  const text=String(value ?? '');
  return goal?.is_example === true ? text.replace(/^公开演示进展[：:]\s*/u, '') : text;
}

function productActivityLabel(type) {
  return ({assigned:'Task assigned',accepted:'Task accepted',work_started:'Work started',progress_updated:'Progress updated',work_submitted:'Deliverable submitted',review_passed:'Review passed',review_rejected:'Returned for revision',work_update_published:'Progress update published',handoff_created:'Handoff sent',handoff_responded:'Handoff response'})[type] || 'Task updated';
}
