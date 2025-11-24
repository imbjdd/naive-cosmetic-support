import { serve } from "@hono/node-server";
import { Hono } from "hono";

const app = new Hono();

const PORT = process.env.PORT || 3000;

console.log(`🚀 LunaGlow API Server running on http://localhost:${PORT}`);

app.get("/", (c) => {
    return c.json({ 
        status: "ok", 
        message: "LunaGlow API is running"
    });
});

app.get("/health", (c) => {
    return c.html(`<b>test<\b>`)
});

serve({
  fetch: app.fetch,
  port: PORT,
});

