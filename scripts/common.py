"""Gemensamma inställningar för Skärgårdskartan."""
from pathlib import Path

# Område: [lon_min, lat_min, lon_max, lat_max]. Stockholms skärgård upp till Gräsö.
BOUNDS = [18.00, 59.15, 19.40, 60.50]

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MASK = ROOT / "mask"
CACHE = ROOT / ".cache"

MASK_ZOOMS = range(9, 15)   # zoomnivåer för land/vattenmasken (14 = ca 5 m per pixel)
DAYS_BACK = 5                # dagar bakåt som sparas
