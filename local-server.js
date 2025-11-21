import handler from "./api/index.js";

const PORT = process.env.PORT || 3000;

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    return await handler(req);
  },
});

console.log(`LunaGlow API Server running on http://localhost:${PORT}`);
console.log(`Endpoints:`);
console.log(`   POST /chat - Send a message`);
console.log(`   POST /chat/clear - Clear a session`);
console.log(`   GET /health - Health check`);

