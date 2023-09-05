#!/usr/bin/env python
import sys
import json
import os
args = [os.path.basename(a) for a in sys.argv[1:]]
print("hellow world")
with open("cwl.output.json", "w") as f:
    json.dump({"args": args}, f)
