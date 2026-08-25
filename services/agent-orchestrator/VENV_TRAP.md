# The venv in this checkout runs code from a different checkout

**Found 2026-08-04. Not fixed — the fix depends on which copy you consider real.**

## What is happening

`services/agent-orchestrator/venv/` in this repo is a **directory skeleton with no
files in it**. 3,873 directories under `site-packages`, zero `.py`, zero `.pyc`,
zero `.so`. The `*.dist-info` metadata survived, so `pip show fastapi` cheerfully
reports `Version: 0.109.0` for a package that cannot be imported.

Running the interpreter directly proves it:

```bash
./venv/bin/python -c "import fastapi; print(fastapi.__version__)"
# AttributeError: module 'fastapi' has no attribute '__version__'
```

That is not a real import. With no `__init__.py` anywhere on the path, Python falls
back to an implicit **namespace package** — an empty module object that imports
successfully and contains nothing. `from fastapi import APIRouter` against it fails
with the memorable `cannot import name 'APIRouter' from 'fastapi' (unknown location)`.

## Why the tests pass anyway

`venv/bin/pytest` is not a Python entry point. It is a `/bin/sh` wrapper whose first
real line is:

```sh
'''exec' "/Users/<user>/Desktop/UnicornProjects/Restaurant AI Automation/services/agent-orchestrator/venv/bin/python3.11" "$0" "$@"
```

There is a second, older copy of this project on the Desktop. Its venv is intact —
18,834 `.py` files, `fastapi/__init__.py` present. The venv was created there, the
project was later moved or copied here, and every console script in `venv/bin/`
still hardcodes the absolute path it was generated with. Console-script shebangs are
baked in at install time; moving a venv does not rewrite them.

So `./venv/bin/pytest` from this directory runs:

- **this** checkout's source and tests (rootdir and `sys.path` come from cwd), against
- **the Desktop copy's** installed libraries.

It works. `tests/test_business_metrics.py` passes 14/14 that way. It also takes 179
seconds for fourteen trivial unit tests, because every import crosses into another
directory tree.

## Why this is worth fixing rather than living with

1. **The tests are not testing what you think.** Library versions come from a copy
   nobody is maintaining. A dependency bump made here has no effect on a test run.
2. **It fails the moment the Desktop copy is deleted** — and it will look like a
   catastrophic breakage of this repo, not like a cleanup consequence.
3. **It is invisible.** `pip show` says installed. Tests pass. Nothing surfaces the
   indirection until someone runs the interpreter directly.
4. **CI cannot reproduce it.** Anything green here that depends on the Desktop copy is
   green for a reason CI does not have.

## The fix

Rebuild the venv in place, which rewrites every console script to a local path:

```bash
rm -rf services/agent-orchestrator/venv && python3 -m venv services/agent-orchestrator/venv && services/agent-orchestrator/venv/bin/pip install -r services/agent-orchestrator/requirements.txt
```

Do this **only after** deciding whether the Desktop copy holds anything you still
want — check it for uncommitted work first. Rebuilding here does not touch it, but
it does end the accidental dependency on it, and that is the point.

## A caution about the empty-skeleton part

The directory tree survived with **May 8 mtimes** while every file inside vanished.
A normal `rm` or `find -delete` updates the parent directory's mtime; these were not
updated. That is consistent with a copy operation that recreated directories and
skipped files — for example a `cp -R` that was interrupted, or a sync tool that
excluded them. It is worth a glance at whether anything else in this checkout was
copied the same way before assuming the venv was the only casualty. The source tree
itself is fine: 244 `.py` under `services/` and 91 test files are all present.
