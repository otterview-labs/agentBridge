"""Synthetic end-to-end: production Java coordinator -> real OpenHands -> local LLM.

No employee sessions, personal keys or repository workspaces are accessed.
Requires JDK 17, a json-java 20250517 jar and the pinned OpenHands packages.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import urllib.request

ROOT = Path(__file__).resolve().parents[2]


def main() -> None:
    json_jar = Path(os.environ["ASB_JSON_JAR"]).resolve()
    java_home = Path(os.environ.get("JAVA_HOME", "/Users/chenhao/.local/share/java/jdk-17"))
    with tempfile.TemporaryDirectory(prefix="asb-openhands-live-") as temporary:
        work = Path(temporary)
        os.chdir(work)
        os.environ.setdefault("LITELLM_LOCAL_MODEL_COST_MAP", "True")
        os.environ.setdefault("OPENHANDS_SUPPRESS_BANNER", "1")
        from openhands.agent_server.api import create_app
        from openhands.agent_server.config import Config
        from openhands.sdk import Agent, LLM
        from openhands.sdk.workspace import LocalWorkspace
        from openhands.sdk.conversation.request import StartConversationRequest
        from pydantic import SecretStr
        import uvicorn

        key = "synthetic-server-key"
        app = create_app(Config(session_api_keys=[key], workspace_path=work,
            conversations_path=work / "conversations", bash_events_dir=work / "bash-events",
            enable_vscode=False, enable_browser=False, preload_tools=False))
        sock = socket.socket()
        sock.bind(("127.0.0.1", 0))
        port = sock.getsockname()[1]
        sock.close()
        server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning"))
        thread = threading.Thread(target=server.run, daemon=True)
        thread.start()
        try:
            for _ in range(200):
                if server.started:
                    break
                time.sleep(0.1)
            if not server.started:
                raise RuntimeError("Agent Server did not start")
            llm = LLM(usage_id="agent", model=os.environ.get("ASB_OH_MODEL", "openai/qwen3.6:27b"),
                base_url=os.environ.get("ASB_OH_URL", "http://127.0.0.1:11434/v1"),
                api_key=SecretStr("local-synthetic-key"), temperature=0, max_output_tokens=256, reasoning_effort="none", litellm_extra_body={"think": False,"chat_template_kwargs":{"enable_thinking":False}})
            agent = Agent(llm=llm, tools=[], include_default_tools=["FinishTool"], system_prompt="You handle synthetic connectivity checks. Use the finish tool to return the requested fixed marker. Do not inspect files or use commands.")
            request = StartConversationRequest(agent=agent, workspace=LocalWorkspace(working_dir=str(work)), max_iterations=2, autotitle=False)
            data = request.model_dump(mode="json", context={"expose_secrets": True})
            req = urllib.request.Request(f"http://127.0.0.1:{port}/api/conversations", method="POST",
                data=json.dumps(data).encode(), headers={"X-Session-API-Key": key, "Content-Type": "application/json"})
            with urllib.request.urlopen(req, timeout=30) as response:
                conversation = json.load(response)
            for name in ("ManagedCoordinator", "OpenHandsBackend"):
                source = (ROOT / "android/app/src/main/java/com/otterview/agentsessionbridge" / f"{name}.java").read_text()
                (work / f"{name}.java").write_text(source.replace("package com.otterview.agentsessionbridge;", ""))
            (work / "LiveHarness.java").write_text(r'''
import org.json.*;import java.net.*;import java.io.*;import java.nio.charset.StandardCharsets;
public class LiveHarness {
 public static void main(String[] args)throws Exception{
  String base=args[0],id=args[1],key=args[2];
  OpenHandsBackend backend=new OpenHandsBackend((method,path,body)->{
   HttpURLConnection c=(HttpURLConnection)new URL(base+path).openConnection();
   c.setRequestMethod(method);c.setRequestProperty("X-Session-API-Key",key);c.setConnectTimeout(10000);c.setReadTimeout(30000);
   try {
    if(body!=null){c.setDoOutput(true);c.setRequestProperty("Content-Type","application/json");try(OutputStream out=c.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}}
    if(c.getResponseCode()!=200)throw new IllegalStateException("HTTP "+c.getResponseCode());
    try(InputStream in=c.getInputStream()){return new JSONObject(new String(in.readAllBytes(),StandardCharsets.UTF_8));}
   }finally{c.disconnect();}
  });
  File file=new File(args[3],"queue.json");
  ManagedCoordinator.Memory memory=new ManagedCoordinator.Memory(){public String read(JSONObject j){return "Synthetic confirmed scope";}public void record(JSONObject j,String t){}};
  ManagedCoordinator coordinator=new ManagedCoordinator(file,(job,obs)->obs.optString("output").contains("TRAINING_READY_482")?
    new JSONObject().put("action","review").put("reason","Synthetic result returned; awaiting user acceptance"):
    new JSONObject().put("action","reply").put("reply","This is a synthetic connectivity check. Do not read files or execute commands. Use the finish tool with message TRAINING_READY_482."),memory);
  coordinator.register("openhands",backend);
  JSONObject binding=new JSONObject().put("conversationId",id);
  JSONObject job=coordinator.add("openhands",binding,"Synthetic connectivity check","Only return the fixed marker",true,1,10);
  coordinator.enable(true);coordinator.tick();
  JSONObject after=coordinator.snapshot().getJSONArray("jobs").getJSONObject(0);
  if(after.optInt("replyCount")!=1 || !after.optString("state").equals("waiting"))throw new AssertionError(after);
  JSONObject observation=null;
  for(int i=0;i<100;i++){observation=backend.observe(binding);if(observation.optString("backendStatus").equals("finished"))break;Thread.sleep(1000);}
  if(observation==null || !observation.optString("output").contains("TRAINING_READY_482"))throw new AssertionError(observation);
  coordinator.control(job.getString("id"),"pause");coordinator.control(job.getString("id"),"resume");coordinator.tick();
  after=coordinator.snapshot().getJSONArray("jobs").getJSONObject(0);
  if(!after.optString("state").equals("review") || after.optInt("replyCount")!=1)throw new AssertionError(after);
  ManagedCoordinator reopened=new ManagedCoordinator(file,(j,o)->new JSONObject().put("action","wait"),memory);
  if(!reopened.snapshot().getJSONArray("jobs").getJSONObject(0).optString("state").equals("review"))throw new AssertionError("lost review state");
  System.out.println("OpenHands V1: sent once, real model returned TRAINING_READY_482, review persisted after reopen");
 }
}''')
            subprocess.run([str(java_home / "bin/javac"), "-cp", str(json_jar), "-d", str(work),
                *(str(work / f"{name}.java") for name in ("ManagedCoordinator", "OpenHandsBackend", "LiveHarness"))], check=True)
            subprocess.run([str(java_home / "bin/java"), "-cp", f"{work}:{json_jar}", "LiveHarness",
                f"http://127.0.0.1:{port}", str(conversation["id"]), key, str(work)], check=True, timeout=180)
        finally:
            server.should_exit = True
            thread.join(timeout=15)


if __name__ == "__main__":
    main()
