# probe_mount：往 DRIVE_ROOT 写删一个探针文件，验证挂载可写（§6.0.5 成功判定第二重）
import os, tempfile

d = __DRIVE_ROOT__
try:
    fd, p = tempfile.mkstemp(dir=d, prefix=".cdm_probe_")
    os.write(fd, b"ok")
    os.close(fd)
    os.remove(p)
    print("OK")
except Exception as e:
    print("FAIL %s" % e)
