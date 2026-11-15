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
        raise ValueError("Skill JSON must be an object.")
    unknown = set(value) - FIELDS
    if reject_unknown and unknown:
        raise ValueError("Non-Skill fields cannot be modified: " + ", ".join(sorted(unknown)))
    warnings = ["Ignored unknown metadata: " + str(key) + "; it does not grant any system permissions." for key in sorted(unknown)]
    result = {}
    for field in TEXT_FIELDS:
        item = value.get(field, "both" if field == "provider_type" else "1.0.0" if field == "version" else "")
        if not isinstance(item, str):
            raise ValueError(f"Skill {field} must be a string.")
        result[field] = item.strip()
    if not result["name"] or not result["description"]:
        raise ValueError("A Skill requires non-empty name and description fields.")
    if len(result["name"]) > 200 or len(result["description"]) > 4000 or len(result["version"]) > 100:
        raise ValueError("Skill name, description or version is too long. Limits are 200, 4000 and 100 characters respectively.")
    if not result["version"]:
        raise ValueError("Skill version cannot be empty.")
    if result["provider_type"] not in ("human", "agent", "both"):
        raise ValueError("provider_type must be human, agent or both.")
    for field in LIST_FIELDS:
        items = value.get(field, [])
        if not isinstance(items, list) or len(items) > 50 or any(not isinstance(item, str) or not item.strip() or len(item) > 300 for item in items):
            raise ValueError(f"Skill {field} must be an array of at most 50 non-empty strings, each no longer than 300 characters.")
        result[field] = list(dict.fromkeys(item.strip() for item in items))
    examples = value.get("examples", [])
    if not isinstance(examples, list) or len(examples) > 20:
        raise ValueError("Skill examples must be an array of at most 20 items.")
    result["examples"] = []
    for example in examples:
        if not isinstance(example, dict) or set(example) != {"input", "output"} or any(not isinstance(example[k], str) for k in ("input", "output")):
            raise ValueError("Each example must contain exactly two string fields: input and output.")
        result["examples"].append({"input": example["input"].strip(), "output": example["output"].strip()})
    if len(json.dumps(result, ensure_ascii=False)) > 100000:
        raise ValueError("The normalized Skill exceeds 100,000 characters.")
    return result, warnings


def normalized_sha256(skill):
    return sha256(json.dumps(skill, sort_keys=True, ensure_ascii=False, separators=(",", ":")))


def _json_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON field: " + key)
        result[key] = value
    return result


def _markdown(content):
    text = content.lstrip("\ufeff")
    if not text.startswith("---\n") and not text.startswith("---\r\n"):
        raise ValueError("A Markdown Skill requires flat frontmatter (name, description, etc.) enclosed by --- lines.")
    lines = text.splitlines()
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise ValueError("The Skill frontmatter is missing its closing --- line.") from None
    metadata = {}
    for line in lines[1:end]:
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line[0].isspace() or ":" not in line:
            raise ValueError("Only flat frontmatter is supported. Indentation, nested objects and multiline YAML are not supported.")
        key, value = line.split(":", 1)
        key, value = key.strip(), value.strip()
        if not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_-]*", key) or key in metadata:
            raise ValueError("Invalid or duplicate frontmatter field: " + key)
        if not value or value.startswith(("|", ">", "&", "*", "!", "{")):
            raise ValueError("Complex YAML, anchors, objects, tags and multiline scalars are not supported: " + key)
        if value.startswith('"'):
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                raise ValueError("Double-quoted frontmatter values must use valid JSON string escaping: " + key) from None
        elif value.startswith("'"):
            if not value.endswith("'") or len(value) < 2:
                raise ValueError("Unclosed single quote in frontmatter: " + key)
            value = value[1:-1].replace("''", "'")
        elif value.startswith("["):
            if key not in LIST_FIELDS:
                raise ValueError("Only tags and tools support simple JSON string arrays.")
            try:
                value = json.loads(value)
            except json.JSONDecodeError:
                raise ValueError("tags/tools must use JSON string arrays, for example [\"analysis\"].") from None
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
                    raise ValueError("Duplicate level-two Skill section: " + match.group(1))
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
                warnings.append("No input:/output: pairs were found in the Examples section. The original text is retained in the source package. Complete examples before importing.")
        else:
            metadata[key] = section
    if not metadata.get("instructions") and body:
        metadata["instructions"] = body
        warnings.append("No separate Instructions section was found. The body is used as instructions only; inputs, outputs and acceptance may still be incomplete.")
    elif any(line.strip() for line in preamble):
        warnings.append("The introduction and unrecognized body sections are retained in the source package. They do not become system instructions.")
    return metadata, warnings


def parse_skill(content, source_name="SKILL.md"):
    if not isinstance(content, str) or not content.strip() or len(content) > 100000 or "\x00" in content:
        raise ValueError("Skill content must be text containing 1 to 100,000 characters and no NUL bytes.")
    if not isinstance(source_name, str) or len(source_name) > 500:
        raise ValueError("source_name must be a filename of at most 500 characters.")
    suffix = source_name.lower().rsplit(".", 1)[-1] if "." in source_name else ""
    if suffix and suffix not in ("md", "markdown", "json", "txt"):
        raise ValueError("Only Markdown, JSON and plain-text Skills are supported. ZIP archives and executable files are not accepted.")
    warnings = []
    is_json = content.lstrip("\ufeff \r\n\t").startswith(("{", "[")) or suffix == "json"
    if is_json:
        try:
            value = json.loads(content.lstrip("\ufeff"), object_pairs_hook=_json_object)
        except (json.JSONDecodeError, RecursionError):
            raise ValueError("Skill JSON is invalid or nested too deeply.") from None
        format_name = "json"
    else:
        value, warnings = _markdown(content)
        format_name = "markdown"
    skill, validation_warnings = normalize_skill(value)
    warnings.extend(validation_warnings)
    missing = [key for key in ("inputs", "outputs", "acceptance") if not skill[key]]
    if skill["tools"]:
        warnings.append("Tools are declared dependencies only. Uploading a Skill does not install dependencies, execute scripts, read paths or grant tool permissions.")
    return {"skill": skill, "warnings": warnings, "missing_fields": missing, "source_sha256": sha256(content), "normalized_sha256": normalized_sha256(skill), "format": format_name}
