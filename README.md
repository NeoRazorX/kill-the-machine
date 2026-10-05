# Kill the Machine

RTS estilo *Command & Conquer* hecho con Three.js (r186, incluido en `lib/`, funciona sin conexión).
Humanos contra máquinas: construye base, cosecha mineral, produce ejército y destruye todos los edificios enemigos.

## Ejecutar
Los módulos ES necesitan un servidor HTTP (no funciona con `file://`):

    npm start            # o: python3 -m http.server 8765
    # abre http://localhost:8765

Parámetros opcionales: `?autostart=easy|normal|hard`, `&spectate=1` (IA contra IA), `&speed=4` (simulación acelerada).

## Cantera del Umbral

El mapa combina una distribución diseñada con decoración procedural reproducible.
El corredor central conecta las bases y el mineral disputado; los flancos enlazan
los claros de expansión. Se reservan corredores de ocho celdas de ancho frente
a la colocación de árboles, rocas y macizos. Las superficies transitables siguen
siendo planas; los acantilados y las ruinas tienen su huella bloqueada en navegación
y construcción, y aparecen en el minimapa.

El suelo incluye caminos con rodadas, hombros irregulares, polvo alrededor de la
roca y juntas en el pavimento de las bases. Los nuevos modelos editables son
`assets/models/env_cliff.blend` y `assets/models/env_ruin.blend`, con sus GLB locales.
Se regeneran con `blender -b --python-exit-code 1 --python tools/build_models.py -- quarry`.
El exportador de Blender necesita NumPy disponible en su Python.

- [Vista general y detalle del mapa](http://localhost:8765/tools/map-preview.html).
- [Jugar el escenario](http://localhost:8765/?autostart=easy).
- [Pruebas de integración](http://localhost:8765/tests/models.html), incluyendo 32
  semillas, acceso a recursos, paso de formaciones y huella de los nuevos modelos.

## Prueba de modelos de Blender

El tanque Atlas y la fábrica humana usan modelos GLB por defecto. El resto conserva los
modelos procedurales. Ambos GLB son locales, sin texturas externas ni servicios de red.
Se precargan antes del inicio; si un archivo falla o su descarga supera 10 segundos,
se usa el modelo procedural correspondiente. No hace falta instalar Blender para jugar.

- Comparación visual: [tools/model-preview.html](http://localhost:8765/tools/model-preview.html).
- Juego con GLB: [modo por defecto](http://localhost:8765/?autostart=easy).
- Juego anterior: [modo procedural](http://localhost:8765/?autostart=easy&models=procedural).
- Pruebas: [tests/models.html](http://localhost:8765/tests/models.html); debe terminar en `ALL PASSED`.
- Diagnóstico en la consola del juego: `window.__graphics()` devuelve carga, llamadas de dibujo y triángulos del último fotograma.

Los originales editables están en `assets/models/h_tank.blend` y `h_factory.blend`.
El script `tools/build_models.py` los genera con la API de Blender y exporta los GLB:

    blender -b --python-exit-code 1 --python tools/build_models.py

Requiere Blender con su exportador glTF y NumPy disponibles en su Python (probado con
Blender 5.0.1). Regenerar sobrescribe los `.blend` y `.glb`; las modificaciones artísticas
hechas a mano deben exportarse desde Blender o trasladarse al script antes de regenerar.

Contrato de los modelos: escala en unidades de mundo, suelo en Y=0 y frente hacia +Z
después de exportar. La fábrica cabe en 6×6 y mantiene su altura por debajo de 4,5.
El tanque tiene nodos `turret` → `barrel` → `muzzle`; sus pivotes conservan giro,
retroceso y punto de disparo. Son modelos rígidos, sin esqueletos. Cada entidad clona
los nodos y comparte geometrías/materiales; no se deben modificar los materiales
compartidos para cambiar una sola instancia. El fantasma de colocación asigna otro material.

Resultado de la prueba aislada (100 tanques + 10 fábricas, todos visibles, con sombras):

| Medida | Procedural | GLB |
|---|---:|---:|
| Mallas por tanque | 17 | 3 |
| Mallas por fábrica | 17 | 1 |
| Triángulos por tanque | 432 | 2.996 |
| Triángulos por fábrica | 264 | 2.600 |
| Llamadas de dibujo, incluyendo sombras | 3.740 | 620 |
| Triángulos dibujados, incluyendo sombras | 91.680 | 651.200 |

Los dos GLB pesan aproximadamente 542 KiB en total. La reducción de llamadas es del
83 %, a cambio de más triángulos: no equivale a una medición de mejora de FPS.
La prueba verifica también pivotes, clones independientes, construcción, disparos,
cosechadoras procedurales y recuperación ante un GLB ausente.

`lib/addons/` contiene GLTFLoader, BufferGeometryUtils y SkeletonUtils oficiales de
Three.js r186, con licencia MIT en `lib/LICENSE`.

## Controles
| Acción | Control |
|---|---|
| Seleccionar | clic · arrastrar caja · doble clic (mismo tipo) · Ctrl+A (todas) |
| Mover / atacar / cosechar | clic derecho (en cuartel/fábrica: punto de reunión) |
| Atacar-mover · Detener | `A` + clic · `S` |
| Cámara | flechas o bordes · rueda / `Q` `E` zoom · botón central arrastra · `H` base · `Espacio` última alerta |
| Grupos | `Ctrl+1-9` crear · `1-9` seleccionar (doble = centrar) |
| Construcción | barra lateral: clic = construir, clic en «LISTO» = colocar, clic derecho = cancelar, Shift = ×5 |
| Vender edificio | `Supr` o botón del panel · `P` pausa · `M` sonido |

## Mecánicas
- **Energía**: cada edificio consume; con déficit la producción va al 40 % y las torretas disparan a la mitad.
- **Economía**: las cosechadoras llevan el mineral a la refinería; los campos se regeneran lentamente.
- **Contadores de daño**: fusil fuerte contra infantería, cohetes/láser contra blindados y edificios, artillería con daño en área.
- **Niebla de guerra** con zonas inexploradas, exploradas y visibles (también en el minimapa).
- **IA enemiga** con tres dificultades: construye, cosecha, defiende y lanza oleadas crecientes.

## Estructura
`src/config.js` definiciones · `map.js` terreno · `pathfinding.js` A* · `units.js` / `buildings.js` entidades ·
`game.js` simulación · `ai.js` IA · `fx.js` efectos y proyectiles · `models.js` modelos procedurales ·
`input.js` cámara y órdenes · `ui.js` interfaz y minimapa · `audio.js` sonido sintetizado.
