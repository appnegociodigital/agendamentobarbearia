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
    const { amount, reference_id } = await req.json();

    if (!amount || !reference_id) {
      return new Response(JSON.stringify({ error: "amount e reference_id são obrigatórios" }), {
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

    // Criar cobrança PIX no PagBank
    const pixPayload = {
      reference_id: reference_id,
      description: "Sinal de agendamento",
      amount: {
        value: Math.round(amount * 100), // em centavos
        currency: "BRL",
      },
      payment_method: {
        type: "PIX",
        pix: {
          expiration_date: new Date(Date.now() + 30 * 60 * 1000).toISOString(), // 30 minutos
        },
      },
    };

    const response = await fetch("https://api.pagseguro.com/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${PAGBANK_TOKEN}`,
        "x-api-version": "4.0",
      },
      body: JSON.stringify(pixPayload),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error("Erro PagBank:", JSON.stringify(data));
      return new Response(JSON.stringify({ error: "Erro ao criar PIX", details: data }), {
        status: 400,
        headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
      });
    }

    // Extrair QR Code e chave PIX
    const charge = data.charges?.[0];
    const pixData = charge?.payment_method?.pix;
    const qrCode = pixData?.qr_codes?.[0];

    return new Response(JSON.stringify({
      order_id: data.id,
      charge_id: charge?.id,
      qr_code: qrCode?.text,        // copia e cola
      qr_code_image: qrCode?.links?.find((l: any) => l.media === "image/png")?.href, // imagem QR
      expiration: qrCode?.expiration_date,
      status: charge?.status,
    }), {
      status: 200,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });

  } catch (err) {
    console.error("Erro interno:", err);
    return new Response(JSON.stringify({ error: "Erro interno", details: String(err) }), {
      status: 500,
      headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
    });
  }
});
