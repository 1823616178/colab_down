# tail_stream：从 out.log 的 OFFSET 处续读，逐行转发（§6.2 第③段，断连恢复靠 OFFSET）
# 行格式：@@OFF@@<offset>\t<内容>；控制行：@@TAILDONE@@ / @@TAILDEAD@@ / @@TAILIDLE@@
import importlib
importlib.invalidate_caches()
import os, sys, time

WD = __WD__
OFFSET = __OFFSET__
IDLE_TIMEOUT = __IDLE__

log = os.path.join(WD, "out.log")
status_file = os.path.join(WD, "status.json")
pid_file = os.path.join(WD, "worker.pid")

def alive():
    try:
        with open(pid_file) as f:
            pid = int(f.read().strip())
        os.kill(pid, 0)
        # 僵尸进程 kill(pid,0) 仍返回成功，查 /proc 排除
        with open("/proc/%d/stat" % pid) as f:
            return f.read().split()[2] != "Z"
    except Exception:
        return False

# worker 可能还没开始写 out.log，等最多 10s
deadline = time.time() + 10
while not os.path.exists(log) and time.time() < deadline:
    if os.path.exists(status_file) or not alive():
        break
    time.sleep(0.25)

if not os.path.exists(log):
    # 日志从未产生 = 进程没跑起来
    sys.stdout.write("@@OFF@@0\t@@TAILDEAD@@ worker process vanished\n")
    sys.stdout.flush()
    sys.exit(0)

f = open(log, "rb")
f.seek(OFFSET)
buf = b""
last_data = time.time()
while True:
    chunk = f.read(65536)
    if chunk:
        last_data = time.time()
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            off = f.tell() - len(buf)
            sys.stdout.write("@@OFF@@%d\t%s\n" % (off, line.decode("utf-8", "replace")))
        sys.stdout.flush()
    else:
        if os.path.exists(status_file):
            sys.stdout.write("@@OFF@@%d\t@@TAILDONE@@ %s\n" % (f.tell(), open(status_file).read()))
            sys.stdout.flush()
            break
        if not alive():
            sys.stdout.write("@@OFF@@%d\t@@TAILDEAD@@ worker process vanished\n" % f.tell())
            sys.stdout.flush()
            break
        if time.time() - last_data > IDLE_TIMEOUT:
            sys.stdout.write("@@OFF@@%d\t@@TAILIDLE@@\n" % f.tell())
            sys.stdout.flush()
            break
        time.sleep(0.25)
