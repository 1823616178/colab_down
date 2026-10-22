# write_job：写 <TASK_DIR>/job.json（含凭据，chmod 600，原子写）
import importlib
importlib.invalidate_caches()
import os, tempfile

d = __TASK_DIR__
os.makedirs(d, exist_ok=True)
fd, tmp = tempfile.mkstemp(dir=d)
with os.fdopen(fd, "w") as f:
    f.write(__JOB_JSON__)
os.chmod(tmp, 0o600)  # 凭据只落在 job.json，权限 600（DESIGN §12）
os.replace(tmp, os.path.join(d, "job.json"))
print("@@JOB_WRITTEN@@")
