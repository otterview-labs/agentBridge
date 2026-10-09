"""Read recent human messages without transferring Codex's tool transcripts."""
import json
import os
import sys


def recent_records(path, limit=8 * 1024 * 1024):
    found = {}
    with open(path, "rb") as transcript:
        position = os.fstat(transcript.fileno()).st_size
        remaining = limit
        fragment = b""
        while position > 0 and remaining > 0:
            size = min(position, remaining, 65536)
            position -= size
            remaining -= size
            transcript.seek(position)
            pieces = (transcript.read(size) + fragment).split(b"\n")
            fragment = pieces.pop(0)
            if position == 0:
                pieces.insert(0, fragment)
            for line in reversed(pieces):
                try:
                    entry = json.loads(line)
                    payload = entry.get("payload", {})
                    record_type = entry.get("type")
                    event = payload.get("type")
                    if record_type == "event_msg" and event in (
                        "task_started", "task_complete", "task_failed", "task_cancelled"
                    ):
                        found.setdefault("state", {"type": "event_msg", "payload": {"type": event}})
                    role = payload.get("role") if record_type == "response_item" and event == "message" else None
                    text = ""
                    if role in ("user", "assistant"):
                        text = "\n".join(item.get("text", "") for item in payload.get("content", [])
                                         if item.get("type") in ("input_text", "output_text"))
                    elif record_type == "event_msg" and event in ("user_message", "agent_message"):
                        role = "user" if event == "user_message" else "assistant"
                        text = payload.get("message", "")
                    if text.strip() and role not in found and not (role == "user" and text.startswith("<")):
                        found[role] = {"type": "response_item", "payload": {
                            "type": "message", "role": role, "content": [{
                                "type": "input_text" if role == "user" else "output_text",
                                "text": text[:2400]}]}}
                    if all(key in found for key in ("user", "assistant", "state")):
                        return list(reversed(list(found.values())))
                except (ValueError, TypeError, AttributeError):
                    # The bounded window can start inside a large tool record.
                    continue
    return list(reversed(list(found.values())))


if __name__ == "__main__":
    for record in recent_records(sys.argv[1]):
        print(json.dumps(record, ensure_ascii=False, separators=(",", ":")))
