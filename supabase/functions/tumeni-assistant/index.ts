import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const MAX_MESSAGES = 20;
const MAX_MESSAGE_LENGTH = 4000;
const MAX_PRODUCTS = 20;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}


function cleanSearchText(input: unknown) {
  return String(input || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

function extractBudget(text: string) {
  const match = text.match(
    /(?:under|below|less than|up to|max(?:imum)?(?: of)?|within)\s*(?:mwk|mk|k)?\s*([0-9][0-9,]*(?:\.\d+)?)/i
  );
  if (!match) return null;
  const amount = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : null;
}

function extractSearchTerms(text: string) {
  const stopWords = new Set([
    "i", "need", "want", "looking", "for", "a", "an", "the", "some",
    "please", "find", "get", "buy", "me", "under", "below", "less",
    "than", "up", "to", "maximum", "max", "of", "within", "mwk", "mk",
    "deliver", "delivered", "delivery", "in", "at", "area", "price",
    "cost", "something", "around", "with", "and", "or", "can", "you"
  ]);

  return [...new Set(
    text.split(/\s+/)
      .map(term => term.replace(/^-+|-+$/g, ""))
      .filter(term => term.length >= 2 && !stopWords.has(term))
  )].slice(0, 6);
}

function looksLikeProductRequest(text: string) {
  const lower = text.toLowerCase();
  const taskSignals = [
    "someone to", "person to", "do this for me", "help me do",
    "pick up", "collect something", "clean my", "repair my",
    "wash my", "deliver something", "run an errand", "task"
  ];

  if (taskSignals.some(signal => lower.includes(signal))) return false;

  return [
    "buy", "need", "looking for", "find me", "product", "charger",
    "phone", "laptop", "food", "groceries", "shoes", "dress",
    "electronics", "under mwk", "below mwk"
  ].some(signal => lower.includes(signal));
}

async function searchCatalog(supabase: any, query: string) {
  const cleanQuery = cleanSearchText(query);
  if (!cleanQuery) return [];

  const terms = extractSearchTerms(cleanQuery);
  const budget = extractBudget(cleanQuery);
  const searchParts = terms.length
    ? terms.map(term => \`name.ilike.%\${term}%,description.ilike.%\${term}%\`)
    : [\`name.ilike.%\${cleanQuery}%,description.ilike.%\${cleanQuery}%\`];

  const { data, error } = await supabase
    .from("products")
    .select("id,name,description,price,image_url,category_id,shop_id,shops(name),categories(name)")
    .eq("available", true)
    .or(searchParts.join(","))
    .order("created_at", { ascending: false })
    .limit(60);

  if (error) throw error;

  const phrase = cleanQuery;
  return (data || [])
    .map((product: any) => {
      const haystack = [
        product.name,
        product.description,
        product.categories?.name,
        product.shops?.name
      ].filter(Boolean).join(" ").toLowerCase();

      let score = 0;
      if (haystack.includes(phrase)) score += 100;

      for (const term of terms) {
        if (String(product.name || "").toLowerCase().includes(term)) score += 20;
        else if (haystack.includes(term)) score += 8;
      }

      const price = Number(product.price || 0);
      const withinBudget = budget === null ? null : price <= budget;
      if (withinBudget === true) score += 35;
      if (withinBudget === false) score -= Math.min(40, ((price - budget) / Math.max(budget, 1)) * 40);

      return {
        id: product.id,
        name: product.name,
        description: product.description || "",
        price,
        image_url: product.image_url || null,
        shop: product.shops?.name || "admin product",
        category: product.categories?.name || null,
        within_budget: withinBudget,
        score
      };
    })
    .filter((product: any) => budget === null || product.within_budget)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, MAX_PRODUCTS);
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

    if (body?.action === "search_products") {
      const query = String(body?.query || "").trim();
      if (!query) return json({ error: "Enter a product search." }, 400);

      const products = await searchCatalog(supabase, query);
      return json({
        assistant_name: "Yaza AI",
        action: "search_products",
        query,
        products
      });
    }

    const messages = cleanMessages(body?.messages);
    const latestUserMessage =
      [...messages].reverse().find(message => message.role === "user")?.content || "";

    let catalogProducts: any[] = [];
    if (body?.include_catalog !== false && looksLikeProductRequest(latestUserMessage)) {
      catalogProducts = await searchCatalog(supabase, latestUserMessage);
    }

    const catalogContext = catalogProducts.length
      ? [
          "",
          "LIVE TUMENI CATALOG RESULTS:",
          JSON.stringify(catalogProducts),
          "Only use these catalog results for product facts. If there are no suitable results, say so rather than inventing products."
        ].join("\n")
      : "";

    const systemPrompt = [
      "You are Yaza AI, the customer-facing AI assistant for Tumeni.",
      "Help users search Tumeni products, understand products, interpret task/service requests, explain Tumeni processes, answer customer questions, and make useful recommendations.",
      "Do not claim that you searched the live catalog unless catalog data was explicitly supplied to you.",
      "Do not invent product availability, prices, delivery fees, delivery times, order status, seller information, or policies.",
      "If the user asks for a purchase, payment, refund, transfer, wallet action, or any other financial action, explain that you can help them understand or prepare the request, but the actual financial action must go through Tumeni's normal confirmation and payment flow.",
      "Never ask for or expose passwords, payment PINs, card security codes, secret keys, or authentication tokens.",
      "For product requests, extract useful constraints such as product type, budget, location, preferred category, quantity, and other requirements.",
      "A delivery location is a fulfillment constraint, not proof that a product is available in that area.\n      For task/service requests such as asking someone to buy groceries, distinguish the task from a normal product search and identify the information Tumeni would need to quote or fulfill it.",
      "If a product request has no suitable live catalog result, explain that no matching product was found and ask whether the user wants broader criteria.\n      Be concise, practical, and clear. Ask only the most useful follow-up question when important information is missing.\n      catalogContext,",
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
      assistant_name: "Yaza AI",
      reply: outputText,
      provider,
      model,
      user_id: userData.user.id,
      catalog_products: catalogProducts,
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Could not process the assistant request.",
    }, 400);
  }
});
