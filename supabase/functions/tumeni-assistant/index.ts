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
    "someone to", "person to", "do this for me", "help me do", "buy groceries for me", "shop for me", "buy it for me",
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

function looksLikeTaskRequest(text: string) {
  const lower = text.toLowerCase();
  return [
    "someone to", "person to", "do this for me", "help me do",
    "buy groceries for me", "shop for me", "buy it for me",
    "pick up", "collect", "clean my", "repair my", "wash my",
    "run an errand", "task", "service", "deliver something"
  ].some(signal => lower.includes(signal));
}

function extractLocation(text: string) {
  const match = text.match(/\b(?:in|at|to|from|around|near)\s+([a-z][a-z0-9]*(?:\s+[a-z][a-z0-9]*){0,3})/i);
  return match ? match[1].trim() : null;
}

function extractTaskItems(text: string) {
  const match = text.match(/(?:buy|get|shop for|purchase)\s+(.+?)(?:\s+(?:in|at|to|from|under|below|for me)\b|$)/i);
  if (!match) return [];
  return match[1].split(/,\s*|\s+and\s+/i).map(item => item.trim()).filter(item => item.length >= 2).slice(0, 10);
}

function interpretTaskRequest(text: string) {
  const raw = String(text || "").trim().slice(0, MAX_MESSAGE_LENGTH);
  const lower = raw.toLowerCase();
  let taskType = "general_task";
  if (/(buy|shop|get|purchase).*(groceries|food|items)/i.test(raw)) taskType = "shopping_task";
  else if (/(pick up|collect|fetch)/i.test(raw)) taskType = "pickup_task";
  else if (/(deliver|drop off|take .* to)/i.test(raw)) taskType = "delivery_task";
  else if (/(repair|fix|service)/i.test(raw)) taskType = "repair_or_service";
  else if (/(clean|wash|laundry)/i.test(raw)) taskType = "cleaning_task";

  const location = extractLocation(raw);
  const budget = extractBudget(raw);
  const items = extractTaskItems(raw);
  const missingInfo = [];
  if (!location) missingInfo.push("delivery_or_task_location");
  if (taskType === "shopping_task" && !items.length) missingInfo.push("items_to_buy");
  if (taskType === "general_task") missingInfo.push("specific_task");

  return {
    task_type: taskType,
    description: raw,
    items,
    location,
    budget_mwk: budget,
    urgency: /(urgent|asap|immediately|today|now)/i.test(lower) ? "urgent" : "normal",
    missing_information: missingInfo,
    ready_for_quote: missingInfo.length === 0
  };
}


async function getCustomerContext(supabase: any, userId: string) {
  const [{ data: profile }, { data: orders }] = await Promise.all([
    supabase.from("profiles").select("full_name").eq("id", userId).maybeSingle(),
    supabase
      .from("orders")
      .select("order_number,order_type,status,total,created_at,task_description")
      .eq("customer_id", userId)
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  return {
    name: profile?.full_name || null,
    recent_orders: (orders || []).map((order: any) => ({
      order_number: order.order_number,
      type: order.order_type,
      status: order.status,
      total: Number(order.total || 0),
      created_at: order.created_at,
      task_description: order.task_description || null,
    })),
  };
}

async function searchCatalog(supabase: any, query: string) {
  const rawQuery = String(query || "").trim();
  const budget = extractBudget(rawQuery);

  // A request such as "products under MWK 20,000" is a valid catalog
  // request even though it has no specific product keyword. In that case,
  // search the catalog broadly and apply the budget locally.
  const normalizedQuery = cleanSearchText(
    rawQuery
      .replace(/(?:under|below|less than|up to|max(?:imum)?(?: of)?|within)\s*(?:mwk|mk|k)?\s*[0-9][0-9,]*(?:\.\d+)?/gi, "")
      .replace(/\b(?:products?|items?)\b/gi, "")
  );

  const { data, error } = await supabase.rpc("search_products_advanced", {
    p_query: normalizedQuery,
    p_limit: 100,
    p_offset: 0,
  });

  // Yaza must remain usable even if the optional advanced-search RPC is
  // missing, stale in PostgREST's schema cache, or incompatible with an
  // existing Tumeni database.
  let catalog = data || [];
  if (error) {
    console.error("Yaza advanced product search failed; using direct catalog fallback:", error);

    const { data: fallbackProducts, error: fallbackError } = await supabase
      .from("products")
      .select("id,name,description,price,image_url,category_id,shop_id,available,created_at,shops(name),categories(name)")
      .eq("available", true)
      .order("created_at", { ascending: false })
      .limit(100);

    if (fallbackError) {
      console.error("Yaza direct catalog fallback failed:", fallbackError.message);
      return [];
    }

    const term = normalizedQuery.toLowerCase();
    catalog = (fallbackProducts || [])
      .filter((product: any) => {
        const shop = product.shops?.name || "";
        const category = product.categories?.name || "";
        const haystack = [
          product.name,
          product.description,
          shop,
          category,
        ].map(value => String(value || "").toLowerCase());

        return !term || haystack.some(value => value.includes(term));
      })
      .map((product: any) => ({
        id: product.id,
        name: product.name,
        description: product.description || "",
        price: Number(product.price || 0),
        image_url: product.image_url || null,
        shop: product.shops?.name || "admin product",
        category: product.categories?.name || null,
        rating: 0,
        relevance: 0,
      }));
  }

  return (catalog || [])
    .map((product: any) => {
      const price = Number(product.price || 0);
      const withinBudget = budget === null ? null : price <= budget;
      return {
        id: product.id,
        name: product.name,
        description: product.description || "",
        price,
        image_url: product.image_url || null,
        shop: product.shop || product.shops?.name || "admin product",
        category: product.category || product.categories?.name || null,
        rating: Number(product.rating || 0),
        within_budget: withinBudget,
        score: Number(product.relevance || 0),
      };
    })
    .filter((product: any) => budget === null || product.within_budget)
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
      (provider === "gemini" ? "gemini-2.5-flash" : "google/gemini-2.5-flash");

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


    if (body?.action === "interpret_task") {
      const request = String(body?.request || "").trim();
      if (!request) return json({ error: "Enter the task request." }, 400);
      if (!looksLikeTaskRequest(request)) {
        return json({
          assistant_name: "Yaza AI",
          action: "interpret_task",
          task: {
            task_type: "not_clearly_a_task",
            description: request,
            items: [],
            location: null,
            budget_mwk: null,
            urgency: "normal",
            missing_information: ["clarify_whether_this_is_a_task_or_product_request"],
            ready_for_quote: false
          }
        });
      }
      return json({
        assistant_name: "Yaza AI",
        action: "interpret_task",
        task: interpretTaskRequest(request)
      });
    }

    const messages = cleanMessages(body?.messages);
    const customerContext = await getCustomerContext(supabase, userData.user.id);
    const latestUserMessage =
      [...messages].reverse().find(message => message.role === "user")?.content || "";

    let catalogProducts: any[] = [];
    if (body?.include_catalog !== false && looksLikeProductRequest(latestUserMessage)) {
      catalogProducts = await searchCatalog(supabase, latestUserMessage);
    }

    const customerContextText = [
      "",
      "PRIVATE CUSTOMER CONTEXT (use only to help this authenticated customer; never expose internal IDs or secrets):",
      JSON.stringify(customerContext),
      "Use recent order data only when it directly answers the customer's question. If no matching order is present, say that you cannot confirm it from the available context."
    ].join("\n");

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
      "When a user asks Tumeni to perform a task, identify the task itself, items involved, location, budget, urgency, and missing information. Do not treat a task request as a normal product purchase unless the user clearly wants to purchase an existing catalog product.",
      "Do not claim that you searched the live catalog unless catalog data was explicitly supplied to you.",
      "Do not invent product availability, prices, delivery fees, delivery times, order status, seller information, or policies.",
      "If the user asks for a purchase, payment, refund, transfer, wallet action, or any other financial action, explain that you can help them understand or prepare the request, but the actual financial action must go through Tumeni's normal confirmation and payment flow.",
      "Never ask for or expose passwords, payment PINs, card security codes, secret keys, or authentication tokens.",
      "For product requests, extract useful constraints such as product type, budget, location, preferred category, quantity, and other requirements.",
      "A delivery location is a fulfillment constraint, not proof that a product is available in that area.",
      "For task/service requests such as asking someone to buy groceries, distinguish the task from a normal product search and identify the information Tumeni would need to quote or fulfill it.",
      "If a product request has no suitable live catalog result, explain that no matching product was found and ask whether the user wants broader criteria.",
      "Be concise, practical, and clear. Ask only the most useful follow-up question when important information is missing.",
      "For questions about an existing order, use the private recent-order context when available. You may explain the recorded status, but do not claim a delivery time or event that is not present.",
      "For payment questions, explain Tumeni's normal PayChangu checkout flow without claiming payment is successful unless the order context says the status is paid.",
      "For task requests, help the customer turn their request into clear information for Tumeni. Do not silently create, submit, quote, assign, cancel, refund, or pay for an order.",
      "When recommending products, use live catalog results when supplied and clearly distinguish catalog facts from general advice.",
      customerContextText,
      catalogContext,
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

    let result: any = null;
    const rawResponse = await response.text();
    try {
      result = rawResponse ? JSON.parse(rawResponse) : null;
    } catch {
      result = null;
    }

    if (!response.ok) {
      const message =
        result?.error?.message ||
        result?.error?.metadata?.raw ||
        result?.error ||
        rawResponse ||
        `The AI service returned HTTP ${response.status}.`;
      return json({
        error: String(message),
        provider,
        model,
        upstream_status: response.status,
      }, 502);
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
      customer_context_used: Boolean(customerContext.recent_orders.length || customerContext.name),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || "Unknown error");
    const name = error instanceof Error ? error.name : "UnknownError";
    console.error("Yaza AI internal error:", message);
    return json({
      error: "Yaza AI encountered an internal error.",
      internal_error: message.slice(0, 500),
      error_type: name,
    }, 500);
  }
});