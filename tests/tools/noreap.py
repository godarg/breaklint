#!/usr/bin/env python3
"""Run a command under a parent that adopts orphans and never collects them (Linux only).

    python3 tests/tools/noreap.py -- <command> [args...]

This models the environments in which breaklint's process cleanup used to fail although nothing
had survived: a container without an init process, where PID 1 is node, npm, a shell or
`tail -f /dev/null` (Docker without `--init`, a GitHub Actions `container:` job, a Kubernetes pod
whose entrypoint is node). Such a PID 1 never calls wait() for a process it did not spawn, so
every orphan that exits stays a zombie until the container ends.

The wrapper declares itself a child subreaper (prctl PR_SET_CHILD_SUBREAPER), so every process
orphaned below it is re-parented to it instead of to the real PID 1. It then waits for its direct
child only, and never for anything it adopted. The exit status is the command's.

On exit it prints the zombies it holds to stderr, as the positive control that the regime was
real: a wrapper that silently collected them would turn a no-reap soak into an ordinary one. With
`--expect-zombies N` it also fails (exit 70) when it holds fewer than N.
"""
import ctypes
import os
import sys

PR_SET_CHILD_SUBREAPER = 36


def held_zombies() -> list[int]:
    me = os.getpid()
    held = []
    for entry in os.listdir("/proc"):
        if not entry.isdigit():
            continue
        try:
            with open(f"/proc/{entry}/stat") as stat:
                fields = stat.read().rsplit(")", 1)[1].split()
        except (FileNotFoundError, ProcessLookupError, IndexError):
            continue
        if fields[0] == "Z" and int(fields[1]) == me:
            held.append(int(entry))
    return sorted(held)


def main(argv: list[str]) -> int:
    expect = 0
    if "--" not in argv:
        print("usage: noreap.py [--expect-zombies N] -- <command> [args...]", file=sys.stderr)
        return 64
    options, command = argv[: argv.index("--")], argv[argv.index("--") + 1 :]
    if options[:1] == ["--expect-zombies"] and len(options) == 2:
        expect = int(options[1])
    elif options:
        print(f"noreap.py: unknown options {options}", file=sys.stderr)
        return 64
    if not command:
        print("noreap.py: no command given", file=sys.stderr)
        return 64
    if not sys.platform.startswith("linux"):
        print("noreap.py: Linux only (PR_SET_CHILD_SUBREAPER)", file=sys.stderr)
        return 69
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0) != 0:
        print(f"noreap.py: prctl failed: errno {ctypes.get_errno()}", file=sys.stderr)
        return 71
    child = os.fork()
    if child == 0:
        try:
            os.execvp(command[0], command)
        except OSError as error:
            print(f"noreap.py: cannot run {command[0]}: {error}", file=sys.stderr)
            os._exit(127)
    _, status = os.waitpid(child, 0)
    code = os.waitstatus_to_exitcode(status)
    zombies = held_zombies()
    print(f"[noreap] command exit {code}; zombies held at exit: {len(zombies)}", file=sys.stderr)
    if code == 0 and len(zombies) < expect:
        print(f"[noreap] expected at least {expect} held zombies: the no-reap regime did not happen", file=sys.stderr)
        return 70
    return code if code >= 0 else 128 - code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
