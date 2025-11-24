import { Hono } from "hono";
import { cors } from "hono/cors";
import { LunaGlowCustomerServiceAgent } from "../customer_service_agent.js";
import { existsSync } from "fs";
import dotenv from "dotenv";

if (existsSync(".env")) {
  dotenv.config();
}

const app = new Hono();

// Configuration CORS
app.use("*", cors({
  origin: "*",
  allowMethods: ["GET", "POST", "OPTIONS", "DELETE"],
  allowHeaders: ["Content-Type", "Authorization"],
}));

const sessions = new Map();

const RATE_LIMIT_CONFIG = {
  MAX_REQUESTS_PER_SESSION: parseInt(process.env.MAX_REQUESTS_PER_SESSION || "1000"),
  MAX_REQUESTS_PER_IP_PER_MINUTE: parseInt(process.env.MAX_REQUESTS_PER_IP_PER_MINUTE || "200"),
  MAX_REQUESTS_PER_IP_PER_HOUR: parseInt(process.env.MAX_REQUESTS_PER_IP_PER_HOUR || "2000"),
  MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH || "2000"),
  GLOBAL_MAX_REQUESTS_PER_MINUTE: parseInt(process.env.GLOBAL_MAX_REQUESTS_PER_MINUTE || "2000"),
};

const rateLimitStore = {
  sessionRequests: new Map(),
  ipRequests: new Map(),
  globalRequests: [],
};

setInterval(() => {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;
  
  for (const [ip, requests] of rateLimitStore.ipRequests.entries()) {
    const filtered = requests.filter(r => r.timestamp > oneHourAgo);
    if (filtered.length === 0) {
      rateLimitStore.ipRequests.delete(ip);
    } else {
      rateLimitStore.ipRequests.set(ip, filtered);
    }
  }
  
  rateLimitStore.globalRequests = rateLimitStore.globalRequests.filter(
    r => r > oneMinuteAgo
  );
}, 60000);

function getClientIP(c) {
  const forwarded = c.req.header("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIP = c.req.header("x-real-ip");
  if (realIP) {
    return realIP;
  }
  return c.req.header("host") || "unknown";
}

function checkRateLimit(sessionId, clientIP) {
  const now = Date.now();
  const oneMinuteAgo = now - 60 * 1000;
  const oneHourAgo = now - 60 * 60 * 1000;
  
  const sessionCount = rateLimitStore.sessionRequests.get(sessionId) || 0;
  if (sessionCount >= RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_SESSION) {
    return {
      allowed: false,
      reason: `Session limit reached. Maximum ${RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_SESSION} requests per session.`,
      limit: RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_SESSION,
      remaining: 0,
    };
  }
  
  const ipRequests = rateLimitStore.ipRequests.get(clientIP) || [];
  const recentMinuteRequests = ipRequests.filter(r => r.timestamp > oneMinuteAgo);
  if (recentMinuteRequests.length >= RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_MINUTE) {
    return {
      allowed: false,
      reason: `Rate limit exceeded. Maximum ${RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_MINUTE} requests per minute per IP.`,
      limit: RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_MINUTE,
      remaining: 0,
    };
  }
  
  const recentHourRequests = ipRequests.filter(r => r.timestamp > oneHourAgo);
  if (recentHourRequests.length >= RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_HOUR) {
    return {
      allowed: false,
      reason: `Rate limit exceeded. Maximum ${RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_HOUR} requests per hour per IP.`,
      limit: RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_HOUR,
      remaining: 0,
    };
  }
  
  const recentGlobalRequests = rateLimitStore.globalRequests.filter(
    r => r > oneMinuteAgo
  );
  if (recentGlobalRequests.length >= RATE_LIMIT_CONFIG.GLOBAL_MAX_REQUESTS_PER_MINUTE) {
    return {
      allowed: false,
      reason: `Global rate limit exceeded. Please try again later.`,
      limit: RATE_LIMIT_CONFIG.GLOBAL_MAX_REQUESTS_PER_MINUTE,
      remaining: 0,
    };
  }
  
  return {
    allowed: true,
    sessionRemaining: RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_SESSION - sessionCount - 1,
    ipMinuteRemaining: RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_MINUTE - recentMinuteRequests.length - 1,
    ipHourRemaining: RATE_LIMIT_CONFIG.MAX_REQUESTS_PER_IP_PER_HOUR - recentHourRequests.length - 1,
  };
}

function recordRequest(sessionId, clientIP) {
  const now = Date.now();
  
  const sessionCount = rateLimitStore.sessionRequests.get(sessionId) || 0;
  rateLimitStore.sessionRequests.set(sessionId, sessionCount + 1);
  
  if (!rateLimitStore.ipRequests.has(clientIP)) {
    rateLimitStore.ipRequests.set(clientIP, []);
  }
  rateLimitStore.ipRequests.get(clientIP).push({ timestamp: now });
  
  rateLimitStore.globalRequests.push(now);
}

async function getOrCreateAgent(sessionId) {
  if (!sessions.has(sessionId)) {
    try {
      const agent = new LunaGlowCustomerServiceAgent();
      await agent.initialize();
      sessions.set(sessionId, agent);
      return agent;
    } catch (error) {
      console.error("Error initializing agent:", error);
      throw error;
    }
  }
  return sessions.get(sessionId);
}

// Health check - retourne immédiatement sans initialisation
app.get("/health", (c) => {
  return c.json({ 
    status: "ok", 
    message: "LunaGlow API is running"
  });
});

app.get("/api/health", (c) => {
  return c.json({ 
    status: "ok", 
    message: "LunaGlow API is running"
  });
});

// Chat endpoint
app.post("/api/chat", async (c) => {
  try {
    const body = await c.req.json();
    const { message, sessionId } = body;

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    if (message.length > RATE_LIMIT_CONFIG.MAX_MESSAGE_LENGTH) {
      return c.json({
        error: `Message too long. Maximum ${RATE_LIMIT_CONFIG.MAX_MESSAGE_LENGTH} characters allowed.`,
      }, 400);
    }

    const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const clientIP = getClientIP(c);

    const rateLimitCheck = checkRateLimit(currentSessionId, clientIP);
    if (!rateLimitCheck.allowed) {
      return c.json({
        error: rateLimitCheck.reason,
        rateLimit: {
          limit: rateLimitCheck.limit,
          remaining: rateLimitCheck.remaining,
        },
      }, 429);
    }

    recordRequest(currentSessionId, clientIP);

    // Initialisation lazy de l'agent uniquement ici
    const agent = await getOrCreateAgent(currentSessionId);
    const result = await agent.ask(message);

    return c.json({
      answer: result.answer,
      sessionId: currentSessionId,
      rateLimit: {
        sessionRemaining: rateLimitCheck.sessionRemaining,
        ipMinuteRemaining: rateLimitCheck.ipMinuteRemaining,
        ipHourRemaining: rateLimitCheck.ipHourRemaining,
      },
    });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return c.json({ 
      error: error.message || "Internal server error",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined
    }, 500);
  }
});

// Alias pour /chat (sans /api)
app.post("/chat", async (c) => {
  try {
    const body = await c.req.json();
    const { message, sessionId } = body;

    if (!message) {
      return c.json({ error: "Message is required" }, 400);
    }

    if (message.length > RATE_LIMIT_CONFIG.MAX_MESSAGE_LENGTH) {
      return c.json({
        error: `Message too long. Maximum ${RATE_LIMIT_CONFIG.MAX_MESSAGE_LENGTH} characters allowed.`,
      }, 400);
    }

    const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const clientIP = getClientIP(c);

    const rateLimitCheck = checkRateLimit(currentSessionId, clientIP);
    if (!rateLimitCheck.allowed) {
      return c.json({
        error: rateLimitCheck.reason,
        rateLimit: {
          limit: rateLimitCheck.limit,
          remaining: rateLimitCheck.remaining,
        },
      }, 429);
    }

    recordRequest(currentSessionId, clientIP);

    const agent = await getOrCreateAgent(currentSessionId);
    const result = await agent.ask(message);

    return c.json({
      answer: result.answer,
      sessionId: currentSessionId,
      rateLimit: {
        sessionRemaining: rateLimitCheck.sessionRemaining,
        ipMinuteRemaining: rateLimitCheck.ipMinuteRemaining,
        ipHourRemaining: rateLimitCheck.ipHourRemaining,
      },
    });
  } catch (error) {
    console.error("Error processing chat request:", error);
    return c.json({ 
      error: error.message || "Internal server error",
      details: process.env.NODE_ENV === "development" ? error.stack : undefined
    }, 500);
  }
});

// Clear session endpoint
app.post("/api/chat/clear", async (c) => {
  try {
    const body = await c.req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return c.json({ error: "Session ID is required" }, 400);
    }

    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      rateLimitStore.sessionRequests.delete(sessionId);
      return c.json({ message: "Session cleared successfully" });
    } else {
      return c.json({ error: "Session not found" }, 404);
    }
  } catch (error) {
    console.error("Error clearing session:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

app.post("/chat/clear", async (c) => {
  try {
    const body = await c.req.json();
    const { sessionId } = body;

    if (!sessionId) {
      return c.json({ error: "Session ID is required" }, 400);
    }

    if (sessions.has(sessionId)) {
      sessions.delete(sessionId);
      rateLimitStore.sessionRequests.delete(sessionId);
      return c.json({ message: "Session cleared successfully" });
    } else {
      return c.json({ error: "Session not found" }, 404);
    }
  } catch (error) {
    console.error("Error clearing session:", error);
    return c.json({ error: error.message || "Internal server error" }, 500);
  }
});

// Export pour Vercel
export default app;
