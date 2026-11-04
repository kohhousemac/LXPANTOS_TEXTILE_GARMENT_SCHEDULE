#!/usr/bin/env python3
"""Copy freshly downloaded dashboard dataset files into build/data.

Usage: python3 build/sync.py <dataset_id>=<path/to/blob.json> [...]

Each file must be a JSON array of row objects (or an object holding one
under rows/data/results). A file that fails to parse is skipped and the
previous build/data/<id>.json is kept, so one bad download never blanks a lane.
"""
import json, sys
from pathlib import Path

DATA = Path(__file__).resolve().parent / 'data'

def main(pairs):
    ok, skipped = [], []
    for pair in pairs:
        ds, _, src = pair.partition('=')
        try:
            v = json.loads(Path(src).read_text(encoding='utf-8'))
            if isinstance(v, dict):
                for k in ('rows', 'data', 'results'):
                    if isinstance(v.get(k), list):
                        v = v[k]; break
            if not isinstance(v, list):
                raise ValueError('not a list')
            (DATA / f'{ds}.json').write_text(json.dumps(v, ensure_ascii=False, indent=1), encoding='utf-8')
            ok.append(ds)
        except Exception as e:  # keep the previous copy
            skipped.append(f'{ds} ({e})')
    print('updated:', ', '.join(ok) or '-')
    print('kept previous:', ', '.join(skipped) or '-')

if __name__ == '__main__':
    main(sys.argv[1:])
