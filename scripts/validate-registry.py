#!/usr/bin/env python3
"""低内存核验直接归仓 Registry、教学计划索引及资料分类。"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from pathlib import Path

MARKER = '$fireworks_shards'
GROUP_FIELDS = {'resource_groups', 'resource_group_id', 'member_resource_group_ids', 'component_id'}


class Invalid(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise Invalid(message)


def unique_object(items):
    result = {}
    for key, value in items:
        require(key not in result, f'JSON 键重复：{key}')
        result[key] = value
    return result


def parse(content):
    return json.loads(content, object_pairs_hook=unique_object,
                      parse_constant=lambda value: (_ for _ in ()).throw(Invalid(f'非法 JSON 数值：{value}')))


def safe_path(value):
    require(isinstance(value, str) and value and not any(c in value for c in '\\:\x00'), f'非法路径：{value!r}')
    require(all(p not in {'', '.', '..', '.git'} for p in value.split('/')), f'非法路径：{value}')
    return value


class Store:
    def __init__(self, path):
        self.path = Path(path)
        self.parent = self.path.parent
        self.verified = set()
        self.dependencies = {self.path}
        self.raw = self.read(self.path)

    def read(self, path):
        require(not path.is_symlink() and path.is_file(), f'缺失文件或链接：{path}')
        require(path.stat().st_size <= 8 * 1024 * 1024, f'JSON 未分片或超限：{path}')
        return parse(path.read_bytes())

    def parts(self, ref, stack=()):
        require(len(stack) < 128, '分片嵌套过深')
        require(isinstance(ref, dict) and set(ref) == {MARKER, 'kind', 'parts'} and type(ref[MARKER]) is int and ref[MARKER] == 1, '分片引用格式无效')
        kind = ref['kind']
        require(kind in {'array', 'object'} and isinstance(ref['parts'], list) and ref['parts'], '分片容器无效')
        directory = self.parent / '.fireworks-json'
        require(not directory.is_symlink(), f'分片目录不得为链接：{directory}')
        for part in ref['parts']:
            require(isinstance(part, dict) and set(part) == {'bytes', 'sha256'}, '分片条目无效')
            digest = part['sha256']
            require(isinstance(digest, str) and re.fullmatch('[a-f0-9]{64}', digest), '分片摘要无效')
            require(digest not in stack, '分片循环引用')
            require(type(part['bytes']) is int and 0 <= part['bytes'] <= 8 * 1024 * 1024, '分片字节数无效')
            path = directory / (digest + '.json')
            require(not path.is_symlink() and path.is_file(), f'缺少分片：{path}')
            data = path.read_bytes()
            require(len(data) == part['bytes'] and hashlib.sha256(data).hexdigest() == digest, f'分片内容校验失败：{path}')
            value = parse(data)
            require(isinstance(value, list if kind == 'array' else dict) and not (isinstance(value, dict) and MARKER in value), '分片容器类型不一致')
            self.dependencies.add(path)
            yield digest, value, stack + (digest,)

    def verify(self, value=None, stack=(), depth=0):
        if value is None:
            value = self.raw
        require(depth < 128, 'JSON 嵌套过深')
        if isinstance(value, dict) and MARKER in value:
            keys = set()
            for digest, part, child_stack in self.parts(value, stack):
                if isinstance(part, dict):
                    require(not keys.intersection(part), '对象分片包含重复键')
                    keys.update(part)
                if digest not in self.verified:
                    self.verify(part, child_stack, depth + 1)
                    self.verified.add(digest)
        elif isinstance(value, dict):
            for child in value.values():
                if child is not None:
                    self.verify(child, stack, depth + 1)
        elif isinstance(value, list):
            for child in value:
                if child is not None:
                    self.verify(child, stack, depth + 1)

    def items(self, value, kind):
        expected = list if kind == 'array' else dict
        if isinstance(value, dict) and MARKER in value:
            require(value['kind'] == kind, '分片集合类型不一致')
            keys = set()
            for _, part, _ in self.parts(value):
                if kind == 'object':
                    require(not keys.intersection(part), '对象分片键重复')
                    keys.update(part)
                yield from (part if kind == 'array' else part.items())
        else:
            require(isinstance(value, expected), f'预期 {kind} 集合')
            yield from (value if kind == 'array' else value.items())

    def object(self, value=None):
        return dict(self.items(self.raw if value is None else value, 'object'))

    def expand(self, value):
        if isinstance(value, dict):
            if MARKER in value:
                if value['kind'] == 'array':
                    return [self.expand(v) for v in self.items(value, 'array')]
                return {k: self.expand(v) for k, v in self.items(value, 'object')}
            return {k: self.expand(v) for k, v in value.items()}
        if isinstance(value, list):
            return [self.expand(v) for v in value]
        return value


def reject_groups(value):
    require(not GROUP_FIELDS.intersection(value), '有效数据仍含旧资源组字段')


def locations(root):
    root = Path(root)
    if (root / 'repository-manifest.json').is_file():
        return [root / n for n in ['repository-manifest.json', 'repository-topology.v4.json', 'repository-file-routes.v4.json']]
    if (root / 'repository-manifest.no-collection.v4.json').is_file():
        return [root / n for n in ['repository-manifest.no-collection.v4.json', 'repository-topology.v4.json', 'repository-file-routes.v4.json']]
    return [root / 'data/repository-manifest.no-collection.v4.json', root / 'config/repository-topology.v4.json', root / 'config/repository-file-routes.v4.json']


def validate(root):
    ms, ts, fs = [Store(p) for p in locations(root)]
    for store in [ms, ts, fs]:
        store.verify()
    manifest, topology, routes = ms.object(), ts.expand(ts.raw), fs.expand(fs.raw)
    reject_groups(manifest)
    require(manifest.get('schema_version') == 2 and topology.get('schema_version') == routes.get('schema_version') == 4, '数据版本不一致')
    require(topology.get('generation') == routes.get('generation'), '路由与拓扑代次不一致')
    repos = topology['repositories']
    listed = {r['repo_id']: r for r in ms.items(manifest['repositories'], 'array')}
    require(set(repos) == set(listed), 'manifest 与 topology 仓库集合不一致')
    owners, physical = {}, set()
    for repo_id, repo in repos.items():
        reject_groups(repo)
        reject_groups(listed[repo_id])
        require(re.fullmatch('[A-Za-z0-9_.-]+', repo_id) and repo['repo_id'] == repo_id, '非法仓库身份')
        pid = repo.get('physical_repository_id')
        if repo['repo_type'] not in {'control', 'template'}:
            require(pid and pid not in physical, f'资料仓物理身份缺失或重复：{repo_id}')
            physical.add(pid)
        require(repo.get('course_codes', []) == listed[repo_id].get('course_codes', []), f'仓库课程成员不一致：{repo_id}')
        for code in repo.get('course_codes', []):
            require(code and code not in owners, f'课程代码重复归属：{code}')
            owners[code] = repo_id
    coded_routes = {}
    for route in routes['course_code_routes']:
        reject_groups(route)
        code, repo = route['course_code'], route['repo_id']
        require(code not in coded_routes and owners.get(code) == repo, f'课程路由错误：{code}')
        require(route.get('physical_repository_id') == repos[repo].get('physical_repository_id'), f'课程物理身份不一致：{code}')
        coded_routes[code] = route
    require(set(coded_routes) == set(owners), '课程代码缺少路由')
    descriptors, descriptor_records = {}, {}
    for raw in ms.items(manifest['course_descriptors'], 'array'):
        item = ms.expand(raw)
        reject_groups(item)
        code = item['course_code']
        require(code not in descriptors and owners.get(code) == item.get('repo_id'), f'课程描述归属错误：{code}')
        require(item.get('physical_repository_id') == repos[owners[code]].get('physical_repository_id'), f'课程描述物理身份错误：{code}')
        safe_path(item['metadata_path'])
        descriptors[code] = item['repo_id']
        ids = item.get('record_ids', [])
        require(len(ids) == len(set(ids)), f'课程描述重复记录：{code}')
        for rid in ids:
            require(rid not in descriptor_records, f'记录属于多个描述：{rid}')
            descriptor_records[rid] = code
    require(set(descriptors) == set(owners), '课程描述与路由集合不同')
    plans = set()
    for raw in ms.items(manifest['curriculum_plans'], 'array'):
        item = ms.expand(raw)
        pid = item['plan_id']
        require(pid and pid not in plans, '教学计划身份缺失或重复')
        safe_path(item['metadata_path'])
        plans.add(pid)
    record_plans, pending, coded = {}, set(), 0
    for raw in ms.items(manifest['curriculum_records'], 'array'):
        item = ms.expand(raw)
        reject_groups(item)
        rid, pid, code = item['record_id'], item['source_plan'], item.get('course_code')
        require(rid and rid not in record_plans and pid in plans, f'课程记录身份或计划引用错误：{rid}')
        safe_path(item['metadata_path'])
        record_plans[rid] = pid
        if code:
            require(owners.get(code) == item.get('repo_id') and code in owners, f'记录仓库归属错误：{rid}')
            require(item.get('physical_repository_id') == repos[owners[code]].get('physical_repository_id'), f'记录物理身份错误：{rid}')
            require(descriptor_records.pop(rid, None) == code, f'描述的记录索引不符：{rid}')
            coded += 1
        else:
            require(not item.get('attachment_repo_id') and not item.get('physical_repository_id') and not item.get('descriptor_id'), f'无代码记录错误绑定资料仓：{rid}')
            pending.add(rid)
    require(not descriptor_records, '课程描述引用不存在的记录')
    indexes = ms.object(manifest['curriculum_metadata_indexes'])
    indexed_records, indexed_plans = set(), set()
    for pid, raw in ms.items(indexes['by_plan'], 'object'):
        require(pid in plans, f'计划索引引用不存在计划：{pid}')
        indexed_plans.add(pid)
        for rid in ms.items(raw, 'array'):
            require(rid not in indexed_records and record_plans.get(rid) == pid, f'计划记录索引错误：{rid}')
            indexed_records.add(rid)
    require(indexed_plans == plans and indexed_records == set(record_plans), '教学计划索引不完整')
    pending_list = list(ms.items(indexes['pending_course_code'], 'array'))
    require(set(pending_list) == pending and len(pending_list) == len(pending), '无代码记录索引不完整')
    layout = manifest['policy'].get('resource_layout')
    require(isinstance(layout, dict) and layout.get('allow_new_root_categories') is False, '缺少固定分类规则')
    categories = layout.get('categories', [])
    require(categories and len(categories) == len(set(categories)), '分类集合无效')
    paths, file_repos, material_codes, origins = set(), set(), set(), set()
    bytes_total = 0
    for file in routes['files']:
        reject_groups(file)
        repo, path = file['repo_id'], safe_path(file['path'])
        require(repo in repos and repos[repo]['repo_type'] not in {'control','template'}, f'资料目标无效：{repo}')
        require('/' in path and path.split('/')[0] in categories, f'资料不在预设分类中：{repo}/{path}')
        key = repo.casefold(), unicodedata.normalize('NFC', path).casefold()
        require(key not in paths, f'目标路径冲突：{repo}/{path}')
        paths.add(key)
        for code in file['course_codes']:
            require(owners.get(code) == repo, f'文件与课程跨仓：{path}/{code}')
            material_codes.add(code)
        require(file.get('route_keys') and file.get('origin'), f'文件缺少路由或来源：{path}')
        require(file['origin'] not in origins, f'来源重复维护：{file["origin"]}')
        origins.add(file['origin'])
        require(type(file['size']) is int and file['size'] >= 0 and re.fullmatch('[a-f0-9]{64}', file['sha256']), f'文件摘要无效：{path}')
        file_repos.add(repo)
        bytes_total += file['size']
    for repo, path in paths:
        parts = path.split('/')
        require(not any((repo, '/'.join(parts[:i])) in paths for i in range(1, len(parts))), f'文件目录冲突：{path}')
    heads = routes['repository_heads']
    complete = routes['inventory_complete_repositories']
    require(not routes.get('unresolved_repository_heads') and len(complete) == len(set(complete)) and set(heads) == set(complete), '完整清点仓库 HEAD 不完整')
    require(file_repos <= set(complete) <= set(repos), '资料文件未完成仓库清点')
    require(all(re.fullmatch('[a-f0-9]{40}', value) for value in heads.values()), '非法仓库 HEAD')
    for code, route in coded_routes.items():
        require(route.get('has_material', False) == (code in material_codes), f'资料状态不一致：{code}')
    expected = {'repository_count':len(repos),'course_descriptor_count':len(descriptors),'curriculum_record_count':len(record_plans),'curriculum_metadata_plan_count':len(plans),'curriculum_metadata_record_count':len(record_plans),'material_file_count':len(paths),'material_bytes':bytes_total}
    for key, value in expected.items():
        require(manifest['summary'].get(key) == value, f'汇总不一致：{key}')
    return {**expected, 'coded_records':coded, 'uncoded_records':len(pending),'verified_shards':sum(len(s.verified) for s in [ms,ts,fs]),'valid':True}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path.cwd())
    args = parser.parse_args()
    try:
        print(json.dumps(validate(args.root), ensure_ascii=False))
        return 0
    except (Invalid, OSError, ValueError, KeyError, TypeError) as error:
        print(f'校验失败：{error}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
