#!/usr/bin/env python3
"""Minimal HTTPS static file server for Horizon Survey, no nginx or
external cert tooling required -- works the same on a Raspberry Pi and
on Windows. Serves index.html/overlay.html (and anything else in this
directory) from wherever this script is run.

Why HTTPS at all: a phone browser's camera (getUserMedia) and compass/
tilt sensors (DeviceOrientationEvent) are both blocked on plain HTTP by
browser security policy -- this generates a self-signed certificate on
first run (valid 10 years) and serves over TLS so those APIs work when
a phone on the same network opens this machine's IP address. The
browser will show a one-time "not trusted" warning for the self-signed
cert -- that's expected, just accept/proceed; this isn't a public-trust
situation.

Usage:
    python3 -m venv .venv
    .venv/bin/pip install -r requirements-serve.txt
    .venv/bin/python serve_https.py
    (Windows: py -m venv .venv, then .venv\\Scripts\\pip / .venv\\Scripts\\python)

Then open the HTTPS URL it prints, from a phone on the same Wi-Fi/LAN.
"""

from __future__ import annotations

import datetime
import http.server
import socket
import ssl
import sys
from pathlib import Path

PORT = 8443
CERT_FILE = Path(__file__).parent / "horizon_survey_cert.pem"
KEY_FILE = Path(__file__).parent / "horizon_survey_key.pem"


def ensure_cert() -> None:
    if CERT_FILE.exists() and KEY_FILE.exists():
        return
    print("No certificate found -- generating a self-signed one (one-time, ~10 year validity)...")
    try:
        from cryptography import x509
        from cryptography.hazmat.primitives import hashes, serialization
        from cryptography.hazmat.primitives.asymmetric import rsa
        from cryptography.x509.oid import NameOID
    except ImportError:
        print(
            "Missing dependency 'cryptography'. Install it first:\n"
            "  .venv/bin/pip install -r requirements-serve.txt   (Linux/Pi)\n"
            "  .venv\\Scripts\\pip install -r requirements-serve.txt   (Windows)",
            file=sys.stderr,
        )
        sys.exit(1)

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "horizon-survey.local")])
    now = datetime.datetime.now(datetime.timezone.utc)
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(
            x509.SubjectAlternativeName([x509.DNSName("horizon-survey.local"), x509.IPAddress(__import__("ipaddress").ip_address("127.0.0.1"))]),
            critical=False,
        )
        .sign(key, hashes.SHA256())
    )
    KEY_FILE.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    CERT_FILE.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"Wrote {CERT_FILE.name} and {KEY_FILE.name}")


def local_ip() -> str:
    # Doesn't actually send anything -- just asks the OS which local
    # interface it would use to reach an external address, to find our
    # own LAN IP without depending on any specific network tool.
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("8.8.8.8", 80))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def main() -> None:
    ensure_cert()
    handler = http.server.SimpleHTTPRequestHandler
    httpd = http.server.HTTPServer(("0.0.0.0", PORT), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    ip = local_ip()
    print(f"\nServing this folder over HTTPS.")
    print(f"On a phone/PC on the same network, open:\n\n    https://{ip}:{PORT}/index.html\n")
    print("(Browser will warn the certificate isn't trusted -- that's expected")
    print(" for a self-signed cert; accept/proceed to continue.)\n")
    print("Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
