import json, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from worker_base import Reporter          # 验证 0.3：跨文件 import

job = json.load(open(sys.argv[1]))
tid, workdir = job["tid"], job["workdir"]
r = Reporter(tid, workdir)
r.emit("hello", pid=os.getpid(), source_type=job.get("source_type", "test"))

total = job.get("total", 50)
for i in range(total + 1):
    # 故意混入脏输出，验证 0.11 解析器耐受
    if i % 7 == 0:
        sys.stdout.write("\r[tqdm-noise] %d%% |####      | %d/%d [00:0%d<00:00]" % (i * 2, i, total, i % 10))
        sys.stdout.flush()
    if i % 11 == 0:
        print("random library chatter: downloading shard", i)
    r.progress(i * 1024 * 1024, total * 1024 * 1024,
               speed_bps=268697600, eta_sec=total - i, file="model.safetensors",
               file_index=1, file_total=1)
    time.sleep(job.get("tick", 0.4))

r.finish("completed", bytes=total * 1024 * 1024, duration_sec=total)
