"""Shared fixtures: project root on sys.path, the report and labels schemas, isolated job and dataset folders."""
import json
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))


@pytest.fixture(scope="session")
def report_schema():
    return json.loads((ROOT / "schema" / "report.schema.json").read_text(encoding="utf-8"))


@pytest.fixture
def job_store(tmp_path, monkeypatch):
    from app import jobs
    monkeypatch.setattr(jobs, "DATA_DIR", tmp_path / "jobs")
    return tmp_path / "jobs"


@pytest.fixture(scope="session")
def labels_schema():
    return json.loads((ROOT / "schema" / "labels.schema.json").read_text(encoding="utf-8"))


@pytest.fixture
def dataset_store(tmp_path, monkeypatch):
    from app import dataset
    monkeypatch.setattr(dataset, "DATASET_DIR", tmp_path / "dataset")
    return tmp_path / "dataset"
