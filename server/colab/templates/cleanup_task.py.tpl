# cleanup_task：删除 TASK_DIR（含凭据的 job.json 与半成品状态文件，§12 任务结束即删）
import importlib
importlib.invalidate_caches()
import shutil

shutil.rmtree(__TASK_DIR__, ignore_errors=True)
print("@@CLEANED@@")
