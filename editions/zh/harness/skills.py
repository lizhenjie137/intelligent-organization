"""Parse declarative Skill text. No YAML evaluator, imports, or code execution."""

import hashlib
import json
import re


TEXT_FIELDS = {"name", "description", "version", "provider_type", "inputs", "outputs", "acceptance", "instructions", "limitations"}
LIST_FIELDS = {"tags", "tools"}
FIELDS = TEXT_FIELDS | LIST_FIELDS | {"examples"}
SECTION_NAMES = {
    "输入要求": "inputs", "输入": "inputs", "inputs": "inputs", "input": "inputs",
    "输出要求": "outputs", "输出": "outputs", "outputs": "outputs", "output": "outputs",
    "验收标准": "acceptance", "acceptance": "acceptance", "acceptance criteria": "acceptance",
    "执行步骤": "instructions", "instructions": "instructions", "steps": "instructions",
    "适用边界": "limitations", "边界": "limitations", "limitations": "limitations",
    "示例": "examples", "examples": "examples",
    "工具依赖": "tools", "tools": "tools",
}


def sha256(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def normalize_skill(value, *, reject_unknown=False):
    """Validate canonical field types without evaluating any declared behavior."""
    if not isinstance(value, dict):
        raise ValueError("Skill JSON 必须是对象")
    unknown = set(value) - FIELDS
    if reject_unknown and unknown:
        raise ValueError("不允许修改非 Skill 字段：" + "、".join(sorted(unknown)))
    warnings = ["忽略未知 metadata：" + str(key) + "；它不会获得任何系统权限" for key in sorted(unknown)]
    result = {}
    for field in TEXT_FIELDS:
        item = value.get(field, "both" if field == "provider_type" else "1.0.0" if field == "version" else "")
        if not isinstance(item, str):
            raise ValueError(f"Skill 的 {field} 必须是字符串")
        result[field] = item.strip()
    if not result["name"] or not result["description"]:
        raise ValueError("Skill 必须提供非空 name 和 description")
    if len(result["name"]) > 200 or len(result["description"]) > 4000 or len(result["version"]) > 100:
        raise ValueError("Skill 名称/介绍/版本过长（上限分别为 200/4000/100 字符）")
    if not result["version"]:
        raise ValueError("Skill version 不能为空")
    if result["provider_type"] not in ("human", "agent", "both"):
        raise ValueError("provider_type 必须为 human、agent 或 both")
    for field in LIST_FIELDS:
        items = value.get(field, [])
        if not isinstance(items, list) or len(items) > 50 or any(not isinstance(item, str) or not item.strip() or len(item) > 300 for item in items):
            raise ValueError(f"Skill 的 {field} 必须是最多 50 项非空字符串数组，每项不超过 300 字符")
        result[field] = list(dict.fromkeys(item.strip() for item in items))
    examples = value.get("examples", [])
    if not isinstance(examples, list) or len(examples) > 20:
        raise ValueError("Skill examples 必须是最多 20 项的数组")
    result["examples"] = []
    for example in examples:
        if not isinstance(example, dict) or set(example) != {"input", "output"} or any(not isinstance(example[k], str) for k in ("input", "output")):
            raise ValueError("每个 example 必须且只能包含字符串 input 和 output")
        result["examples"].append({"input": example["input"].strip(), "output": example["output"].strip()})
    if len(json.dumps(result, ensure_ascii=False)) > 100000:
        raise ValueError("规范化 Skill 超过 100,000 字符")
    return result, warnings


def normalized_sha256(skill):
    return sha256(json.dumps(skill, sort_keys=True, ensure_ascii=False, separators=(",", ":")))


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("JSON 字段重复：" + key)
        result[key] = value
    return result


def _markdown(content):
    text = content.lstrip("\ufeff")
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        raise ValueError("Markdown Skill 需要以 --- 包围的平面 frontmatter（name、description 等）")
    lines = text.splitlines()
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise ValueError("Skill frontmatter 缺少结束的 ---") from None
    metadata = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0].isspace() or ":" not in line:
            raise ValueError("只支持平面 frontmatter；不支持缩进、嵌套对象或多行 YAML")
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key) or key in metadata:
            raise ValueError("frontmatter 字段名无效或重复：" + key)
        if not value or value.startswith(("|", ">", "&", "*", "!", "{")):
            raise ValueError("不支持复杂 YAML、锚点、对象、标签或多行标量：" + key)
        if value.startswith('"'):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                raise ValueError("双引号 frontmatter 值必须使用合法 JSON 字符串转义：" + key) from None
        elif value.startswith("'"):
            if not value.endswith("'") or len(value) < 2:
                raise ValueError("frontmatter 单引号未闭合：" + key)
            value = value[1:-1].replace("''", "'")
        elif value.startswith("["):
            if key not in LIST_FIELDS:
                raise ValueError("只有 tags/tools 支持简单 JSON 字符串数组")
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                raise ValueError("tags/tools 必须使用 JSON 字符串数组，例如 [\"分析\"]") from None
        metadata[key] = value
    body = "\n".join(lines[end + 1:]).strip()
    sections = {}
    current = None
    preamble = []
    for line in body.splitlines():
        match = re.match(r"^##\s+(.+?)\s*#*\s*$", line)
        if match:
            current = SECTION_NAMES.get(match.group(1).strip().lower())
            if current:
                if current in sections:
                    raise ValueError("Skill 二级章节重复：" + match.group(1))
                sections[current] = []
            else:
                preamble.append(line)
        elif current:
            sections[current].append(line)
        else:
            preamble.append(line)
    warnings = []
    for key, section_lines in sections.items():
        section = "\n".join(section_lines).strip()
        if key == "tools":
            metadata[key] = [re.sub(r"^\s*(?:[-*+]\s+|\d+[.)]\s+)", "", line).strip() for line in section_lines if line.strip()]
            metadata[key] = [item for item in metadata[key] if item.lower() not in ("无", "无。", "none", "none.")]
        elif key == "examples":
            pairs = []
            # One or more explicit Input/Output pairs, preserving multiline values.
            example_input, example_output, part = [], [], None
            for line in section_lines:
                match = re.match(r"^\s*(?:[-*]\s*)?(输入|输出|input|output)\s*[:：]\s*(.*)$", line, re.I)
                if match:
                    is_input = match.group(1).lower() in ("输入", "input")
                    if is_input and example_output:
                        pairs.append({"input": "\n".join(example_input).strip(), "output": "\n".join(example_output).strip()})
                        example_input, example_output = [], []
                    part = example_input if is_input else example_output
                    part.append(match.group(2))
                elif part is not None:
                    part.append(line)
            if example_input and example_output:
                pairs.append({"input": "\n".join(example_input).strip(), "output": "\n".join(example_output).strip()})
            metadata[key] = pairs
            if section and not pairs:
                warnings.append("示例章节未识别到 输入:/输出: 配对；原文保留在来源包中，请在导入前补齐 examples")
        else:
            metadata[key] = section
    if not metadata.get("instructions") and body:
        metadata["instructions"] = body
        warnings.append("未找到独立执行步骤章节，正文仅作为 instructions；不代表输入/输出/验收完整")
    elif any(line.strip() for line in preamble):
        warnings.append("正文中的前言或未知章节保留在来源包，不自动转为系统指令")
    return metadata, warnings


def parse_skill(content, source_name="SKILL.md"):
    if not isinstance(content, str) or not content.strip() or len(content) > 100000 or "\x00" in content:
        raise ValueError("Skill 内容必须是 1–100,000 字符的文本，不能包含 NUL")
    if not isinstance(source_name, str) or len(source_name) > 500:
        raise ValueError("source_name 必须是至多 500 字符的文件名")
    suffix = source_name.lower().rsplit(".", 1)[-1] if "." in source_name else ""
    if suffix and suffix not in ("md", "markdown", "json", "txt"):
        raise ValueError("仅支持 Markdown、JSON 或纯文本 Skill，不接受 ZIP 或可执行文件")
    warnings = []
    is_json = content.lstrip("\ufeff \r\n\t").startswith(("{", "[")) or suffix == "json"
    if is_json:
        try:
            value = json.loads(content.lstrip("\ufeff"), object_pairs_hook=_json_object)
        except (json.JSONDecodeError, RecursionError):
            raise ValueError("Skill JSON 格式无效或嵌套过深") from None
        format_name = "json"
    else:
        value, warnings = _markdown(content)
        format_name = "markdown"
    skill, validation_warnings = normalize_skill(value)
    warnings.extend(validation_warnings)
    missing = [key for key in ("inputs", "outputs", "acceptance") if not skill[key]]
    if skill["tools"]:
        warnings.append("工具仅是能力依赖声明；上传不会安装依赖、执行脚本、读取路径或授予工具权限")
    return {"skill": skill, "warnings": warnings, "missing_fields": missing, "source_sha256": sha256(content), "normalized_sha256": normalized_sha256(skill), "format": format_name}
