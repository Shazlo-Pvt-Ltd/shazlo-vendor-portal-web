import ipaddress
from collections.abc import Sequence

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
Network = ipaddress.IPv4Network | ipaddress.IPv6Network


def parse_networks(cidrs: Sequence[str]) -> list[Network]:
    return [ipaddress.ip_network(cidr) for cidr in cidrs]


def _parse(value: str) -> IPAddress | None:
    """The address, with IPv4-mapped IPv6 (`::ffff:203.0.113.7`, what a dual-stack socket
    reports for an IPv4 peer) turned into plain IPv4, so it matches IPv4 proxy networks."""
    try:
        address = ipaddress.ip_address(value.strip())
    except ValueError:
        return None
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped is not None:
        return address.ipv4_mapped
    return address


def client_ip(peer: str | None, forwarded_for: Sequence[str], trusted: Sequence[Network]) -> str:
    """The client's IP. `X-Forwarded-For` counts only when the TCP peer is a trusted proxy.

    `peer` is the TCP peer's address (None if unknown) and `forwarded_for` the values of the
    `X-Forwarded-For` header lines. Each proxy appends the address it saw, so the list is read
    from the right. The first address that is not a trusted proxy is the client; anything
    further left was written by the client and can be anything.
    """
    address = _parse(peer) if peer else None
    if address is None:
        return "unknown"
    if not any(address in network for network in trusted):
        return str(address)
    hops = [hop for header in forwarded_for for hop in header.split(",")]
    for hop in reversed(hops):
        candidate = _parse(hop)
        if candidate is None:
            # A garbled entry: stop here and use the proxy that vouched for it.
            return str(address)
        if not any(candidate in network for network in trusted):
            return str(candidate)
    return str(address)


def rate_limit_subject(ip: str, ipv6_prefix: int) -> str:
    """What the per-IP rate limits count: an IPv4 address as it is, an IPv6 address as its
    network of `ipv6_prefix` bits (e.g. `2001:db8:1:2::/64`).

    One host usually holds a whole /64, so counting single IPv6 addresses would let it pick a
    new one for every request. `ip` comes from `client_ip`; "unknown" stays as it is.
    """
    address = _parse(ip)
    if isinstance(address, ipaddress.IPv6Address):
        return str(ipaddress.IPv6Network((address, ipv6_prefix), strict=False))
    return ip if address is None else str(address)
