"""src_http：HTTP(S) 直链下载，优先 aria2c -x8（C27 实测 174 MB/s，单连接仅 30）。

aria2c 不存在时退化 requests + Range 续传。无 Content-Length 时 total=null。
续传约定：半成品为 <name>.part（aria2 模式由 .aria2 控制文件管理），目标在 Drive 上即可跨 VM 续传。
"""
import os
import re
import select
import shutil
import subprocess
import time
import urllib.parse

from worker_base import WorkerError, WorkerStopped

_UNIT = {"": 1, "K": 1024, "M": 1024**2, "G": 1024**3, "T": 1024**4}

# [#2085b0 1.0GiB/2.5GiB(40%) CN:8 DL:100MiB ETA:20s]
_ARIA_RE = re.compile(
    r"\[#[0-9a-f]+\s+([\d.]+)([KMGT]?)iB/([\d.]+)([KMGT]?)iB\((\d+)%\)"
    r"(?:\s+CN:(\d+))?\s+DL:([\d.]+)([KMGT]?)iB(?:\s+ETA:(\d+)s)?\]"
)


def _to_bytes(v, unit):
    return int(float(v) * _UNIT.get(unit, 1))


def aria2_available():
    return shutil.which("aria2c") is not None


def run_aria2(args, reporter, file_name=None, file_index=1, file_total=1, base_downloaded=0):
    """跑 aria2c 并解析其输出行得进度（注意 \\r：按 \\r/\\n 双分隔切行）。返回前抛 WorkerError。"""
    proc = subprocess.Popen(
        ["aria2c"] + args,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        stdin=subprocess.DEVNULL,
        start_new_session=True,
    )
    buf = b""
    last = {"done": 0, "total": None}
    try:
        while True:
            if proc.poll() is not None:
                # 排空残余输出
                try:
                    chunk = os.read(proc.stdout.fileno(), 65536)
                    buf += chunk
                except OSError:
                    pass
                break
            r, _w, _x = select.select([proc.stdout], [], [], 1.0)
            if r:
                buf += os.read(proc.stdout.fileno(), 65536)
            for sep in (b"\r", b"\n"):
                while sep in buf:
                    line, buf = buf.split(sep, 1)
                    _parse_aria2_line(line.decode("utf-8", "replace"), reporter, file_name, file_index, file_total, base_downloaded, last)
            reporter.tick(base_downloaded + last["done"])
        code = proc.wait()
    except WorkerStopped:
        proc.terminate()
        try:
            proc.wait(timeout=5)
        except subprocess.TimeoutExpired:
            proc.kill()
        raise
    if code != 0:
        raise WorkerError("HTTP_DOWNLOAD_FAILED", "aria2c 退出码 %d" % code)
    return last


def _parse_aria2_line(line, reporter, file_name, file_index, file_total, base, last):
    m = _ARIA_RE.search(line)
    if not m:
        return
    done = _to_bytes(m.group(1), m.group(2))
    total = _to_bytes(m.group(3), m.group(4))
    speed = _to_bytes(m.group(7), m.group(8))
    eta = int(m.group(9)) if m.group(9) else (int((total - done) / speed) if speed > 0 else None)
    last["done"], last["total"] = done, total
    reporter.progress(base + done, (base + total) if total else None, speed_bps=speed, eta_sec=eta, file=file_name, file_index=file_index, file_total=file_total)


def _filename_from_url(url, fallback="download.bin"):
    path = urllib.parse.unquote(urllib.parse.urlparse(url).path)
    name = os.path.basename(path.rstrip("/"))
    return name or fallback


def download_one(ctx, url, dest_dir, file_name=None, file_index=1, file_total=1, base_downloaded=0, extra_headers=None):
    """下载单个 URL 到 dest_dir。返回 (文件名, 字节数)。供 src_github 复用。"""
    reporter = ctx["reporter"]
    token = ctx.get("token")
    name = file_name or _filename_from_url(url)
    os.makedirs(dest_dir, exist_ok=True)

    headers = list(extra_headers or [])
    if token and not any(h.lower().startswith("authorization:") for h in headers):
        headers.append("Authorization: Bearer %s" % token)

    if aria2_available():
        args = [
            "-x8", "-s8", "-k10M",
            "--continue=true",
            "--file-allocation=none",
            "--summary-interval=1",
            "--max-tries=5",
            "--retry-wait=3",
            "--console-log-level=warn",
            "-d", dest_dir,
            "-o", name,
        ]
        conf_path = None
        if headers:
            # §12：凭据绝不出现在命令行参数（ps 可见）—— header 写 conf 文件传递
            import tempfile

            fd, conf_path = tempfile.mkstemp(prefix=".cdm_aria2_", suffix=".conf")
            with os.fdopen(fd, "w") as f:
                for h in headers:
                    f.write("header=%s\n" % h)
            os.chmod(conf_path, 0o600)
            args.append("--conf-path=%s" % conf_path)
        args.append(url)
        try:
            last = run_aria2(args, reporter, name, file_index, file_total, base_downloaded)
        finally:
            if conf_path:
                try:
                    os.remove(conf_path)
                except OSError:
                    pass
        final = os.path.join(dest_dir, name)
        size = os.path.getsize(final) if os.path.exists(final) else (last["total"] or last["done"])
        return name, size

    return _requests_download(ctx, url, dest_dir, name, file_index, file_total, base_downloaded, headers)


def _requests_download(ctx, url, dest_dir, name, file_index, file_total, base, headers):
    """aria2c 兜底：requests + Range 续传（单连接 ~30 MB/s，仅保底用）。"""
    import requests

    reporter = ctx["reporter"]
    header_map = {}
    for h in headers:
        k, _sep, v = h.partition(":")
        header_map[k.strip()] = v.strip()

    final = os.path.join(dest_dir, name)
    part = final + ".part"
    offset = os.path.getsize(part) if os.path.exists(part) else 0
    if offset:
        header_map["Range"] = "bytes=%d-" % offset

    with requests.get(url, headers=header_map, stream=True, allow_redirects=True, timeout=(15, 60)) as r:
        if r.status_code in (401, 403):
            raise WorkerError("AUTH_REQUIRED", "HTTP %d：需要凭据" % r.status_code)
        if r.status_code == 404:
            raise WorkerError("SOURCE_NOT_FOUND", "HTTP 404: %s" % url)
        if r.status_code == 416 and offset:
            # Range 不可满足：文件可能已完整，从头校验重下
            offset = 0
            os.remove(part)
            return _requests_download(ctx, url, dest_dir, name, file_index, file_total, base, headers)
        if r.status_code not in (200, 206):
            raise WorkerError("HTTP_DOWNLOAD_FAILED", "HTTP %d: %s" % (r.status_code, url))
        if r.status_code == 200:
            offset = 0  # 服务端不支持 Range，重头来
        cl = r.headers.get("Content-Length")
        total = (offset + int(cl)) if cl is not None else None  # 无 Content-Length → total=null

        done = offset
        started = time.time()
        last_t, last_done = started, done
        mode = "ab" if offset else "wb"
        with open(part, mode) as f:
            for chunk in r.iter_content(chunk_size=1024 * 1024):
                if not chunk:
                    continue
                f.write(chunk)
                done += len(chunk)
                now = time.time()
                if now - last_t >= 1.0:
                    speed = int((done - last_done) / (now - last_t))
                    eta = int((total - done) / speed) if (total and speed > 0) else None
                    reporter.progress(base + done, (base + total) if total else None, speed_bps=speed, eta_sec=eta, file=name, file_index=file_index, file_total=file_total)
                    reporter.tick(base + done)
                    last_t, last_done = now, done
    os.replace(part, final)
    return name, done


def run(ctx):
    job = ctx["job"]
    reporter = ctx["reporter"]
    reporter.hello("http", 1)
    name, size = download_one(ctx, job["source_url"], ctx["dest"])
    reporter.file_done(name, size)
    reporter.progress(size, size, speed_bps=0, eta_sec=0, file=name, file_index=1, file_total=1, force=True)
