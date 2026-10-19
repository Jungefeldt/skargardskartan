"""Gemensamma inställningar för Skärgårdskartan."""
from pathlib import Path

# Område: [lon_min, lat_min, lon_max, lat_max].
# Hela skärgården upp till Gräsö är [18.00, 59.15, 19.40, 60.50].
# AREA gäller grunddatan som klarar hela området: kustmasken (kartrutor), vind, vattentemperatur,
# djup, namn och zonerna runt hus och bryggor (build_mask.py och update_data.py).
# BOUNDS gäller tills vidare de tunga lagren (Lantmäteriets kustlinje och terräng, trädhöjd, lä för
# vinden, SWAN, detaljkartan och satellitbilderna), eftersom de i dag sparas som en fil för hela sitt
# område. De delas upp i rutor och byggs ut över skärgården i ett senare steg.
FULL_BOUNDS = [18.00, 59.15, 19.40, 60.50]
TEST_BOUNDS = [18.22, 59.37, 18.58, 59.53]   # Trälhavet: Österskär, Åkersberga, Vaxholm, Stora Älgö
AREA = FULL_BOUNDS
BOUNDS = TEST_BOUNDS

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
MASK = ROOT / "mask"
CACHE = ROOT / ".cache"

MASK_ZOOMS = range(9, 16) if AREA != FULL_BOUNDS else range(9, 15)   # 14 = ca 5 m, 15 = ca 2,5 m per pixel
DAYS_BACK = 5                # dagar bakåt som sparas
