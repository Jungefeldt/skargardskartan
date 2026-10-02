# Skärgårdskartan

Egen kartapp för fiske i Stockholms skärgård och Roslagen. Visar var det finns
lä för en viss vind, vindprognos, väder och vattentemperatur, ovanpå öppna kartor
(OpenStreetMap med sjömärken från OpenSeaMap). Fungerar i mobilen och kan läggas
på hemskärmen.

## Data

| Vad | Källa | Uppdateras |
|---|---|---|
| Karta och sjömärken | OpenStreetMap, OpenSeaMap | löpande |
| Kustlinje för lä-beräkning | OpenStreetMap | en gång (mappen `mask`) |
| Vind, byar, lufttemperatur, nederbörd | SMHI öppna prognoser (snow1g) | 4 gånger per dygn |
| Vattentemperatur | Copernicus Marine, Östersjömodellen | 4 gånger per dygn |

Senaste 5 dagarna sparas plus prognosen framåt.

## Så räknas lä

För varje punkt i vattnet räknas hur långt det är till land i den riktning vinden
kommer ifrån (öppet vatten mot vinden, max 6 km), med lite spridning i vindriktning.
Av det och vindstyrkan uppskattas våghöjden. Det är en förenkling: vågor böjer runt
små öar, så verkligt lä är ofta något mindre. Använd inte appen för navigering.

## Ändra området

Ändra `BOUNDS` i `scripts/common.py`, och kör sedan flödet "Uppdatera kartan" med
rutan "Bygg om land/vatten-masken" ikryssad.
