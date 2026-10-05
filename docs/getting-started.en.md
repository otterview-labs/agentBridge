# Your first session in Office Town

[中文](getting-started.zh.md) · [Watch the app demo](https://otterview-labs.github.io/agentBridge/en/#demo)

Connect one computer, find a session, and send a reply from your phone. Set up the butler and speech after that works.

You need Android 7.0+ and a Mac or Linux computer with an existing Codex or Claude Code session. For your first connection, use the same local network on both devices and keep the computer on.

## 1. Install the app

[Download the English APK](https://github.com/otterview-labs/agentBridge/releases/latest/download/agentbridge-en.apk). Open the downloaded file and follow Android's prompt to allow installation from your browser.

If the download does not start, choose `agentbridge-en.apk` under Assets in the [latest release](https://github.com/otterview-labs/agentBridge/releases/latest). The Chinese edition is `agentbridge-zh.apk`.

## 2. Prepare SSH on your computer

The phone connects over SSH. Your computer needs no Office Town installation.

On a Mac, open **System Settings → General → Sharing → Remote Login**. Enable Remote Login and allow the account that runs Codex or Claude Code. The settings show the SSH command and username. See [Apple's Remote Login guide](https://support.apple.com/guide/mac-help/allow-a-remote-computer-to-access-your-mac-mchlp1066/mac).

On Linux, run an SSH server. Ubuntu users can follow the [official OpenSSH guide](https://ubuntu.com/server/docs/how-to/security/openssh-server/) to install `openssh-server`; other distributions have their own setup.

Note your computer's local IP, SSH port, username, and password or private key. Use the account that owns the AI sessions. You usually do not need `root`; run `whoami` in that account's terminal to check the username.

On your phone, `localhost` and `127.0.0.1` refer to the phone itself. Enter your computer's address instead.

## 3. Find a session

1. Start a separate Codex or Claude Code session on your computer for this trial. Ask it to answer a short message without editing files or running commands.
2. In the app, tap **Add SSH**. Enter an office name, the computer's address, account, and password or private key. The default port is 22; use the actual port if yours differs.
3. Tap **Save Office**, then **Find tasks** in that office. **Find computers** can also scan your local network. The scan checks port 22 only, so you can still add a computer manually if the scan misses it.
4. Open the employee card for your trial session and read the recent messages or raw records.

If no tasks appear, check that SSH uses the same account that started the AI session. A successful SSH connection still needs readable session records on the computer.

## 4. Send a reply

In the trial session's **Your reply** field, enter a simple request such as “Reply only with: phone connection test. Do not edit files or run commands.” Tap **Send**.

Check the send result, then tap **Refresh Output** for new records. Refresh is manual. A delivered message does not mean the task has finished. If Codex Desktop is already working on the thread, the message may be queued for that thread to handle next.

This step succeeds when the original session receives your message and a new answer appears in its output.

## 5. Set up the butler and speech

Open the butler's **Set up model** settings. Enter your provider's OpenAI-compatible URL, model name, and API key as required. Save, tap **Verify Connection**, then send a text message to check the answer.

After refreshing your tasks, ask “Which tasks need my reply?” On an employee card, **Draft a reply** generates suggestions. Choose one, edit it, and send it yourself. Choosing a suggestion does not send it.

Once text chat works, open **Voice Settings**, use **Listen to Butler** to test playback, and test recognition with the microphone beside the chat input. Start **Call Butler** after both work. If system speech services are unavailable, you can configure Bailian / DashScope cloud speech with a Beijing-region key. See [voice setup](android-app.md#butler-voice-setup).

## If a step fails

| What you see | What to check |
| --- | --- |
| The scan finds no computer | Add the address and actual SSH port manually. Check that the devices can reach each other. |
| Connection refused or timed out | Check the computer is on, SSH is enabled, and the address and port are correct. Use the office's **More → Test** action to test SSH separately. |
| Authentication failed | Check the username, password or private key, and whether that account allows SSH login. |
| No tasks found | Connect with the account that runs Codex / Claude Code. Start a session on the computer, then tap **Find tasks**. |
| Output has not changed | Tap **Refresh Output**. Offline computers show saved records. |
| The butler does not answer | Use **Verify Connection** in model settings and note the error. SSH does not configure the model for you. |
| Calls have no sound or recognition | Test speech playback and the microphone separately. Check voice settings and microphone permission. Working text chat does not verify speech setup. |

Still stuck? [Report the problem](https://github.com/otterview-labs/agentBridge/issues/new?template=bug_report.yml) with your Android version, computer OS, app version, and the step that failed. Include an error with private information removed. Keep passwords, private keys, and API keys out of the issue.

Away from your local network, you need a reachable SSH connection. See the [full guide](android-app.md#optional-public-access) for FRP setup.
