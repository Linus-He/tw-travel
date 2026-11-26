#!/usr/bin/env python3
"""Validate and package only website assets; do not publish credentials or scripts."""
import argparse
import json
import os
from pathlib import Path
import shutil

ROOT = Path(__file__).resolve().parent
FILES = ['index.html', 'style.css', 'app.js', 'map.js', 'places-model.js', 'places.json', 'sources.json', 'ui.js', 'lucide.min.js', 'LUCIDE-LICENSE', 'community.js', 'community.css', 'social-embeds.js', 'social-posts.json']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'public')
    target = parser.parse_args().output.resolve()
    if target == ROOT or ROOT in target.parents and target.name != 'public':
        parser.error('Use public/ or a separate output directory')
    rows = json.loads((ROOT / 'places.json').read_text())
    manifest = json.loads((ROOT / 'sources.json').read_text())
    if not rows or len({p['id'] for p in rows}) != len(rows) or manifest['coverage']['total'] != len(rows):
        raise ValueError('Place data and provenance manifest do not match')
    if any('rating' in p or not p.get('source') for p in rows):
        raise ValueError('Do not package unattributed places or external ratings')
    target.mkdir(parents=True, exist_ok=True)
    for name in FILES:
        shutil.copyfile(ROOT / name, target / name)
    config = {
        'googleMapsApiKey': os.environ.get('GOOGLE_MAPS_API_KEY', ''),
        'googleMapsMapId': os.environ.get('GOOGLE_MAPS_MAP_ID', ''),
        'communityApiUrl': os.environ.get('COMMUNITY_API_URL', 'https://tw-travel-community.square-hwh.workers.dev'),
    }
    (target / 'config.js').write_text('window.TRAVEL_CONFIG = ' + json.dumps(config) + ';\n')
    print('Packaged %s attributed places in %s' % (len(rows), target))

if __name__ == '__main__':
    main()
