# LunaGlow Customer Service API

API de service client intelligent utilisant LangChain et Hono pour répondre aux questions des clients basées sur le document PDF LunaGlow.

## Installation

```bash
npm install
```

## Configuration

Créez un fichier `.env` à la racine du projet :

```bash
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your_api_key_here
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
AZURE_OPENAI_API_VERSION=2024-12-01-preview
PORT=3000
```

## Utilisation

### Lancer le serveur API en développement

```bash
npm run dev
# ou
npm start
```

Le serveur démarre sur `http://localhost:3000`

### Lancer l'agent en ligne de commande

```bash
npm run agent
```

## API Endpoints

### Health Check
```bash
GET /health
GET /api/health
```

### Chat
```bash
POST /api/chat
POST /chat
```

Body:
```json
{
  "message": "Quels sont vos produits?",
  "sessionId": "optional-session-id"
}
```

### Clear Session
```bash
POST /api/chat/clear
POST /chat/clear
```

Body:
```json
{
  "sessionId": "session-id-to-clear"
}
```

### Exemple rapide

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Quels sont vos produits?"}'
```

## Déploiement sur Vercel

Le projet est configuré pour être déployé sur Vercel. L'API est dans `api/index.js` et sera automatiquement déployée comme fonction serverless.

```bash
vercel deploy
```

## Rate Limiting

L'API inclut un système de rate limiting pour protéger contre les abus :
- 50 requêtes par session
- 10 requêtes par minute par IP
- 100 requêtes par heure par IP
- 100 requêtes par minute globalement


