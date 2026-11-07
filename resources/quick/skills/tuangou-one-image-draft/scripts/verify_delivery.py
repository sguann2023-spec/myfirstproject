#!/usr/bin/env python3
"""Validate approved flattened-picture + separate dialogue/SFX delivery."""
import json, math, sys
from pathlib import Path
p=Path(sys.argv[1]).resolve(); f=p/'draft_content.json'
if not f.exists(): f=p/'draft_info.json'
d=json.loads(f.read_text()); errors=[]; voices=[]; effects=[]
for t in d.get('tracks',[]):
    name=t.get('name','')
    if t.get('type')=='audio':
        if '对白' in name or '人声' in name:
            voices.extend(t.get('segments',[]))
        elif '音效' in name: effects.extend(t.get('segments',[]))
if not voices: errors.append('missing dialogue track')
for s in voices:
    if not math.isclose(s.get('volume',0),10,rel_tol=1e-4): errors.append('dialogue not maximum +20dB / linear10')
if not effects: errors.append('missing separate SFX track')
for kind in ('videos','audios'):
    for m in d.get('materials',{}).get(kind,[]):
        raw=m.get('path','')
        if not raw: errors.append('missing media path'); continue
        q=p/raw.split('##/')[-1] if '##/' in raw else Path(raw)
        if not q.is_absolute(): q=p/q
        if not q.exists(): errors.append('media missing: '+str(q))
print(json.dumps({'pass':not errors,'errors':errors,'duration_us':d.get('duration'),'voice_segments':len(voices),'separate_sfx_segments':len(effects),'note':'Structure only; does not verify lip sync or guarantee audio has no clipping.'},ensure_ascii=False,indent=2))
sys.exit(bool(errors))
