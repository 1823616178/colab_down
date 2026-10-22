#!/usr/bin/env python3
"""模拟 colab drivemount 的交互行为，用于零成本验证 PTY 链路。

严格复刻 colab_cli/commands/automation.py:97-118 的输出与阻塞方式：
  - 打印 REQUIRED 提示 + 授权 URI
  - sys.stdout.write 一个不带换行的 prompt
  - open("/dev/tty").readline() 阻塞（注意：不是读 stdin）
"""
import sys
import time

URI = (
    "https://accounts.google.com/o/oauth2/v2/auth?access_type=offline"
    "&client_id=FAKE.apps.googleusercontent.com&enable_granular_consent=true"
    "&login_hint=test%40example.com&prompt=consent"
    "&redirect_uri=https%3A%2F%2Fcolab.research.google.com%2Ftun%2Fm%2F"
    "authorize-for-drive-credentials-ephem"
    "&response_type=none+gsession&scope=email+https%3A%2F%2Fwww.googleapis.com"
    "%2Fauth%2Fdrive&state=FAKESTATE"
)

print("[colab] Mounting Google Drive to '/content/drive' on fake-vm...")
sys.stdout.flush()
time.sleep(0.4)

print(f"\n[colab] Intercepted Drive Auth Request. Connecting to colab.research.google.com...")
sys.stdout.flush()
time.sleep(0.4)

print(f"\n[colab] REQUIRED: Google Drive Authorization needed.\nPlease visit:\n\n{URI}\n")
sys.stdout.write("Press Enter after you have granted access... ")
sys.stdout.flush()

# 关键：直接打开 tty 设备，不是读 stdin。管道喂不进去。
with open("/dev/tty") as tty:
    tty.readline()

print("\n[colab] Authorizing VM...")
sys.stdout.flush()
time.sleep(0.3)
print("[colab] Credentials propagated. Resuming mount...")
sys.stdout.flush()
time.sleep(0.3)
print("Mounted at /content/drive")
sys.stdout.flush()
