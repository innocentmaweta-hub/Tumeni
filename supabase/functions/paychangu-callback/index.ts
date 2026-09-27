import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const appUrl = "https://tumeni.vercel.app/";

function redirectToApp(
  paymentState: "complete" | "failed" | "verification_pending" | "error",
  txRef = ""
) {
  const target = new URL(appUrl);
  target.searchParams.set("payment", paymentState);
  if (txRef) target.searchParams.set("tx_ref", txRef);

  console.log("[paychangu-callback] redirect", {
    paymentState,
    txRef
  });

  return new Response(null, {
    status: 303,
    headers: {
      Location: target.toString(),
      "Cache-Control": "no-store"
    }
  });
}

async function readCallback(req: Request) {
  const url = new URL(req.url);
  const body: Record<string, unknown> = {};

  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/json")) {
      Object.assign(body, await req.json());
    } else {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        body[key] = String(value);
      }
    }
  }

  return {
    body,
    txRef: String(body?.tx_ref || url.searchParams.get("tx_ref") || "").trim(),
    callbackStatus: String(
      body?.status || url.searchParams.get("status") || ""
    ).trim().toLowerCase()
  };
}

Deno.serve(async (req) => {
  let txRef = "";

  try {
    console.log("[paychangu-callback] received", {
      method: req.method,
      url: new URL(req.url).pathname
    });

    if (req.method !== "GET" && req.method !== "POST") {
      console.error("[paychangu-callback] unsupported method", req.method);
      return redirectToApp("error");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const paychanguSecret = Deno.env.get("PAYCHANGU_SECRET_KEY");

    if (!supabaseUrl || !serviceRoleKey || !paychanguSecret) {
      console.error("[paychangu-callback] missing server configuration");
      return redirectToApp("error");
    }

    const callback = await readCallback(req);
    txRef = callback.txRef;

    console.log("[paychangu-callback] callback data", {
      txRef,
      callbackStatus: callback.callbackStatus
    });

    if (!txRef) {
      console.error("[paychangu-callback] missing tx_ref");
      return redirectToApp("error");
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: payment, error: paymentLookupError } = await admin
      .from("payments")
      .select("id,order_id,amount,currency,status")
      .eq("provider", "paychangu")
      .eq("provider_reference", txRef)
      .maybeSingle();

    if (paymentLookupError) {
      console.error("[paychangu-callback] payment lookup failed", {
        txRef,
        error: paymentLookupError.message
      });
      return redirectToApp("verification_pending", txRef);
    }

    if (!payment) {
      console.error("[paychangu-callback] payment record not found", { txRef });
      return redirectToApp("verification_pending", txRef);
    }

    console.log("[paychangu-callback] payment found", {
      txRef,
      paymentId: payment.id,
      orderId: payment.order_id,
      currentPaymentStatus: payment.status
    });

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
      Number.isFinite(verifiedAmount) &&
      verifiedAmount >= Number(payment.amount) &&
      (!verifiedCurrency ||
        verifiedCurrency === String(payment.currency).toUpperCase());

    console.log("[paychangu-callback] verification result", {
      txRef,
      httpOk: verifyResponse.ok,
      verifiedStatus,
      dataStatus,
      verifiedAmount,
      verifiedCurrency,
      successful
    });

    const { error: paymentUpdateError } = await admin
      .from("payments")
      .update({
        status: successful
          ? "success"
          : dataStatus || callback.callbackStatus || "failed",
        raw_response: verification
      })
      .eq("id", payment.id);

    if (paymentUpdateError) {
      console.error("[paychangu-callback] payment update failed", {
        txRef,
        paymentId: payment.id,
        error: paymentUpdateError.message
      });
      throw paymentUpdateError;
    }

    if (!successful) {
      console.warn("[paychangu-callback] payment not confirmed", {
        txRef,
        dataStatus,
        callbackStatus: callback.callbackStatus
      });
      return redirectToApp("failed", txRef);
    }

    const { data: order, error: orderLookupError } = await admin
      .from("orders")
      .select("id,status")
      .eq("id", payment.order_id)
      .maybeSingle();

    if (orderLookupError) {
      console.error("[paychangu-callback] order lookup failed", {
        txRef,
        orderId: payment.order_id,
        error: orderLookupError.message
      });
      throw orderLookupError;
    }

    if (!order) {
      console.error("[paychangu-callback] order not found", {
        txRef,
        orderId: payment.order_id
      });
      return redirectToApp("error", txRef);
    }

    if (order.status === "pending_payment") {
      const paymentReference =
        String(verification?.data?.reference || "").trim() || txRef;

      const { error: orderError } = await admin
        .from("orders")
        .update({
          status: "paid",
          payment_reference: paymentReference
        })
        .eq("id", payment.order_id);

      if (orderError) {
        console.error("[paychangu-callback] order update failed", {
          txRef,
          orderId: payment.order_id,
          error: orderError.message
        });
        throw orderError;
      }

      const { error: historyError } = await admin
        .from("order_status_history")
        .insert({
          order_id: payment.order_id,
          status: "paid",
          note: "Payment confirmed by PayChangu.",
          changed_by: null
        });

      if (historyError) {
        console.error("[paychangu-callback] history insert failed", {
          txRef,
          orderId: payment.order_id,
          error: historyError.message
        });
        throw historyError;
      }

      console.log("[paychangu-callback] order marked paid", {
        txRef,
        orderId: payment.order_id
      });
    } else {
      console.log("[paychangu-callback] order already advanced", {
        txRef,
        orderId: payment.order_id,
        orderStatus: order.status
      });
    }

    return redirectToApp("complete", txRef);
  } catch (error) {
    console.error("[paychangu-callback] unhandled error", {
      txRef,
      error: error instanceof Error ? error.message : String(error)
    });

    return redirectToApp("error", txRef);
  }
});
