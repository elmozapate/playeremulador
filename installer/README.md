# Instalador ldplayer-node-bridge / ldplayer-bridge

Instalador **idempotente** para Windows: lo puedes ejecutar hoy, mañana o
dentro de seis meses y siempre hará lo correcto.

- Si algo falta, lo instala.
- Si algo ya existe, lo reutiliza.
- Si los repos ya están clonados, hace `git pull`.
- Si las dependencias ya están instaladas, `npm install` / `pip install`
  simplemente confirman que todo sigue correcto.
- El `.env` se actualiza solo en las claves que gestiona el instalador;
  cualquier línea que hayas añadido a mano se conserva.

## Uso

1. Edita `config.ps1` y coloca las URLs reales de tus dos repositorios
   (`NodeRepoUrl`, `PythonRepoUrl`).
2. Copia toda la carpeta `installer/` a la máquina destino (puede ir en
   cualquier ruta; el propio script crea `C:\playeremulador`).
3. Doble clic en `install.bat` (o clic derecho -> "Ejecutar como
   administrador" si tu política de UAC lo requiere).

También puedes lanzarlo directamente desde PowerShell:

```powershell
powershell -ExecutionPolicy Bypass -File install.ps1
```

## Qué hace, paso a paso

```
[1/12]  Comprobando Git                (instala si falta)
[2/12]  Comprobando Node v20.19.0      (instala/actualiza si difiere)
[3/12]  Comprobando Python 3.13        (instala 3.13.2 si falta; nunca 3.14)
[4/12]  Sincronizando repositorios     (git clone o git pull)
[5/12]  npm install
[6/12]  Creando entorno virtual        (.venv con Python 3.13)
[7/12]  pip install -r requirements.txt
[8/12]  Generando/actualizando .env
[9/12]  LDPlayer                       (opcional, desactivado por defecto)
[10/12] Verificando uvicorn
[11/12] Iniciando el bridge            (npm start en ventana aparte)
[12/12] Instalación finalizada
```

## Estructura

```
installer/
│
├── install.ps1          # Orquestador principal
├── install.bat           # Lanzador de doble clic
├── config.ps1            # Versiones, URLs y rutas (edítalo aquí)
├── modules/
│   ├── Logger.ps1         # Salida en consola + log a fichero
│   ├── Utils.ps1          # Helpers: admin check, descargas, PATH
│   ├── Git.ps1             # Verifica/instala Git
│   ├── Node.ps1            # Verifica/instala Node 20.19.0
│   ├── Python.ps1          # Verifica/instala Python 3.13.x (no 3.14)
│   ├── Repo.ps1             # git clone / git pull idempotente
│   ├── Npm.ps1               # npm install
│   ├── Venv.ps1               # Crea .venv con Python 3.13
│   ├── Pip.ps1                 # pip install -r requirements.txt
│   ├── Env.ps1                  # Genera/actualiza .env preservando líneas manuales
│   └── LDPlayer.ps1              # Instala LDPlayer (opcional)
└── README.md
```

## Configuración relevante (`config.ps1`)

| Variable | Descripción |
|---|---|
| `BasePath` | Carpeta raíz, por defecto `C:\playeremulador` |
| `NodeRepoUrl` / `PythonRepoUrl` | URLs de los dos repositorios a clonar |
| `NodeRequiredVersion` | Versión exacta de Node exigida (`20.19.0`) |
| `PythonInstallVersion` | Versión de Python a instalar si falta 3.13 |
| `InstallLDPlayer` | `$true`/`$false` — actívalo si quieres que el script instale LDPlayer |
| `EnvManagedKeys` | Claves del `.env` que el instalador gestiona automáticamente |

## Log

Cada ejecución escribe un log detallado en:

```
C:\playeremulador\install.log
```

Útil para depurar sin tener que capturar la salida de consola.

## Notas

- El script pide elevación de administrador automáticamente si hace falta
  (relanza la propia consola con `RunAs`).
- Node y Python se instalan en modo silencioso (`/qn`, `/quiet`), sin
  intervención del usuario.
- Python se instala explícitamente evitando 3.14, porque algunas
  dependencias (p. ej. `pydantic-core`) pueden no tener ruedas
  precompiladas para esa versión y forzarían compilación nativa.
- El paso de LDPlayer está desactivado por defecto (`InstallLDPlayer =
  $false` en `config.ps1`) porque es una descarga pesada; actívalo solo
  si lo necesitas.
