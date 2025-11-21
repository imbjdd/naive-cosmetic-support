import app from "./api/index.js";
import { serve } from "@hono/node-server";

const PORT = process.env.PORT || 3000;

console.log(`🚀 LunaGlow API Server running on http://localhost:${PORT}`);
console.log(`\n📋 Endpoints:`);
console.log(`   GET  /health - Health check`);
console.log(`   GET  /api/health - Health check`);
console.log(`   POST /api/chat - Send a message`);
console.log(`   POST /chat - Send a message`);
console.log(`   POST /api/chat/clear - Clear a session`);
console.log(`   POST /chat/clear - Clear a session\n`);

serve({
  fetch: app.fetch,
  port: PORT,
});

