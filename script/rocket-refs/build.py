#!/usr/bin/env python3
"""Збирає src/public/rocket-refs.js із шаблону та зображень у script/rocket-refs/img/."""
import base64, json, pathlib
here = pathlib.Path(__file__).resolve().parent
images = {}
for path in sorted((here / 'img').glob('*.webp')):
    images[path.stem] = 'data:image/webp;base64,' + base64.b64encode(path.read_bytes()).decode()
out = (here / 'template.js').read_text(encoding='utf-8').replace('__IMAGES__', json.dumps(images, indent=0))
target = here.parent.parent / 'src' / 'public' / 'rocket-refs.js'
target.write_text(out, encoding='utf-8')
print(f'{target}: {len(images)} images, {len(out) // 1024} KiB')
