#!/usr/bin/env python3
"""Cron Health Check — scans recent log files for errors and writes status."""
import json, os, glob, datetime

LOGDIR = "/root/.openclaw/workspace/logs"
OUTFILE = os.path.join(LOGDIR, "cron-health.json")

details = []
total_errors = 0

for logpath in glob.glob(os.path.join(LOGDIR, "*.log")):
    name = os.path.basename(logpath).replace(".log", "")
    try:
        with open(logpath, "r", errors="ignore") as f:
            lines = f.readlines()[-100:]  # last 100 lines
    except Exception:
        continue
    
    errs = [l.strip() for l in lines if any(k in l.lower() for k in ["error", "failed", "fatal"])]
    if errs:
        total_errors += len(errs)
        details.append({
            "name": name,
            "errors": len(errs),
            "last_error": errs[-1][:200] if errs else None
        })

status = "error" if total_errors > 10 else ("warning" if total_errors > 0 else "ok")

health = {
    "timestamp": datetime.datetime.now().isoformat(),
    "status": status,
    "total_errors": total_errors,
    "details": details[:10]  # cap at 10 entries
}

with open(OUTFILE, "w") as f:
    json.dump(health, f, indent=2)

print(f"Cron health: {status} ({total_errors} errors across {len(details)} logs)")
