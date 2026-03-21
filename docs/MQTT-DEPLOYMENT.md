# MQTT for production (Vercel frontend + Render backend)

## Important: where MQTT runs

| Piece | Role |
|--------|------|
| **https://inventory-brown-beta.vercel.app** | React UI only. It does **not** connect to MQTT in the current design. |
| **Render (FastAPI)** | When users use the app, the browser calls **your API** → the **backend** publishes MQTT messages. |
| **MQTT broker** | A **separate** service (cloud or VPS). Vercel does not host brokers. |

So: **you do not “enable MQTT on Vercel.”** You enable MQTT on **Render** and point it at a **broker URL** that Render can reach over the internet.

---

## Step 1 — Choose a broker (pick one)

**Managed (easiest for production)**

- [HiveMQ Cloud](https://www.hivemq.com/mqtt-cloud-broker/) — free tier, TLS, username/password  
- [EMQX Cloud](https://www.emqx.com/en/cloud)  
- [AWS IoT Core](https://aws.amazon.com/iot-core/) — if you already use AWS  

**Self-hosted**

- Mosquitto on a small VPS/DigitalOcean with TLS + password file  
- **Not** the same machine requirement as “must be on Vercel” — only must be reachable from **Render’s outbound IP** (almost any public broker is fine).

From the broker dashboard, copy:

- **Host** (e.g. `xxxx.s1.eu.hivemq.cloud`)  
- **Port** — often **8883** for TLS, **1883** for plain (avoid plain on public internet)  
- **Username / password** (if required)  
- Whether you need a **CA bundle** (HiveMQ often uses system CAs — `MQTT_USE_TLS=true` without custom CA is enough in many cases)

---

## Step 2 — Configure Render (backend)

1. Open [Render Dashboard](https://dashboard.render.com) → your **FastAPI** service (`sierlab-inventory-backend` or similar).  
2. **Environment** → add/update:

```env
MQTT_ENABLED=true
MQTT_BROKER_HOST=<broker-host-from-dashboard>
MQTT_BROKER_PORT=8883
MQTT_USE_TLS=true
MQTT_USERNAME=<broker-username>
MQTT_PASSWORD=<broker-password>
MQTT_TOPIC_PREFIX=searlab/inventory
MQTT_QOS=1
```

3. **Do not** set `MQTT_TLS_INSECURE=true` in production (only for broken lab certs).  
4. If the broker gives you a custom CA file, host it or use Render secret file — set `MQTT_TLS_CA_PATH` if your code is extended to read from disk; today the app uses **system CA store** when `MQTT_TLS_CA_PATH` is empty (works for HiveMQ and most public brokers).

5. **Save** → Render will redeploy.

---

## Step 3 — Verify

After deploy, open (replace with your Render URL):

```text
https://<your-render-service>.onrender.com/health
```

You should see something like:

```json
{
  "status": "ok",
  "mqtt": {
    "enabled": true,
    "connected": true,
    "prefix": "searlab/inventory"
  }
}
```

- If `"connected": false` → broker host/port/TLS/auth wrong or broker blocks Render (firewall / IP allowlist).  
- If MQTT section missing → `MQTT_ENABLED` is not `true`.

---

## Step 4 — Test an event

1. Log in at **https://inventory-brown-beta.vercel.app** (so traffic hits your API).  
2. Do a **stock in** or **transfer** (or create an item).  
3. On your MQTT subscriber (MQTT Explorer, `mosquitto_sub`, or a script), subscribe to:

```text
searlab/inventory/#
```

You should see JSON messages for `inventory.stock_in`, `item.created`, etc. (see [MQTT.md](./MQTT.md)).

---

## Vercel checklist (nothing MQTT-specific)

Ensure the frontend still points at your Render API (`VITE_API_URL` at build time, or your Vercel rewrite/proxy). If the API URL is wrong, **no** requests hit Render → **no** MQTT publishes.

---

## Optional later: live dashboard in the browser

That would mean **MQTT over WebSockets** from the browser + broker WebSocket port + auth — **not** implemented in this repo today. The scalable pattern is: backend publishes MQTT → **small worker or cloud function** subscribes and pushes to **WebSockets/SSE** or **Firebase/Ably**, or you use **only** polling/refresh on the dashboard.

---

## Summary

1. Create/use a **cloud MQTT broker**.  
2. Set **Render** env vars (`MQTT_ENABLED=true`, host, port, TLS, user, pass).  
3. Confirm **`/health`** → `mqtt.connected: true`.  
4. Use the **Vercel app** normally; MQTT fires from **Render** on each API write.

You cannot complete broker signup or Render dashboard clicks from this chat — follow the steps above on your accounts.

---

## Render + EMQX Cloud (this repo)

If you use **EMQX Serverless**, typical values are:

| Variable | Value |
|----------|--------|
| `MQTT_BROKER_HOST` | From deployment overview (e.g. `*.emqxsl.com`) |
| `MQTT_BROKER_PORT` | `8883` |
| `MQTT_USE_TLS` | `true` |
| `MQTT_USERNAME` | EMQX **App ID** |
| `MQTT_PASSWORD` | EMQX **App Secret** (set only in Render **Environment** or `.env` — never commit) |

**Browser / WebSocket** (future live UI): `wss://<same-host>:8084/mqtt` with [MQTT.js](https://github.com/mqttjs/MQTT.js) — see [EMQX WebSocket guide](https://www.emqx.com/en/blog/connect-to-mqtt-broker-with-websocket).

`render.yaml` enables MQTT and sets the public host; **`MQTT_PASSWORD` must be added in the Render dashboard** (`sync: false`) so the secret is not stored in Git.

---

## Render CLI (what it can / cannot do)

The official [Render CLI](https://render.com/docs/cli) can **list services**, **tail logs**, **trigger deploys**, etc. It does **not** provide a command to set environment variables — use the **Dashboard → Environment** or the [Render REST API](https://render.com/docs/api) with an API key (`Authorization: Bearer …`).

View recent MQTT-related logs for this project’s backend (replace with your service id from `render services -o json`):

```bash
render logs -r srv-d6tniama2pns738u7hlg --limit 100 -o text --text MQTT
```

---

## EMQX Cloud Serverless: `Not authorized` / `mqtt.connected: false`

If logs show **`MQTT connect not accepted: Not authorized`**:

1. **Register MQTT users in EMQX** (required for Serverless):  
   Console → your deployment → **Access Control → Authentication** → **+ Add**.  
   Enter the **same** username and password you use in Render (`MQTT_USERNAME` / `MQTT_PASSWORD`).  
   The overview “App ID / App Secret” are **not** automatically MQTT login credentials unless you **add** that pair here (or use the exact user you created).  
   See [Create a Serverless Deployment](https://docs.emqx.com/en/cloud/latest/create/serverless.html) → *Connect to Serverless Deployment Using MQTTX*.

2. **TLS + SNI**: Use the **deployment hostname** as `MQTT_BROKER_HOST` (not an IP). Port **8883**, `MQTT_USE_TLS=true`. Missing SNI can yield auth failure (`0x5`) on Serverless — see [EMQX FAQ](https://docs.emqx.com/en/cloud/latest/faq/deploy.html).

3. **Optional**: Download the **CA certificate** from the deployment Overview and set `MQTT_TLS_CA_PATH` to that file path if verification issues appear.

4. **Confirm with MQTTX** using the same host, 8883, TLS, and the username/password from **Authentication**. If MQTTX fails, fix EMQX auth before changing app code.
