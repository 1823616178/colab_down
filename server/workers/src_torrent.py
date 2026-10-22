# 🔒 违反 Colab ToS（C18：明确禁止 torrent / P2P）—— 默认禁用，
# 仅在 job.enable_torrent 为真（设置页手动开启并确认风险）时运行。
"""src_torrent：aria2c BT 下载 magnet / .torrent。"""
import os

from worker_base import WorkerError
from src_http import aria2_available, run_aria2


def run(ctx):
    job = ctx["job"]
    reporter = ctx["reporter"]
    if not job.get("enable_torrent"):
        raise WorkerError("TORRENT_DISABLED", "torrent 源违反 Colab ToS，默认禁用（setting.enable_torrent）")
    if not aria2_available():
        raise WorkerError("TORRENT_FAILED", "aria2c 不可用")

    reporter.hello("torrent", 0)
    reporter.log("⚠ torrent 下载已启用（用户已确认合规风险）")
    args = [
        "--seed-time=0",  # 下完即停，不做种（降低 P2P 暴露面）
        "--bt-stop-timeout=300",
        "--file-allocation=none",
        "--summary-interval=1",
        "--console-log-level=warn",
        "--follow-torrent=mem",
        "-d", ctx["dest"],
        job["source_url"],
    ]
    run_aria2(args, reporter)
    total = 0
    for base, _dirs, files in os.walk(ctx["dest"]):
        for f in files:
            if f.endswith(".aria2"):
                continue
            try:
                total += os.path.getsize(os.path.join(base, f))
            except OSError:
                pass
    reporter.progress(total, total, speed_bps=0, eta_sec=0, force=True)
