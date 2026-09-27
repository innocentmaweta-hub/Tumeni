// PayChangu hosted checkout
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const paychanguSecret = Deno.env.get("PAYCHANGU_SECRET_KEY");

    if (!paychanguSecret) throw new Error("PAYCHANGU_SECRET_KEY is not configured.");

    const auth = req.headers.get("Authorization");
    if (!auth?.startsWith("Bearer ")) throw new Error("Authentication required.");

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const { data: authData, error: authError } = await admin.auth.getUser(auth.slice(7));
    if (authError || !authData.user) throw new Error("Authentication required.");

    const body = await req.json();
    const orderId = String(body?.order_id || "").trim();
    if (!orderId) throw new Error("Order ID is required.");

    const { data: order, error: orderError } = await admin
      .from("orders")
      .select("id,customer_id,total,status")
      .eq("id", orderId)
      .maybeSingle();

    if (orderError || !order) throw new Error("Order not found.");
    if (order.customer_id !== authData.user.id) throw new Error("You cannot pay for this order.");
    if (order.status !== "pending_payment") throw new Error("This order is no longer awaiting payment.");

    const txRef = "TM_" + order.id.replace(/-/g, "").slice(0, 16) + "_" + Date.now();
    const email = authData.user.email || "customer@tumeni.app";

    const { data: profile } = await admin
      .from("profiles")
      .select("full_name")
      .eq("id", authData.user.id)
      .maybeSingle();

    const name = String(profile?.full_name || authData.user.user_metadata?.full_name || "Tumeni Customer")
      .trim()
      .split(/\s+/);
    const firstName = name[0] || "Tumeni";
    const lastName = name.slice(1).join(" ") || "Customer";

    const returnUrl = "https://tumeni.vercel.app/";

    const payload = {
      amount: String(order.total),
      currency: "MWK",
      email,
      first_name: firstName,
      last_name: lastName,
      callback_url: returnUrl,
      return_url: returnUrl,
      tx_ref: txRef,
      customization: {
        title: "Tumeni",
        description: "Payment for your Tumeni order"
      },
      meta: {
        order_id: order.id,
        source: "tumeni"
      }
    };

    const response = await fetch("https://api.paychangu.com/payment", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + paychanguSecret
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (!response.ok || result?.status !== "success" || !result?.data?.checkout_url) {
      throw new Error(result?.message || "PayChangu could not create the payment checkout.");
    }

    const checkoutUrl = result.data.checkout_url;
    const { error: paymentError } = await admin.from("payments").insert({
      order_id: order.id,
      provider: "paychangu",
      provider_reference: txRef,
      amount: order.total,
      currency: "MWK",
      status: "pending",
      raw_response: result
    });

    if (paymentError) throw paymentError;

    return new Response(JSON.stringify({
      checkout_url: checkoutUrl,
      tx_ref: txRef,
      status: "pending"
    }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Could not initialize payment."
    }), { status: 400, headers: cors });
  }
});
