"""worker_main：VM 后台下载进程入口。

读 job.json → 校验 dest 必须落在 drive_root 下（拒绝路径穿越）→ 分发到 src_* 模块。
终态一律写 status.json：completed / failed(带 error_code) / cancelled；
未捕获异常兜底 failed(UNCAUGHT) + traceback 进 out.log。
"""
import argparse
import json
import os
import shutil
import sys
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# HF vault 噪声抑制（spike-report §9：CLI 环境读不到 Colab UI vault）
os.environ.setdefault("HF_HUB_DISABLE_IMPLICIT_TOKEN", "1")

from worker_base import Reporter, WorkerError, WorkerStopped, install_sigterm_handler


def resolve_dest(drive_root, dest_path):
    """dest_path 是相对路径；规范化后必须落在 drive_root 之下（§12 路径穿越校验）。"""
    root = os.path.normpath(drive_root)
    dest = os.path.normpath(os.path.join(root, dest_path))
    if dest != root and not dest.startswith(root + os.sep):
        raise WorkerError("INVALID_URL", "dest_path 越出 drive_root: %s" % dest_path)
    return dest


def tree_bytes(dest):
    total = 0
    for base, _dirs, files in os.walk(dest):
        if os.sep + ".cache" in base:
            continue
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


def run_job(job, reporter):
    drive_root = job["drive_root"]
    dest = resolve_dest(drive_root, job["dest_path"])
    os.makedirs(dest, exist_ok=True)

    # staged 模式：先落 VM 本地再拷贝（更快但不可跨 VM 续传，§6.8）
    staged = job.get("download_mode") == "staged"
    work_dest = dest
    if staged:
        work_dest = os.path.join("/content/cdm_stage", str(job["tid"]))
        os.makedirs(work_dest, exist_ok=True)

    ctx = {
        "job": job,
        "reporter": reporter,
        "dest": work_dest,
        "token": job.get("token"),
    }

    source_type = job["source_type"]
    if source_type == "huggingface":
        import src_huggingface as mod
    elif source_type == "http":
        import src_http as mod
    elif source_type == "github":
        import src_github as mod
    elif source_type == "gdrive":
        import src_gdrive as mod
    elif source_type == "torrent":
        import src_torrent as mod
    else:
        raise WorkerError("INVALID_URL", "未知 source_type: %s" % source_type)

    started = time.time()
    mod.run(ctx)

    if staged:
        reporter.log("staged：拷贝本地产物到 Drive")
        for name in os.listdir(work_dest):
            src = os.path.join(work_dest, name)
            if os.path.isfile(src):
                shutil.copy2(src, os.path.join(dest, name))
        shutil.rmtree(work_dest, ignore_errors=True)
        reporter.drive_probe()

    reporter.finish(
        "completed",
        bytes=tree_bytes(dest),
        duration_sec=round(time.time() - started, 1),
        dest=dest,
    )


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--job", required=True)
    args = ap.parse_args()
    with open(args.job) as f:
        job = json.load(f)
    workdir = os.path.dirname(os.path.abspath(args.job))
    reporter = Reporter(job["tid"], workdir, drive_root=job["drive_root"])
    install_sigterm_handler()
    try:
        run_job(job, reporter)
    except WorkerStopped:
        # §6.5 取消链路：SIGTERM 优雅退出；status.json 由服务端 kill_worker 模板补写
        sys.exit(143)
    except WorkerError as e:
        reporter.finish("failed", error_code=e.code, error=str(e))
        sys.exit(1)
    except Exception:
        traceback.print_exc()  # traceback 进 out.log（异常兜底）
        reporter.finish("failed", error_code="UNCAUGHT", error=traceback.format_exc(limit=3))
        sys.exit(1)


if __name__ == "__main__":
    main()
