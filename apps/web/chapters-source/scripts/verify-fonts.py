"""Check coverage of shipped font chunks (requires fonttools and brotli)."""
from pathlib import Path
from fontTools.ttLib import TTFont
root = Path(__file__).resolve().parents[1]
cmap = set()
for path in (root / 'public/shared/fonts').glob('*.woff2'):
    font = TTFont(path)
    assert 'fvar' not in font, 'Fonts are intentionally declared as static Regular'
    cmap.update(font.getBestCmap())
text = '你忙你的我陪我的把小日子慢慢存起来毛宠物小窝旅行小岛记忆宫殿'
missing = [char for char in text if ord(char) not in cmap]
assert not missing, missing
print(f'All {len(set(text))} regression characters are covered; {len(cmap)} Chinese glyphs shipped.')
