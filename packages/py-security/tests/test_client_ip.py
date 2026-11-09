import pytest

from shazlo_security.client_ip import client_ip, parse_networks, rate_limit_subject

PROXIES = parse_networks(["10.0.0.0/8", "192.168.0.1/32"])


@pytest.mark.parametrize(
    ("peer", "forwarded", "expected"),
    [
        # Not from a trusted proxy: the header is ignored, however convincing it looks.
        ("203.0.113.5", ["198.51.100.1"], "203.0.113.5"),
        ("203.0.113.5", [], "203.0.113.5"),
        # From a trusted proxy: the last address that is not a proxy.
        ("10.0.0.1", ["198.51.100.1"], "198.51.100.1"),
        ("10.0.0.1", ["198.51.100.1, 10.0.0.7"], "198.51.100.1"),
        ("10.0.0.1", ["198.51.100.1", "10.0.0.7"], "198.51.100.1"),
        # What the client wrote further left cannot override what the proxy appended.
        ("10.0.0.1", ["6.6.6.6, 198.51.100.1"], "198.51.100.1"),
        ("10.0.0.1", ["1.1.1.1, 2.2.2.2, 10.0.0.9"], "2.2.2.2"),
        # No usable header: the proxy itself.
        ("10.0.0.1", [], "10.0.0.1"),
        ("10.0.0.1", ["garbage"], "10.0.0.1"),
        ("10.0.0.1", ["6.6.6.6, garbage"], "10.0.0.1"),
        ("192.168.0.1", ["2001:db8::1"], "2001:db8::1"),
        # IPv4-mapped IPv6 (a dual-stack socket's view of an IPv4 peer) is plain IPv4, so it
        # matches IPv4 proxy networks and shares the IPv4 address's counters.
        ("::ffff:203.0.113.5", [], "203.0.113.5"),
        ("::ffff:10.0.0.1", ["198.51.100.1"], "198.51.100.1"),
        ("10.0.0.1", ["::ffff:198.51.100.1"], "198.51.100.1"),
        (None, ["1.1.1.1"], "unknown"),
        ("not-an-ip", ["1.1.1.1"], "unknown"),
    ],
)
def test_client_ip(peer: str | None, forwarded: list[str], expected: str) -> None:
    assert client_ip(peer, forwarded, PROXIES) == expected


def test_no_trusted_proxies_means_the_header_is_never_read() -> None:
    assert client_ip("10.0.0.1", ["198.51.100.1"], []) == "10.0.0.1"


@pytest.mark.parametrize(
    ("ip", "prefix", "expected"),
    [
        ("203.0.113.5", 64, "203.0.113.5"),
        ("2001:db8:1:2:aaaa:bbbb:cccc:dddd", 64, "2001:db8:1:2::/64"),
        ("2001:db8:1:2::1", 64, "2001:db8:1:2::/64"),
        ("2001:db8:1:2:aaaa::1", 48, "2001:db8:1::/48"),
        ("2001:db8:1:2::1", 128, "2001:db8:1:2::1/128"),
        ("::ffff:203.0.113.5", 64, "203.0.113.5"),
        ("unknown", 64, "unknown"),
    ],
)
def test_rate_limit_subject(ip: str, prefix: int, expected: str) -> None:
    assert rate_limit_subject(ip, prefix) == expected
