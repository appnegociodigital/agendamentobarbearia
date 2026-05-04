import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }

  try {
    const { order_id } = await req.json();

    if (!order_id) {
      return new Response(JSON.stringify({ error: "order_id é obrigatório" }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const PAGBANK_TOKEN = Deno.env.get("PAGBANK_TOKEN");

    if (!PAGBANK_TOKEN) {
      return new Response(JSON.stringify({ error: "Token PagBank não configurado" }), {
        status: 500,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const response = await fetch(`https://api.pagseguro.com/orders/${order_id}`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${PAGBANK_TOKEN}`,
        "x-api-version": "4.0",
      },
    });

    const data = await response.json();

    if (!response.ok) {
      return new Response(JSON.stringify({ error: "Erro ao consultar PIX", details: data }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    const charge = data.charges?.[0];
    const paid = charge?.status === "PAID";

    return new Response(JSON.stringify({
      paid,
      status: charge?.status,
      order_id: data.id,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: "Erro interno", details: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
