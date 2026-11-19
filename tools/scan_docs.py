"""Run unslop's three scanners over project Markdown docs and aggregate results."""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(r"D:\my projects\surepesa")
UNSlOP = ROOT / "tools" / "unslop" / "scripts"

FILES = [
    "README.md",
    "admin/README.md",
    "mobile/README.md",
    "payment-providers-teardown.md",
    "docs/governance/sop-gap-assessment.md",
    "docs/research/payment-patterns-teardown.md",
]

SCANNERS = [
    ("phrase", [sys.executable, str(UNSlOP / "banned_phrase_scan.py")]),
    ("structure", [sys.executable, str(UNSlOP / "structure_scan.py"), "--genre", "docs"]),
    ("silhouette", [sys.executable, str(UNSlOP / "silhouette_scan.py")]),
]

report = {}
for rel in FILES:
    text = (ROOT / rel).read_text(encoding="utf-8")
    file_result = {}
    for name, cmd in SCANNERS:
        proc = subprocess.run(cmd, input=text, capture_output=True, text=True, encoding="utf-8")
        try:
            file_result[name] = json.loads(proc.stdout)
        except json.JSONDecodeError:
            file_result[name] = {"error": proc.stderr.strip() or proc.stdout[:200], "exit": proc.returncode}
    report[rel] = file_result

out = ROOT / "tools" / "unslop_scan_results.json"
out.write_text(json.dumps(report, indent=2), encoding="utf-8")
print(f"wrote {out}")
