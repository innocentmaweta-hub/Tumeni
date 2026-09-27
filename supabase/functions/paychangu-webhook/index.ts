import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = { "Content-Type": "application/json" };

async function hmac(secret: string, body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: cors });
  }

  try {
    const webhookSecret = Deno.env.get("PAYCHANGU_WEBHOOK_SECRET");
    const paychanguSecret = Deno.env.get("PAYCHANGU_SECRET_KEY");
    const raw = await req.text();
    const signature = req.headers.get("Signature") || req.headers.get("signature");

    if (!webhookSecret || !paychanguSecret || !signature) {
      return new Response(JSON.stringify({ error: "Invalid webhook configuration." }), { status: 401, headers: cors });
    }

    const expected = await hmac(webhookSecret, raw);
    if (expected.toLowerCase() !== signature.toLowerCase()) {
      return new Response(JSON.stringify({ error: "Invalid signature." }), { status: 401, headers: cors });
    }

    const event = JSON.parse(raw);
    if (event?.event_type !== "checkout.payment") {
      return new Response(JSON.stringify({ ok: true, message: "Event ignored." }), { status: 200, headers: cors });
    }

    const txRef = String(event?.tx_ref || "").trim();
    const reference = String(event?.reference || "").trim();
    if (!txRef) {
      return new Response(JSON.stringify({ ok: true }), { status: 200, headers: cors });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: payment } = await admin
      .from("payments")
      .select("id,order_id,amount,currency,status")
      .eq("provider", "paychangu")
      .eq("provider_reference", txRef)
      .maybeSingle();

    if (!payment) {
      return new Response(JSON.stringify({ ok: true, message: "Payment not found." }), { status: 200, headers: cors });
    }

    // Verify against PayChangu directly, rather than trusting the webhook body.
    const verifyResponse = await fetch(
      "https://api.paychangu.com/verify-payment/" + encodeURIComponent(txRef),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + paychanguSecret
        }
      }
    );

    const verification = await verifyResponse.json();
    const verifiedStatus = String(verification?.status || "").toLowerCase();
    const dataStatus = String(verification?.data?.status || "").toLowerCase();
    const verifiedAmount = Number(verification?.data?.amount);
    const verifiedCurrency = String(verification?.data?.currency || "").toUpperCase();

    const successful =
      verifyResponse.ok &&
      verifiedStatus === "success" &&
      dataStatus === "success" &&
      verifiedAmount >= Number(payment.amount) &&
      (!verifiedCurrency || verifiedCurrency === String(payment.currency).toUpperCase());

    await admin
      .from("payments")
      .update({
        status: successful ? "success" : (dataStatus || String(event?.status || "failed")),
        raw_response: verification
      })
      .eq("id", payment.id);

    if (successful) {
      const { data: order } = await admin
        .from("orders")
        .select("id,status")
        .eq("id", payment.order_id)
        .maybeSingle();

      if (order?.status === "pending_payment") {
        const { error: orderError } = await admin
          .from("orders")
          .update({
            status: "paid",
            payment_reference: reference || txRef
          })
          .eq("id", payment.order_id);

        if (orderError) throw orderError;

        await admin.from("order_status_history").insert({
          order_id: payment.order_id,
          status: "paid",
          note: "Payment confirmed by PayChangu.",
          changed_by: null
        });
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      successful,
      tx_ref: txRef
    }), { status: 200, headers: cors });
  } catch (e) {
    return new Response(JSON.stringify({
      error: e instanceof Error ? e.message : "Webhook processing failed."
    }), { status: 500, headers: cors });
  }
});