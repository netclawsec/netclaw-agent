"""Aliyun OSS uploader — stdlib only (no oss2 / aliyun-sdk-python).

Uses OSS V1 signature (HMAC-SHA1) which Aliyun still supports for both
authenticated PUT and presigned GET URLs. Tested against the public OSS
endpoints, no proprietary dependencies required.

Env knobs:
    OSS_ACCESS_KEY_ID         — RAM user access key id
    OSS_ACCESS_KEY_SECRET     — RAM user access key secret
    OSS_BUCKET                — bucket name (e.g. netclaw-installers)
    OSS_ENDPOINT              — optional, default oss-cn-hangzhou.aliyuncs.com

Public surface:
    OssClient(...).put_file(object_key, local_path, content_type=None) -> None
    OssClient(...).sign_get_url(object_key, expires_in_seconds=86400) -> str
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import re
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass
from email.utils import formatdate
from pathlib import Path

DEFAULT_ENDPOINT = "oss-cn-hangzhou.aliyuncs.com"

# Bucket / object key validation — Aliyun rules.
# Bucket: lowercase letters / digits / hyphens, 3-63 chars, can't start/end with hyphen.
_BUCKET_RE = re.compile(r"^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$")
# Object: any char except control. Keep things sane: alphanumerics + . _ - / and length <= 1023.
_OBJECT_KEY_RE = re.compile(r"^[A-Za-z0-9._\-/]{1,1023}$")


class OssError(RuntimeError):
    """Raised on signature config errors or non-2xx PUT responses."""


@dataclass(frozen=True)
class OssConfig:
    access_key_id: str
    access_key_secret: str
    bucket: str
    endpoint: str = DEFAULT_ENDPOINT

    @classmethod
    def from_env(cls) -> "OssConfig":
        akid = os.environ.get("OSS_ACCESS_KEY_ID")
        aks = os.environ.get("OSS_ACCESS_KEY_SECRET")
        bucket = os.environ.get("OSS_BUCKET")
        if not akid or not aks or not bucket:
            raise OssError(
                "Missing one of OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET / OSS_BUCKET in env"
            )
        if not _BUCKET_RE.match(bucket):
            raise OssError(f"Bucket name {bucket!r} fails Aliyun OSS naming rules")
        endpoint = os.environ.get("OSS_ENDPOINT", DEFAULT_ENDPOINT)
        return cls(akid, aks, bucket, endpoint)


def _validate_object_key(key: str) -> None:
    if not _OBJECT_KEY_RE.match(key):
        raise OssError(f"object key {key!r} contains invalid chars or is too long")
    if key.startswith("/") or key.endswith("/") or "//" in key:
        raise OssError(f"object key {key!r} has illegal slashes")


def _md5_b64(path: Path) -> str:
    h = hashlib.md5()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(64 * 1024), b""):
            h.update(chunk)
    return base64.b64encode(h.digest()).decode("ascii")


def _sign(string_to_sign: str, secret: str) -> str:
    sig = hmac.new(
        secret.encode("utf-8"), string_to_sign.encode("utf-8"), hashlib.sha1
    ).digest()
    return base64.b64encode(sig).decode("ascii")


def _canonicalized_resource(bucket: str, key: str) -> str:
    return f"/{bucket}/{key}"


class OssClient:
    """Tiny OSS client. Only PUT (upload) + presigned GET URL are needed."""

    def __init__(self, config: OssConfig | None = None) -> None:
        self.config = config or OssConfig.from_env()

    @property
    def base_host(self) -> str:
        return f"{self.config.bucket}.{self.config.endpoint}"

    def put_file(
        self,
        object_key: str,
        local_path: str | Path,
        content_type: str | None = None,
    ) -> str:
        """Upload local file to bucket/<object_key>. Returns the unsigned URL.

        Idempotent — re-uploading overwrites the object. We don't bother with
        Content-MD5 retry logic; if the network corrupts mid-upload the next
        retry just overwrites.
        """
        _validate_object_key(object_key)
        path = Path(local_path)
        if not path.is_file():
            raise OssError(f"local file {path} missing")

        ct = content_type or "application/octet-stream"
        date_hdr = formatdate(timeval=None, localtime=False, usegmt=True)
        content_md5 = _md5_b64(path)

        sts = "\n".join(
            [
                "PUT",
                content_md5,
                ct,
                date_hdr,
                _canonicalized_resource(self.config.bucket, object_key),
            ]
        )
        sig = _sign(sts, self.config.access_key_secret)
        url = f"https://{self.base_host}/{object_key}"

        with path.open("rb") as fh:
            req = urllib.request.Request(url, method="PUT", data=fh.read())
            req.add_header("Authorization", f"OSS {self.config.access_key_id}:{sig}")
            req.add_header("Date", date_hdr)
            req.add_header("Content-Type", ct)
            req.add_header("Content-MD5", content_md5)
            req.add_header("Content-Length", str(path.stat().st_size))

            try:
                with urllib.request.urlopen(req, timeout=300) as resp:
                    if resp.status not in (200, 201, 204):
                        raise OssError(f"OSS PUT returned {resp.status}")
            except urllib.error.HTTPError as exc:
                body = exc.read().decode("utf-8", errors="replace")[:500]
                raise OssError(f"OSS PUT failed [{exc.code}]: {body}") from exc

        return url

    def sign_get_url(self, object_key: str, expires_in_seconds: int = 24 * 3600) -> str:
        """Build a presigned URL valid for <expires_in_seconds>.

        Suitable for forwarding to tenant admins so they can hand a download
        link to their employees. Default TTL: 24h.
        """
        _validate_object_key(object_key)
        if expires_in_seconds <= 0 or expires_in_seconds > 7 * 24 * 3600:
            raise OssError("expires_in_seconds must be in (0, 7*24*3600]")
        expires = int(time.time()) + int(expires_in_seconds)
        sts = "\n".join(
            [
                "GET",
                "",
                "",
                str(expires),
                _canonicalized_resource(self.config.bucket, object_key),
            ]
        )
        sig = _sign(sts, self.config.access_key_secret)
        qs = urllib.parse.urlencode(
            {
                "OSSAccessKeyId": self.config.access_key_id,
                "Expires": expires,
                "Signature": sig,
            }
        )
        return f"https://{self.base_host}/{object_key}?{qs}"
