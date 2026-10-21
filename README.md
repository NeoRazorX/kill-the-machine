# Kill the Machine

RTS estilo *Command & Conquer* hecho con Three.js (r186, incluido en `lib/`, funciona sin conexión).
Humanos contra máquinas: construye base, cosecha mineral, produce ejército y destruye todos los edificios enemigos.
Se puede jugar con cualquiera de los dos bandos; la IA lleva el otro.

## Ejecutar
Los módulos ES necesitan un servidor HTTP (no funciona con `file://`):

    npm start            # o: python3 -m http.server 8765
    # abre http://localhost:8765

La dificultad empieza marcada en **Fácil**; se cambia en el menú y no se recuerda entre partidas.

**Bando**: en el menú, pulsa la tarjeta de **Humanos** o de **Máquinas** para jugar con ese bando (por defecto,
Humanos). La elección se recuerda entre partidas. La IA toma el bando contrario con la dificultad elegida, y su
ventaja económica se aplica a ese bando. Cambian la presentación del menú, el saludo y la voz de mando (más
grave y lenta con las máquinas), los textos de victoria y derrota, y el color de acento del menú y del HUD.
`?side=human|machine` fija el bando solo para esa visita, sin cambiar lo recordado. En el modo IA contra IA
se ignora. Pruebas en el navegador: [tests/sides.html](http://localhost:8765/tests/sides.html).

Parámetros opcionales: `?autostart=easy|normal|hard` (empieza sin pasar por el menú, en Fácil si no se indica otra), `&side=machine` (juega con las máquinas), `&spectate=1` (IA contra IA), `&speed=4` (simulación acelerada),
`&spawn=0,2` (fija las esquinas de humanos y máquinas: 0 abajo a la izquierda y después en sentido horario;
en Río Partido deben estar en orillas opuestas; Duelo del Paso solo tiene 0 y 1), `&layout=quarry|river|pass|random` (mapa),
`&map=temperate|desert|ice|random` (aspecto del mapa), `&tech=random|none|t_silo,t_mine,…` (estructuras
tecnológicas al azar, ninguna o las indicadas; ver más abajo) y `&seed=n` (repite una disposición de árboles y rocas).

## Mapas

En el menú, la fila **Mapa** elige el trazado; se recuerda entre partidas y `?layout=quarry|river|pass|random`
lo fija solo para esa visita (`pass` para Duelo del Paso). El fondo del menú cambia al momento para previsualizarlo.

- **Cuatro Vientos** (por defecto): cuatro esquinas idénticas, giradas 90°, alrededor de un yacimiento
  central rico. Los dos bandos pueden empezar en cualquier par de esquinas.
- **Río Partido**: un río cruza el mapa de oeste a este y separa dos orillas; los rivales empiezan siempre
  en orillas opuestas, y la salida libre de cada orilla queda como expansión. El agua profunda no la cruza
  ninguna unidad: solo se pasa por dos vados laterales estrechos y por el centro, donde una isla guarda el
  yacimiento más rico. En los vados toda unidad va más despacio (`FORD_SPEED` en `src/config.js`) y no se
  puede construir sobre el agua. El río mide unas 10 celdas: los fusileros, tanques y lanzacohetes no
  alcanzan la otra orilla, pero las torretas y la artillería sí. El mapa es simétrico respecto a los dos
  ejes, así que cualquier emparejamiento permitido es justo.
- **Duelo del Paso**: un duelo en esquinas opuestas (abajo a la izquierda y arriba a la derecha), así que
  los dos bandos saben desde el principio dónde está el rival. Una sierra de 13 celdas de grosor cruza el
  mapa en diagonal, de esquina a esquina, y solo se atraviesa por tres pasos: dos laterales estrechos
  (unas 9 celdas), cada uno con un campo de expansión a su lado, y uno central más ancho con un campo rico
  en medio del camino. Unas peñas separan en cada lado el carril central de los laterales, y cada bando
  tiene una expansión protegida lejos de los pasos. Los obstáculos no tapan la vista ni los disparos, pero
  la sierra es tan gruesa que solo la artillería y las torretas pegadas a ella alcanzan el otro lado. El
  mapa es simétrico respecto a las dos diagonales, así que los dos pasos laterales son equivalentes.

Los trazados están en `LAYOUTS` (`src/map.js`): salidas, caminos, yacimientos, obstáculos y agua de una
esquina, que la simetría del mapa repite en las demás.

## Aspecto del mapa

La fila **Aspecto** elige **Templado**, **Desierto**, **Helado** o **Aleatorio** (opción por defecto).
Todos los mapas admiten los tres aspectos, que no cambian trazado, yacimientos, caminos ni obstáculos,
así que la elección no altera el equilibrio; cambian el suelo, la luz, el cielo,
el minimapa, la vegetación y el agua: el desierto tiene dunas onduladas, arenisca, saguaros y un oasis
turquesa; el helado tiene nieve, placas de hielo, pinos, nieve acumulada en las caras superiores de rocas
y riscos, y agua de deshielo. Además, cada carga elige una semilla distinta para la disposición de árboles
y rocas, que sigue siendo simétrica. Los temas están en `src/themes.js`;
[tools/map-preview.html](http://localhost:8765/tools/map-preview.html?map=desert&layout=river) acepta
`?map=` y `?layout=`.

Cada partida reparte 12 cajas de dinero en posiciones aleatorias accesibles, fuera
de las cuatro esquinas de salida y los yacimientos. Explora para descubrirlas: aparecen con una marca
dorada en el minimapa. Acerca cualquier unidad (o haz clic derecho sobre la caja)
para recibir entre 300 y 700 créditos. Cada caja se recoge una sola vez y también
pueden recogerlas las máquinas: la IA envía su unidad de combate más rápida a
explorar el mapa y a por las cajas que ha descubierto con su propia visión, nunca
las que solo ha visto el rival. Mientras busca tu base se desvía a por las que tiene
cerca, y las unidades ociosas que estén a menos de 90 unidades de una caja vista van a
recogerla (una a la vez en Fácil, dos en Normal y tres en Difícil); evita las que están
junto a tu base. En Fácil no empieza hasta el minuto y medio.
La distribución cambia al volver a jugar.
Pruebas de reparto, niebla, recogida y economía: `npm run test:crates`.

## Estructuras tecnológicas

Cada partida coloca estructuras tecnológicas en ruinas. Hay seis tipos: **silo de misiles**, **cañón de iones**,
**fábrica Mamut**, **fábrica Juggernaut**, **mina de tibero** y **radar estratégico**. En el menú, la opción
**Estructuras tecnológicas** decide cuáles:

- **Aleatorias** (por defecto): se sortean dos de tipos distintos.
- **Elegir**: se marcan las que se quieran, con su icono, nombre y una descripción corta; entre ninguna
  y cuatro como máximo. Sin ninguna marcada, la partida no tiene estructuras tecnológicas y no se anuncian.

La elección se recuerda entre partidas (en `localStorage`). También se puede indicar en la dirección:
`?tech=random`, `?tech=none` o una lista de tipos como `?tech=t_silo,t_mine` (`t_silo`, `t_ion`, `t_mammoth`,
`t_juggernaut`, `t_mine`, `t_radar`). Los tipos desconocidos o repetidos se ignoran, y la dirección solo vale para
esa visita: no cambia lo que se recuerda. El aviso de inicio dice cuántas hay. La IA, también en el modo
espectador, juega igual con cualquier selección.

Se colocan después de sortear las esquinas, a la misma distancia a pie
(medida con la holgura del vehículo más grande) de las dos bases y lejos de ambas. Nunca quedan
sobre caminos, mineral ni cajas, y dejan un pasillo libre alrededor. Si con dos esquinas vecinas no hay sitio exactamente
entre ambas, se admite poco más de margen; si aun así no basta, las estructuras se compensan
y las ventajas que dan a cada bando suman lo mismo. Con esquinas enfrentadas suelen ocupar las esquinas vacías.
Normalmente quedan a 40 celdas como mínimo unas de otras; con tres o cuatro elegidas esa distancia puede bajar
a 32 o 24 celdas si no caben, antes que perder equidad. Una sola estructura no se puede compensar con otra: si
no hay ningún sitio equidistante, se usa el más justo disponible.

Hay que encontrarlas: aparecen en el minimapa con un rombo (blanco en ruinas, del color del
dueño al capturarlas) y cada bando las descubre con su propia visión. Bajo la niebla se recuerda
el último estado visto. Las ruinas no son de nadie y no se pueden atacar. El **ingeniero**
(humanos) o el **infiltrador** (máquinas) sale del cuartel por 500 $: con clic derecho sobre la
estructura, entra y la captura, y se consume al entrar. También puede arrebatársela al enemigo.
La reparación empieza sola y se paga a medida que avanza, como la producción (2000 $ y 60 s,
más lenta con poca energía). Se puede pausar desde el panel de la estructura. Si destruyen una estructura capturada,
vuelve a quedar en ruinas, lista para otro ingeniero. No se pueden vender ni amplían el radio
de construcción, y no cuentan para la victoria: quien pierde todos sus edificios pierde la partida.

**Mina de Tibero**: después de capturarla y repararla, genera un ingreso base de **50 créditos cada 5 s**
para su propietario (con el multiplicador económico habitual de la dificultad). No consume energía,
funciona aunque falte energía en la base y no necesita cosechadoras. El panel muestra el ingreso y el
tiempo hasta el próximo pago. Al cambiar de dueño reinicia el contador; destruida, vuelve a ser una
ruina sin ingresos hasta capturarla y repararla de nuevo.
Cada pago muestra un indicador dorado flotante sobre la mina con los créditos recibidos; asciende
y se desvanece en dos segundos. Solo lo ve su propietario (o un espectador).
Vista de los tres estados: `tests/tibero.html`.

**Radar Estratégico**: capturado y reparado, consume **50 de energía** y revela **todo el mapa**
para su propietario: terreno, unidades enemigas, edificios, cajas y estructuras tecnológicas.
La IA dispone de la misma información si lo controla. Sin energía, destruido o capturado por el
enemigo, se pierde la cobertura global: el terreno queda explorado, pero las unidades fuera de
la visión normal dejan de verse. El panel indica si está activo o sin energía.

**Fábrica Mamut**: reparada, construye el **Tanque Mamut** (2200 $, 40 s) para su dueño. El
tanque aparece en la pestaña Vehículos en cuanto se descubre la fábrica y se desbloquea al tenerla
reparada. Es un supertanque de antes de la guerra, igual para los dos bandos salvo los colores.
Tiene doble cañón con disparos alternos, 1100 de vida, el doble de tamaño que el tanque principal
y es más lento. Fuera de combate (5 s sin recibir daño) se repara solo hasta la mitad de su vida.
La fábrica admite punto de reunión. Si la capturan o la destruyen, se pierde lo que estuviera en cola.

**Fábrica Juggernaut**: reparada, construye el **Juggernaut** (2000 $, 36 s), un caminante bípedo
de artillería. Eleva los cañones unos 25° y dispara salvas de tres proyectiles en una parábola más
tendida que la de la artillería (uno por cañón, con daño en área y más daño contra edificios) desde 30 de distancia, más lejos que el Mamut (20). Ve igual de lejos que
dispara. A cambio tiene 650 de vida, no se repara solo y tiene que detenerse para disparar.

La IA mezcla Mamuts y Juggernauts en su producción cuando tiene la fábrica correspondiente reparada.

**Superarmas** (`src/superweapons.js`): el **silo de misiles** y el **cañón de iones** reparados
consumen 60 de energía y empiezan a cargarse: 6 min el misil nuclear y 4 min el cañón de iones.
Sin energía suficiente la carga se detiene, y vuelve a cero cuando la estructura cambia de manos.
La carga aparece en la barra lateral. Cuando está lista, su botón parpadea: se pulsa y se apunta en
una zona ya explorada, con una vista previa bajo el cursor (Esc o clic derecho cancela).
- **Misil nuclear**: clic en el objetivo. Tarda 8 s en caer, radio 11 y 1000 de daño en el centro, que
  baja hasta el 40 % en el borde.
- **Cañón de iones**: se arrastra desde el punto inicial (explorado) hasta el final, o se hace clic en
  uno y luego en el otro. Tras 1,5 s de zumbido creciente, el haz barre la línea (34 unidades como
  máximo) en 2,5 s, quemando el suelo a su paso. Todo lo que queda a 3,5 unidades de la línea recibe
  un único golpe de hasta 1400, que baja hasta el 40 % cuanto más lejos del eje.

Los impactos alcanzan a todos, también al bando que dispara. Ningún impacto
deja un centro de mando por debajo de una cuarta parte de su vida, así que una superarma sola no
acaba la partida. Todos ven el círculo del impacto en el suelo y en el minimapa mientras llega, y el
bando atacado recibe un aviso. Como en Command & Conquer, cada bando ve en su barra lateral la cuenta
atrás de las superarmas enemigas que ha descubierto. La IA dispara las suyas contra el punto más
valioso que conoce (edificios descubiertos y unidades a la vista, sobre todo energía y refinerías),
evita alcanzar lo suyo y espera si no hay un objetivo que merezca la pena. Con el cañón de iones
busca la línea que cruza más valor.

**Ataque aéreo**: cada bando puede construir un **aeródromo** (humanos) o un **nido de drones**
(máquinas): $1500, requiere fábrica, consume 50 de energía y solo se permite uno. Con energía carga
en 100 s un ataque de apoyo que se lanza como una superarma, con un clic en zona explorada. Tres
cazabombarderos (o seis drones) entran desde el borde del mapa por detrás del aeródromo, pasan sobre
el objetivo soltando bombas y salen por el otro lado, así que cuanto más lejos el objetivo, más
tiempo de aviso. El bombardeo cubre un radio de 6 con 300 de daño en el centro (la mitad en el borde):
la infantería cae, los blindados reciben el 60 % y los edificios solo el 25 %. La IA construye su
aeródromo tras su primera oleada y solo lo usa contra ejércitos que ve.

La IA busca las estructuras con su explorador y, pasado un tiempo según la dificultad (7 min en
Fácil, 3 min 20 s en Normal y 1 min 30 s en Difícil), envía un ingeniero escoltado a la más cercana
que no sea suya. La escolta se queda guardándola.
Pruebas de colocación justa en todas las parejas de esquinas, al azar y con una, varias o ninguna
estructura elegida, captura, reparación, vuelta a ruina, niebla e IA: `npm run test:tech`.

## Cantera de los Cuatro Vientos

El mapa (192 × 192 celdas) tiene cuatro esquinas de salida idénticas: el terreno
se diseña en un cuarto y se rota 90° tres veces, de modo que cualquier pareja de
esquinas es justa. Cada partida sortea dónde empiezan humanos y máquinas, que
pueden quedar en esquinas vecinas o enfrentadas. Ni el suelo ni las cajas de dinero
delatan qué esquinas están ocupadas: hay que explorar para encontrar al enemigo.

Como en *Command & Conquer*, cada edificio se levanta sobre una losa de hormigón que
cubre su planta y una celda alrededor; las losas vecinas se funden en una sola
explanada que crece con la base, y la vista previa de colocación la muestra. La losa
de un edificio enemigo solo aparece cuando se ha visto el edificio. Al vender un
edificio se retira su losa; si lo destruyen, queda agrietada y quemada. En el desierto
el hormigón se cubre de arena y en el mapa helado, de nieve (`src/foundations.js`).

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
roca y hormigón bajo los edificios. Fuera del área jugable, el terreno continúa
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
| Capturar | clic derecho con un ingeniero sobre una estructura tecnológica que no sea tuya |
| Modo de movimiento · Detener | panel de selección: Mover / Atacar-mover / Detener · `A` + clic = atacar-mover puntual · `S` = detener |
| Cámara | flechas o bordes · rueda / `Q` `E` zoom · botón central arrastra · `H` base · `Espacio` última alerta |
| Grupos | `Ctrl+1-9` crear · `1-9` seleccionar (doble = centrar) |
| Construcción | barra lateral: clic = construir, clic en «LISTO» = colocar, clic derecho = cancelar, Shift = ×5 |
| Reparar / vender edificio | `R` / `Supr` o botones del panel · `P` pausa · `M` sonido |
| Menú de pausa | `Esc` (si no estás colocando un edificio ni apuntando) o el botón ☰ |

**Menú de pausa**: `Esc` cancela primero lo que esté en curso (colocar un edificio, atacar-mover puntual
o apuntar una superarma); si no hay nada, abre el menú y pausa la partida. Mientras está abierto no se dan
órdenes ni se mueve la cámara; `Esc` cierra primero la ayuda o una confirmación y después el menú, y la
partida vuelve al estado anterior (si estaba pausada con `P`, sigue pausada). Ofrece **Continuar**,
**Reiniciar partida** (misma dificultad, bando, mapa, escenario, esquinas y estructuras tecnológicas; las
cajas se reparten de nuevo), **Controles** y **Abandonar partida** (vuelve al menú principal). Reiniciar y
abandonar piden confirmación salvo con la partida terminada. Los volúmenes **General**, **Música**,
**Efectos** y **Voz de mando** se ajustan en vivo y se recuerdan entre partidas. Código en
`src/game-menu.js`; pruebas en [tests/game-menu.html](http://localhost:8765/tests/game-menu.html).

## Mecánicas
- **Modo de movimiento**: el panel de las unidades propias permite elegir **Mover** o **Atacar-mover** y **Detener**. Cada unidad conserva su modo al cambiar de selección; el clic derecho, también en el minimapa, lo respeta. Cambiar el modo durante una marcha conserva el destino y cambia si se detiene a combatir por el camino. Las órdenes explícitas de atacar, capturar, curar o recoger una caja mantienen su función. `A` + clic permite dar una orden puntual de atacar-mover, y `S` detiene al grupo.
- **Formación y escolta**: al mover un grupo, la formación mira hacia el destino con los blindados en primera fila, detrás el resto de unidades de tiro directo, después la artillería y al final las unidades de apoyo; cada una conserva su lado dentro de la fila para que los recorridos no se crucen. En las órdenes de ataque (clic derecho sobre un enemigo, atacar-mover o mover con el modo Atacar-mover) las unidades desarmadas que van con tropas armadas (radar móvil, vehículo de reparación, soldador, médico, nanodron e ingeniero) no avanzan hacia el objetivo: escoltan al grupo desde atrás, unas 5 unidades por detrás de la última unidad armada (12 el radar, que ve más lejos), repartidas a lo ancho y siguiéndolo mientras avanza. Los sanadores siguen atendiendo a los heridos y vuelven a su sitio. La escolta termina con una nueva orden o cuando cae todo el grupo. Una unidad de apoyo que va sola sí acude adonde se le manda. `npm run test:escort` lo comprueba.
- **Estelas de movimiento**: los vehículos terrestres, incluidas las cosechadoras y los caminantes pesados, levantan polvo ocre en el desierto y pequeñas salpicaduras de nieve en el mapa helado. La cantidad depende del desplazamiento y del tamaño; dejan de emitir al parar. La infantería y los drones flotantes no las producen. Las partículas respetan la visibilidad y tienen un límite independiente de los efectos de combate. `npm run test:ground-trails` comprueba emisión, visibilidad y límites; `tests/ground-trails.html` muestra ambos efectos.
- **Reparar estructuras**: selecciona un edificio propio dañado y pulsa **Reparar** en el panel o la tecla `R` (vuelve a pulsarla para detenerla; con varios edificios seleccionados actúa sobre todos). Recupera la vida en 25 s desde cero, sea cual sea su tamaño, y se paga a medida que avanza: una reparación completa cuesta la mitad del precio del edificio. Sin fondos queda en espera, con poca energía va al 40 % y se detiene sola al llegar al máximo. Sirve para el cuartel general y para las estructuras tecnológicas ya operativas (a la mitad de su coste de restauración). La IA repara lo que baja del 80 % cuando le sobra el dinero. `npm run test:building-repair` comprueba ritmo, coste, fondos, energía, controles e IA.
- **Rodadas y huellas**: los vehículos terrestres dejan en el suelo marcas de cadena en todos los mapas; el Juggernaut deja pisadas alternas y el Segador, la Araña Lanzacohetes, el Soldador y el radar móvil de las máquinas pequeñas marcas de patas. Las marcas duran 14 s y se desvanecen en la segunda mitad; con mucho tráfico se reutilizan las más antiguas (máximo 3072, una sola llamada de dibujo). Solo se estampan en terreno visible, así que no delatan movimientos bajo la niebla. La infantería y los drones no dejan marcas. `npm run test:track-marks` comprueba orientación, desvanecimiento, visibilidad y límites; `tests/track-marks.html` las muestra en los tres temas.
- **Música**: suena desde que empieza la misión, también en modo espectador. Se compone en tiempo real con WebAudio, sin archivos de audio, en el estilo electrónico-industrial de *Tiberian Sun* (breakbeats, sub-bajos, colchones oscuros con mucha reverb y melodías escasas). Fuera de combate rotan en cola tres pistas, empezando por una al azar: **Vigilia** (la original: latido de bajo, colchón y arpegio a contratiempo), **Tormenta iónica** (medio tiempo en re frigio con campana FM) y **Campos de tiberio** (trip-hop con swing y arpegio resonante); cada una dura minuto y medio aproximadamente y la siguiente entra justo al acabar. En combate suena **Frente de máquinas** (breakbeat industrial a 140 con bajo saturado), que entra ya con la batería. Pasa a combate cuando al menos dos unidades o edificios propios, o enemigos a la vista, reciben daño o disparan durante un segundo (al instante si son cuatro o más), y vuelve a la siguiente pista de la cola tras 10 s sin combate, con un fundido cruzado suave; los tiroteos intermitentes no la hacen saltar. Queda por debajo de los efectos y se silencia con `M` o el botón de sonido. El sintetizador está en `src/synth.js` y las pistas en `src/music-tracks.js`; [tools/music-lab.html](http://localhost:8765/tools/music-lab.html) las reproduce una a una y las exporta a WAV. `npm run test:music` comprueba la detección, la histéresis, la cola, el fundido y el silencio.
- **Contador de créditos**: mientras el contador del HUD sube (descargas de las cosechadoras, mina de tibero, cajas o ventas) suena un chasquido metálico seco como el de *Command & Conquer*, como mucho cada 60 ms; al gastar no suena.
- **Resultados**: al acabar la partida, la pantalla final compara los dos bandos (el tuyo marcado como «Tú»): unidades y edificios destruidos y perdidos, unidades producidas, edificios construidos (sin contar la base inicial), créditos ganados con su desglose (cosecha, cajas de dinero y mina de tibero), estructuras capturadas y superarmas lanzadas. En cada fila se resalta el mejor valor; en las pérdidas, el menor. Debajo, una gráfica muestra cada 10 s el **valor del ejército** (coste de las unidades vivas sin contar cosechadoras) o los **créditos ganados** de cada bando; al pasar el ratón (o con las flechas del teclado) se ven los dos valores de ese momento, y «Ver datos» los muestra en tabla. Código en `src/results.js`; pruebas en [tests/results.html](http://localhost:8765/tests/results.html).
- **Radar móvil**: ambos bandos lo construyen en la fábrica por 650 créditos (16 s). Desarmado y con 180 de vida, revela terreno y enemigos en un radio de 64 unidades, también en movimiento (un tanque ve 22). Su antena gira continuamente y al seleccionarlo muestra la cobertura en el minimapa. La IA mantiene como máximo uno y puede usarlo como explorador.
- **Experiencia**: las unidades de combate ascienden a veteranas con 3 bajas (+10 % daño) y a élite con 8 (+20 % daño y +10 % vida máxima, conservando el porcentaje de salud). Solo cuenta el golpe final contra unidades o estructuras enemigas; las defensas estáticas no ascienden. Los distintivos y la ficha muestran rango y progreso. Como en C&C, cada ascenso de una unidad propia suena con un carillón y la voz de mando anuncia «Unidad ascendida» o «Unidad de élite», que tiene una fanfarria más larga; los ascensos enemigos son silenciosos. Las bonificaciones son totales y no se acumulan más allá de élite.
- **Médicos y reparación**: el médico (humanos) y el nanodron (máquinas) salen del cuartel y curan a la infantería aliada; el vehículo de reparación y el soldador salen de la fábrica y reparan vehículos aliados, incluidas las cosechadoras. Están desarmados. En reposo atienden solos a los heridos cercanos sin alejarse de su posición; con atacar-mover acompañan al grupo y se detienen a curar por el camino. La curación nunca supera la vida máxima (incluida la de élite). La IA los produce en proporción de uno por cada seis unidades del mismo tipo.
- **Energía**: cada edificio consume; con déficit la producción va al 40 % y las torretas se apagan: dejan de apuntar y de disparar (se marcan con un rayo rojo) hasta que vuelve la energía.
- **Economía**: las cosechadoras llevan el mineral a la refinería; los campos se regeneran lentamente.
- **Cola de descarga**: como en C&C, solo una cosechadora descarga a la vez en el muelle de cada refinería. Las que llegan después se apartan a una plaza de espera junto al muelle, sin taparlo ni empujar a la que descarga, y entran por orden de llegada cuando queda libre. Si hay otra refinería propia libre y no mucho más lejos, se reparten entre ellas; una refinería a la que ordenas volver con clic derecho se respeta. Nadie se queda atascado: si la que descarga muere, recibe otra orden o no consigue llegar al muelle en 20 s, pasa la siguiente; si la refinería se destruye o se vende, buscan otra o esperan a que haya una. `npm run test:harvest-queue` lo comprueba con cuatro cosechadoras cargadas hacia una sola refinería.
- **Contadores de daño**: fusil fuerte contra infantería, cohetes/láser contra blindados y edificios, artillería con daño en área.
- **Tiro parabólico**: la artillería, la araña lanzacohetes y el Juggernaut elevan el cañón (o el contenedor de cohetes) hasta el ángulo de salida de su parábola antes de disparar (unos 40° la artillería y 25° el Juggernaut) y lo bajan sin objetivo.
- **Araña lanzacohetes**: la artillería de las máquinas (750 $, alcance 40) lanza salvas de ocho cohetes sin guiado, uno por tubo, que caen repartidos a menos de 2 unidades del punto apuntado, con daño en área cada uno. Por salva hace un daño parecido al de la artillería humana: algo más contra un blindado solo y algo menos contra grupos apretados. Los cohetes van a donde apuntaban al salir, así que una unidad que se mueve puede esquivar parte de la salva.
- **Niebla de guerra** con zonas inexploradas, exploradas y visibles (también en el minimapa).
- **IA enemiga** con tres dificultades: construye, cosecha, defiende y lanza oleadas crecientes.

La IA prioriza una planta de energía y una primera refinería si faltan, antes de
ampliar la base. También reconstruye esa economía tras perderla y espera a que los
edificios terminen de desplegarse para no duplicarlos. `npm run test:ai` comprueba
el arranque desde solo el centro de mando, la recolección y el acceso a cuartel y
fábrica para ambos bandos en las tres dificultades, además de la reconstrucción.
También comprueba que la IA empieza sin conocer la base enemiga, descarta las
esquinas vacías, deduce la última y ataca la base una vez descubierta.

La economía de la IA depende de la dificultad:

| | Fácil | Normal | Difícil |
|---|---|---|---|
| Cosechadoras por refinería | 2 | 2 | 3 |
| Refinerías | 2 (la 2.ª desde el min 7) | 2 (desde el min 2 30 s) | 3 (desde el min 1 y el 2) |
| Ingresos por mineral | ×0,75 | ×1 | ×1,25 |

Encarga una refinería más cuando las que tiene ya tienen sus cosechadoras y, mientras le
falten cosechadoras o refinerías, ahorra: la refinería pasa delante de los edificios
militares y el ejército espera hasta tener 1000 créditos, salvo si le atacan la base.
Repone las cosechadoras perdidas poniéndolas al principio de la cola de la fábrica. Pone
cada refinería nueva junto a un campo que no tenga ya una y reparte las cosechadoras entre
los campos a menos de 120 unidades de sus refinerías: unas tres por campo, primero los más
cercanos, y pasa a otro cuando el suyo se agota, se llena o queda junto a tu base. Nunca
tiene más cosechadoras de las que ese mineral puede ocupar.

`npm run test:ai-economy` simula 9 minutos de IA contra IA (la máquina en Normal y en Difícil
contra los humanos en Normal) en cuatro semillas y comprueba cosechadoras, refinerías,
campos explotados, cajas recogidas antes del minuto 5 e ingresos frente a las cifras de
antes de este ajuste. En Difícil la IA pasa de 2 a 9 cosechadoras, de 1 a 3 refinerías y de
2 a 4 o 5 campos; recoge su primera caja a los 12–38 s (antes, 22–83 s) e ingresa unos
37 000 $ en 9 minutos (antes, 15 400 $). En Normal, de 11 700 $ a unos 19 000 $.
`node tests/ai-economy.mjs --report --easy` muestra la tabla con Fácil incluido.

La IA ordena su base como en C&C: deja pasillos de dos celdas entre edificios (caben
una cosechadora o un tanque), no tapa los muelles de las refinerías ni las salidas
del cuartel y la fábrica, y procura dejar libre el terreno que hay delante. Pone las
refinerías con el muelle junto al mineral, la energía detrás y las torretas en el
lado que mira al enemigo, repartidas y sin alejarse de la base. Si falta sitio,
estrecha los pasillos a una celda antes de rendirse. `npm run test:ai-layout` levanta
bases completas en varios mapas y esquinas y comprueba huecos, muelles, salidas, que
los vehículos pueden salir de la base y que la IA sigue construyendo en una esquina
estrecha.

## Estructura
`src/config.js` definiciones · `map.js` terreno · `pathfinding.js` A* · `units.js` / `buildings.js` entidades ·
`game.js` simulación · `tech-sites.js` estructuras tecnológicas · `ai.js` IA · `fx.js` efectos y proyectiles · `models.js` modelos procedurales ·
`input.js` cámara y órdenes · `ui.js` interfaz y minimapa · `audio.js` sonido sintetizado · `music.js` música procedural (`synth.js` sintetizador, `music-tracks.js` pistas) · `results.js` pantalla de resultados · `game-menu.js` menú de pausa.

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
