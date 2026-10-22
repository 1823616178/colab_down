"""src_github：owner/repo@tag → GitHub API 列 release assets → 逐个走 src_http 逻辑。"""
import os
import re

from worker_base import WorkerError
from src_http import download_one

_REPO_RE = re.compile(r"^(?:https?://github\.com/)?([^/]+)/([^/@\s]+)(?:@(\S+))?$")


def run(ctx):
    job = ctx["job"]
    reporter = ctx["reporter"]
    token = ctx.get("token")

    m = _REPO_RE.match(job["source_url"].strip())
    if not m:
        raise WorkerError("INVALID_URL", "github 源格式应为 owner/repo@tag: %s" % job["source_url"])
    owner, repo, tag = m.group(1), m.group(2), m.group(3)

    import requests

    headers = {"Accept": "application/vnd.github+json"}
    if token:
        headers["Authorization"] = "Bearer %s" % token
    if tag:
        api = "https://api.github.com/repos/%s/%s/releases/tags/%s" % (owner, repo, tag)
    else:
        api = "https://api.github.com/repos/%s/%s/releases/latest" % (owner, repo)
    r = requests.get(api, headers=headers, timeout=30)
    if r.status_code in (401, 403):
        raise WorkerError("AUTH_REQUIRED", "GitHub API %d：需要 token 或触发限流" % r.status_code)
    if r.status_code == 404:
        raise WorkerError("SOURCE_NOT_FOUND", "release 不存在: %s" % api)
    if r.status_code != 200:
        raise WorkerError("HTTP_DOWNLOAD_FAILED", "GitHub API %d" % r.status_code)
    assets = r.json().get("assets") or []
    if not assets:
        raise WorkerError("SOURCE_NOT_FOUND", "该 release 没有 assets")

    total = sum(a.get("size") or 0 for a in assets) or None
    file_total = len(assets)
    reporter.hello("github", file_total)
    reporter.log("release %s/%s@%s：%d 个资产" % (owner, repo, tag or "latest", file_total))

    done_base = 0
    for i, a in enumerate(assets, start=1):
        name = a.get("name") or ("asset-%d" % i)
        url = a.get("browser_download_url")
        if not url:
            continue
        _name, size = download_one(ctx, url, ctx["dest"], file_name=name, file_index=i, file_total=file_total, base_downloaded=done_base)
        reporter.file_done(name, size)
        done_base += size
    reporter.progress(done_base, total, speed_bps=0, eta_sec=0, file=None, file_index=file_total, file_total=file_total, force=True)
