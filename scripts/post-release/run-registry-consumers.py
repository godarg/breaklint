#!/usr/bin/env python3
"""Private postpublication collector. Preparation alone performs no network I/O."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import signal
import subprocess
import sys
import tempfile
import tarfile

VERSION = '0.10.0'
REGISTRY = 'https://registry.npmjs.org'
PACKAGE_URL = REGISTRY + '/breaklint/-/breaklint-' + VERSION + '.tgz'
RUNTIMES = {'22.13.0', '24.21.0'}
PEERS = ['pagedjs@0.4.3', 'pdfjs-dist@6.2.108', 'puppeteer-core@25.8.0',
         '@playwright/test@1.62.1', 'typescript@5.9.2']


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def utc():
    return datetime.now(timezone.utc).isoformat()


def read_json(path):
    # Duplicate keys are rejected instead of allowing the last one to hide a contradiction.
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, 'Duplicate JSON key: ' + key)
            result[key] = value
        return result
    return json.loads(Path(path).read_bytes(), object_pairs_hook=pairs)


def validate_readback(record):
    require(isinstance(record, dict), 'Readback must be an object')
    require(record.get('status') == 'READBACKS_MATCH', 'Actual READBACKS_MATCH required')
    require(record.get('version') == VERSION and record.get('registryLatest') == VERSION,
            'Published version/latest mismatch')
    require(re.fullmatch(r'[0-9a-f]{40}', str(record.get('releaseCommit', ''))),
            'Full release commit required')
    require(re.fullmatch(r'[0-9a-f]{64}', str(record.get('packageSHA256', ''))),
            'Package SHA256 required')
    sri = record.get('packageSRI')
    require(isinstance(sri, str) and sri.startswith('sha512-'), 'SHA512 SRI required')
    try:
        decoded = base64.b64decode(sri[7:], validate=True)
    except (ValueError, TypeError) as error:
        raise ValueError('Invalid SRI encoding') from error
    require(len(decoded) == 64 and base64.b64encode(decoded).decode() == sri[7:], 'Invalid SRI size/canonical form')
    inventory = record.get('registryMemberInventory')
    require(isinstance(inventory, list) and len(inventory) > 0, 'Complete member inventory required')
    seen = set()
    for item in inventory:
        require(isinstance(item, dict), 'Invalid inventory member')
        path = item.get('path')
        require(isinstance(path, str) and path and '\\' not in path, 'Invalid member path')
        parts = PurePosixPath(path).parts
        require(not path.startswith('/') and all(p not in {'.', '..', ''} for p in parts)
                and str(PurePosixPath(path)) == path and path not in seen, 'Unsafe/duplicate member path')
        seen.add(path)
        require(type(item.get('bytes')) is int and item['bytes'] >= 0, 'Invalid member byte count')
        require(re.fullmatch(r'[0-9a-f]{64}', str(item.get('sha256', ''))), 'Invalid member SHA256')
    require('package.json' in seen, 'Package manifest member missing')
    return record


def validate_signatures(record, native_exit):
    require(type(native_exit) is int and native_exit == 0, 'Signature process did not exit native0')
    require(isinstance(record, dict), 'Signature JSON must be an object')
    require(type(record.get('invalid')) is list and record['invalid'] == [], 'Invalid signatures or malformed array')
    require(type(record.get('missing')) is list and record['missing'] == [], 'Missing signatures or malformed array')
    for key in ['audited', 'verifiedSignatures', 'verifiedAttestations']:
        require(key not in record or (type(record[key]) is int and record[key] >= 0), 'Invalid actual signature counter')
    return {'invalid': [], 'missing': [], 'counts': {
        key: record[key] for key in ['audited', 'verifiedSignatures', 'verifiedAttestations'] if key in record},
        'countQualification': 'Only actual npm JSON fields are retained; absent counts are not inferred.'}


def validate_identity(manifest, root_lock, hidden_lock, installed_manifest, readback):
    require(manifest.get('dependencies', {}).get('breaklint') == VERSION, 'Root manifest must pin exact version')
    require(installed_manifest.get('name') == 'breaklint' and installed_manifest.get('version') == VERSION,
            'Installed package name/version mismatch')
    entries = {}
    for label, lock in [('root', root_lock), ('hidden', hidden_lock)]:
        require(isinstance(lock, dict) and type(lock.get('lockfileVersion')) is int
                and lock['lockfileVersion'] >= 2, 'Unsupported lock shape')
        entry = lock.get('packages', {}).get('node_modules/breaklint')
        require(isinstance(entry, dict), label + ': package lock entry missing')
        require(entry.get('version') == VERSION and entry.get('resolved') == PACKAGE_URL
                and entry.get('integrity') == readback['packageSRI'], label + ': version/URL/SRI mismatch')
        # npm lock entries may omit name; the key and installed manifest prove identity.
        require('name' not in entry or entry['name'] == 'breaklint', label + ': contradictory package name')
        require(not entry.get('link', False), label + ': linked package refused')
        if label == 'root':
            require(lock.get('packages', {}).get('', {}).get('dependencies', {}).get('breaklint') == VERSION,
                    'Root lock dependency is not exact')
        entries[label] = entry
    return {'status': 'MATCH', 'installedName': 'breaklint', 'version': VERSION, 'lockEntries': entries,
            'qualification': 'Absent lock-entry name is joined through exact package key and installed manifest.'}


def validate_demo(report, native_exit):
    require(native_exit == 1 and type(native_exit) is int, 'Demo must end native1')
    require(isinstance(report, dict) and type(report.get('schemaVersion')) is int and report['schemaVersion'] == 5, 'Demo report schema mismatch')
    require(report.get('tool', {}).get('version') == VERSION and type(report.get('exitCode')) is int and report['exitCode'] == 1,
            'Demo version/exit mismatch')
    require(report.get('runVerdict') == 'findings', 'Demo verdict mismatch')
    require(type(report.get('pagesAnalysed')) is int and report['pagesAnalysed'] > 0
            and type(report.get('rulesRun')) is int and report['rulesRun'] > 0
            and isinstance(report.get('findings'), list) and len(report['findings']) > 0,
            'Demo measured counters/findings missing')
    return {'schemaVersion': 5, 'nativeExit': 1, 'runVerdict': 'findings',
            'qualification': 'Bounded report boundary check; shipped README/docs/config contracts are separate native receipts.'}


def bind_readback_files(result_path, record):
    root = result_path.parent
    registry = root / 'registry-package.tgz'
    github = root / ('breaklint-' + VERSION + '.tgz')
    data = registry.read_bytes()
    require(data == github.read_bytes() and sha(data) == record['packageSHA256']
            and 'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode() == record['packageSRI'],
            'Readback archive bytes/SHA/SRI mismatch')
    receipts = read_json(root / 'native-command-receipts.json')
    require(isinstance(receipts, list) and len(receipts) > 0, 'Actual readback command receipts missing')
    for receipt in receipts:
        require(isinstance(receipt, dict) and type(receipt.get('nativeExit')) is int and receipt['nativeExit'] == 0,
                'Readback command failed/incomplete')
    labels = {x.get('label') for x in receipts}
    require({'remote-tag-ref', 'remote-tag-object', 'exact-main-ci', 'release-workflow-jobs',
             'npm-version-metadata', 'npm-dist-tags', 'registry-tarball-fetch', 'provenance-semantic-contract'} <= labels,
            'Required actual readback receipts absent')
    measured = []
    with tarfile.open(registry, mode='r:gz') as archive:
        for member in archive.getmembers():
            if member.isdir():
                continue
            require(member.isfile() and member.name.startswith('package/'), 'Unsafe readback tar member')
            body = archive.extractfile(member).read()
            measured.append({'path': member.name[8:], 'bytes': len(body), 'sha256': sha(body)})
    reconstructed = dict(record, registryMemberInventory=measured)
    validate_readback(reconstructed)
    require(sorted(measured, key=lambda x: x['path']) == sorted(record['registryMemberInventory'], key=lambda x: x['path']),
            'Readback inventory does not describe actual archive')
    return {'registryArchiveSHA256': sha(data), 'nativeReadbackReceiptSHA256': sha((root / 'native-command-receipts.json').read_bytes())}


class Collector:
    def __init__(self, out):
        self.out = out
        self.commands = []

    def run(self, label, argv, cwd, env, expected=0, timeout=300):
        require(not any(x['label'] == label for x in self.commands), 'Duplicate command label')
        stdout = self.out / (label + '.stdout')
        stderr = self.out / (label + '.stderr')
        record = {'label': label, 'argv': list(map(str, argv)), 'cwd': str(cwd), 'startUTC': utc(),
                  'expectedExit': expected, 'nativeExit': None, 'timedOut': False}
        self.commands.append(record)
        process = None
        try:
            with stdout.open('xb') as stream_out, stderr.open('xb') as stream_err:
                process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                           stdout=stream_out, stderr=stream_err, start_new_session=True)
                try:
                    process.wait(timeout=timeout)
                except subprocess.TimeoutExpired:
                    record['timedOut'] = True
                    raise
        except BaseException:
            if process is not None:
                # start_new_session makes this our own group; never signal another group.
                try:
                    os.killpg(process.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(process.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    process.wait(timeout=5)
            raise
        finally:
            record['endUTC'] = utc()
            record['nativeExit'] = process.returncode if process is not None else None
            for kind, path in [('stdout', stdout), ('stderr', stderr)]:
                if path.exists():
                    record[kind + 'SHA256'] = sha(path.read_bytes())
            self.flush()
        require(not record['timedOut'] and record['nativeExit'] == expected, label + ': unexpected native outcome')
        return stdout.read_bytes()

    def flush(self):
        (self.out / 'native-command-receipts.json').write_text(json.dumps(self.commands, indent=2) + '\n')


def save_identity(consumer, out, phase, readback):
    paths = {'manifest': consumer / 'package.json', 'rootLock': consumer / 'package-lock.json',
             'hiddenLock': consumer / 'node_modules/.package-lock.json',
             'installedManifest': consumer / 'node_modules/breaklint/package.json'}
    values = {}
    for label, path in paths.items():
        require(path.is_file() and not path.is_symlink(), 'Missing/symlink identity file: ' + label)
        shutil.copyfile(path, out / (phase + '-' + label + '.json'))
        values[label] = read_json(path)
    result = validate_identity(values['manifest'], values['rootLock'], values['hiddenLock'],
                               values['installedManifest'], readback)
    (out / (phase + '-lock-identity.json')).write_text(json.dumps(result, indent=2) + '\n')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--readback-result', required=True, type=Path)
    parser.add_argument('--contract-root', required=True, type=Path)
    parser.add_argument('--member-helper', required=True, type=Path)
    parser.add_argument('--chrome', required=True, type=Path, help='Existing browser executable; never downloaded by this helper')
    parser.add_argument('--runtime', action='append', nargs=3, metavar=('VERSION', 'NODE', 'NPM'), required=True)
    parser.add_argument('--matrix-part', action='store_true', help='One exact runtime only; not a two-runtime acceptance')
    parser.add_argument('--out', required=True, type=Path)
    args = parser.parse_args(argv)
    args.out.mkdir(parents=True, exist_ok=False)
    out = args.out.resolve()
    collector = Collector(out)
    result = {'status': 'INCOMPLETE', 'matrixPart': args.matrix_part,
              'runtimeConsumers': [], 'startUTC': utc(),
              'qualification': 'Execution evidence only; independent acceptance and actual remote Action-tag resolution remain separate.'}
    (out / 'invocation.json').write_text(json.dumps({'argv': sys.argv if argv is None else argv,
                                                   'cwd': str(Path.cwd()), 'startUTC': result['startUTC']}, indent=2) + '\n')
    try:
        # Refuse before creating consumers or running any external process; keep failed preflights.
        if args.readback_result.is_file():
            shutil.copyfile(args.readback_result, out / 'readback-result.input.json')
        record = validate_readback(read_json(args.readback_result))
        readback_binding = bind_readback_files(args.readback_result, record)
        versions = [row[0] for row in args.runtime]
        require(len(versions) == len(set(versions)) and set(versions) <= RUNTIMES, 'Unsupported/duplicate runtime')
        require((args.matrix_part and len(versions) == 1) or (not args.matrix_part and set(versions) == RUNTIMES),
                'Both exact runtimes required unless explicitly a partial matrix receipt')
        require(args.contract_root.is_dir() and not args.contract_root.is_symlink(), 'Contract checkout missing/symlink')
        require(args.member_helper.is_file() and not args.member_helper.is_symlink(), 'Member helper missing/symlink')
        require(args.chrome.is_file(), 'Existing Chrome executable missing')
        result.update(releaseCommit=record['releaseCommit'], packageSRI=record['packageSRI'],
                      readbackSHA256=sha(args.readback_result.read_bytes()), readbackBinding=readback_binding,
                      memberHelperSHA256=sha(args.member_helper.read_bytes()))
        base_env = dict(os.environ)
        # npm configuration files can redirect an install or execute an operator-specific hook.
        require(not any(k.lower().startswith('npm_config_') for k in base_env), 'Ambient npm configuration refused')
        require(not base_env.get('NODE_OPTIONS') and not base_env.get('NODE_PATH'), 'Ambient Node injection refused')
        head = collector.run('contract-head', ['git', '-C', str(args.contract_root), 'rev-parse', 'HEAD'],
                             out, base_env).decode().strip()
        require(head == record['releaseCommit'], 'Contract tools must be at actual released commit')
        collector.run('contract-clean', ['git', '-C', str(args.contract_root), 'diff', '--quiet', 'HEAD'], out, base_env)
        collector.run('contract-untracked', ['git', '-C', str(args.contract_root), 'ls-files', '--others', '--exclude-standard'], out, base_env)
        require((out / 'contract-untracked.stdout').read_bytes() == b'', 'Untracked contract files refused')
        tools = args.contract_root.resolve() / 'tests/tools'
        for version, node_string, npm_string in args.runtime:
            node = Path(node_string).absolute()
            npm = Path(npm_string).absolute()
            require(node.is_file() and npm.is_file(), 'Selected runtime executable missing')
            runtime_out = out / ('node-' + version)
            runtime_out.mkdir()
            run = Collector(runtime_out)
            consumer = Path(tempfile.mkdtemp(prefix='breaklint-registry-' + version + '-')).resolve()
            require(not consumer.is_relative_to(args.contract_root.resolve()), 'Consumer must be outside checkout')
            entry = {'version': version, 'consumerCWD': str(consumer), 'status': 'INCOMPLETE'}
            result['runtimeConsumers'].append(entry)
            env = dict(base_env, PATH=str(node.parent) + os.pathsep + base_env.get('PATH', ''),
                       PUPPETEER_SKIP_DOWNLOAD='1', PUPPETEER_SKIP_CHROMIUM_DOWNLOAD='1',
                       NPM_CONFIG_USERCONFIG=str(consumer / '.empty-npmrc'),
                       NPM_CONFIG_GLOBALCONFIG=str(consumer / '.empty-global-npmrc'))
            env['BREAKLINT_CHROME'] = str(args.chrome.resolve())
            (consumer / '.empty-npmrc').write_text('')
            (consumer / '.empty-global-npmrc').write_text('')
            require(run.run('node-version', [str(node), '--version'], consumer, env).decode().strip() == 'v' + version,
                    'Selected Node version mismatch')
            npm_version = run.run('npm-version', [str(npm), '--version'], consumer, env).decode().strip()
            require(re.fullmatch(r'\d+\.\d+\.\d+', npm_version), 'Actual npm version invalid')
            entry['npmVersion'] = npm_version
            entry['nodeExecutable'] = {'path': str(node.resolve()), 'sha256': sha(node.read_bytes())}
            entry['npmExecutable'] = {'path': str(npm.resolve()), 'sha256': sha(npm.read_bytes())}
            run.run('browser-version', [str(args.chrome.resolve()), '--version'], consumer, env)
            entry['browser'] = {'path': str(args.chrome.resolve()), 'sha256': sha(args.chrome.read_bytes())}
            run.run('npm-init', [str(npm), 'init', '-y'], consumer, env)
            install = [str(npm), 'install', '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', '--registry=' + REGISTRY]
            run.run('registry-install', install + ['breaklint@' + VERSION], consumer, env, timeout=600)
            cli = consumer / 'node_modules/breaklint/dist/cli/index.js'
            for phase in ['before-peers', 'after-peers']:
                if phase == 'after-peers':
                    run.run('peer-install', install + PEERS, consumer, env, timeout=600)
                raw = run.run(phase + '-signature-audit', [str(npm), 'audit', 'signatures', '--json'], consumer, env, timeout=600)
                signature = validate_signatures(read_json(runtime_out / (phase + '-signature-audit.stdout')), 0)
                (runtime_out / (phase + '-signature-validation.json')).write_text(json.dumps(signature, indent=2) + '\n')
                save_identity(consumer, runtime_out, phase, record)
                member_receipt = runtime_out / (phase + '-installed-member-join.json')
                run.run(phase + '-member-join', [sys.executable, str(args.member_helper.resolve()), '--readback-result',
                        str(args.readback_result.resolve()), '--installed-package', str(cli.parents[2]), '--out', str(member_receipt)], consumer, env)
                require(read_json(member_receipt).get('status') == 'MATCH', 'Member join did not produce MATCH')
                if phase == 'before-peers':
                    require(run.run('cli-version', [str(node), str(cli), '--version'], consumer, env).decode().strip() == VERSION,
                            'Installed CLI version mismatch')
                    demo = runtime_out / 'demo.json'
                    run.run('demo', [str(node), str(cli), '--demo', '--format', 'json', '--out', str(demo)], consumer, env, expected=1)
                    (runtime_out / 'demo-boundary-validation.json').write_text(json.dumps(validate_demo(read_json(demo), 1), indent=2) + '\n')
                    for label, cmd in [
                        ('readme-contract', [str(tools / 'readme-demo-contract.mjs'), '--consumer', str(consumer)]),
                        ('docs-contract', [str(tools / 'docs-truth.mjs'), '--package', str(cli.parents[2]), '--pending', str(tools / 'docs-truth-pending.jsonl'), '--release']),
                        ('config-contract', [str(tools / 'installed-config-contract.mjs')])]:
                        run.run(label, [str(node)] + cmd, consumer, env, timeout=600)
            run.run('api-contract', [str(node), str(tools / 'installed-api-contract.mjs')], consumer, env, timeout=600)
            run.run('real-document-contract', [str(node), str(tools / 'real-document-gate.mjs'), '--cli', str(cli), '--cwd', str(consumer)], consumer, env, timeout=1200)
            # Interface calls must not replace or mutate installed package bytes either.
            save_identity(consumer, runtime_out, 'final', record)
            run.run('final-member-join', [sys.executable, str(args.member_helper.resolve()), '--readback-result',
                    str(args.readback_result.resolve()), '--installed-package', str(cli.parents[2]), '--out', str(runtime_out / 'final-installed-member-join.json')], consumer, env)
            run.run('final-signature-audit', [str(npm), 'audit', 'signatures', '--json'], consumer, env, timeout=600)
            final_signature = validate_signatures(read_json(runtime_out / 'final-signature-audit.stdout'), 0)
            (runtime_out / 'final-signature-validation.json').write_text(json.dumps(final_signature, indent=2) + '\n')
            for name in ['installed-api-result.json', 'public-api-types.mts']:
                require((consumer / name).is_file(), 'API contract artifact missing: ' + name)
                shutil.copyfile(consumer / name, runtime_out / name)
            for name in ['api-evidence', 'api-bundle']:
                source = consumer / name
                require(source.is_dir() and not source.is_symlink(), 'Actual API artifact directory missing: ' + name)
                for path in source.rglob('*'):
                    require(not path.is_symlink() and (path.is_file() or path.is_dir()), 'Unsafe API artifact member')
                shutil.copytree(source, runtime_out / name)
            entry['status'] = 'EXECUTED_MATCH'
        result['status'] = 'EXECUTED_MATRIX_PART_MATCH' if args.matrix_part else 'EXECUTED_BOTH_RUNTIMES_MATCH'
    except BaseException as error:
        result['status'] = 'FAILED_OR_INCOMPLETE'
        result['failure'] = type(error).__name__ + ': ' + str(error)
        raise
    finally:
        result['endUTC'] = utc()
        (out / 'consumer-execution-result.json').write_text(json.dumps(result, indent=2) + '\n')
        members = [{'path': str(p.relative_to(out)), 'bytes': p.stat().st_size, 'sha256': sha(p.read_bytes())}
                   for p in sorted(out.rglob('*')) if p.is_file() and p.name != 'manifest.json']
        (out / 'manifest.json').write_text(json.dumps({'status': result['status'], 'members': members}, indent=2) + '\n')


if __name__ == '__main__':
    main()
