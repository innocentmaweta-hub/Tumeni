import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const appUrl = "https://tumeni.vercel.app/";

function redirectPage(message: string, txRef: string) {
  const safeMessage = message.replace(/[<>&"]/g, "");
  const safeTxRef = txRef.replace(/[^a-zA-Z0-9._-]/g, "");
  const target = appUrl + "?payment=complete&tx_ref=" + encodeURIComponent(safeTxRef);

  return new Response(
    "<!doctype html><html><head><meta charset=\"utf-8\"><meta http-equiv=\"refresh\" content=\"1;url=" +
      target +
      "\"><title>Tumeni payment</title></head><body><p>" +
      safeMessage +
      "</p><p>Returning to Tumeni…</p><script>window.location.replace(" +
      JSON.stringify(target) +
      ")</script></body></html>",
    {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" }
    }
  );
}

Deno.serve(async (req) => {
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const paychanguSecret = Deno.env.get("PAYCHANGU_SECRET_KEY");

    if (!paychanguSecret) {
      return redirectPage("Payment verification is not configured.", "");
    }

    const url = new URL(req.url);
    let body: Record<string, unknown> = {};

    if (req.method === "POST") {
      const contentType = req.headers.get("content-type") || "";

      if (contentType.includes("application/json")) {
        body = await req.json();
      } else {
        const form = await req.formData();
        for (const [key, value] of form.entries()) {
          body[key] = String(value);
        }
      }
    }

    const txRef = String(
      body?.tx_ref || url.searchParams.get("tx_ref") || ""
    ).trim();
    const callbackStatus = String(
      body?.status || url.searchParams.get("status") || ""
    ).trim().toLowerCase();

    if (!txRef) {
      return redirectPage(
        "Payment response received. Returning to Tumeni.",
        ""
      );
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: payment, error: paymentLookupError } = await admin
      .from("payments")
      .select("id,order_id,amount,currency,status")
      .eq("provider", "paychangu")
      .eq("provider_reference", txRef)
      .maybeSingle();

    if (paymentLookupError || !payment) {
      return redirectPage(
        "We received the payment response and will verify it.",
        txRef
      );
    }

    const verifyResponse = await fetch(
      "https://api.paychangu.com/verify-payment/" +
        encodeURIComponent(txRef),
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + paychanguSecret
        }
      }
    );

    const verification = await verifyResponse.json();
    const verifiedStatus = String(
      verification?.status || ""
    ).toLowerCase();
    const dataStatus = String(
      verification?.data?.status || ""
    ).toLowerCase();
    const verifiedAmount = Number(verification?.data?.amount);
    const verifiedCurrency = String(
      verification?.data?.currency || ""
    ).toUpperCase();

    const successful =
      verifyResponse.ok &&
      verifiedStatus === "success" &&
      dataStatus === "success" &&
      verifiedAmount >= Number(payment.amount) &&
      (!verifiedCurrency ||
        verifiedCurrency === String(payment.currency).toUpperCase());

    await admin
      .from("payments")
      .update({
        status: successful
          ? "success"
          : dataStatus || callbackStatus || "failed",
        raw_response: verification
      })
      .eq("id", payment.id);

    if (successful) {
      const { data: order, error: orderLookupError } = await admin
        .from("orders")
        .select("id,status")
        .eq("id", payment.order_id)
        .maybeSingle();

      if (orderLookupError) throw orderLookupError;

      if (order?.status === "pending_payment") {
        const { error: orderError } = await admin
          .from("orders")
          .update({
            status: "paid",
            payment_reference:
              String(verification?.data?.reference || "").trim() || txRef
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

      return redirectPage(
        "Payment confirmed. Returning to Tumeni.",
        txRef
      );
    }

    return redirectPage(
      "Payment was not confirmed. Returning to Tumeni.",
      txRef
    );
  } catch (_error) {
    return redirectPage(
      "We could not confirm the payment yet. Returning to Tumeni.",
      ""
    );
  }
});
