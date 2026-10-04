# Kill the Machine

RTS estilo *Command & Conquer* hecho con Three.js (r186, incluido en `lib/`, funciona sin conexión).
Humanos contra máquinas: construye base, cosecha mineral, produce ejército y destruye todos los edificios enemigos.

## Ejecutar
Los módulos ES necesitan un servidor HTTP (no funciona con `file://`):

    npm start            # o: python3 -m http.server 8765
    # abre http://localhost:8765

Parámetros opcionales: `?autostart=easy|normal|hard`, `&spectate=1` (IA contra IA), `&speed=4` (simulación acelerada).

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
