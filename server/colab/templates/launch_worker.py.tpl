# launch_worker：setsid nohup 启动后台下载进程（§6.2 两段式 exec 第②段）
# start_new_session=True 等价 setsid：kernel 重启不会杀死 worker（C30）
import importlib
importlib.invalidate_caches()
import os, subprocess

d = __TASK_DIR__
log = os.path.join(d, "out.log")
lf = open(log, "ab")
try:
    p = subprocess.Popen(
        ["nohup", "python3", "/content/cdm/lib/worker_main.py", "--job", os.path.join(d, "job.json")],
        stdout=lf,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
        close_fds=True,
    )
finally:
    lf.close()
with open(os.path.join(d, "worker.pid"), "w") as f:
    f.write(str(p.pid))
print("@@PID@@%d" % p.pid)
