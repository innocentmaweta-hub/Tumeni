import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

function cleanMessages(input: unknown) {
  if (!Array.isArray(input)) throw new Error("messages must be an array.");

  const messages = input
    .slice(-MAX_MESSAGES)
    .map((message: any) => ({
      role: message?.role === "assistant" ? "assistant" : "user",
      content: String(message?.content || "").trim().slice(0, MAX_MESSAGE_LENGTH),
    }))
    .filter((message: any) => message.content);

  if (!messages.length) throw new Error("At least one message is required.");
  return messages;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "Authentication is required." }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const provider = (Deno.env.get("AI_PROVIDER") || "openrouter").toLowerCase();
    const openRouterKey = Deno.env.get("OPENROUTER_API_KEY");
    const geminiKey = Deno.env.get("GEMINI_API_KEY");
    const model =
      Deno.env.get("AI_MODEL") ||
      (provider === "gemini" ? "gemini-3.8-flash" : "google/gemini-3.8-flash");

    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error("Supabase function configuration is incomplete.");
    }
    if (!["openrouter", "gemini"].includes(provider)) {
      throw new Error("AI_PROVIDER must be openrouter or gemini.");
    }
    if (provider === "openrouter" && !openRouterKey) {
      throw new Error("OPENROUTER_API_KEY is not configured.");
    }
    if (provider === "gemini" && !geminiKey) {
      throw new Error("GEMINI_API_KEY is not configured.");
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData?.user) {
      return json({ error: "Your session is invalid or expired." }, 401);
    }

    const body = await req.json();
    const messages = cleanMessages(body?.messages);

    const systemPrompt = [
      "You are Tumeni Assistant, a helpful customer-facing assistant for the Tumeni shopping, delivery and task/service platform.",
      "Help users understand products, formulate product searches, interpret task/service requests, explain Tumeni processes, and make useful recommendations.",
      "Do not claim that you searched the live catalog unless catalog data was explicitly supplied to you.",
      "Do not invent product availability, prices, delivery fees, delivery times, order status, seller information, or policies.",
      "If the user asks for a purchase, payment, refund, transfer, wallet action, or any other financial action, explain that you can help them understand or prepare the request, but the actual financial action must go through Tumeni's normal confirmation and payment flow.",
      "Never ask for or expose passwords, payment PINs, card security codes, secret keys, or authentication tokens.",
      "For product requests, extract useful constraints such as product type, budget, location, preferred category, quantity, and other requirements.",
      "For task/service requests, distinguish the task from a product purchase and identify the information Tumeni would need to quote or fulfill it.",
      "Be concise, practical, and clear. Ask only the most useful follow-up question when important information is missing.",
    ].join("\n");

    const baseUrl =
      provider === "gemini"
        ? "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
        : "https://openrouter.ai/api/v1/chat/completions";
    const apiKey = provider === "gemini" ? geminiKey : openRouterKey;

    const response = await fetch(baseUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        ...(provider === "openrouter"
          ? {
              "HTTP-Referer": "https://tumeni.vercel.app",
              "X-OpenRouter-Title": "Tumeni",
            }
          : {}),
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          ...messages,
        ],
        max_tokens: 700,
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      const message =
        result?.error?.message ||
        result?.error ||
        "The AI service could not process the request.";
      return json({ error: String(message) }, response.status >= 500 ? 502 : 400);
    }

    const outputText = String(result?.choices?.[0]?.message?.content || "").trim();
    if (!outputText) return json({ error: "The AI service returned an empty response." }, 502);

    return json({
      reply: outputText,
      provider,
      model,
      user_id: userData.user.id,
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Could not process the assistant request.",
    }, 400);
  }
});
