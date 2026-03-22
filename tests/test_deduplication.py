"""Tests for manifest deduplication (raw_hash)."""

import os
import sys
import json
import tempfile
from pathlib import Path

# Add workspace to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.manifest import (
    compute_raw_hash,
    create_entry,
    exists_raw_hash,
    get_by_raw_hash,
    update_entry,
    load_manifest,
    save_entry,
    MANIFEST_PATH
)

def test_compute_raw_hash_consistency():
    """Test that hash is deterministic."""
    content = b"Test content for hashing"
    h1 = compute_raw_hash(content)
    h2 = compute_raw_hash(content)
    assert h1 == h2
    assert len(h1) == 64  # SHA256 hex length

def test_create_entry_creates_valid_entry():
    """Test create_entry generates required fields."""
    content = b"Sample raw content"
    entry = create_entry(content, "test_type", "/tmp/raw.txt")
    assert "raw_hash" in entry
    assert entry["source_type"] == "test_type"
    assert entry["raw_path"] == "/tmp/raw.txt"
    assert entry["clean_path"] is None
    assert entry["artifact_path"] is None
    assert entry["status"] == "raw"

def test_exists_raw_hash(tmp_path):
    """Test that exists_raw_hash returns True after entry saved."""
    # Use a temporary manifest to avoid interfering with real one
    from scripts import manifest
    original_manifest = manifest.MANIFEST_PATH
    test_manifest = tmp_path / "test_manifest.jsonl"
    manifest.MANIFEST_PATH = test_manifest

    try:
        content = b"test content for deduplication"
        entry = create_entry(content, "test", "/tmp/test.raw")
        save_entry(entry)
        assert exists_raw_hash(entry["raw_hash"]) is True

        # Different content
        other_hash = compute_raw_hash(b"other content")
        assert exists_raw_hash(other_hash) is False
    finally:
        manifest.MANIFEST_PATH = original_manifest

def test_get_by_raw_hash_returns_most_recent(tmp_path):
    """Test that get_by_raw_hash returns the latest entry if duplicate."""
    from scripts import manifest
    original_manifest = manifest.MANIFEST_PATH
    test_manifest = tmp_path / "test_manifest.jsonl"
    manifest.MANIFEST_PATH = test_manifest

    try:
        content = b"same content"
        h = compute_raw_hash(content)
        # Create two entries with same hash but different paths (simulate versioning)
        entry1 = create_entry(content, "type1", "/path/1")
        entry1["raw_hash"] = h
        save_entry(entry1)

        entry2 = create_entry(content, "type2", "/path/2")
        entry2["raw_hash"] = h
        save_entry(entry2)

        found = get_by_raw_hash(h)
        assert found is not None
        # Should return the most recent (second)
        assert found["raw_path"] == "/path/2"
    finally:
        manifest.MANIFEST_PATH = original_manifest

def test_update_entry_modifies_manifest(tmp_path):
    """Test that update_entry correctly updates an existing entry."""
    from scripts import manifest
    original_manifest = manifest.MANIFEST_PATH
    test_manifest = tmp_path / "test_manifest.jsonl"
    manifest.MANIFEST_PATH = test_manifest

    try:
        content = b"updatable content"
        entry = create_entry(content, "test", "/tmp/test.raw")
        save_entry(entry)
        raw_hash = entry["raw_hash"]

        # Update
        success = update_entry(raw_hash, {"status": "processed", "notes": "test"})
        assert success is True

        updated = get_by_raw_hash(raw_hash)
        assert updated["status"] == "processed"
        assert updated["notes"] == "test"
    finally:
        manifest.MANIFEST_PATH = original_manifest

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])