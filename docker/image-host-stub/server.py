"""A stand-in for Cloudinary's Admin API, for the end-to-end stack only (docker-compose.e2e.yml).

vendor-api checks every upload by asking the image host what it stored
(`GET /v1_1/<cloud>/resources/image/upload/<public id>`) and deletes a refused file
(`DELETE /v1_1/<cloud>/resources/image/upload`). In the browser tests the upload itself is
intercepted by Playwright and never reaches Cloudinary, so this server answers those two calls as
Cloudinary would for a small PNG. vendor-api is pointed at it with CLOUDINARY_ADMIN_API_URL, which
it accepts in development and tests only.

Standard library only: it runs in a plain python image with this file mounted. It holds nothing,
checks no credentials and must never be exposed beyond the compose network.
"""

import json
import re
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import unquote

PORT = 8004
DESCRIBE = re.compile(r"^/v1_1/(?P<cloud>[A-Za-z0-9_-]+)/resources/image/upload/(?P<public_id>.+)$")
DELETE = re.compile(r"^/v1_1/[A-Za-z0-9_-]+/resources/image/upload$")


class Handler(BaseHTTPRequestHandler):
    server_version = "image-host-stub"

    def _send(self, status: int, body: object) -> None:
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:  # noqa: N802 - the name http.server calls
        path = self.path.split("?", 1)[0]
        if path == "/health":
            self._send(200, {"status": "ok"})
            return
        match = DESCRIBE.match(path)
        if match is None:
            self._send(404, {"error": {"message": "Not found"}})
            return
        public_id = unquote(match["public_id"])
        # Every file "exists": a small PNG. The address is Cloudinary's CDN, which the tests also
        # intercept, so the portal's image policy (res.cloudinary.com only) is exercised as is.
        self._send(
            200,
            {
                "public_id": public_id,
                "resource_type": "image",
                "type": "upload",
                "format": "png",
                "bytes": 2048,
                "width": 800,
                "height": 800,
                "secure_url": f"https://res.cloudinary.com/{match['cloud']}/image/upload/{public_id}.png",
            },
        )

    def do_DELETE(self) -> None:  # noqa: N802 - the name http.server calls
        if DELETE.match(self.path.split("?", 1)[0]):
            self._send(200, {"deleted": {}})
        else:
            self._send(404, {"error": {"message": "Not found"}})

    def log_message(self, format: str, *args: object) -> None:  # noqa: A002 - the base class's name
        # One short line per request on stderr, so `docker compose logs` shows what was asked.
        super().log_message(format, *args)


if __name__ == "__main__":
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()  # noqa: S104 - compose network only
