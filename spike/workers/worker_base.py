import json, os, sys, time, tempfile

MAGIC = "@@CDM@@"

class Reporter:
    """行协议输出 + 节流 + progress.json 原子写"""
    def __init__(self, tid, workdir, min_interval=1.0):
        self.tid, self.workdir, self.min_interval = tid, workdir, min_interval
        self.seq, self._last = 0, 0.0
        os.makedirs(workdir, exist_ok=True)

    def emit(self, type_, **kw):
        self.seq += 1
        rec = {"v": 1, "tid": self.tid, "seq": self.seq, "ts": round(time.time(), 3), "type": type_}
        rec.update(kw)
        sys.stdout.write(MAGIC + json.dumps(rec) + "\n")
        sys.stdout.flush()
        return rec

    def progress(self, downloaded, total, **kw):
        now = time.time()
        if now - self._last < self.min_interval:
            return None
        self._last = now
        rec = self.emit("progress", downloaded=downloaded, total=total, **kw)
        self.atomic_write("progress.json", rec)
        return rec

    def atomic_write(self, name, obj):
        path = os.path.join(self.workdir, name)
        fd, tmp = tempfile.mkstemp(dir=self.workdir)
        with os.fdopen(fd, "w") as f:
            json.dump(obj, f)
        os.replace(tmp, path)

    def finish(self, status, **kw):
        rec = self.emit("status", status=status, **kw)
        self.atomic_write("status.json", rec)
        return rec
