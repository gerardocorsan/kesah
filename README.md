# Kesah, editor visual de grafos

Aplicación web para dibujar grafos (nodos y aristas) con el ratón. HTML + TypeScript, sin librerías en tiempo de ejecución: el dibujo es SVG puro y Vite sólo se usa para desarrollar y empaquetar.

## Puesta en marcha

```bash
npm install
npm run dev      # servidor de desarrollo en http://localhost:5173
npm run build    # comprueba tipos y genera dist/
npm run preview  # sirve dist/ para probar la versión final
```

## Controles

| Acción | Cómo |
| --- | --- |
| Crear nodo | Doble clic en el fondo |
| Mover nodo | Arrastrarlo |
| Conectar dos nodos | Shift + arrastrar de uno a otro, o activar «Conectar» y arrastrar |
| Renombrar nodo o etiquetar arista | Doble clic sobre él |
| Seleccionar | Clic en un nodo o una arista |
| Borrar | Supr o Retroceso con algo seleccionado, o botón «Borrar» |
| Zoom | Rueda del ratón |
| Desplazar el lienzo | Arrastrar el fondo, o botón central del ratón |
| Dirigido / no dirigido | Casilla «Dirigido» |

El grafo se guarda solo en `localStorage`, así que sobrevive a recargar la página. «Exportar JSON» descarga el archivo e «Importar JSON» lo carga.

## Estructura

- `src/graph.ts`: el modelo. Nodos, aristas, validación del JSON y notificación de cambios. No toca el DOM.
- `src/editor.ts`: la vista. Pinta el grafo en un `<svg>` y traduce los gestos del puntero en operaciones sobre el modelo.
- `src/main.ts`: barra de herramientas, guardado automático, importación y exportación.
- `src/style.css`: estilos de la interfaz y del lienzo.

## Formato JSON

```json
{
  "directed": true,
  "nodes": [
    { "id": "n1", "label": "A", "x": 120, "y": 160 },
    { "id": "n2", "label": "B", "x": 320, "y": 80 }
  ],
  "edges": [
    { "id": "e1", "source": "n1", "target": "n2", "label": "" }
  ]
}
```
