# preflight：下载前预检，任一失败快速失败（§13.1）
# 检查 drive_root 可写（探针写删）、Drive 配额、staged 模式的 VM 本地磁盘
import importlib
importlib.invalidate_caches()
import os, sys, json, shutil, tempfile

TASK_DIR = __TASK_DIR__
DRIVE_ROOT = __DRIVE_ROOT__
TOTAL_BYTES = __TOTAL_BYTES__ or 0
MODE = __MODE__

result = {"ok": True, "drive_free": None, "drive_total": None, "vm_free": None, "error_code": None, "error": None}

# ① 挂载点写探针（失败 = 挂载失效，走 DRIVE_MOUNT_LOST 特判）
try:
    fd, p = tempfile.mkstemp(dir=DRIVE_ROOT, prefix=".cdm_probe_")
    os.write(fd, b"ok")
    os.close(fd)
    os.remove(p)
except Exception as e:
    result.update(ok=False, error_code="DRIVE_MOUNT_LOST", error="drive_root 不可写: %s" % e)

# ② Drive 配额（C19：总量 * 1.05 > 可用 → 快速失败）
if result["ok"]:
    try:
        u = shutil.disk_usage(DRIVE_ROOT)
        result["drive_free"], result["drive_total"] = u.free, u.total
        if TOTAL_BYTES > 0 and TOTAL_BYTES * 1.05 > u.free:
            result.update(
                ok=False,
                error_code="DRIVE_QUOTA_EXCEEDED",
                error="Drive 剩余空间不足：需要 %.1fGB，可用 %.1fGB" % (TOTAL_BYTES * 1.05 / 2**30, u.free / 2**30),
            )
    except Exception as e:
        result.update(ok=False, error_code="DRIVE_MOUNT_LOST", error="disk_usage 失败: %s" % e)

# ③ staged 模式：VM 本地磁盘（先落 /content 再拷到 Drive）
if result["ok"] and MODE == "staged":
    u = shutil.disk_usage("/content")
    result["vm_free"] = u.free
    if TOTAL_BYTES > 0 and TOTAL_BYTES > u.free * 0.9:
        result.update(
            ok=False,
            error_code="VM_DISK_INSUFFICIENT",
            error="VM 本地磁盘不足：需要 %.1fGB，可用 %.1fGB" % (TOTAL_BYTES / 2**30, u.free / 2**30),
        )

sys.stdout.write("@@PREFLIGHT@@%s\n" % json.dumps(result))
sys.stdout.flush()
