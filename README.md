# Selectivity Charts

PROMPT:

Necesito que crees una aplicación web (HTML, CSS y JavaScript en un solo archivo, liviana, sin backend ni dependencias pesadas) para el estudio de selectividad de protecciones eléctricas mediante curvas de disparo (tiempo-corriente).

Funcionalidad principal:

Panel principal de ingreso de datos, donde el usuario pueda cargar cada protección/equipo con datos básicos como:

Nombre/identificación del equipo o circuito (ej: "Bomba 1", "Tablero principal", "Alimentador general")

Tipo de protección (interruptor termomagnético, guardamotor, fusible, relé, etc.)

Corriente nominal (In)

Curva de disparo (B, C, D, u otra según el tipo)

Capacidad de ruptura (kA)

Sección de datos del cable asociado a cada protección, incluyendo:

Tipo de cable: unipolar o multipolar/bipolar

Instalación: subterráneo o al aire / a la intemperie

Sección del cable (mm²) — sin calculadora de sección, solo como dato informativo a ingresar manualmente

Corriente admisible del cable según norma (dato de referencia, no calculado por la app)

Graficado de curvas de selectividad:

Generar automáticamente la curva tiempo-corriente (log-log) de todas las protecciones cargadas, superpuestas en un mismo gráfico

Permitir agregar o quitar protecciones de forma dinámica, viendo el gráfico actualizarse en simultáneo

Detectar visual o automáticamente si las curvas se cruzan (lo que indicaría pérdida de selectividad) y avisar al usuario

Pensado para aplicaciones como arranque de bombas u otras cargas con curvas específicas

Guardado de datos:

Que los datos ingresados se guarden (localStorage o similar) para no perderlos al recargar

Poder agregar, editar o eliminar equipos/secciones de la lista guardada

Verificación de compatibilidad:

Una función que indique si el equipo seleccionado es apto o no en términos de selectividad respecto a los demás ya cargados (por ejemplo, si hay solapamiento de curvas o falta de margen de tiempo/corriente entre protecciones aguas arriba y aguas abajo)

Requisitos de diseño:

Interfaz ordenada, limpia y simple de usar

Liviana (un solo HTML, sin frameworks pesados)

No incluir calculadora de sección de cable (ya está resuelto por fuera)

El foco está en la selectividad entre curvas, no en el dimensionamiento de conductores

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/2982a1f6-bb6c-443e-b10c-65ce3eac9238).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
