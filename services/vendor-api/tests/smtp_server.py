"""A minimal SMTP server for tests: records what it receives. No TLS."""

import asyncio
import base64
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from email import message_from_bytes
from email.message import EmailMessage
from email.policy import default


@dataclass
class FakeSmtp:
    host: str = "127.0.0.1"
    port: int = 0
    messages: list[EmailMessage] = field(default_factory=list)
    envelopes: list[tuple[str, list[str]]] = field(default_factory=list)
    credentials: list[tuple[str, str]] = field(default_factory=list)
    # Answer every MAIL command with this code (to simulate a provider that refuses).
    refuse_with: str | None = None

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        sender = ""
        recipients: list[str] = []

        def reply(line: str) -> None:
            writer.write(line.encode() + b"\r\n")

        reply("220 fake ESMTP ready")
        while raw := await reader.readline():
            line = raw.decode().strip()
            command = line.upper()
            if command.startswith("EHLO"):
                reply("250-fake")
                reply("250-AUTH PLAIN")
                reply("250 8BITMIME")
            elif command.startswith("HELO"):
                reply("250 fake")
            elif command.startswith("AUTH PLAIN"):
                _, user, password = base64.b64decode(line.split()[2]).split(b"\0")
                self.credentials.append((user.decode(), password.decode()))
                reply("235 2.7.0 authenticated")
            elif command.startswith("MAIL FROM"):
                if self.refuse_with:
                    reply(self.refuse_with)
                    continue
                sender = line.partition(":")[2].strip()
                recipients = []
                reply("250 ok")
            elif command.startswith("RCPT TO"):
                recipients.append(line.partition(":")[2].strip())
                reply("250 ok")
            elif command == "DATA":
                reply("354 go ahead")
                body = b""
                while (chunk := await reader.readline()) != b".\r\n":
                    body += chunk
                parsed = message_from_bytes(body, policy=default)
                assert isinstance(parsed, EmailMessage)
                self.messages.append(parsed)
                self.envelopes.append((sender, recipients))
                reply("250 queued")
            elif command == "QUIT":
                reply("221 bye")
                break
            else:
                reply("250 ok")
            await writer.drain()
        await writer.drain()
        writer.close()


@asynccontextmanager
async def fake_smtp() -> AsyncIterator[FakeSmtp]:
    server = FakeSmtp()
    listener = await asyncio.start_server(server._handle, server.host, 0)  # noqa: SLF001
    server.port = listener.sockets[0].getsockname()[1]
    try:
        yield server
    finally:
        listener.close()
        await listener.wait_closed()
