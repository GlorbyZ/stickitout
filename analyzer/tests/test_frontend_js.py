"""Runs the front end unit tests (tests/js, node:test) so pytest covers static/camera.js too."""
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_frontend_js_units():
    files = sorted(str(p.relative_to(ROOT)) for p in (ROOT / "tests" / "js").glob("*.test.mjs"))
    assert files, "no front end tests found"
    proc = subprocess.run(["node", "--test", *files], cwd=ROOT, capture_output=True, text=True, timeout=120)
    assert proc.returncode == 0, proc.stdout[-4000:] + proc.stderr[-2000:]
