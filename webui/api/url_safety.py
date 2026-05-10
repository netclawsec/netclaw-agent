"""SSRF-safe URL fetcher.

The studio routes (save-output, oss-mirror) accept arbitrary http(s) URLs from
the SPA. Without guards a caller can pin them at internal services
(http://127.0.0.1:8080/admin, http://169.254.169.254/, http://intranet.host/)
or use DNS rebinding to swap the resolved IP between validation and connect.

This module exposes ``open_safe_http`` which validates URL → resolves DNS →
checks every resolved IP against the private/loopback/link-local block list →
opens the connection by IP (Host header forwarded) so a rebinding swap can't
sneak past validation. Redirects are followed manually with the same checks.
"""

from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
from dataclasses import dataclass
from typing import IO
from urllib.parse import urlparse, urlunparse

MAX_REDIRECTS = 4
DEFAULT_TIMEOUT = 30.0


class UnsafeUrlError(ValueError):
    """Raised when a URL or its resolved IPs fail SSRF validation."""


@dataclass(frozen=True)
class SafeResponse:
    status: int
    headers: dict[str, str]
    body: IO[bytes]

    def read_chunk(self, size: int) -> bytes:
        return self.body.read(size)


def _ip_blocked(ip: str) -> bool:
    """Return True for any non-global-public IP.

    The earlier "is_private/loopback/…" enumeration missed several real-world
    SSRF vectors — most notably CGNAT/Tailscale (100.64.0.0/10), which
    Python's `ipaddress` reports as `is_private=False` and `is_reserved=False`.
    `not addr.is_global` is the union we actually want: any address that
    isn't routable on the public Internet gets rejected (loopback, link-local,
    private RFC1918, ULA, multicast, CGNAT, documentation, benchmarking,
    reserved, unspecified).
    """
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return True
    if addr.is_multicast:
        return True
    return not addr.is_global


def _resolve_safe(host: str, port: int) -> tuple[str, int]:
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise UnsafeUrlError(f"dns resolve failed: {exc}") from exc
    for family, _socktype, _proto, _canon, sockaddr in infos:
        ip = sockaddr[0]
        if _ip_blocked(ip):
            raise UnsafeUrlError(f"resolved IP {ip} is in a blocked range")
        if family in (socket.AF_INET, socket.AF_INET6):
            return ip, port
    raise UnsafeUrlError("no usable IPv4/IPv6 address")


def _normalize_url(url: str) -> tuple[str, str, int, str]:
    """Return (scheme, host, port, path_with_query). Raises UnsafeUrlError on bad input."""
    if not isinstance(url, str) or len(url) > 4096:
        raise UnsafeUrlError("url must be a string ≤ 4096 chars")
    parsed = urlparse(url)
    if parsed.scheme not in ("http", "https"):
        raise UnsafeUrlError("only http/https are allowed")
    host = (parsed.hostname or "").strip().lower()
    if not host:
        raise UnsafeUrlError("missing host")
    # Block raw IP literals that aren't globally routable, before we even
    # touch DNS. Same semantics as _ip_blocked() above.
    try:
        if _ip_blocked(host):
            raise UnsafeUrlError(f"literal IP {host} is in a blocked range")
    except ValueError:
        # Hostname (not literal IP) — DNS check happens below.
        pass
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    path = parsed.path or "/"
    if parsed.query:
        path = f"{path}?{parsed.query}"
    return parsed.scheme, host, port, path


class _PinnedHTTPSConnection(http.client.HTTPSConnection):
    """HTTPSConnection that connects to a pre-resolved IP but presents the
    original hostname for SNI / cert validation.

    Why we need this: ``HTTPSConnection.__init__`` does not accept
    ``server_hostname`` kwarg (only ``connect()`` uses it via ``self.host``).
    Passing ``ip`` as ``host`` would skip DNS rebinding but break SNI and
    fail cert validation. Override connect() to set both correctly.
    """

    def __init__(self, ip: str, sni_host: str, port: int, **kwargs):
        super().__init__(ip, port, **kwargs)
        self._sni_host = sni_host

    def connect(self):  # type: ignore[override]
        sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
        # Wrap with TLS using the *original* hostname for SNI + cert verify.
        self.sock = self._context.wrap_socket(sock, server_hostname=self._sni_host)


def open_safe_http(url: str, timeout: float = DEFAULT_TIMEOUT) -> SafeResponse:
    """Open the URL with SSRF guards and manual-redirect handling.

    Caller is responsible for closing ``response.body``.
    """
    seen: list[str] = []
    cur = url
    for _ in range(MAX_REDIRECTS + 1):
        if cur in seen:
            raise UnsafeUrlError("redirect loop")
        seen.append(cur)
        scheme, host, port, path = _normalize_url(cur)
        ip, port = _resolve_safe(host, port)
        conn: http.client.HTTPConnection
        if scheme == "https":
            ctx = ssl.create_default_context()
            conn = _PinnedHTTPSConnection(ip, host, port, timeout=timeout, context=ctx)
        else:
            conn = http.client.HTTPConnection(ip, port, timeout=timeout)
        # Use the original host in Host header so virtual-hosting sites
        # respond with the right cert + content even though we connected by IP.
        conn.request(
            "GET",
            path,
            headers={"Host": host, "User-Agent": "NetClawAgent/Studio"},
        )
        resp = conn.getresponse()
        if resp.status in (301, 302, 303, 307, 308):
            location = resp.getheader("Location") or ""
            resp.close()
            conn.close()
            if not location:
                raise UnsafeUrlError("redirect with empty Location")
            # Resolve relative redirects against the previous URL.
            if location.startswith("/"):
                cur = urlunparse((scheme, f"{host}:{port}", location, "", "", ""))
            else:
                cur = location
            continue
        # Final response.
        headers = {k.lower(): v for k, v in resp.getheaders()}
        return SafeResponse(status=resp.status, headers=headers, body=resp)
    raise UnsafeUrlError(f"too many redirects (>{MAX_REDIRECTS})")
