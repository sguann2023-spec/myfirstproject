#!/usr/bin/env python3
"""Offline planning/checking only. All media edits use runtime MCP tools.
plan: input contains cuts=[0,...,actual_speech_end] in source seconds.
check: input is queried Jianying draft JSON (microsecond timeranges).
"""
import argparse,json,math,sys
from pathlib import Path

def plan(d):
    cuts=d['cuts']
    if len(cuts)<2 or abs(cuts[0])>1e-6 or any(not math.isfinite(x) for x in cuts) or any(b<=a for a,b in zip(cuts,cuts[1:])):
        raise ValueError('cuts must increase strictly from 0 to actual speech end')
    intro=float(d.get('intro',5.4)); product=float(d.get('product',0.5)); tail=float(d.get('tail',2.8))
    limit=min(float(d.get('target_seconds',59.5)),59.5)
    if min(intro,product,tail)<0: raise ValueError('negative duration')
    budget=limit-intro-product-tail
    if budget<=0: raise ValueError('no time for speech')
    speed=max(1.0,cuts[-1]/budget)
    if speed>1.12+1e-8:
        return {'ok':False,'reason':'speech exceeds budget; trim silence or request permission to shorten; do not cut speech automatically','required_speed':speed}
    t=intro+product; segments=[]
    scales=[1,1.1,1,1.1,1,1.12]
    for i,(a,b) in enumerate(zip(cuts,cuts[1:])):
        dur=(b-a)/speed
        segments.append({'source_start':a,'source_duration':b-a,'target_start':t,'target_duration':dur,'speed':speed,'scale':scales[i%len(scales)]})
        t+=dur
    return {'ok':True,'intro':intro,'product':product,'speech_offset':intro+product,'speed':speed,'speech':segments,'tail_start':t,'tail':tail,'duration':t+tail,'subtitle_mapping':'target = speech_offset + source / speed'}

def check(d):
    errors=[]; duration=d.get('duration',0)/1e6
    if not 0<duration<=60: errors.append('draft duration outside (0,60] seconds')
    tracks=[t for t in d.get('tracks',[]) if t.get('name')=='video_main']
    if len(tracks)!=1: errors.append('expected one video_main track')
    else:
        end=0
        for s in sorted(tracks[0].get('segments',[]),key=lambda s:s['target_timerange']['start']):
            r=s['target_timerange']; start=r['start']/1e6; dur=r['duration']/1e6
            if dur<=0: errors.append('zero/negative main segment')
            if abs(start-end)>0.035: errors.append(f'main gap/overlap at {start:.3f}, expected {end:.3f}')
            end=start+dur
        if abs(end-duration)>0.035: errors.append('main end differs from draft duration')
    for t in d.get('tracks',[]):
        if t.get('type')!='audio': continue
        end=-1
        for s in sorted(t.get('segments',[]),key=lambda s:s['target_timerange']['start']):
            r=s['target_timerange']
            if r['start']<end: errors.append('overlapping audio track '+t.get('name',''))
            end=r['start']+r['duration']
    return {'ok':not errors,'duration':duration,'errors':errors,'scope':'structural only; visual/audio QA still required'}

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('action',choices=['plan','check']); ap.add_argument('input'); ap.add_argument('--output'); args=ap.parse_args()
    try: result=(plan if args.action=='plan' else check)(json.loads(Path(args.input).read_text()))
    except (ValueError,KeyError,TypeError) as e: result={'ok':False,'reason':str(e)}
    out=json.dumps(result,ensure_ascii=False,indent=2)
    if args.output: Path(args.output).write_text(out)
    print(out)
    sys.exit(0 if result['ok'] else 2)
if __name__=='__main__': main()
