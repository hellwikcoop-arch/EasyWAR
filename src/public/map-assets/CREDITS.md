# Ресурси 3D-карти «Рельєф України»

Усе в цій папці — готові растри й JSON-описи, які читає `src/map-app.js`. Мережі карта не потребує.

- `heights.png` — висоти (R·256+G−1000 = метри, B = маска суші): Mapzen Terrain Tiles на основі SRTM (NASA/USGS), ~600 м/піксель. Ці ж висоти читає 3D-рельєф картки «Метеоумови» (`src/dashboard-module-weather-3d.js`).
- `sat.jpg`, `r*_sat.jpg`, `q*_sat.jpg`, `*_sat.jpg` у міських пакетах — Esri World Imagery (© Esri, Maxar, Earthstar Geographics, дані користувачів GIS).
- `borders.png`, `coast.json`, `oblasts.json`, `cities.json` — кордони й назви: geoBoundaries та © OpenStreetMap contributors (ODbL). Спрощений контур із `coast.json` також вбудовано в `src/dashboard-module-geo.js` (картка «Карта подій» каталогу модулів; генерує `script/dashboard_geo.py`).
- `borders.png` (канал лінії зіткнення) і `front_meta.json` — DeepStateMap (знімок на вказану в `front_meta.json` дату; це відкриті дані, у застосунку вони не оновлюються).
- `*_buildings.png`, `cities3d.json`, `villages.json` — висоти будівель, виведені з © OpenStreetMap contributors (ODbL).
- `fac_*.jpg`, `facades.json` — текстури фасадів із початкового набору карти; авторство в наборі не зазначене, перед публічним розповсюдженням його варто уточнити.

Оновлення даних = заміна файлів тут (кожен шар карти перезавантажується незалежно, див. `defLayer` у `map-app.js`); код не змінюється.
