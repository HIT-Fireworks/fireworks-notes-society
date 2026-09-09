"""仓库 description 与 README 的稳定结构身份契约。"""

from __future__ import annotations

import re
from collections import defaultdict
from collections.abc import Mapping, Sequence
from typing import Any

REGISTRY_REPO_ID = "fireworks-course-registry-v2"
COLLECTION_TEMPLATE_REPO_ID = "fireworks-collection-template-v2"
EMPTY_COURSE_SUFFIX = " / 无资料课程"
DESCRIPTION_LIMIT = 350
MAPPING_SEPARATOR = "｜"
GROUP_OPEN = "{"
GROUP_CLOSE = "}"
ENTRY_SEPARATOR = ";"
NAME_SEPARATOR = "="
COURSE_CODE_PATTERN = re.compile(r"(?P<prefix>[0-9]*[A-Za-z]+)(?P<suffix>.+)")
RESERVED_MAPPING_CHARACTERS = {MAPPING_SEPARATOR, GROUP_OPEN, GROUP_CLOSE, ENTRY_SEPARATOR, NAME_SEPARATOR}
TRUNCATION_MARKER_PATTERN = re.compile(r"^…尚余(?P<count>[1-9]\d*)项$")


INVENTORY_PATTERNS = (
    re.compile(r"\d+\s*个(?:逻辑|历史)?资源分组"),
    re.compile(r"\d+\s*个资料共享连通分量"),
    re.compile(r"\d+\s*个资料文件"),
    re.compile(r"(?<![A-Za-z0-9])\d+\s+(?:B|bytes?)\b", re.IGNORECASE),
)
COMMON_GUIDANCE_PATTERNS = (
    "课程元数据以",
    "路由元数据以",
    "special-topic 路由与资料归属",
    "普通内容增删",
    "维护课程路由与资料归属",
)


def umbrella_name(display_name: str) -> str:
    """从展示名提取不依赖当前内容状态的上位语义。"""
    value = display_name.strip()
    if value.endswith(EMPTY_COURSE_SUFFIX):
        value = value[: -len(EMPTY_COURSE_SUFFIX)].rstrip()
    return value


def normalize_course_mapping(
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]] | None,
) -> list[tuple[str, str]]:
    """校验并按课程代码稳定排序。"""
    if course_mapping is None:
        return []
    raw_items = (
        list(course_mapping.items())
        if isinstance(course_mapping, Mapping)
        else list(course_mapping)
    )
    mapping: dict[str, str] = {}
    for raw_code, raw_name in raw_items:
        code = str(raw_code).strip()
        name = str(raw_name).strip()
        if not code or not name or not COURSE_CODE_PATTERN.fullmatch(code):
            raise ValueError(f"非法课程代码或原始课程名：{raw_code!r}={raw_name!r}")
        if any(character in name for character in RESERVED_MAPPING_CHARACTERS):
            raise ValueError(f"原始课程名含保留分隔符：{code}={name!r}")
        prior = mapping.setdefault(code, name)
        if prior != name:
            raise ValueError(f"同一课程代码对应多个原始名称：{code}")
    return sorted(mapping.items(), key=lambda item: natural_code_key(item[0]))


def natural_code_key(code: str) -> tuple[Any, ...]:
    return tuple(
        int(part) if part.isdigit() else part.casefold()
        for part in re.split(r"(\d+)", code)
    )


def encode_course_mapping(
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]],
) -> str:
    """把完整代码→原名映射编码成可逆的紧凑字符串。"""
    grouped: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for code, name in normalize_course_mapping(course_mapping):
        match = COURSE_CODE_PATTERN.fullmatch(code)
        if not match:
            raise AssertionError("课程代码已经过校验")
        grouped[match.group("prefix")].append((match.group("suffix"), name))
    segments = []
    for prefix in sorted(grouped, key=natural_code_key):
        entries = ENTRY_SEPARATOR.join(
            f"{suffix}{NAME_SEPARATOR}{name}" for suffix, name in grouped[prefix]
        )
        segments.append(f"{prefix}{GROUP_OPEN}{entries}{GROUP_CLOSE}")
    return ENTRY_SEPARATOR.join(segments)


def decode_course_mapping(encoded: str) -> dict[str, str]:
    """解码紧凑映射；非法或歧义输入直接失败。"""
    if not encoded:
        return {}
    result: dict[str, str] = {}
    segments = re.findall(r"(?:^|;)([0-9]*[A-Za-z]+)\{([^{}]*)\}", encoded)
    if not segments or ";".join(f"{prefix}{{{body}}}" for prefix, body in segments) != encoded:
        raise ValueError("课程映射编码格式无效")
    for prefix, body in segments:
        if not body:
            raise ValueError("课程映射含空前缀组")
        for entry in body.split(ENTRY_SEPARATOR):
            if entry.count(NAME_SEPARATOR) != 1:
                raise ValueError("课程映射条目格式无效")
            suffix, name = entry.split(NAME_SEPARATOR, 1)
            code = prefix + suffix
            if not suffix or not name or code in result:
                raise ValueError("课程映射条目为空或重复")
            result[code] = name
    normalize_course_mapping(result)
    return result


def course_mapping_projection(
    display_name: str,
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]],
    *,
    limit: int = DESCRIPTION_LIMIT,
) -> dict[str, Any]:
    """生成完整或条目级截断的确定性 description 投影。"""
    semantic_name = umbrella_name(display_name)
    mapping = normalize_course_mapping(course_mapping)
    if not semantic_name or MAPPING_SEPARATOR in semantic_name:
        raise ValueError("课程仓缺少合法稳定上位语义")
    if not mapping:
        return {
            "description": semantic_name,
            "shown_mapping": {},
            "remaining_count": 0,
            "truncated": False,
            "full_length": len(semantic_name),
        }
    full_encoded = encode_course_mapping(mapping)
    full_description = semantic_name + MAPPING_SEPARATOR + full_encoded
    if len(full_description) <= limit:
        return {
            "description": full_description,
            "shown_mapping": dict(mapping),
            "remaining_count": 0,
            "truncated": False,
            "full_length": len(full_description),
        }
    best: list[tuple[str, str]] = []
    for count in range(1, len(mapping)):
        shown = mapping[:count]
        remaining = len(mapping) - count
        candidate = (
            semantic_name
            + MAPPING_SEPARATOR
            + encode_course_mapping(shown)
            + MAPPING_SEPARATOR
            + f"…尚余{remaining}项"
        )
        if len(candidate) <= limit:
            best = shown
    if not best:
        raise ValueError("350 字限制内无法容纳任一完整课程映射条目")
    remaining = len(mapping) - len(best)
    projected = (
        semantic_name
        + MAPPING_SEPARATOR
        + encode_course_mapping(best)
        + MAPPING_SEPARATOR
        + f"…尚余{remaining}项"
    )
    return {
        "description": projected,
        "shown_mapping": dict(best),
        "remaining_count": remaining,
        "truncated": True,
        "full_length": len(full_description),
    }


def course_mapping_description(
    display_name: str,
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]],
    *,
    limit: int = DESCRIPTION_LIMIT,
) -> str:
    return str(
        course_mapping_projection(display_name, course_mapping, limit=limit)[
            "description"
        ]
    )


def parse_course_mapping_description(value: str) -> dict[str, Any]:
    """解析完整或带“尚余 N 项”标记的 description。"""
    parts = value.split(MAPPING_SEPARATOR)
    if len(parts) not in {2, 3} or not parts[0]:
        raise ValueError("课程映射 description 格式无效")
    shown = decode_course_mapping(parts[1])
    remaining = 0
    truncated = False
    if len(parts) == 3:
        marker = TRUNCATION_MARKER_PATTERN.fullmatch(parts[2])
        if not marker:
            raise ValueError("课程映射截断标记无效")
        remaining = int(marker.group("count"))
        truncated = True
    return {
        "semantic_name": parts[0],
        "shown_mapping": shown,
        "remaining_count": remaining,
        "truncated": truncated,
    }


def stable_repository_description(
    repo_type: str,
    display_name: str,
    *,
    repo_id: str | None = None,
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]] | None = None,
) -> str:
    """返回稳定 description；超限课程映射按完整条目截断并标记余量。"""
    semantic_name = umbrella_name(display_name)
    if not semantic_name:
        raise ValueError("仓库 description 缺少稳定语义")
    if repo_type == "course":
        return course_mapping_description(semantic_name, course_mapping or {})
    if repo_type in {"shared", "competition", "collection", "software"}:
        return semantic_name
    if repo_type == "control":
        if repo_id == REGISTRY_REPO_ID:
            return "HIT 全量课程、培养方案记录、仓库绑定与历史资料映射的 v2 权威注册表"
        return "HIT-Fireworks v2 课程仓库的创建、索引、校验与聚合工作流"
    if repo_type == "template":
        if repo_id == COLLECTION_TEMPLATE_REPO_ID:
            return "HIT-Fireworks 非课程资料仓模板"
        return "薪火笔记社多代码课程资料仓库 v2 模板"
    raise ValueError(f"不支持的 repo_type：{repo_type}")


def course_mapping_table(
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]],
) -> str:
    mapping = normalize_course_mapping(course_mapping)
    if not mapping:
        return ""
    rows = "".join(f"| `{code}` | {name} |\n" for code, name in mapping)
    return "## 课程代码与原始课程名\n\n| 课程代码 | 原始课程名 |\n|---|---|\n" + rows


def repository_readme(
    *,
    repo_type: str,
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]] | None = None,
) -> str:
    """生成通用维护指引；course README 始终附完整映射表。"""
    role = {
        "course": "课程资料物理仓",
        "shared": "非课程共享资料仓",
        "competition": "竞赛资料仓",
        "control": "控制面仓库",
        "template": "仓库模板",
    }.get(repo_type, "托管资料仓")
    guidance = (
        f"# 薪火笔记社{role}\n\n"
        "本仓库由 [HIT-Fireworks 课程注册表 v2]"
        f"(https://github.com/HIT-Fireworks/{REGISTRY_REPO_ID}) 统一维护身份与索引。\n\n"
        "## 维护约定\n\n"
        "- GitHub description 按稳定顺序展示尽可能多的完整代码→原始课程名条目。\n"
        "- 超过 350 字时以“尚余 N 项”明确标记截断；不得在代码或课程名中间硬截断。\n"
        "- 完整课程映射始终以本 README 与 Registry 为准。\n"
        "- 文件库存、容量和内容分类属于 Registry 或审计索引，不写入 description。\n"
        "- 普通内容增删不应触发 description 更新；课程代码成员或原始课程名变化时才更新。\n"
        "- 仓库是唯一资源归属边界，需要独立维护的资料通过拆仓表达，不建立仓内资源组。\n"
        "- 资料按预设中文分类存放：教材、笔记、课件、试卷、作业、实验、软件、教程、模板、项目、其他；只创建实际需要的分类。\n"
        "- 不得自行新增根级分类目录；新增分类须先统一调整管理规则。根目录仅保留 README、LICENSE 和仓库配置。\n"
        "- 分类只区分资料用途，不是资源组；软件包、代码项目与多文件文档放入对应分类并保留完整内部结构。\n"
        "- 课程与文件直接归属仓库，共仓本身不产生资料共享关系。\n\n"
    )
    if repo_type == "course":
        guidance += course_mapping_table(course_mapping or {})
    return guidance


def description_contract_violations(
    description: str,
    *,
    repo_type: str,
    repo_id: str | None = None,
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]] | None = None,
) -> list[str]:
    """返回违反稳定 description 与课程映射契约的原因。"""
    value = description.strip()
    violations: list[str] = []
    if not value:
        violations.append("missing-description")
    if len(value) > DESCRIPTION_LIMIT:
        violations.append("description-too-long")
    if any(pattern.search(value) for pattern in INVENTORY_PATTERNS):
        violations.append("inventory-coupled-description")
    if "当前无资料" in value or "无资料课程代码集合" in value:
        violations.append("current-content-state-description")
    if value.startswith("资料共享连通分量课程仓"):
        violations.append("implementation-description")
    if value.startswith("历史资料分类：") or value.startswith("历史资料："):
        violations.append("historical-classification-description")
    if repo_id == COLLECTION_TEMPLATE_REPO_ID and (
        "collection" in value.casefold() or "software" in value.casefold()
    ):
        violations.append("obsolete-template-role-description")
    if any(pattern in value for pattern in COMMON_GUIDANCE_PATTERNS):
        violations.append("readme-guidance-in-description")
    if repo_type == "course":
        expected_mapping = dict(normalize_course_mapping(course_mapping or {}))
        semantic_name = value.split(MAPPING_SEPARATOR, 1)[0]
        try:
            expected_projection = course_mapping_projection(
                semantic_name, expected_mapping
            )
        except ValueError:
            violations.append("invalid-course-mapping-projection")
        else:
            if value != expected_projection["description"]:
                violations.append("noncanonical-course-mapping-projection")
            try:
                parsed = parse_course_mapping_description(value)
            except ValueError:
                if expected_mapping:
                    violations.append("invalid-course-mapping")
            else:
                expected_shown = expected_projection["shown_mapping"]
                if (
                    parsed["shown_mapping"] != expected_shown
                    or parsed["remaining_count"]
                    != expected_projection["remaining_count"]
                    or parsed["truncated"] != expected_projection["truncated"]
                ):
                    violations.append("incomplete-or-mismatched-course-mapping")
    return violations
def stable_description_for(
    repository: Mapping[str, Any],
    *,
    course_mapping: Mapping[str, str] | Sequence[tuple[str, str]] | None = None,
) -> str:
    return stable_repository_description(
        str(repository["repo_type"]),
        str(repository.get("display_name") or repository["repo_id"]),
        repo_id=str(repository["repo_id"]),
        course_mapping=course_mapping,
    )
