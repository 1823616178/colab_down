"""worker_base：行协议输出 + 节流 + 原子写 + Drive 探针 + SIGTERM 钩子（DESIGN §7）。

运行环境：Colab VM（python3.10+，无第三方包依赖）。
协议：一行一个 @@CDM@@{json}，必带 v/tid/seq/ts，seq 单调递增；
progress >=1s 一条（C6：客户端 outputs 无上限累积），heartbeat >=30s 一条。
"""
import json
import os
import signal
import sys
import tempfile
import time

MAGIC = "@@CDM@@"

# 终态错误码：与服务端 NON_RETRYABLE / 特判逻辑对齐
ERR_DRIVE_MOUNT_LOST = "DRIVE_MOUNT_LOST"


class WorkerStopped(Exception):
    """SIGTERM 触发的优雅退出（§6.5：服务端 restart-kernel 后会 SIGTERM worker）。"""


class WorkerError(Exception):
    """已知分类的失败，error_code 决定服务端是否重试（§6.6）。"""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def install_sigterm_handler():
    def _handler(signum, frame):
        raise WorkerStopped()

    signal.signal(signal.SIGTERM, _handler)


class Reporter:
    """@@CDM@@ 行协议输出（flush 及时）、progress.json / status.json 原子写、Drive 探针。"""

    def __init__(self, tid, workdir, drive_root=None, min_interval=1.0, heartbeat_interval=30.0, probe_interval=60.0):
        self.tid = tid
        self.workdir = workdir
        self.drive_root = drive_root
        self.min_interval = min_interval
        self.heartbeat_interval = heartbeat_interval
        self.probe_interval = probe_interval
        self.seq = 0
        self._last_progress = 0.0
        self._last_heartbeat = time.time()
        self._last_probe = time.time()
        self._finished = False
        os.makedirs(workdir, exist_ok=True)

    # ---- 基础输出 ----

    def emit(self, type_, **kw):
        self.seq += 1
        rec = {"v": 1, "tid": self.tid, "seq": self.seq, "ts": round(time.time(), 3), "type": type_}
        rec.update(kw)
        sys.stdout.write(MAGIC + json.dumps(rec, ensure_ascii=False) + "\n")
        sys.stdout.flush()
        return rec

    def atomic_write(self, name, obj):
        """tmp + os.replace 原子写（§7.4：断连恢复的真相来源）。"""
        path = os.path.join(self.workdir, name)
        fd, tmp = tempfile.mkstemp(dir=self.workdir)
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(obj, f, ensure_ascii=False)
            os.replace(tmp, path)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise

    # ---- 业务消息 ----

    def hello(self, source_type, files_planned):
        return self.emit("hello", pid=os.getpid(), source_type=source_type, files_planned=files_planned)

    def progress(self, downloaded, total, speed_bps=0, eta_sec=None, file=None, file_index=0, file_total=0, force=False):
        """>=1s 节流；每次发 progress 同时原子重写 progress.json。"""
        if self._finished:
            return None
        now = time.time()
        if not force and now - self._last_progress < self.min_interval:
            return None
        self._last_progress = now
        rec = self.emit(
            "progress",
            downloaded=int(downloaded),
            total=None if total is None else int(total),
            speed_bps=int(speed_bps),
            eta_sec=None if eta_sec is None else int(eta_sec),
            file=file,
            file_index=file_index,
            file_total=file_total,
        )
        self.atomic_write("progress.json", rec)
        return rec

    def file_done(self, file, bytes_, status="done"):
        return self.emit("file", file=file, bytes=int(bytes_), status=status)

    def log(self, message, level="info"):
        return self.emit("log", level=level, message=str(message))

    def heartbeat(self, downloaded):
        self._last_heartbeat = time.time()
        return self.emit("heartbeat", downloaded=int(downloaded))

    def tick(self, downloaded=0):
        """src 循环每次迭代调用：heartbeat >=30s 一条 + Drive 探针 >=60s 一次。"""
        now = time.time()
        if now - self._last_heartbeat >= self.heartbeat_interval:
            self.heartbeat(downloaded)
        if self.drive_root and now - self._last_probe >= self.probe_interval:
            self._last_probe = now
            self.drive_probe()

    def drive_probe(self):
        """§6.0.6：写删探针文件，失败以 DRIVE_MOUNT_LOST 终态退出（不消耗任务重试次数）。"""
        try:
            fd, p = tempfile.mkstemp(dir=self.drive_root, prefix=".cdm_probe_")
            os.write(fd, b"ok")
            os.close(fd)
            os.remove(p)
        except Exception as e:
            raise WorkerError(ERR_DRIVE_MOUNT_LOST, "Drive 挂载点不可写: %s" % e)

    def finish(self, status, **kw):
        """终态：status 消息 + status.json 原子写（幂等判定的唯一依据，§6.3）。"""
        if self._finished:
            return None
        self._finished = True
        rec = self.emit("status", status=status, **kw)
        self.atomic_write("status.json", rec)
        return rec
