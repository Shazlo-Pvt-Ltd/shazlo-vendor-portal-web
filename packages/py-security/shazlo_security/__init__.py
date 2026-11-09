"""Security code that identity-api and vendor-api share (ADR 0010).

It imports nothing from either service: a service passes in its configuration and maps the
exceptions raised here to its own HTTP errors.
"""
