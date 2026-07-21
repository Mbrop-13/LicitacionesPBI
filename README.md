# ProgramBI · Licitaciones

Plataforma profesional para detectar automáticamente **licitaciones de Mercado Público (ChileCompra)** que aplican a **ProgramBI** — centro de capacitación en:

- Excel  
- Power BI  
- SQL Server  
- Power Automate  
- Análisis de datos  
- Inteligencia Artificial / Machine Learning  
- Big Data  
- Python / programación  

Diseño limpio estilo Grok (off-white + negro). Funciona **de inmediato** con almacenamiento local; Supabase es opcional.

---

## Qué hace

1. Consulta la API pública de Mercado Público por fecha.
2. Filtra con un perfil de palabras clave (editable en la web).
3. Guarda solo las que aplican a tus cursos.
4. Te **notifica** (panel en la web, navegador, y opcionalmente webhook Discord/Slack/Make).
5. Dashboard para revisar, marcar favoritos y exportar CSV.

---

## Inicio rápido

```bash
# 1. Variables de entorno
copy .env.example .env
# Edita MERCADOPUBLICO_TICKET con tu ticket

# 2. Dependencias
npm install

# 3. Arrancar
npm start
```

Abre **http://localhost:3000** y pulsa **Buscar ahora**.

Sin Supabase se guardan los datos en la carpeta `data/` (JSON). Perfecto para empezar.

---

## Ticket de Mercado Público

1. Entra a [mercadopublico.cl](https://www.mercadopublico.cl/) y regístrate como proveedor.  
2. Solicita acceso a la API (gratuito) en el centro de ayuda de ChileCompra.  
3. Copia el ticket en `.env` → `MERCADOPUBLICO_TICKET`.

---

## Notificaciones

| Canal | Cómo |
|--------|------|
| Panel web | Campana en el dashboard |
| Navegador | Acepta el permiso cuando aparezca |
| Webhook | `NOTIFY_WEBHOOK_URL` en `.env` (Discord, Slack, Make, n8n…) |
| Email | `NOTIFY_EMAIL` va en el payload del webhook (envíalo con Make/n8n) |

Ejemplo Discord: pega la URL del webhook del canal en `NOTIFY_WEBHOOK_URL`.

---

## Supabase (opcional, producción)

1. Crea un proyecto en [supabase.com](https://supabase.com).  
2. SQL Editor → pega `supabase_schema.sql` → Run.  
3. En `.env`:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJ...   # service_role
```

---

## Despliegue en Vercel

1. Sube el repo a GitHub.  
2. Importa en Vercel y define las variables de entorno.  
3. El cron diario (lun–vie 09:00 UTC) está en `vercel.json` → `GET /api/cron`.

---

## Variables de entorno

| Variable | Descripción |
|----------|-------------|
| `MERCADOPUBLICO_TICKET` | Ticket API ChileCompra (**obligatorio**) |
| `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` | Opcional |
| `DIAS_HACIA_ATRAS` | Días a escanear (default 5) |
| `ENRIQUECER_DETALLE` | `1` pide ficha completa si falta descripción |
| `NOTIFY_WEBHOOK_URL` | Webhook de alertas |
| `NOTIFY_EMAIL` | Email en el payload del webhook |
| `CRON_SECRET` | Protege `/api/cron` en Vercel |
| `PORT` | Puerto local (default 3000) |

---

## API

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/status` | Estado del sistema |
| GET | `/api/licitaciones` | Listado con filtros |
| GET | `/api/licitaciones/:codigo` | Detalle (marca vista) |
| POST | `/api/licitaciones/:codigo/favorito` | Favorito |
| POST | `/api/buscar` | Búsqueda manual |
| GET | `/api/cron` | Búsqueda automática |
| GET/PUT | `/api/config` | Keywords |
| GET | `/api/notificaciones` | Inbox de alertas |
| GET | `/api/stats` | KPIs |
| GET | `/api/logs` | Historial |

---

## Estructura

```
api/[[...slug]].js     API (Express + serverless)
public/                Frontend (HTML/CSS/JS)
src/
  buscador.js          Orquesta API → matcher → storage → notifs
  matcher/             Keywords ProgramBI + scoring
  services/            Mercado Público + webhooks
  store/db.js          Local JSON o Supabase
  server.js            Dev local
supabase_schema.sql
```

---

## Licencia

MIT · ProgramBI
