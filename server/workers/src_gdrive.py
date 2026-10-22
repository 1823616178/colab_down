"""src_gdrive：gdown 下载 Google Drive 分享链接（单文件 / 文件夹）。

gdown 不支持可靠续传（§6.8）：失败整体重来，开始前先清掉半成品。
"""
import os
import shutil
import threading
import time

from worker_base import WorkerError


def _tree_bytes(root):
    total = 0
    if os.path.isfile(root):
        return os.path.getsize(root)
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
    url = job["source_url"]

    import gdown

    is_folder = "/folders/" in url or "drive.google.com/drive/folders/" in url
    reporter.hello("gdrive", 0)
    reporter.log("gdown %s（不支持续传，失败需整体重来）" % ("文件夹" if is_folder else "单文件"))

    # 清掉半成品（不支持续传）
    if os.path.isdir(dest):
        shutil.rmtree(dest, ignore_errors=True)
    elif os.path.exists(dest):
        os.remove(dest)
    os.makedirs(dest, exist_ok=True)
    target = dest if is_folder else os.path.join(dest, "gdrive_download")

    stop_flag = {"stop": False}

    def monitor():
        while not stop_flag["stop"]:
            try:
                done = _tree_bytes(target)
                reporter.progress(done, None, speed_bps=0, eta_sec=None, file=None, file_index=0, file_total=0)
                reporter.tick(done)
            except WorkerError as e:
                # 监控线程里的探针异常：写终态并结束进程
                reporter.finish("failed", error_code=e.code, error=str(e))
                os._exit(3)
            time.sleep(1.0)

    t = threading.Thread(target=monitor, daemon=True)
    t.start()
    try:
        if is_folder:
            out = gdown.download_folder(url=url, output=target, quiet=True, use_cookies=False)
        else:
            out = gdown.download(url=url, output=target, quiet=True, fuzzy=True)
    finally:
        stop_flag["stop"] = True
        t.join(timeout=5)
    if not out:
        raise WorkerError("GDRIVE_FAILED", "gdown 下载失败（可能需要登录或触发配额）")
    size = _tree_bytes(target)
    reporter.progress(size, None, speed_bps=0, eta_sec=0, force=True)
