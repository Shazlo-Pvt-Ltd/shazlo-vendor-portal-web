import pytest

from shazlo_security.keys import generate_private_key, private_key_pem


@pytest.fixture(scope="session")
def key_pems() -> dict[str, str]:
    """Two generated private keys by kid. Generating RSA keys is slow, so once per run."""
    return {
        kid: private_key_pem(generate_private_key()).decode()
        for kid in ("test-key-1", "test-key-2")
    }
