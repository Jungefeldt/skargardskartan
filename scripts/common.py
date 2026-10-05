"""Gemensamma inställningar för Skärgårdskartan."""
from pathlib import Path

# Område: [lon_min, lat_min, lon_max, lat_max].
# Hela skärgården upp till Gräsö är [18.00, 59.15, 19.40, 60.50]. Just nu används ett
# mindre testområde runt Trälhavet, så att allt hinner byggas snabbt i en körning.
FULL_BOUNDS = [18.00, 59.15, 19.40, 60.50]
TEST_BOUNDS = [18.22, 59.37, 18.58, 59.53]   # Trälhavet: Österskär, Åkersberga, Vaxholm, Stora Älgö
BOUNDS = TEST_BOUNDS

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MASK = ROOT / "mask"
CACHE = ROOT / ".cache"

MASK_ZOOMS = range(9, 16) if BOUNDS != FULL_BOUNDS else range(9, 15)   # 14 = ca 5 m, 15 = ca 2,5 m per pixel
DAYS_BACK = 5                # dagar bakåt som sparas
