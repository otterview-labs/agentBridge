"""Optional OpenHands V1 backend; phone owns the supervision queue.

Run in a dedicated workspace using tools/openhands/requirements.txt.
The service binds localhost; use an authenticated HTTPS proxy for phone access.
"""
import argparse
import os
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--port", type=int, default=8001)
    args = parser.parse_args()
    workspace = args.workspace.expanduser().resolve()
    workspace.mkdir(parents=True, exist_ok=True)
    key = os.environ.get("ASB_OPENHANDS_SERVER_KEY", "")
    if not key:
        raise SystemExit("Set ASB_OPENHANDS_SERVER_KEY before starting the backend")
    secret = os.environ.get("OH_SECRET_KEY", "")
    if not secret:
        raise SystemExit("Set a stable OH_SECRET_KEY to preserve encrypted model credentials across restarts")
    # Keep default SDK import-time paths inside the selected execution workspace.
    os.chdir(workspace)
    from openhands.agent_server.api import create_app
    from openhands.agent_server.config import Config
    import uvicorn

    app = create_app(Config(
        session_api_keys=[key], workspace_path=workspace,
        conversations_path=workspace / ".openhands" / "conversations",
        bash_events_dir=workspace / ".openhands" / "bash-events",
        enable_vscode=False, enable_browser=False, preload_tools=False,
        max_concurrent_runs=2, secret_key=secret,
    ))
    uvicorn.run(app, host="127.0.0.1", port=args.port)


if __name__ == "__main__":
    main()
