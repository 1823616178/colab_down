import os, sys, time, json
WD     = __WD__
OFFSET = __OFFSET__
IDLE_TIMEOUT = __IDLE__

log = os.path.join(WD, "out.log")
status_file = os.path.join(WD, "status.json")
pid_file = os.path.join(WD, "worker.pid")

def alive():
    try:
        os.kill(int(open(pid_file).read().strip()), 0); return True
    except Exception:
        return False

f = open(log, "rb"); f.seek(OFFSET)
buf = b""; last_data = time.time()
while True:
    chunk = f.read(65536)
    if chunk:
        last_data = time.time()
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            off = f.tell() - len(buf)
            sys.stdout.write("@@OFF@@%d\t%s\n" % (off, line.decode("utf-8", "replace")))
        sys.stdout.flush()
    else:
        if os.path.exists(status_file):
            sys.stdout.write("@@OFF@@%d\t@@TAILDONE@@ %s\n" % (f.tell(), open(status_file).read()))
            sys.stdout.flush(); break
        if not alive():
            sys.stdout.write("@@OFF@@%d\t@@TAILDEAD@@ worker process vanished\n" % f.tell())
            sys.stdout.flush(); break
        if time.time() - last_data > IDLE_TIMEOUT:
            sys.stdout.write("@@OFF@@%d\t@@TAILIDLE@@\n" % f.tell()); sys.stdout.flush(); break
        time.sleep(0.25)
