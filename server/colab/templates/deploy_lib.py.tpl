# deploy_lib：base64 tar.gz 解包 worker 包到 /content/cdm/lib（spike-report §4 方案 B）
# C2b: kernel 的 path_importer_cache 可能被毒化，固定头部先失效缓存
import importlib
importlib.invalidate_caches()
import base64, io, tarfile, os

D = "/content/cdm/lib"
os.makedirs(D, exist_ok=True)
tarfile.open(fileobj=io.BytesIO(base64.b64decode(__BLOB__)), mode="r:gz").extractall(D)
importlib.invalidate_caches()
print("@@DEPLOY_OK@@", ",".join(sorted(os.listdir(D))))
