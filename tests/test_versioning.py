"""Tests for manifest versioning and source_id tracking."""

import os
import sys
import json
import tempfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.manifest import (
    compute_raw_hash,
    generate_source_id,
    create_entry,
    get_latest_by_source_id,
    get_history_by_source_id,
    get_by_raw_hash,
    save_entry,
    load_manifest,
    exists_raw_hash,
    MANIFEST_PATH
)

def test_generate_source_id_consistency():
    """Source ID generation is deterministic."""
    id1 = generate_source_id("web", "https://example.com/article")
    id2 = generate_source_id("web", "https://example.com/article")
    assert id1 == id2
    assert id1.startswith("web:")

def test_version_increment_on_new_source():
    """Creating entry for a new source_id should start at version 1."""
    content = b"First version content"
    entry = create_entry(content, "test", "/tmp/test1.raw", source_id="test:source1")
    assert entry["version"] == 1
    assert entry["supersedes"] is None

def test_version_increment_on_supersede():
    """Creating entry with supersedes should increment version from predecessor."""
    content1 = b"Version 1 content"
    entry1 = create_entry(content1, "test", "/tmp/v1.raw", source_id="test:my_source")
    entry1 = {**entry1, "raw_hash": compute_raw_hash(content1)}  # ensure hash
    # Simulate saving to manifest for lookup
    # Temporarily override manifest path?
    # Instead, we'll use in-memory monkeypatch but easier: rely on get_by_raw_hash which reads manifest file.
    # We'll write to a temporary manifest file.
    from scripts import manifest as m
    original_manifest = m.MANIFEST_PATH
    with tempfile.TemporaryDirectory() as tmp:
        test_manifest = Path(tmp) / "manifest.jsonl"
        m.MANIFEST_PATH = test_manifest
        try:
            # Save entry1
            save_entry(entry1)
            # Create second entry with supersedes
            content2 = b"Version 2 content"
            entry2 = create_entry(
                content2, "test", "/tmp/v2.raw",
                source_id="test:my_source",
                supersedes=entry1["raw_hash"]
            )
            assert entry2["version"] == 2
            assert entry2["supersedes"] == entry1["raw_hash"]
            assert entry2["source_id"] == "test:my_source"
        finally:
            m.MANIFEST_PATH = original_manifest

def test_get_history_by_source_id_returns_ordered_versions():
    """History should return entries ordered oldest to newest."""
    from scripts import manifest as m
    original_manifest = m.MANIFEST_PATH
    with tempfile.TemporaryDirectory() as tmp:
        test_manifest = Path(tmp) / "manifest.jsonl"
        m.MANIFEST_PATH = test_manifest
        try:
            # Create two versions of same source
            for i in [1, 2]:
                content = f"Version {i}".encode()
                entry = create_entry(
                    content, "test", f"/tmp/v{i}.raw",
                    source_id="test:ordered",
                    supersedes=None if i == 1 else None  # we'll rely on create_entry to auto version via history
                )
                # For v2 we need supersedes to be previous raw_hash. Let's do manually:
                if i == 1:
                    e1 = entry
                    save_entry(e1)
                else:
                    e2 = create_entry(content, "test", f"/tmp/v{i}.raw", source_id="test:ordered", supersedes=e1["raw_hash"])
                    save_entry(e2)
            history = get_history_by_source_id("test:ordered")
            assert len(history) == 2
            assert history[0]["version"] == 1
            assert history[1]["version"] == 2
        finally:
            m.MANIFEST_PATH = original_manifest

def test_raw_hash_dedupe_prevents_duplicate():
    """If raw content identical, second acquisition should detect duplicate."""
    content = b"same content"
    h = compute_raw_hash(content)
    from scripts import manifest as m
    original_manifest = m.MANIFEST_PATH
    with tempfile.TemporaryDirectory() as tmp:
        test_manifest = Path(tmp) / "manifest.jsonl"
        m.MANIFEST_PATH = test_manifest
        try:
            entry1 = create_entry(content, "test", "/tmp/a.raw", source_id="test:dup")
            save_entry(entry1)
            assert exists_raw_hash(h) is True
            # Simulate second acquisition attempt
            if exists_raw_hash(h):
                # Should skip creating new entry
                pass
            # Ensure manifest still has only one entry
            entries = load_manifest()
            assert len(entries) == 1
        finally:
            m.MANIFEST_PATH = original_manifest

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])