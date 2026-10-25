"""Writes the latest commits as JSON for the landing page's list of changes.

Run from the repository: python3 tools/changes.py [count] > changes.json
Each entry: {"hash", "date" (ISO 8601), "subject"}, newest first, merges left out.
"""
import json
import subprocess
import sys

count = int(sys.argv[1]) if len(sys.argv) > 1 else 15
# Unit and record separators keep subjects with any punctuation intact.
log = subprocess.run(['git', 'log', '--no-merges', f'-n{count}', '--format=%H%x1f%cI%x1f%s%x1e'],
                     check=True, capture_output=True, text=True).stdout
entries = []
for record in log.split('\x1e'):
    if record.strip():
        sha, date, subject = record.strip().split('\x1f')
        entries.append({'hash': sha, 'date': date, 'subject': subject})
json.dump(entries, sys.stdout, ensure_ascii=False, indent=1)
sys.stdout.write('\n')
