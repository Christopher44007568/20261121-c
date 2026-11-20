#!/usr/bin/env python3
# Pure-stdlib summary of the SSR reference run. Reads the CSV artifacts and
# prints per-path hit/confidence statistics plus the tracked-pixel curves.
import csv, os, sys, statistics

ROOT=os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA=os.path.join(ROOT,"artifacts_data")

def load(name):
    with open(os.path.join(DATA,name),newline="") as f:
        return list(csv.DictReader(f))

def main():
    stats=load("hit_stats.csv")
    curves=load("transition_curves.csv")
    print("== SSR hit statistics ==")
    for path in sorted({r["path"] for r in stats}):
        rows=[r for r in stats if r["path"]==path]
        hit=sum(int(r["ssr_hit"]) for r in rows)
        geo=sum(int(r["geo_hit"]) for r in rows)
        vis=sum(int(r["geo_visible"]) for r in rows)
        agree=sum(int(r["agree_hit"]) for r in rows)
        conf=statistics.mean(float(r["mean_conf"]) for r in rows if float(r["mean_conf"])>0)
        stale=sum(int(r["stale_guard_triggers"]) for r in rows)
        print(f"\n[{path}] frames={len(rows)}")
        print(f"  geometric reflection hits : {geo} (screen-visible {vis})")
        print(f"  SSR screen hits           : {hit}")
        print(f"  SSR hits agreeing w/ geo  : {agree}")
        print(f"  mean confidence (hit px)  : {conf:.3f}")
        print(f"  history-invalidation events: {stale}")
    print("\n== Tracked-pixel transition curves ==")
    for key in sorted({r["path"]+"/"+r["pixel"] for r in curves}):
        path,pixel=key.split("/")
        seq=[r for r in curves if r["path"]==path and r["pixel"]==pixel]
        line=" ".join(f"{r['frame']}:{r['state']}({r['reason'].split('_',1)[-1]})" for r in seq)
        print(f"\n{path} {pixel}\n  {line}")

if __name__=="__main__":
    sys.exit(main())
