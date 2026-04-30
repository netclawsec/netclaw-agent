"""Unit tests for the stdlib OSS V1 signer.

Sanity-checks signature determinism, key validation, and presigned-URL
shape. We do NOT hit the real OSS endpoint — that's an integration concern
left to the manual end-to-end test in the worker README.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import importlib.util
import sys
import time
import urllib.parse
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = REPO_ROOT / "packaging" / "build-worker" / "oss_uploader.py"


def _load_module():
    spec = importlib.util.spec_from_file_location("oss_uploader_test", MODULE_PATH)
    assert spec and spec.loader
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


@pytest.fixture(scope="module")
def oss():
    return _load_module()


@pytest.fixture
def cfg(oss):
    return oss.OssConfig(
        access_key_id="LTAI5tDummy",
        access_key_secret="DummySecretDoNotUseInProd",
        bucket="netclaw-test",
        endpoint="oss-cn-hangzhou.aliyuncs.com",
    )


# ---------- OssConfig.from_env ----------------------------------------------


def test_from_env_requires_all_three_keys(monkeypatch, oss):
    monkeypatch.delenv("OSS_ACCESS_KEY_ID", raising=False)
    monkeypatch.delenv("OSS_ACCESS_KEY_SECRET", raising=False)
    monkeypatch.delenv("OSS_BUCKET", raising=False)
    with pytest.raises(oss.OssError, match="Missing"):
        oss.OssConfig.from_env()


def test_from_env_rejects_invalid_bucket(monkeypatch, oss):
    monkeypatch.setenv("OSS_ACCESS_KEY_ID", "k")
    monkeypatch.setenv("OSS_ACCESS_KEY_SECRET", "s")
    monkeypatch.setenv("OSS_BUCKET", "Bad_Bucket_Name")  # uppercase + underscore
    with pytest.raises(oss.OssError, match="naming rules"):
        oss.OssConfig.from_env()


def test_from_env_happy_path(monkeypatch, oss):
    monkeypatch.setenv("OSS_ACCESS_KEY_ID", "LTAI-x")
    monkeypatch.setenv("OSS_ACCESS_KEY_SECRET", "secret-x")
    monkeypatch.setenv("OSS_BUCKET", "good-bucket-1")
    monkeypatch.setenv("OSS_ENDPOINT", "oss-cn-shanghai.aliyuncs.com")
    cfg = oss.OssConfig.from_env()
    assert cfg.bucket == "good-bucket-1"
    assert cfg.endpoint == "oss-cn-shanghai.aliyuncs.com"
    assert cfg.access_key_id == "LTAI-x"


# ---------- _validate_object_key --------------------------------------------


@pytest.mark.parametrize(
    "bad_key",
    [
        "/leading-slash",
        "trailing-slash/",
        "double//slash",
        "with space",
        "spaß",  # non-ASCII
        "",
    ],
)
def test_validate_rejects_bad_keys(bad_key, oss):
    with pytest.raises(oss.OssError):
        oss._validate_object_key(bad_key)


@pytest.mark.parametrize(
    "good_key",
    [
        "installers/acme/NetClaw-Agent-Setup-acme-0.10.0.exe",
        "a",
        "x.y.z/abc-123_def",
    ],
)
def test_validate_accepts_good_keys(good_key, oss):
    oss._validate_object_key(good_key)  # no raise


# ---------- sign_get_url ----------------------------------------------------


def test_sign_get_url_format(cfg, oss):
    client = oss.OssClient(cfg)
    fixed_now = 1_700_000_000
    # Pin time so we can verify the signature input deterministically.
    real_time = oss.time.time
    oss.time.time = lambda: fixed_now
    try:
        url = client.sign_get_url("installers/acme/v1.exe", expires_in_seconds=3600)
    finally:
        oss.time.time = real_time

    parsed = urllib.parse.urlparse(url)
    assert parsed.scheme == "https"
    assert parsed.hostname == "netclaw-test.oss-cn-hangzhou.aliyuncs.com"
    assert parsed.path == "/installers/acme/v1.exe"

    qs = dict(urllib.parse.parse_qsl(parsed.query))
    assert qs["OSSAccessKeyId"] == "LTAI5tDummy"
    assert qs["Expires"] == str(fixed_now + 3600)

    expected_sts = f"GET\n\n\n{fixed_now + 3600}\n/netclaw-test/installers/acme/v1.exe"
    expected_sig = base64.b64encode(
        hmac.new(
            b"DummySecretDoNotUseInProd",
            expected_sts.encode(),
            hashlib.sha1,
        ).digest()
    ).decode()
    assert qs["Signature"] == expected_sig


def test_sign_get_url_clamps_expiry(cfg, oss):
    client = oss.OssClient(cfg)
    with pytest.raises(oss.OssError):
        client.sign_get_url("installers/acme/v1.exe", expires_in_seconds=0)
    with pytest.raises(oss.OssError):
        client.sign_get_url("installers/acme/v1.exe", expires_in_seconds=8 * 24 * 3600)


# ---------- put_file (integration via mocked urlopen) -----------------------


def test_put_file_signs_correctly(cfg, oss, tmp_path, monkeypatch):
    """We don't hit the network; we intercept urlopen to inspect the request."""
    payload = b"hello-installer-bytes" * 10
    artifact = tmp_path / "x.exe"
    artifact.write_bytes(payload)

    captured = {}

    class _MockResp:
        status = 200

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self):
            return b""

    def _mock_urlopen(req, timeout=None):
        captured["url"] = req.full_url
        captured["method"] = req.get_method()
        captured["headers"] = dict(req.header_items())
        captured["body"] = req.data
        return _MockResp()

    monkeypatch.setattr(oss.urllib.request, "urlopen", _mock_urlopen)

    client = oss.OssClient(cfg)
    url = client.put_file(
        "installers/acme/x.exe", artifact, content_type="application/x-msdownload"
    )
    assert (
        url == "https://netclaw-test.oss-cn-hangzhou.aliyuncs.com/installers/acme/x.exe"
    )
    assert captured["method"] == "PUT"
    assert captured["body"] == payload

    headers_lower = {k.lower(): v for k, v in captured["headers"].items()}
    assert "authorization" in headers_lower
    assert headers_lower["authorization"].startswith("OSS LTAI5tDummy:")
    assert headers_lower["content-type"] == "application/x-msdownload"
    md5_b64 = base64.b64encode(hashlib.md5(payload).digest()).decode()
    assert headers_lower["content-md5"] == md5_b64


def test_put_file_missing_local_raises(cfg, oss, tmp_path):
    client = oss.OssClient(cfg)
    with pytest.raises(oss.OssError, match="missing"):
        client.put_file("installers/acme/x.exe", tmp_path / "no-such-file.exe")
