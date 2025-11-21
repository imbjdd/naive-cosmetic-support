import { LunaGlowCustomerServiceAgent } from "../customer_service_agent.js";
import { existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

import dotenv from "dotenv";
if (existsSync(".env")) {
  dotenv.config();
}

const sessions = new Map();

const RATE_LIMIT_CONFIG = {
  MAX_REQUESTS_PER_SESSION: parseInt(process.env.MAX_REQUESTS_PER_SESSION || "50"),
  MAX_REQUESTS_PER_IP_PER_MINUTE: parseInt(process.env.MAX_REQUESTS_PER_IP_PER_MINUTE || "10"),
  MAX_REQUESTS_PER_IP_PER_HOUR: parseInt(process.env.MAX_REQUESTS_PER_IP_PER_HOUR || "100"),
  MAX_MESSAGE_LENGTH: parseInt(process.env.MAX_MESSAGE_LENGTH || "2000"),
  GLOBAL_MAX_REQUESTS_PER_MINUTE: parseInt(process.env.GLOBAL_MAX_REQUESTS_PER_MINUTE || "100"),
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

function getClientIP(req) {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  const realIP = req.headers.get("x-real-ip");
  if (realIP) {
    return realIP;
  }
  return req.headers.get("host") || "unknown";
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
    const agent = new LunaGlowCustomerServiceAgent();
    await agent.initialize();
    sessions.set(sessionId, agent);
    return agent;
  }
  return sessions.get(sessionId);
}

let agentInitialized = false;

async function ensureAgentInitialized() {
  if (!agentInitialized) {
    try {
      const testAgent = new LunaGlowCustomerServiceAgent();
      await testAgent.initialize();
      agentInitialized = true;
    } catch (error) {
      console.error("Error initializing agent:", error.message);
      throw error;
    }
  }
}

export default async function handler(req) {
  await ensureAgentInitialized();

  const url = new URL(req.url);
  const path = url.pathname;
  const method = req.method;

  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS, DELETE",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };

  if (method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (path === "/api/health" || path === "/health") {
    return new Response(
      JSON.stringify({ status: "ok", message: "LunaGlow API is running" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  if (path === "/api/chat" || path === "/chat") {
    try {
      const body = await req.json();
      const { message, sessionId } = body;

      if (!message) {
        return new Response(
          JSON.stringify({ error: "Message is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (message.length > RATE_LIMIT_CONFIG.MAX_MESSAGE_LENGTH) {
        return new Response(
          JSON.stringify({
            error: `Message too long. Maximum ${RATE_LIMIT_CONFIG.MAX_MESSAGE_LENGTH} characters allowed.`,
          }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const currentSessionId = sessionId || `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

      const clientIP = getClientIP(req);

      const rateLimitCheck = checkRateLimit(currentSessionId, clientIP);
      if (!rateLimitCheck.allowed) {
        return new Response(
          JSON.stringify({
            error: rateLimitCheck.reason,
            rateLimit: {
              limit: rateLimitCheck.limit,
              remaining: rateLimitCheck.remaining,
            },
          }),
          {
            status: 429,
            headers: {
              ...corsHeaders,
              "Content-Type": "application/json",
              "Retry-After": "60",
            },
          }
        );
      }

      recordRequest(currentSessionId, clientIP);

      const agent = await getOrCreateAgent(currentSessionId);

      const result = await agent.ask(message);

      return new Response(
        JSON.stringify({
          answer: result.answer,
          sessionId: currentSessionId,
          rateLimit: {
            sessionRemaining: rateLimitCheck.sessionRemaining,
            ipMinuteRemaining: rateLimitCheck.ipMinuteRemaining,
            ipHourRemaining: rateLimitCheck.ipHourRemaining,
          },
        }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    } catch (error) {
      console.error("Error processing chat request:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Internal server error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  if (path === "/api/chat/clear" || path === "/chat/clear") {
    try {
      const body = await req.json();
      const { sessionId } = body;

      if (!sessionId) {
        return new Response(
          JSON.stringify({ error: "Session ID is required" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (sessions.has(sessionId)) {
        sessions.delete(sessionId);
        rateLimitStore.sessionRequests.delete(sessionId);
        return new Response(
          JSON.stringify({ message: "Session cleared successfully" }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      } else {
        return new Response(
          JSON.stringify({ error: "Session not found" }),
          {
            status: 404,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    } catch (error) {
      console.error("Error clearing session:", error);
      return new Response(
        JSON.stringify({ error: error.message || "Internal server error" }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  return new Response(
    JSON.stringify({ error: "Not found" }),
    {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }
  );
}

