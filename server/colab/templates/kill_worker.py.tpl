# kill_worker：SIGTERM → 等 5s → SIGKILL（§6.5），最后写终态 cancelled
import importlib
importlib.invalidate_caches()
import os, signal, time, json, tempfile

d = __TASK_DIR__
pid = None
try:
    with open(os.path.join(d, "worker.pid")) as f:
        pid = int(f.read().strip())
except Exception:
    pass

def gone(p):
    try:
        with open("/proc/%d/stat" % p) as f:
            return f.read().split()[2] == "Z"
    except Exception:
        return True

if pid:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        pass
    deadline = time.time() + 5
    while time.time() < deadline:
        if gone(pid):
            break
        time.sleep(0.2)
    if not gone(pid):
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

# 终态是幂等判定的唯一依据（§6.3），取消也要落 status.json
st = {"v": 1, "type": "status", "status": "cancelled", "ts": round(time.time(), 3)}
fd, tmp = tempfile.mkstemp(dir=d)
with os.fdopen(fd, "w") as f:
    json.dump(st, f)
os.replace(tmp, os.path.join(d, "status.json"))
print("@@KILLED@@")
