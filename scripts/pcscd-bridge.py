#!/usr/bin/env python3
"""pcscd bridge — HTTP API for reading NTAG424 bolt cards via PC/SC reader.

Usage:
  python3 scripts/pcscd-bridge.py [--port 4321]

Requirements:
  pip install pyscard

Endpoints:
  GET /status     — reader and card status
  GET /tap        — wait for card tap, return {p, c, uid}
  GET /card-info  — return cached card info {uid, k1, k2, version}
"""

import sys
import json
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler

try:
    from smartcard.System import readers
    from smartcard.util import toHexString, toBytes
except ImportError:
    print("pyscard not installed. Run: pip install pyscard", file=sys.stderr)
    sys.exit(1)

NDEF_AID = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01]
cached_card_info = {}


def select_ndef_app(connection):
    apdu = [0x00, 0xA4, 0x04, 0x00, 0x07] + NDEF_AID + [0x00]
    data, sw1, sw2 = connection.transmit(apdu)
    if sw1 != 0x90:
        raise RuntimeError(f"NDEF app select failed: SW={sw1:02X}{sw2:02X}")
    return data


def read_ndef_file(connection, file_id):
    select_apdu = [0x00, 0xA4, 0x00, 0x00, 0x02, (file_id >> 8) & 0xFF, file_id & 0xFF, 0x00]
    data, sw1, sw2 = connection.transmit(select_apdu)
    if sw1 != 0x90:
        raise RuntimeError(f"File {file_id:04X} select failed: SW={sw1:02X}{sw2:02X}")

    read_apdu = [0x00, 0xB0, 0x00, 0x00, 0x00]
    data, sw1, sw2 = connection.transmit(read_apdu)
    if sw1 not in (0x90, 0x61):
        raise RuntimeError(f"File {file_id:04X} read failed: SW={sw1:02X}{sw2:02X}")
    return bytes(data)


def parse_ndef_url(ndef_data):
    idx = 0
    while idx < len(ndef_data):
        if idx + 3 > len(ndef_data):
            break
        tnf = ndef_data[idx] & 0x07
        il = (ndef_data[idx] >> 3) & 0x01
        sr = (ndef_data[idx] >> 4) & 0x01
        has_payload = (ndef_data[idx] >> 5) & 0x01
        idx += 1

        type_len = ndef_data[idx]
        idx += 1

        payload_len = ndef_data[idx] if sr else int.from_bytes(ndef_data[idx:idx+4], 'big')
        if not sr:
            idx += 4
        else:
            idx += 1

        if il:
            idx += 1

        idx += type_len

        if tnf == 0x01 and has_payload:
            payload = ndef_data[idx:idx+payload_len]
            if payload and payload[0] in (0x01, 0x02, 0x03, 0x04):
                url = payload[1:].decode('utf-8', errors='replace')
                if payload[0] == 0x01:
                    url = "http://" + url
                elif payload[0] == 0x02:
                    url = "https://" + url
                elif payload[0] == 0x04:
                    url = "https://" + url
                return url
            elif payload:
                return payload.decode('utf-8', errors='replace')

        idx += payload_len
    return None


def extract_params(url):
    from urllib.parse import urlparse, parse_qs
    parsed = urlparse(url)
    params = parse_qs(parsed.query)
    p = params.get('p', [None])[0]
    c = params.get('c', [None])[0]
    return p, c


def read_card():
    reader_list = readers()
    if not reader_list:
        raise RuntimeError("No PC/SC readers found")

    reader = reader_list[0]
    connection = reader.createConnection()
    connection.connect()

    try:
        select_ndef_app(connection)
        ndef_data = read_ndef_file(connection, 0xE104)
        url = parse_ndef_url(list(ndef_data))

        if not url:
            raise RuntimeError("No NDEF URL found on card")

        if url.startswith("lnurlw://"):
            url = "https://" + url[len("lnurlw://"):]

        p, c = extract_params(url)
        if not p or not c:
            raise RuntimeError(f"URL missing p/c params: {url}")

        return {"p": p, "c": c, "url": url}
    finally:
        connection.disconnect()


class BridgeHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/status":
            reader_list = readers()
            status = {
                "readers": len(reader_list),
                "reader_names": [str(r) for r in reader_list],
                "bridge": "ok",
            }
            self._json_response(200, status)

        elif self.path == "/tap":
            try:
                result = read_card()
                cached_card_info.update(result)
                self._json_response(200, {"p": result["p"], "c": result["c"]})
            except Exception as e:
                self._json_response(500, {"error": str(e)})

        elif self.path == "/card-info":
            if cached_card_info:
                self._json_response(200, cached_card_info)
            else:
                self._json_response(404, {"error": "No card read yet. Call /tap first."})
        else:
            self._json_response(404, {"error": "Not found"})

    def do_HEAD(self):
        self.send_response(200)
        self.end_headers()

    def _json_response(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print(f"[pcscd-bridge] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="pcscd bridge for NTAG424 card reading")
    parser.add_argument("--port", type=int, default=4321)
    args = parser.parse_args()

    reader_list = readers()
    if not reader_list:
        print("WARNING: No PC/SC readers detected", file=sys.stderr)
    else:
        for r in reader_list:
            print(f"Reader: {r}")

    server = HTTPServer(("127.0.0.1", args.port), BridgeHandler)
    print(f"pcscd-bridge listening on http://127.0.0.1:{args.port}")
    print("Endpoints: /status /tap /card-info")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
