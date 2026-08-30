#!/usr/bin/env python3
r"""Minimal HTTPS static file server for Horizon Survey, no nginx or
external cert tooling required -- works the same on a Raspberry Pi and
on Windows. Serves index.html/overlay.html (and the other files in this
directory) over TLS.

Why HTTPS at all: a phone browser's camera (getUserMedia) and compass/
tilt sensors (DeviceOrientationEvent) are both blocked on plain HTTP by
browser security policy -- this generates a self-signed certificate on
first run (valid 10 years) and serves over TLS so those APIs work when
a phone on the same network opens this machine's IP address. The
browser will show a one-time "not trusted" warning for the self-signed
cert -- that's expected, just accept/proceed; this isn't a public-trust
situation.

The certificate and key go to ~/.horizon-survey/ rather than into this
folder, because this folder is what gets served: a private key sitting
next to index.html is a private key anyone on the LAN can download.

Usage:
    python3 -m venv .venv
    .venv/bin/pip install -r requirements-serve.txt
    .venv/bin/python serve_https.py
    (Windows: py -m venv .venv, then .venv\Scripts\pip / .venv\Scripts\python)

Then open the HTTPS URL it prints, from a phone on the same Wi-Fi/LAN.
"""

from __future__ import annotations

import datetime
import functools
import http.server
import ipaddress
import os
import socket
import ssl
import sys
from pathlib import Path

PORT = 8443
SERVE_DIR = Path(__file__).resolve().parent
# Deliberately outside SERVE_DIR: everything in there is downloadable.
CERT_DIR = Path.home() / ".horizon-survey"
CERT_FILE = CERT_DIR / "cert.pem"
KEY_FILE = CERT_DIR / "key.pem"


def cert_covers(path: Path, ip: str) -> bool:
    """True if an existing certificate already lists `ip` in its SAN.

    A certificate whose SAN does not match the address the phone typed is
    rejected by every current browser, so one generated on a different
    network has to be replaced rather than reused.
    """
    from cryptography import x509

    try:
        cert = x509.load_pem_x509_certificate(path.read_bytes())
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
        return ipaddress.ip_address(ip) in san.get_values_for_type(x509.IPAddress)
    except Exception:
        return False


def ensure_cert(ip: str) -> None:
    if CERT_FILE.exists() and KEY_FILE.exists() and cert_covers(CERT_FILE, ip):
        return
    why = "No certificate found" if not CERT_FILE.exists() else f"Existing certificate does not cover {ip}"
    print(f"{why} -- generating a self-signed one (~10 year validity)...")
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
    alt_names = [
        x509.DNSName("horizon-survey.local"),
        x509.DNSName("localhost"),
        x509.IPAddress(ipaddress.ip_address("127.0.0.1")),
    ]
    if ip != "127.0.0.1":
        alt_names.append(x509.IPAddress(ipaddress.ip_address(ip)))
    cert = (
        x509.CertificateBuilder()
        .subject_name(subject)
        .issuer_name(issuer)
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - datetime.timedelta(days=1))
        .not_valid_after(now + datetime.timedelta(days=3650))
        .add_extension(x509.SubjectAlternativeName(alt_names), critical=False)
        .sign(key, hashes.SHA256())
    )

    CERT_DIR.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_bytes(
        key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.TraditionalOpenSSL,
            encryption_algorithm=serialization.NoEncryption(),
        )
    )
    if os.name == "posix":
        KEY_FILE.chmod(0o600)
    CERT_FILE.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    print(f"Wrote {CERT_FILE} and {KEY_FILE}")


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
    ip = local_ip()
    ensure_cert(ip)
    # Pinned to this script's directory: without it the handler serves
    # whatever the current working directory happens to be.
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(SERVE_DIR))
    httpd = http.server.HTTPServer(("0.0.0.0", PORT), handler)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(certfile=str(CERT_FILE), keyfile=str(KEY_FILE))
    httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)

    print(f"\nServing {SERVE_DIR} over HTTPS.")
    print("Every file in that folder is readable by anyone on this network.")
    print(f"\nOn a phone/PC on the same network, open:\n\n    https://{ip}:{PORT}/index.html\n")
    print("(Browser will warn the certificate isn't trusted -- that's expected")
    print(" for a self-signed cert; accept/proceed to continue.)\n")
    print("Ctrl+C to stop.\n")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
