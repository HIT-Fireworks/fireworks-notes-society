#!/usr/bin/env python3
"""执行已冻结的中文分类切换，逐仓核验并记录恢复点。"""
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import hashlib
import json
import os
from pathlib import Path
import subprocess
import threading
import time

from repository_description import repository_readme, stable_repository_description

ROOT = Path(__file__).resolve().parents[1]
AUDIT = ROOT / 'data/repository-flat-migration'
OWNER = 'HIT-Fireworks'
ENV = {**os.environ, 'GOMAXPROCS': '1', 'GOMEMLIMIT': '128MiB', 'GIT_TERMINAL_PROMPT': '0'}
LOCK = threading.Lock()


def load(name):
    return json.loads((AUDIT / name).read_text(encoding='utf8'))


def save(name, value):
    path = AUDIT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')), encoding='utf8')
    os.replace(temporary, path)


def api(endpoint, method='GET', payload=None):
    args = ['gh', 'api', endpoint, '--method', method]
    data = None
    if payload is not None:
        args += ['--input', '-']
        data = json.dumps(payload, ensure_ascii=False).encode()
    attempts = 3 if method == 'GET' or '/git/trees' in endpoint or '/git/commits' in endpoint else 1
    for attempt in range(attempts):
        try:
            p = subprocess.run(args, input=data, cwd=ROOT, env=ENV, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
            if p.returncode == 0:
                return json.loads(p.stdout) if p.stdout.strip() else None
            error = p.stderr.decode('utf8', 'replace')
            if not any(s in error for s in ['EOF', 'TLS', 'timeout', '502', '503', '504', 'reset by peer']):
                raise RuntimeError(f'{method} {endpoint}: {error}')
        except subprocess.TimeoutExpired:
            error = 'request timeout'
        if attempt + 1 == attempts:
            raise RuntimeError(f'{method} {endpoint}: {error}')
        time.sleep(2 * (attempt + 1))


def tree(repo, sha):
    value = api(f'repos/{OWNER}/{repo}/git/trees/{sha}?recursive=1')
    if value.get('truncated'):
        raise RuntimeError(f'{repo}: 截断文件树禁止用于迁移')
    entries = {row['path']: {key: row[key] for key in ['mode', 'type', 'sha', 'size'] if key in row}
               for row in value['tree'] if row['type'] != 'tree'}
    return value['sha'], entries


def head(repo):
    return api(f'repos/{OWNER}/{repo}/git/ref/heads/main')['object']['sha']


def identity(repo):
    meta = api(f'repos/{OWNER}/{repo}')
    expected = BASE['repositories'].get(repo) or OLD['created'][repo]
    if meta['id'] != expected['id'] or meta['node_id'] != expected.get('nodeId', expected.get('node_id')):
        raise RuntimeError(f'{repo}: 仓库身份发生变化')
    if meta['archived'] or meta['default_branch'] != 'main':
        raise RuntimeError(f'{repo}: 仓库状态不允许迁移')
    return meta


def checkpoint(repo, phase, value):
    with LOCK:
        STATE['repositories'].setdefault(repo, {})[phase] = value
        save('classified-execution.json', STATE)


def source_expected(repo):
    old = OLD['repositories'].get(repo, {}).get('add')
    if old:
        accepted = {old['head']}
        if old.get('status') != 'completed' and old.get('parent'):
            accepted.add(old['parent'])
        return accepted
    return {BASE['repositories'][repo]['head']}


def entry_identity(value):
    return value.get('mode'), value.get('type', 'blob'), value.get('sha')


def verify_files(repo, entries):
    for row in BY_REPO.get(repo, []):
        item = entries.get(row['target_path'])
        expected = (row['source_mode'], 'blob', row['source_blob_sha1'])
        if not item or entry_identity(item) != expected or item.get('size') != row['size']:
            raise RuntimeError(f'{repo}/{row["target_path"]}: 文件内容、大小或模式不符')


def metadata(repo):
    spec = SPECS[repo]
    mapping = {code: NAMES[code] for code in spec.get('course_codes', [])}
    return repository_readme(repo_type=spec['repo_type'], course_mapping=mapping)

def compact_tree(repo, base_tree, expected, changes):
    source = api(f'repos/{OWNER}/{repo}/git/trees/{base_tree}?recursive=1')
    if source.get('truncated'):
        raise RuntimeError(f'{repo}: 基线树被截断')
    known = {base_tree} | {item['sha'] for item in source['tree'] if item['type'] == 'tree'}
    for change in changes:
        if 'content' in change:
            blob = api(f'repos/{OWNER}/{repo}/git/blobs', 'POST', {'content': change['content'], 'encoding': 'utf-8'})
            if blob['sha'] != expected[change['path']]['sha']:
                raise RuntimeError('托管文本的 Git blob 不一致')
    root = {}
    for path, entry in expected.items():
        node = root
        parts = path.split('/')
        for part in parts[:-1]:
            node = node.setdefault(part, {})
        node[parts[-1]] = (entry['mode'], entry.get('type', 'blob'), entry['sha'])
    def build(node):
        entries = []
        for name, value in node.items():
            if isinstance(value, dict):
                entries.append({'path': name, 'mode': '040000', 'type': 'tree', 'sha': build(value)})
            else:
                mode, kind, sha = value
                entries.append({'path': name, 'mode': mode, 'type': kind, 'sha': sha})
        entries.sort(key=lambda item: (item['path'] + ('/' if item['type'] == 'tree' else '')).encode())
        body = b''.join((item['mode'].lstrip('0') + ' ' + item['path']).encode() + b'\0' + bytes.fromhex(item['sha']) for item in entries)
        sha = hashlib.sha1(f'tree {len(body)}\0'.encode() + body).hexdigest()
        if sha not in known:
            result = api(f'repos/{OWNER}/{repo}/git/trees', 'POST', {'tree': entries})
            if result['sha'] != sha:
                raise RuntimeError('Git 子树内容身份不一致')
            known.add(sha)
        return sha
    return {'sha': build(root)}


def publish(repo, phase, changes, parent, expected_entries, files=True):
    prior = STATE['repositories'].get(repo, {}).get(phase)
    actual = head(repo)
    if prior and actual == prior['head']:
        tree_sha, entries = tree(repo, prior['tree'])
        if files:
            verify_files(repo, entries)
        prior['status'] = 'completed'
        checkpoint(repo, phase, prior)
        return prior
    if prior and prior['status'] == 'completed':
        later = STATE['repositories'][repo].get('cleanup')
        if phase == 'add' and later and actual == later['head']:
            return prior
        raise RuntimeError(f'{repo}: 已完成提交被改动')
    if actual != (prior['parent'] if prior else parent):
        raise RuntimeError(f'{repo}: 远端 HEAD 漂移，拒绝写入')
    if prior:
        prepared = prior
    else:
        base_commit = api(f'repos/{OWNER}/{repo}/git/commits/{parent}')
        result = compact_tree(repo, base_commit['tree']['sha'], expected_entries, changes) if len(changes) > 300 else api(f'repos/{OWNER}/{repo}/git/trees', 'POST', {'base_tree': base_commit['tree']['sha'], 'tree': changes})
        tree_sha, entries = tree(repo, result['sha'])
        expected_paths = set(expected_entries)
        if set(entries) != expected_paths:
            raise RuntimeError(f'{repo}: 构造树文件集合发生意外变化')
        for path, expected in expected_entries.items():
            if entry_identity(entries[path]) != entry_identity(expected):
                raise RuntimeError(f'{repo}/{path}: 构造树内容不符合冻结计划')
        if files:
            verify_files(repo, entries)
        commit = api(f'repos/{OWNER}/{repo}/git/commits', 'POST', {'message': f'refactor(resources): {"切换中文资料分类" if phase == "add" else "移除旧资源分组和无效 CI"}\n\n迁移：{PLAN["identity_sha256"]}', 'tree': tree_sha, 'parents': [parent]})
        prepared = {'head': commit['sha'], 'tree': tree_sha, 'parent': parent, 'status': 'prepared'}
        checkpoint(repo, phase, prepared)
    # 非 force 更新：若检查后有并发写入，GitHub 拒绝非快进，不能覆盖他人提交。
    try:
        api(f'repos/{OWNER}/{repo}/git/refs/heads/main', 'PATCH', {'sha': prepared['head'], 'force': False})
    except RuntimeError:
        if head(repo) != prepared['head']:
            raise
    if head(repo) != prepared['head']:
        raise RuntimeError(f'{repo}: 更新引用后提交不一致')
    _, final_entries = tree(repo, prepared['tree'])
    if files:
        verify_files(repo, final_entries)
    prepared['status'] = 'completed'
    checkpoint(repo, phase, prepared)
    return prepared


def add_one(repo):
    identity(repo)
    prior = STATE['repositories'].get(repo, {}).get('add')
    if prior:
        publish(repo, 'add', [], prior['parent'], {}, files=True)
        return
    parent = head(repo)
    if parent not in source_expected(repo):
        raise RuntimeError(f'{repo}: 初始 HEAD 不属于冻结基线或旧阶段凭据')
    commit = api(f'repos/{OWNER}/{repo}/git/commits/{parent}')
    _, entries = tree(repo, commit['tree']['sha'])
    baseline_entries = BASE['repositories'].get(repo, {}).get('entries', [])
    if baseline_entries:
        for old in baseline_entries:
            if old['type'] != 'tree' and entry_identity(entries.get(old['path'], {})) != entry_identity(old):
                raise RuntimeError(f'{repo}/{old["path"]}: 冻结源文件变化')
    changes = []
    expected = dict(entries)
    known_blobs = {item['sha'] for item in entries.values()}
    for row in BY_REPO[repo]:
        path = row['target_path']
        item = {'mode': row['source_mode'], 'type': 'blob', 'sha': row['source_blob_sha1'], 'size': row['size']}
        if path in expected and entry_identity(expected[path]) != entry_identity(item):
            raise RuntimeError(f'{repo}/{path}: 拒绝覆盖不同文件')
        if item['sha'] not in known_blobs:
            raise RuntimeError(f'{repo}: 原始 blob 尚未进入目标仓库，禁止伪造迁移成功')
        if path not in expected:
            changes.append({'path': path, **{k: item[k] for k in ['mode', 'type', 'sha']}})
            expected[path] = item
    publish(repo, 'add', changes, parent, expected)


def cleanup_one(repo):
    identity(repo)
    prior = STATE['repositories'].get(repo, {}).get('cleanup')
    if prior:
        publish(repo, 'cleanup', [], prior['parent'], {}, files=repo in BY_REPO)
        return
    added = STATE['repositories'].get(repo, {}).get('add')
    parent = added['head'] if added else BASE['repositories'][repo]['head']
    if head(repo) != parent:
        raise RuntimeError(f'{repo}: 清理前 HEAD 漂移')
    base = api(f'repos/{OWNER}/{repo}/git/commits/{parent}')
    _, entries = tree(repo, base['tree']['sha'])
    expected = dict(entries)
    changes = []
    final_paths = {f['target_path'] for f in BY_REPO.get(repo, [])}
    removals = {}
    for row in PLAN['files']:
        if row['source_repo_id'] == repo:
            removals[row['source_path']] = row['source_blob_sha1']
        if row['target_repo_id'] == repo:
            removals[row['previous_target_path']] = row['source_blob_sha1']
    for path, item in entries.items():
        if path in final_paths:
            continue
        remove = path == '.github/workflows/sync.yml' or (path.endswith('/.gitkeep') and item['sha'] == 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391')
        if path in removals:
            if item['sha'] != removals[path]:
                raise RuntimeError(f'{repo}/{path}: 旧路径内容已变化，禁止删除')
            remove = True
        if remove:
            changes.append({'path': path, 'mode': item['mode'], 'type': 'blob', 'sha': None})
            del expected[path]
    content = metadata(repo)
    encoded = content.encode()
    sha = hashlib.sha1(f'blob {len(encoded)}\0'.encode() + encoded).hexdigest()
    changes.append({'path': 'README.md', 'mode': '100644', 'type': 'blob', 'content': content})
    expected['README.md'] = {'mode': '100644', 'type': 'blob', 'sha': sha}
    result = publish(repo, 'cleanup', changes, parent, expected, files=repo in BY_REPO)
    spec = SPECS[repo]
    description = stable_repository_description(spec['repo_type'], spec['display_name'], repo_id=repo, course_mapping={code: NAMES[code] for code in spec.get('course_codes', [])})
    api(f'repos/{OWNER}/{repo}', 'PATCH', {'description': description})
    return result


def batch(repos, action):
    errors = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(action, repo): repo for repo in repos}
        for number, future in enumerate(concurrent.futures.as_completed(futures), 1):
            repo = futures[future]
            try:
                future.result()
                print(f'{action.__name__} {number}/{len(repos)} {repo}: 已核验', flush=True)
            except Exception as exc:
                errors.append({'repo': repo, 'error': str(exc)})
                print(f'{repo}: {exc}', flush=True)
                with LOCK:
                    STATE.setdefault('errors', []).append({'phase': action.__name__, **errors[-1]})
                    save('classified-execution.json', STATE)
    if errors:
        raise RuntimeError(f'{len(errors)} 个仓库未完成；其余结果已落盘，运行同一命令续接')


def audit_ci():
    repos = json.loads(subprocess.check_output(['gh', 'repo', 'list', OWNER, '--limit', '500', '--json', 'name,isArchived,isPrivate,isTemplate'], env=ENV))
    report = load('ci-evidence.json') if (AUDIT / 'ci-evidence.json').exists() else {'repositories': {}}
    def examine(repo):
        name = repo['name']
        runs = api(f'repos/{OWNER}/{name}/actions/runs?per_page=5')
        workflows = api(f'repos/{OWNER}/{name}/actions/workflows?per_page=100')
        permissions = api(f'repos/{OWNER}/{name}/actions/permissions')
        value = {'metadata': repo, 'total_runs': runs['total_count'], 'recent_runs': [{k: r.get(k) for k in ['id','name','path','status','conclusion','event','head_sha','created_at','updated_at','html_url']} for r in runs['workflow_runs']], 'workflows': workflows['workflows'], 'actions': permissions}
        with LOCK:
            report['repositories'][name] = value
            report['checked_at'] = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
            save('ci-evidence.json', report)
    batch(repos, examine)


def disable_ci():
    data_repos = [repo for repo, spec in SPECS.items() if spec['repo_type'] not in {'control'}]
    def disable(repo):
        before = api(f'repos/{OWNER}/{repo}/actions/permissions')
        if before['enabled']:
            api(f'repos/{OWNER}/{repo}/actions/permissions', 'PUT', {'enabled': False})
        after = api(f'repos/{OWNER}/{repo}/actions/permissions')
        if after['enabled']:
            raise RuntimeError('资料仓 Actions 未关闭')
        with LOCK:
            STATE.setdefault('ci_disabled', {})[repo] = after
            save('classified-execution.json', STATE)
    batch(data_repos, disable)


def verify():
    rows = []
    def check(repo):
        stages = STATE['repositories'].get(repo, {})
        stage = stages.get('cleanup') or stages.get('add')
        if not stage or stage['status'] != 'completed' or head(repo) != stage['head']:
            raise RuntimeError('迁移提交未完成或发生漂移')
        _, entries = tree(repo, stage['tree'])
        verify_files(repo, entries)
        if stages.get('cleanup'):
            for path in entries:
                if path.split('/')[0] in {'resource-groups','course-components','legacy-imports','collisions'}:
                    raise RuntimeError('旧资源组目录残留')
            for row in PLAN['files']:
                for owner, path in [(row['source_repo_id'],row['source_path']),(row['target_repo_id'],row['previous_target_path'])]:
                    if owner == repo and path in entries and path not in {f['target_path'] for f in BY_REPO[repo]}:
                        raise RuntimeError(f'旧路径残留：{path}')
        with LOCK:
            rows.append({'repo':repo, 'head':stage['head'], 'tree':stage['tree'], 'files':len(BY_REPO[repo])})
    batch(list(BY_REPO), check)
    save('classified-verification.json', {'valid': True, 'identity_sha256': PLAN['identity_sha256'], 'files': sum(r['files'] for r in rows), 'bytes': sum(f['size'] for f in PLAN['files']), 'repositories':rows})


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['add','verify','cleanup','ci-audit','ci-disable'])
    args = parser.parse_args()
    PLAN = load('classified-plan.json')
    identity_value = {k:v for k,v in PLAN.items() if k != 'identity_sha256'}
    if hashlib.sha256(json.dumps(identity_value, ensure_ascii=False, separators=(',', ':')).encode()).hexdigest() != PLAN['identity_sha256']:
        raise RuntimeError('迁移计划身份不一致')
    BASE = load('baseline.json')
    OLD = load('execution.json')
    NAMES = load('course-names.json')
    candidate = load('candidate/repository-topology.v4.json')
    SPECS = dict(candidate['repositories'])
    SPECS.update({spec['repo_id']: spec for spec in PLAN['targets']})
    STATE = load('classified-execution.json') if (AUDIT/'classified-execution.json').exists() else {'identity_sha256':PLAN['identity_sha256'], 'repositories':{}}
    if STATE['identity_sha256'] != PLAN['identity_sha256']:
        raise RuntimeError('恢复日志与计划身份不一致')
    BY_REPO = {}
    for item in PLAN['files']:
        BY_REPO.setdefault(item['target_repo_id'], []).append(item)
    if args.phase in {'add','cleanup','ci-disable'}:
        if api('user')['login'] != BASE['github_actor']:
            raise RuntimeError('操作者身份变化')
        evidence = load('source-byte-verification.json')
        if not evidence.get('valid') or evidence['plan_identity_sha256'] != PLAN['previous_layout_identity']:
            raise RuntimeError('源字节验证不符合前序计划')
    if args.phase == 'cleanup':
        gate = load('site-cutover-verification.json')
        if not gate.get('valid') or gate.get('identity_sha256') != PLAN['identity_sha256']:
            raise RuntimeError('没有当前计划的线上切换证据，禁止清理旧路径')
        verify()
        batch([r for r,s in SPECS.items() if s['repo_type'] != 'control'], cleanup_one)
    elif args.phase == 'add':
        batch(list(BY_REPO), add_one)
        verify()
    elif args.phase == 'verify':
        verify()
    elif args.phase == 'ci-audit':
        audit_ci()
    else:
        disable_ci()
