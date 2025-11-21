# LunaGlow Customer Service API

API de service client intelligent utilisant LangChain et Bun pour répondre aux questions des clients basées sur le document PDF LunaGlow.

## Installation

```bash
bun install
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

### Lancer le serveur API

```bash
bun run server
# ou
bun run api
```

### Lancer l'agent en ligne de commande

```bash
bun run customer_service_agent.js
```

## API Endpoints

Voir `API.md` pour la documentation complète de l'API.

### Exemple rapide

```bash
curl -X POST http://localhost:3000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Quels sont vos produits?"}'
```

## Rate Limiting

L'API inclut un système de rate limiting pour protéger contre les abus. Voir `API.md` pour plus de détails.


