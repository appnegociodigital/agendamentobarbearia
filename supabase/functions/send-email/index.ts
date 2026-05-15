import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const { to, client_name, barber_name, service_name, date, time, shop_name, type } = await req.json();
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

  const subject = type === "lembrete"
    ? `⏰ Lembrete: seu horário amanhã — ${shop_name}`
    : `✅ Agendamento confirmado — ${shop_name}`;

  const html = `
    <h2>${type === "lembrete" ? "⏰ Lembrete de amanhã!" : "✅ Agendamento Confirmado!"}</h2>
    <p>Olá, <b>${client_name}</b>!</p>
    <p>📅 <b>Data:</b> ${date}</p>
    <p>🕐 <b>Horário:</b> ${time}</p>
    <p>💈 <b>Barbeiro:</b> ${barber_name}</p>
    <p>✂️ <b>Serviço:</b> ${service_name}</p>
    <p>📍 <b>Local:</b> ${shop_name}</p>
  `;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: "onboarding@resend.dev", to, subject, html }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
