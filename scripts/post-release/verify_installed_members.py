#!/usr/bin/env python3
"""Prepared independent member join; run only on an actual fresh registry installation."""
import argparse
import hashlib
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--readback-result', type=Path, required=True)
parser.add_argument('--installed-package', type=Path, required=True)
parser.add_argument('--out', type=Path, required=True)
a = parser.parse_args()
assert not a.out.exists(), 'Preserve prior attempts; output must be new'
record = json.loads(a.readback_result.read_bytes())
assert record['status'] == 'READBACKS_MATCH', 'Successful registry/GitHub readback is required first'
root = a.installed_package
assert root.is_dir() and root.name == 'breaklint' and root.parent.name == 'node_modules'
for ancestor in [root, *root.parents]:
    assert not ancestor.is_symlink(), 'Installed package ancestor is a symlink'
expected = {x['path']: x['sha256'] for x in record['registryMemberInventory']}
actual = {}
for path in sorted(root.rglob('*')):
    assert not path.is_symlink(), 'Installed member symlink refused'
    if path.is_dir():
        continue
    assert path.is_file(), 'Nonregular installed member refused'
    data = path.read_bytes()
    actual[str(path.relative_to(root))] = hashlib.sha256(data).hexdigest()
joined = [{'path': name, 'registrySHA256': expected.get(name), 'installedSHA256': actual.get(name),
    'matches': name in expected and name in actual and expected[name] == actual[name]}
    for name in sorted(set(expected) | set(actual))]
result = {'status': 'MATCH' if expected == actual else 'MISMATCH',
    'registryMemberCount': len(expected), 'installedMemberCount': len(actual), 'members': joined,
    'releaseCommit': record['releaseCommit'], 'packageSHA256': record['packageSHA256'],
    'qualification': 'Installed breaklint members only; peers/interface/provenance signatures remain separate receipts.'}
a.out.write_text(json.dumps(result, indent=2) + '\n')
assert expected == actual, 'Installed package bytes differ; evidence written, stop'
