#!/usr/bin/env python3
"""从已验证的候选快照构造 Registry 提交；不检出巨大的逐记录目录。"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'data/repository-flat-migration'
CANDIDATE = AUDIT / 'candidate'
GIT = ROOT / '.workspaces/registry-cutover.git'
REMOTE = 'git@github.com:HIT-Fireworks/fireworks-course-registry-v2.git'
ENV = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GOMAXPROCS': '1', 'GIT_NO_LAZY_FETCH': '1'}
spec = importlib.util.spec_from_file_location('registry_validation', ROOT / 'scripts/validate-registry.py')
validation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(validation)


def run(args, cwd=GIT, data=None, timeout=600):
    p = subprocess.run(args, cwd=cwd, input=data, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout)
    if p.returncode:
        raise RuntimeError(f'{args[:3]}: {p.stderr.decode("utf8", "replace")}')
    return p.stdout


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_bytes(data)
    os.replace(temporary, path)


def compact(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()


def copied_snapshot(destination):
    mapping = {'repository-manifest.no-collection.v4.json': 'data/repository-manifest.no-collection.v4.json',
               'repository-topology.v4.json': 'config/repository-topology.v4.json',
               'repository-file-routes.v4.json': 'config/repository-file-routes.v4.json'}
    roots = []
    for source_name, target_name in mapping.items():
        source = CANDIDATE / source_name
        store = validation.Store(source)
        store.verify()
        for part in store.dependencies - {source}:
            relative = part.relative_to(CANDIDATE)
            target = destination / Path(target_name).parent / relative
            target.parent.mkdir(parents=True, exist_ok=True)
            if not target.exists():
                shutil.copyfile(part, target)
            elif target.read_bytes() != part.read_bytes():
                raise RuntimeError(f'内容寻址分片冲突：{target}')
        roots.append((destination / target_name, source.read_bytes()))
    for target, content in roots:
        save(target, content)
    print(f'已同步完整快照：{destination}', flush=True)


def registry_commit():
    result = validation.validate(CANDIDATE)
    print(json.dumps(result, ensure_ascii=False), flush=True)
    migration = json.loads((AUDIT / 'classified-plan.json').read_text(encoding='utf8'))
    proof = json.loads((AUDIT / 'classified-verification.json').read_text(encoding='utf8'))
    if not proof['valid'] or proof['identity_sha256'] != migration['identity_sha256']:
        raise RuntimeError('分类迁移证明与当前计划不一致')
    baseline = json.loads((AUDIT / 'baseline.json').read_text(encoding='utf8'))['repositories']['fireworks-course-registry-v2']['head']
    receipt_path = AUDIT / 'registry-cutover.json'
    actual = run(['git', 'ls-remote', REMOTE, 'refs/heads/main'], cwd=ROOT, timeout=60).decode().split()[0]
    if receipt_path.exists():
        receipt = json.loads(receipt_path.read_text(encoding='utf8'))
        if receipt['identity_sha256'] != migration['identity_sha256']:
            raise RuntimeError('Registry 恢复记录身份不同')
        commit = receipt['head']
        if actual == commit:
            receipt['status'] = 'completed'
            save(receipt_path, compact(receipt))
            print(json.dumps(receipt), flush=True)
            return
        if actual != receipt['parent']:
            raise RuntimeError('Registry 自冻结点后发生并发变化')
    else:
        if actual != baseline:
            raise RuntimeError('Registry 初始提交与冻结基线不一致')
        GIT.mkdir(parents=True, exist_ok=True)
        if not (GIT / 'HEAD').exists():
            run(['git', 'init', '--bare'])
        run(['git', 'fetch', '--no-tags', '--depth=1', '--filter=blob:none', REMOTE, f'{baseline}:refs/heads/baseline'], timeout=300)
        store = validation.Store(CANDIDATE / 'repository-manifest.no-collection.v4.json')
        store.verify()
        manifest = store.object()
        original = run(['git', 'ls-tree', '-r', '-z', baseline])
        retained = {}
        for row in original.split(b'\0'):
            if row:
                fields, name = row.split(b'\t', 1)
                mode, kind, sha = fields.decode().split()
                retained[name.decode()] = (mode, sha)
        with tempfile.TemporaryFile() as error_log:
            process = subprocess.Popen(['git', 'fast-import', '--quiet'], cwd=GIT, env=ENV, stdin=subprocess.PIPE, stdout=subprocess.DEVNULL, stderr=error_log)
            stream = process.stdin
            def line(value):
                stream.write(value.encode() + b'\n')
            def payload(value):
                line(f'data {len(value)}')
                stream.write(value + b'\n')
            def file(name, value):
                validation.safe_path(name)
                sha = hashlib.sha1(f'blob {len(value)}\0'.encode() + value).hexdigest()
                if retained.get(name) == ('100644', sha):
                    return
                line('M 100644 inline ' + json.dumps(name, ensure_ascii=False))
                payload(value)
            line('commit refs/heads/cutover')
            line(f'committer HIT Fireworks Automation <actions@users.noreply.github.com> {int(time.time())} +0000')
            payload(f'refactor(registry): 取消资源组并切换中文分类资料路由\n\n迁移：{migration["identity_sha256"]}'.encode())
            line('from ' + baseline)
            for name in ['resource-repository-groups.v1.json', 'course-resource-families.v1.json', 'course-resource-family-migration.v1.json', 'course-code-atomic-content-migration-plan.v1.json', 'course-code-atomic-physical-repositories.v1.json', 'course-code-atomic-repository-optimization.v1.json', 'no-collection-content-migration-plan.v1.json', 'no-collection-repository-optimization.v1.json']:
                if name in retained:
                    line('D ' + name)
            file('repository-manifest.json', store.path.read_bytes())
            file('repository-topology.v4.json', (CANDIDATE / 'repository-topology.v4.json').read_bytes())
            file('repository-file-routes.v4.json', (CANDIDATE / 'repository-file-routes.v4.json').read_bytes())
            for part in sorted(store.dependencies - {store.path}):
                file(part.relative_to(CANDIDATE).as_posix(), part.read_bytes())
            for field in ['course_descriptors', 'curriculum_records', 'curriculum_plans']:
                count = 0
                for raw in store.items(manifest[field], 'array'):
                    item = store.expand(raw)
                    file(item['metadata_path'], compact(item))
                    count += 1
                print(f'Registry {field}: {count}', flush=True)
            indexes = store.object(manifest['curriculum_metadata_indexes'])
            for name, raw in indexes.items():
                encoded = compact(store.expand(raw))
                if len(encoded) > 8 * 1024 * 1024:
                    # 复用候选索引引用并在其文件所在目录收录引用分片。
                    encoded = compact(raw)
                    for part in sorted(store.dependencies - {store.path}):
                        file('indexes/' + part.relative_to(CANDIDATE).as_posix(), part.read_bytes())
                file('indexes/' + name.replace('_', '-') + '.json', encoded)
            file('course-groups.v1.json', compact({'course_groups': store.expand(manifest['course_groups']), 'course_group_memberships': store.expand(manifest['course_group_memberships'])}))
            file('scripts/validate-registry.py', (ROOT / 'scripts/validate-registry.py').read_bytes())
            file('.github/workflows/registry-checks.yml', (AUDIT / 'registry-checks.yml').read_bytes())
            file('README.md', ('# HIT 课程注册表\n\n课程代码、教学计划记录和资料仓库路由的权威数据。资料直接归仓，不维护仓内资源组。\n\n资料使用预设中文分类：教材、笔记、课件、试卷、作业、实验、软件、教程、模板、项目、其他。维护者不得自行新增根级分类；软件和多文件文档保留必要内部结构。\n\n`python scripts/validate-registry.py --root .` 校验完整分片、课程绑定、计划索引和文件路径。资料仓不再独立运行 CI；此处集中验证元数据，源字节与远端 Git 树在受控迁移时核验。\n\n来源附件仓只保留历史，下载以当前 repository-file-routes.v4.json 为准。\n').encode())
            line('')
            line('done')
            stream.close()
            code = process.wait(timeout=300)
            if code:
                error_log.seek(0)
                raise RuntimeError(error_log.read().decode('utf8', 'replace'))
        commit = run(['git', 'rev-parse', 'refs/heads/cutover']).decode().strip()
        receipt = {'head':commit, 'parent':baseline, 'identity_sha256':migration['identity_sha256'], 'status':'prepared'}
        save(receipt_path, compact(receipt))
    run(['git', '-c', 'pack.threads=1', 'push', REMOTE, f'{commit}:refs/heads/main'], timeout=1800)
    actual = run(['git', 'ls-remote', REMOTE, 'refs/heads/main'], timeout=60).decode().split()[0]
    if actual != commit:
        raise RuntimeError('Registry 远端提交核验失败')
    receipt['status'] = 'completed'
    save(receipt_path, compact(receipt))
    print(json.dumps(receipt), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['registry', 'local'])
    args = parser.parse_args()
    if args.phase == 'registry':
        registry_commit()
    else:
        receipt = json.loads((AUDIT / 'registry-cutover.json').read_text(encoding='utf8'))
        if receipt['status'] != 'completed':
            raise RuntimeError('Registry 尚未完成，不能切换本地')
        copied_snapshot(ROOT)
        manager = ROOT / '.workspaces/fireworks-repos-management-v2'
        copied_snapshot(manager)
        shutil.copyfile(ROOT / 'scripts/validate-registry.py', manager / 'scripts/validate-registry.py')
