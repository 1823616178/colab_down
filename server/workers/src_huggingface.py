"""src_huggingface：huggingface_hub.snapshot_download 下载到 Drive。

C27/C28：必须启用 hf_transfer（124.6 vs 93.4 MB/s，Drive FUSE 损耗 18%→5%）。
snapshot_download 没有逐字节回调：起监控线程轮询 local_dir 已下载字节，
Reporter 自身 >=1s 节流（不能让 HF 内置进度条直接喷 stdout，会污染协议）。
"""
import fnmatch
import os
import threading
import time

os.environ["HF_HUB_ENABLE_HF_TRANSFER"] = "1"  # 需在 import huggingface_hub 前设置

from worker_base import WorkerError


def _match(name, allow, ignore):
    if allow and not any(fnmatch.fnmatch(name, p) for p in allow):
        return False
    if ignore and any(fnmatch.fnmatch(name, p) for p in ignore):
        return False
    return True


def _tree_bytes(root):
    total = 0
    for base, _dirs, files in os.walk(root):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    return total


def run(ctx):
    job = ctx["job"]
    reporter = ctx["reporter"]
    dest = ctx["dest"]
    token = ctx.get("token")

    from huggingface_hub import HfApi, snapshot_download
    from huggingface_hub.utils import GatedRepoError, RepositoryNotFoundError

    repo_id = job["source_url"]
    revision = job.get("revision") or "main"
    allow = job.get("allow_patterns") or None
    ignore = job.get("ignore_patterns") or None

    # 预列文件：算出 total 与文件清单（大仓配 allow_patterns 是刚需）
    try:
        info = HfApi().repo_info(repo_id, revision=revision, files_metadata=True, token=token)
    except GatedRepoError:
        raise WorkerError("AUTH_REQUIRED", "gated repo 需要 HF token")
    except RepositoryNotFoundError:
        raise WorkerError("SOURCE_NOT_FOUND", "HF 仓库不存在: %s" % repo_id)
    files = [s for s in (info.siblings or []) if _match(s.rfilename, allow, ignore)]
    total = sum(s.size or 0 for s in files) or None
    file_total = len(files)

    reporter.hello("huggingface", file_total)
    reporter.log("开始下载 %s@%s（%d 个文件）" % (repo_id, revision, file_total))

    stop_flag = {"stop": False, "done": 0}

    def monitor():
        # 轮询 local_dir（含 .cache/huggingface 的未完成分片）得已下载字节
        while not stop_flag["stop"]:
            try:
                done = _tree_bytes(dest)
                stop_flag["done"] = done
                speed = 0
                prev = getattr(monitor, "_prev", (time.time(), 0))
                dt = time.time() - prev[0]
                if dt > 0:
                    speed = int((done - prev[1]) / dt)
                monitor._prev = (time.time(), done)
                eta = int((total - done) / speed) if (total and speed > 0) else None
                reporter.progress(done, total, speed_bps=speed, eta_sec=eta, file=None, file_index=0, file_total=file_total)
                reporter.tick(done)
            except WorkerError as e:
                # 监控线程里的探针异常（如 DRIVE_MOUNT_LOST）：直接写终态并结束进程
                reporter.finish("failed", error_code=e.code, error=str(e))
                os._exit(3)
            time.sleep(1.0)

    t = threading.Thread(target=monitor, daemon=True)
    t.start()
    try:
        snapshot_download(
            repo_id,
            revision=revision,
            allow_patterns=allow,
            ignore_patterns=ignore,
            local_dir=dest,
            token=token,
        )
    except GatedRepoError:
        raise WorkerError("AUTH_REQUIRED", "gated repo 需要 HF token")
    except RepositoryNotFoundError:
        raise WorkerError("SOURCE_NOT_FOUND", "HF 仓库不存在: %s" % repo_id)
    finally:
        stop_flag["stop"] = True
        t.join(timeout=5)

    # 文件级完成事件（跳过 .cache 元数据目录）
    done_idx = 0
    for base, _dirs, names in os.walk(dest):
        if os.sep + ".cache" in base or base.endswith(".cache"):
            continue
        for name in sorted(names):
            path = os.path.join(base, name)
            rel = os.path.relpath(path, dest)
            done_idx += 1
            reporter.file_done(rel, os.path.getsize(path))
    reporter.progress(stop_flag["done"], total, speed_bps=0, eta_sec=0, file=None, file_index=file_total, file_total=file_total, force=True)
