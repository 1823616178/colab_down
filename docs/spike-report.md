# Phase 0 技术验证报告

> 执行日期：2026-08-09
> 环境：`google-colab-cli 0.6.0`，`--auth oauth2`，CPU 会话 `cdm-spike-1`（独立 `--config /tmp/cdm-spike.json`）
> 验证脚本：`spike/pty-runner.mjs`、`spike/fake_drivemount.py`、`spike/tail_stream.py.tpl`

---

## 结论摘要

| # | 验证项 | 结果 | 是否推翻既有设计 |
|:--|:---|:---|:---|
| 0.1 | Colab 认证 | ✅ | 否 |
| 0.2 | drivemount 授权可持久化 | ❌ 已证伪（先前完成） | 已处理 |
| 0.2b | **PTY 捕获授权 URI + 写回车** | ✅ | 否，方案成立 |
| 0.2c | 授权超时行为 | ⚠️ 部分（见下） | 否 |
| 0.2d | ephemeral 凭据 TTL | 🕐 观测中 | 待定 |
| 0.3 | worker 包投递 + 跨文件 import | ✅ | **是，改为 base64 tar 单次送达（快 5.7 倍）** |
| 0.4 | 参数化下发（管道喂代码） | ✅ | 否 |
| 0.5 | 两段式执行 | ✅ | 否 |
| 0.6 | 断连恢复（offset 续读） | ✅ | 否 |
| 0.7 | 真实下载到 Drive | ✅ | **是，吞吐远低于宣称值** |
| 0.8 | 依赖安装耗时 | ✅ | 否 |
| 0.9 | `--config` 并发隔离 | ✅ | 否 |
| 0.10 | 取消链路 | ✅ | 否 |
| 0.11 | 脏输出耐受 | ⚠️ | **是，解析规则错误** |
| — | **`--timeout 0` 语义** | ❌ | **是，C4 结论完全写反** |

---

## 1. 🔴 最严重：`--timeout 0` 不是「永不超时」

### 现象

`colab exec --timeout 0` 执行一个 75 秒、每秒输出一行的脚本，**在 ~30 秒抛 `TimeoutError: Timeout waiting for output`**。

### 根因（三层）

```python
# ① colab_cli/commands/execution.py:214
timeout_val = None if (timeout is not None and timeout <= 0) else timeout
#    --timeout 0  →  timeout_val = None

# ② colab_cli/runtime.py:184-185
if timeout is not None:                    # ← None 时为 False，整段跳过
    kwargs["timeout"] = None if timeout <= 0 else timeout
#    kwargs 里根本没有 "timeout" 键

# ③ jupyter_kernel_client/client.py  execute_interactive 签名
timeout: float | None = REQUEST_TIMEOUT    # = int(os.getenv("REQUEST_TIMEOUT", 30))
#    回落到默认 30 秒
```

**`--timeout 0` 实际给你 30 秒。** 这是 CLI 的一个 bug（`0` 的语义在第 ① 层被翻译成 `None`，却在第 ② 层被当作"未指定"）。

### 死线是「总时长预算」，不是「空闲超时」

`jupyter_kernel_client/wsclient.py:1067-1096`：

```python
if timeout is not None:
    deadline = time.monotonic() + timeout      # ← 循环外只设一次
while True:
    if timeout is not None:
        timeout = max(0, deadline - time.monotonic())
    if not self._message_received.wait(timeout=timeout) and not (...msg_ready()):
        raise TimeoutError("Timeout waiting for output")
```

CLI 源码注释声称「只要 iopub 事件连续到达就能存活」，**实测为假**：持续每秒输出仍在 30s 死线处抛错。

### 实测对照

| 命令 | 脚本行为 | 结果 |
|:---|:---|:---|
| `--timeout 0` | 持续输出 75s | ❌ 35.7s 超时 |
| `--timeout 0` | pip + 静默下载 | ❌ 34.2s 超时 |
| `--timeout 600` | 持续输出 75s | ✅ 完成 |
| `--timeout 600` | **静默 70s** 后输出 | ✅ 完成（证明不是空闲超时） |

### 设计修正

> **ColabBridge 一律传显式大正数，绝不传 0。**
> 长流式 tail 用 `--timeout 86400`（与 VM 的 24h 上限对齐）。
> 短命令用 `--timeout 120`。

### 附带发现：客户端超时不停止 kernel 执行

第一次下载测试在 34s 客户端超时后，**kernel 上的下载继续跑完了**（后续测试发现文件已存在）。

- 好的一面：进一步佐证两段式设计的正确性。
- 危险的一面：超时的 exec 会留下**仍在运行的工作**，服务端必须假定"超时 ≠ 已停止"，不能直接重试同一操作，否则会重复执行。

---

## 2. 🔴 协议解析规则错误（§7.2）

### 现象

真实抓到的一行：

```
[tqdm-noise] 70% |####      | 35/60 [00:05<00:00]@@CDM@@{"v":1,"tid":42,"seq":37,...}
```

`\r` 风格的进度输出不带换行，把 `@@CDM@@` 挤到了行中间。

### 影响

DESIGN.md §7.2 原文写的 `line.startsWith('@@CDM@@')` **会直接漏掉这一行**。

### 修正

```ts
// ❌ 错误
if (line.startsWith(MAGIC)) parse(line.slice(MAGIC.length))

// ✅ 正确：扫描行内所有出现位置
for (const m of line.matchAll(/@@CDM@@(\{.*?\})(?=\s*$|@@CDM@@)/g)) {
  tryParse(m[1])
}
```

实测用 `re.finditer` 版本对全量 63 条消息校验，**零缺失**。

---

## 3. 🔴 核心价值主张的吞吐数据严重偏乐观

### 实测（2.88GB 单文件，`openai/whisper-large-v3/model.safetensors`）

| 方式 | → 本地磁盘 | → Drive 直写 |
|:---|:---|:---|
| `hf_hub_download`（默认） | 113.4 MB/s | **93.4 MB/s** |
| `hf_hub_download` + `hf_transfer` | 131.1 MB/s | **124.6 MB/s** |
| `aria2c -x1` | 30.1 MB/s | — |
| **`aria2c -x8`** | **174.1 MB/s** ⭐ | — |
| `aria2c -x16` | 130.2 MB/s（反降） | — |

### 结论

- **单连接是瓶颈**（30 MB/s）。多连接提升近 6 倍，`-x8` 是甜点，`-x16` 反而下降。
- `hf_transfer` 把 Drive FUSE 写入损耗从 **18% 降到 5%**（93.4/113.4 → 124.6/131.1），值得默认启用。
- TASK.md 原文「39GB 模型 ~2 分钟」需要 333 MB/s。按实测最优 174 MB/s 计算约 **3.8 分钟**；按 HF 路径 124.6 MB/s 约 **5.3 分钟**。

> **文案修正**：把「~2 分钟」改为「**实测 90-175 MB/s，39GB 约 4-6 分钟**」。
> 项目价值依然成立（比家用宽带快 10-50 倍），但不应给出做不到的数字。

### 设计输出

- `src_http.py` 用 **`aria2c -x8 -s8 -k10M`**，不要单连接 `requests`。
- `src_huggingface.py` 默认设 `HF_HUB_ENABLE_HF_TRANSFER=1`（需 `pip install hf_transfer`）。
- 可选优化：HF 仓库先用 API 列文件，再用 aria2c 拉 `resolve/<rev>/<file>` URL，兼得列表能力与 174 MB/s 吞吐。

---

## 4. 🟠 `colab upload` 不会创建父目录 —— 及解法

### 现象与根因

目标目录不存在时返回 **`500 Internal Server Error`**，错误信息完全不提是目录问题（只给一个带 token 的 URL），极难定位：

```
[colab] Upload failed: 500 Server Error: Internal Server Error for url:
https://8080-....colab.dev/api/contents/content/cdm/lib/worker_base.py?...
```

根因：Jupyter contents API 的 PUT 不递归创建父目录，CLI 未做处理，直接把 500 透传出来。

### ✅ 解法：不用 `colab upload` 投递 worker 包，改用「单次 piped exec + base64 tar.gz」

```bash
# 本地
B64=$(tar czf - -C server/workers . | base64 -w0)
```
```python
# 渲染进模板，一次 exec 送达
import base64, io, tarfile, os
D = "/content/cdm/lib"
os.makedirs(D, exist_ok=True)
tarfile.open(fileobj=io.BytesIO(base64.b64decode(BLOB)), mode="r:gz").extractall(D)
```

### 实测对比（6 个文件）

| 方案 | 往返次数 | 耗时 |
|:---|:---|:---|
| A：`mkdir` exec + 6 × `colab upload` | 7 | **31.5s** |
| **B：单次 piped exec + base64 tar.gz** | **1** | **5.5s** ⭐ |

**快 5.7 倍**，且有三个额外好处：

1. **原子性** —— 要么整包落地要么都不落地，不会出现"半个包"的中间状态（而 N 次 upload 中途失败就是半个包）。
2. **自带 mkdir** —— 父目录问题从根上消失。
3. **保留目录结构** —— tar 天然支持子目录，`upload` 只能一个个文件传。

### 适用边界（实测代码通道约 30KB/s）

| 源大小 | base64 | 耗时 |
|:---|:---|:---|
| 64KB | 63.9KB | 6.4s |
| 256KB | 254.7KB | 13.6s |
| 1MB | 1017.9KB | 37.4s |

> Python 源码 gzip 压缩率很高，几十 KB 的 worker 包压完通常 < 20KB base64，约 5s 送达。
> **大二进制（rclone、模型文件等）绝不要走这条路** —— 在 VM 上直接 `wget`/`apt` 更快。
> 若确实要用 `colab upload` 传大文件，**必须先 exec 一次 `os.makedirs(exist_ok=True)`**。

---

## 5. 🟠 kernel 持久化毒化 import 缓存 —— 及解法

### 精确根因（已在 VM 上复现证实）

```python
# ① importlib/_bootstrap_external.py  FileFinder.path_hook
def path_hook_for_FileFinder(path):
    if not _path_isdir(path):
        raise ImportError('only directories are supported', path=path)

# ② PathFinder._path_hooks —— 所有 hook 都抛 ImportError
    else:
        return None

# ③ PathFinder._path_importer_cache —— None 被写进缓存，且永不重算
    except KeyError:
        finder = cls._path_hooks(path)
        sys.path_importer_cache[path] = finder      # ← finder is None
```

之后每次 import 从缓存拿到 `None` → **直接跳过该路径**，哪怕目录后来建好了也没用。

VM 上的复现输出：

```
① 目录不存在时触发 import
    sys.path_importer_cache[/content/cdm/repro] = None   ← 毒化点
② 建目录并写入模块
    os.listdir: ['mymod.py']
    cache 仍是: None      ← 建目录不会刷新它
    ❌ import 仍失败 —— 根因证实
```

`importlib.invalidate_caches()` 之所以能救，是因为它**显式删除 None 条目**：

```python
if finder is None or not _path_isabs(name):
    del sys.path_importer_cache[name]
```

### ✅ 解法：三道防线，生产上其实碰不到

**防线 1（根本解）：顺序正确。** 先建目录写文件，再 import。采用上面的「base64 tar 一次送达」后，投递本身就是原子的，不存在"目录不存在时先 import 了一次"的窗口。

**防线 2（生产实际路径）：worker 在子进程里跑，天然免疫。** 实测：

```
③  子进程 import 成功: loaded            ← 新解释器，全新 path_importer_cache
③b 脚本方式 import 成功: loaded          ← python3 /path/worker_main.py
```

> **重要澄清**：这个坑只在 **kernel 内** import 时发作。生产上 worker 是
> `python3 /content/cdm/lib/worker_main.py` 的 detached 子进程，是全新解释器。
> 而且 `python3 script.py` 会自动把脚本所在目录放进 `sys.path[0]`，
> **连 `sys.path.insert` 都不需要写**。

**防线 3（kernel 侧防御）：** 任何在 kernel 内 import worker 包的地方（如 preflight 脚本），开头统一：

```python
import importlib
importlib.invalidate_caches()
```

成本几乎为零，作为 `ColabBridge` 模板的固定头部注入。

---

## 6. ✅ PTY 授权链路（0.2b）—— 方案成立

### 对照实验

| 模式 | 结果 |
|:---|:---|
| 纯管道（无 PTY） | ❌ `OSError: [Errno 6] No such device or address: '/dev/tty'` |
| `script -qec` 分配 PTY | ✅ 捕获 URI → 写回车 → `Credentials propagated` → `Mounted at` |

**不需要 `node-pty` 原生编译**，`script -qec "<cmd>" /dev/null` 就够，零依赖。

### 真实链路时间线

```
  5.8s   捕获授权 URI（1415 字符）
101.9s   写入换行（人工授权耗时 ~96s）
102.4s   [colab] Credentials propagated. Resuming mount...
113.6s   Mounted at /content/drive          ← 确认后仍需 11 秒
114.3s   进程退出 code=0
```

### 关键细节

- **授权 URI 实测 1415 字符**（比预想长得多）。UI 不能平铺显示，必须折叠 + 复制按钮；二维码会很密，需较大尺寸与高容错级别。
- URI 的 `state` 参数内含 `"endpoint":"m-s-kkb-usw1b0-1f27atte8u4kw"` —— **授权绑定到具体 VM endpoint 的铁证**，解释了为何每台新 VM 必须重新授权。
- 「确认后 11 秒才挂载完成」要体现在 UI 上（`propagating` 状态不能瞬间跳过，否则用户以为卡住）。

---

## 7. ✅ 两段式执行与断连恢复（0.5 / 0.6）

```
① 短 exec 写 job.json            ~4s（含 ~3s CLI 认证开销）
② 短 exec setsid nohup 启动      4.8s 返回，kernel 立即释放
③ 长 exec tail out.log           流式，每秒一条
```

**断连测试**：③ 段运行 12 秒后 `kill -KILL` 本地 `colab` 进程 → VM 上 worker 继续跑 → 带 `offset=9109` 重新 tail → **seq 1→63 全部收到，零缺失**，`@@TAILDONE@@` 正确检测终态并自行退出。

> 注意：本次 ③ 段每次都在 30s 内完成，**未触发上述 timeout bug**。生产必须用 `--timeout 86400`。

---

## 8. ✅ 取消链路（0.10）

| 步骤 | 结果 |
|:---|:---|
| `colab restart-kernel` | ✅ **不会**杀死 detached worker（`start_new_session=True` 保护） |
| 重启后查进程 | ✅ `alive=True`，`out.log` 仍在增长 |
| `os.kill(pid, SIGTERM)` | ✅ 2 秒内进程消失 |
| 写 `status.json` | ✅ |

§6.5 设计的取消流程完全成立。

---

## 9. ✅ 其他实测数据

| 项 | 实测值 | 备注 |
|:---|:---|:---|
| `colab new`（CPU） | **15.9s** | 优于预估的 20-40s |
| `colab upload` 单文件 | ~2s | |
| `pip install huggingface_hub` | **4.6s** | |
| `apt-get install aria2` | ~15s | |
| Drive 配额读取 | `shutil.disk_usage("/content/drive/MyDrive")` | ✅ 返回真实配额，预检方案可行 |
| 当前账号 Drive | 225.83GB 总 / 195.58GB 可用 | 用户有 Google One |
| Drive 小文件写删 | 0.02s | |
| 并发 session 数 | **≥ 2** | 与用户已有的 L4 会话并存无冲突 |
| `--config` 隔离 | ✅ | 全程未影响默认 `sessions.json` |

### `HF_TOKEN` 噪声

`huggingface_hub` 在 Colab 上会尝试从 Colab UI vault 读取 `HF_TOKEN`，CLI 环境下必然超时并打印警告到 stderr：

```
Error while fetching `HF_TOKEN` secret value from your vault:
'Requesting secret HF_TOKEN timed out. Secrets can only be fetched when running from the Colab UI.'
```

> Worker 应设 `HF_HUB_DISABLE_IMPLICIT_TOKEN=1`，或显式提供 token，避免这条噪声进日志。

---

## 10. 🕐 未完成：0.2d ephemeral 凭据 TTL

VM 上已启动常驻探针（`/content/cdm/ttl/ttl_probe.py`），每 60 秒往 `/content/drive/MyDrive` 写删一个探针文件，失败即记录并停止。

**当前状态：已连续 ~15 分钟正常。**

查看方式：

```bash
CFG=/tmp/cdm-spike.json
printf 'print(open("/content/cdm/ttl/ttl.jsonl").read().strip().split("\\n")[-1])\n' \
  | colab --config $CFG exec -s cdm-spike-1 --timeout 120
```

**判定标准：**
- TTL > 2h → 长下载基本安全，§6.0.6 的挂载失效恢复作为保险即可。
- TTL < 1h → 挂载失效恢复**必须实现**，Phase 4 +1 天。

---

## 11. 遗留清理

```bash
colab --config /tmp/cdm-spike.json stop -s cdm-spike-1     # TTL 观测结束后执行
```

VM 上的临时目录：`/content/cdm/`（lib、42、99、ttl）、`/content/partest`、`/content/hft`。
Drive 上测试目录已在脚本内清理完毕。
