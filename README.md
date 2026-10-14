# Kill the Machine

RTS estilo *Command & Conquer* hecho con Three.js (r186, incluido en `lib/`, funciona sin conexión).
Humanos contra máquinas: construye base, cosecha mineral, produce ejército y destruye todos los edificios enemigos.

## Ejecutar
Los módulos ES necesitan un servidor HTTP (no funciona con `file://`):

    npm start            # o: python3 -m http.server 8765
    # abre http://localhost:8765

Parámetros opcionales: `?autostart=easy|normal|hard`, `&spectate=1` (IA contra IA), `&speed=4` (simulación acelerada),
`&spawn=0,2` (fija las esquinas de humanos y máquinas: 0 abajo a la izquierda y después en sentido horario),
`&map=temperate|desert|ice|random` (aspecto del mapa) y `&seed=n` (repite una disposición de árboles y rocas).

## Aspecto del mapa

En el menú se elige el mapa: **Templado**, **Desierto**, **Helado** o **Aleatorio** (opción por defecto).
El fondo del menú cambia al momento para previsualizarlo. Los tres comparten trazado, yacimientos,
caminos y obstáculos, así que la elección no altera el equilibrio; cambian el suelo, la luz, el cielo,
el minimapa y la vegetación: el desierto tiene dunas onduladas, arenisca y saguaros; el helado tiene
nieve, placas de hielo, pinos y nieve acumulada en las caras superiores de rocas y riscos.
Además, cada carga elige una semilla distinta para la disposición de árboles y rocas, que sigue siendo
simétrica en las cuatro esquinas. Los temas están en `src/themes.js`;
[tools/map-preview.html](http://localhost:8765/tools/map-preview.html?map=desert) acepta `?map=`.

Cada partida reparte 12 cajas de dinero en posiciones aleatorias accesibles, fuera
de las cuatro esquinas de salida y los yacimientos. Explora para descubrirlas: aparecen con una marca
dorada en el minimapa. Acerca cualquier unidad (o haz clic derecho sobre la caja)
para recibir entre 300 y 700 créditos. Cada caja se recoge una sola vez y también
pueden recogerlas las máquinas: la IA envía su unidad de combate más rápida a
explorar el mapa y a por las cajas que ha descubierto con su propia visión, nunca
las que solo ha visto el rival (en Fácil no sale hasta los 2 min 30 s).
La distribución cambia al volver a jugar.
Pruebas de reparto, niebla, recogida y economía: `npm run test:crates`.

## Cantera de los Cuatro Vientos

El mapa (192 × 192 celdas) tiene cuatro esquinas de salida idénticas: el terreno
se diseña en un cuarto y se rota 90° tres veces, de modo que cualquier pareja de
esquinas es justa. Cada partida sortea dónde empiezan humanos y máquinas, que
pueden quedar en esquinas vecinas o enfrentadas. Las cuatro esquinas tienen el
mismo pavimento, y ni el suelo ni las cajas de dinero delatan cuáles están ocupadas:
hay que explorar para encontrar al enemigo.

Cada esquina tiene dos yacimientos propios y sale por tres caminos: dos de borde
hacia los claros con mineral que comparte con sus vecinas y uno diagonal hacia la
expansión y el gran yacimiento central. Un anillo enlaza las expansiones. Se reservan
corredores de ocho celdas de ancho frente a la colocación de árboles, rocas y macizos.
Las superficies transitables siguen siendo planas; los acantilados y las ruinas
tienen su huella bloqueada en navegación y construcción, y aparecen en el minimapa.

La IA tampoco sabe dónde empezaste: solo conoce los edificios que han visto sus
unidades o edificios. Su explorador recorre las esquinas pendientes antes de buscar
cajas, y sus oleadas atacan la esquina sin explorar más cercana hasta encontrar la base.
Si solo queda una esquina por ver, deduce que el enemigo está ahí. Ningún bando
puede construir sobre la zona de descarga de una refinería.

El suelo incluye caminos con rodadas, hombros irregulares, polvo alrededor de la
roca y juntas en el pavimento de las bases. Fuera del área jugable, el terreno continúa
y se convierte en pedregal al pie de dos filas desalineadas de rocas de tamaño y altura
variables, con piedras sueltas y tramos de bosque; todo es decorativo y reproducible. Los modelos editables son
`assets/models/env_cliff.blend` y `assets/models/env_ruin.blend`, con sus GLB locales.
Se regeneran con `blender -b --python-exit-code 1 --python tools/build_models.py -- quarry`.
El exportador de Blender necesita NumPy disponible en su Python.

- [Vista general y detalle del mapa](http://localhost:8765/tools/map-preview.html).
- [Jugar el escenario](http://localhost:8765/?autostart=easy).
- [Pruebas de integración](http://localhost:8765/tests/models.html), incluyendo 32
  semillas, simetría de las cuatro esquinas, acceso a recursos desde cada salida,
  paso de formaciones y huella de los nuevos modelos.

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
| Mover / atacar / cosechar / curar | clic derecho (sobre un aliado herido: curar o reparar; en cuartel/fábrica: punto de reunión) |
| Atacar-mover · Detener | `A` + clic · `S` |
| Cámara | flechas o bordes · rueda / `Q` `E` zoom · botón central arrastra · `H` base · `Espacio` última alerta |
| Grupos | `Ctrl+1-9` crear · `1-9` seleccionar (doble = centrar) |
| Construcción | barra lateral: clic = construir, clic en «LISTO» = colocar, clic derecho = cancelar, Shift = ×5 |
| Vender edificio | `Supr` o botón del panel · `P` pausa · `M` sonido |

## Mecánicas
- **Experiencia**: las unidades de combate ascienden a veteranas con 3 bajas (+10 % daño) y a élite con 8 (+20 % daño y +10 % vida máxima, conservando el porcentaje de salud). Solo cuenta el golpe final contra unidades enemigas; edificios y defensas estáticas no generan ascensos. Los distintivos y la ficha muestran rango y progreso. Las bonificaciones son totales y no se acumulan más allá de élite.
- **Médicos y reparación**: el médico (humanos) y el nanodron (máquinas) salen del cuartel y curan a la infantería aliada; el vehículo de reparación y el soldador salen de la fábrica y reparan vehículos aliados, incluidas las cosechadoras. Están desarmados. En reposo atienden solos a los heridos cercanos sin alejarse de su posición; con atacar-mover acompañan al grupo y se detienen a curar por el camino. La curación nunca supera la vida máxima (incluida la de élite). La IA los produce en proporción de uno por cada seis unidades del mismo tipo.
- **Energía**: cada edificio consume; con déficit la producción va al 40 % y las torretas disparan a la mitad.
- **Economía**: las cosechadoras llevan el mineral a la refinería; los campos se regeneran lentamente.
- **Contadores de daño**: fusil fuerte contra infantería, cohetes/láser contra blindados y edificios, artillería con daño en área.
- **Niebla de guerra** con zonas inexploradas, exploradas y visibles (también en el minimapa).
- **IA enemiga** con tres dificultades: construye, cosecha, defiende y lanza oleadas crecientes.

La IA prioriza una planta de energía y una primera refinería si faltan, antes de
ampliar la base. También reconstruye esa economía tras perderla y espera a que los
edificios terminen de desplegarse para no duplicarlos. `npm run test:ai` comprueba
el arranque desde solo el centro de mando, la recolección y el acceso a cuartel y
fábrica para ambos bandos en las tres dificultades, además de la reconstrucción.
También comprueba que la IA empieza sin conocer la base enemiga, descarta las
esquinas vacías, deduce la última y ataca la base una vez descubierta.

## Estructura
`src/config.js` definiciones · `map.js` terreno · `pathfinding.js` A* · `units.js` / `buildings.js` entidades ·
`game.js` simulación · `ai.js` IA · `fx.js` efectos y proyectiles · `models.js` modelos procedurales ·
`input.js` cámara y órdenes · `ui.js` interfaz y minimapa · `audio.js` sonido sintetizado.

## Pruebas de experiencia

`npm run test:experience` comprueba ascensos, daño, salud, atribución de bajas y
ausencia de bonificaciones compartidas (Node.js 22.15+).
[Vista y pruebas de los rangos](http://localhost:8765/tests/experience.html) añade
la comprobación de fichas y distintivos con los modelos del juego.

## Pruebas de curación

`npm run test:repair` comprueba qué unidad puede curar a cuál, la curación automática
en reposo, las órdenes explícitas a distancia y el límite de vida máxima.

## Pruebas de navegación

`npm run test:navigation` comprueba el radio completo en pasos estrechos, esquinas,
destinos pegados a obstáculos y rutas modificadas por edificios. También simula
el movimiento de tanques entre bases y la recuperación de bloqueos temporales
y persistentes. Planificación y colisiones usan la misma huella circular; los
recálculos de recuperación conservan el contador y se limitan a dos intentos
antes de detener el movimiento si el bloqueo persiste.
