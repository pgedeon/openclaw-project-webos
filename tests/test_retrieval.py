"""Tests for Stage 5 retrieval strategy."""

import os
import sys
import json
import subprocess
from pathlib import Path

# Add workspace to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

def test_retrieval_returns_results():
    """Test that stage5-retrieval returns context from clean and artifacts."""
    # Run retrieval for query "example"
    script = Path(__file__).parent.parent / "scripts" / "stage5-retrieval.py"
    result = subprocess.run(
        [sys.executable, str(script), "example", "--format", "json"],
        capture_output=True,
        text=True,
        timeout=20
    )
    assert result.returncode == 0, f"Retrieval failed: {result.stderr}"
    data = json.loads(result.stdout)
    assert "context" in data
    assert "sources" in data
    assert "tokens" in data
    assert len(data["sources"]) > 0
    # Check that we have at least one from clean and one from artifacts
    collections = [s["collection"] for s in data["sources"]]
    assert "clean" in collections
    assert "artifacts" in collections

def test_retrieval_token_cap():
    """Test that token cap is respected (simulated by checking tokens field)."""
    script = Path(__file__).parent.parent / "scripts" / "stage5-retrieval.py"
    result = subprocess.run(
        [sys.executable, str(script), "example", "--format", "json"],
        capture_output=True,
        text=True,
        timeout=20
    )
    assert result.returncode == 0
    data = json.loads(result.stdout)
    # Tokens should be <= 3500 (default cap) or 7500 if deep
    assert data["tokens"] <= 3500

def test_retrieval_deep_flag():
    """Test that --deep increases token cap to 7500."""
    script = Path(__file__).parent.parent / "scripts" / "stage5-retrieval.py"
    result = subprocess.run(
        [sys.executable, str(script), "example", "--deep", "--format", "json"],
        capture_output=True,
        text=True,
        timeout=20
    )
    assert result.returncode == 0
    data = json.loads(result.stdout)
    assert data["tokens"] <= 7500

if __name__ == "__main__":
    import pytest
    pytest.main([__file__, "-v"])