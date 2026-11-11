# Рендер 3D-емблем стартового екрана

Конвеєр перетворює плоску емблему (PNG/WEBP з альфою) на металевий рельєф і рендерить
13 кадрів повороту для `src/start-emblems.js`. Потрібен Blender як модуль Python
(`pip install bpy pillow numpy`, Python 3.11+; у хмарній сесії — у venv) або звичайний
Blender (`blender -b -P render.py -- …`).

```bash
python3 prep.py <emblem.png> maps/air          # color.png, height.png, alpha.png (4× LANCZOS, фаска з альфи)
python render.py -- maps/air frames/air 13 384 48   # 13 кадрів, 384 px, 48 семплів Cycles
python3 strip.py frames/air src/public/emblem-3d/air.webp 320
```

Після нового рендеру оновіть пропорції кадру в `EMBLEMS` (`src/start-emblems-core.js`), якщо
вихідне зображення мало інші розміри; `tests/start-emblems.test.mjs` перевіряє смугу.
Вихідні емблеми — ті самі, що вбудовані в картки `src/index.html` (data-URI).
Синтетичних чи реальних таблиць конвеєр не торкається.
