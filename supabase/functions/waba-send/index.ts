/**
 * Edge Function: waba-send
 * ─────────────────────────────────────────────────────────────────────────────
 * Envia mensagens WhatsApp via Meta Cloud API (WhatsApp Business API oficial).
 * O token de acesso é lido do banco via service_role — NUNCA sai para o frontend.
 *
 * Deploy:
 *   supabase functions deploy waba-send --no-verify-jwt
 *
 * Variáveis de ambiente (Supabase Dashboard → Project Settings → Edge Functions):
 *   SUPABASE_URL              → https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY → chave service_role
 *   META_API_VERSION          → ex: v19.0  (padrão: v19.0)
 *
 * Tipos de mensagem suportados:
 *   confirmacao  → confirmação de agendamento para o cliente
 *   lembrete     → lembrete de agendamento
 *   test         → mensagem de teste livre
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, apikey, Authorization",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Sanitiza strings para uso em mensagens ────────────────────────────────────
function safe(s: unknown): string {
  if (typeof s !== "string") return "";
  return s.replace(/[<>&"']/g, "").substring(0, 200).trim();
}

// ── Monta o texto da mensagem conforme o tipo ─────────────────────────────────
function buildMessageText(type: string, data: Record<string, string>): string {
  const shopName    = safe(data.shop_name)    || "Barbearia";
  const clientName  = safe(data.client_name)  || "Cliente";
  const barberName  = safe(data.barber_name)  || "-";
  const serviceName = safe(data.service_name) || "-";
  const date        = safe(data.date)         || "-";
  const time        = safe(data.time)         || "-";
  const price       = safe(data.price)        || "0";
  const deposit     = parseFloat(data.deposit || "0");
  const sinalInfo   = deposit > 0 ? `\n💳 Sinal pago: R$${deposit.toFixed(2)} (abatido no dia)` : "";

  if (type === "confirmacao") {
    return (
      `✅ *Agendamento Confirmado!*\n\n` +
      `✂️ *${shopName}*\n\n` +
      `👤 *Cliente:* ${clientName}\n` +
      `💈 *Barbeiro:* ${barberName}\n` +
      `🎯 *Serviço:* ${serviceName}\n` +
      `📅 *Data:* ${date}\n` +
      `⏰ *Horário:* ${time}\n` +
      `💰 *Valor:* R$${price}` +
      sinalInfo +
      `\n\nReagendamento gratuito até 24h antes. Até logo! 😊`
    );
  }

  if (type === "lembrete") {
    return (
      `🔔 *Lembrete de Agendamento!*\n\n` +
      `✂️ *${shopName}*\n\n` +
      `💈 *Barbeiro:* ${barberName}\n` +
      `🎯 *Serviço:* ${serviceName}\n` +
      `📅 *Data:* ${date}\n` +
      `⏰ *Horário:* ${time}` +
      sinalInfo +
      `\n\nAguardamos você! 😊`
    );
  }

  // type === "test" ou qualquer outro
  return safe(data.message) || `Olá ${clientName}! Teste do sistema WhatsApp Business — tudo certo! ✅`;
}

// ── Valida número E.164 ───────────────────────────────────────────────────────
function isValidE164(phone: string): boolean {
  return /^\d{12,15}$/.test(phone);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL  = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const META_VERSION  = Deno.env.get("META_API_VERSION") || "v19.0";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[waba-send] Variáveis de ambiente ausentes");
    return json({ error: "Server misconfiguration" }, 500);
  }

  // ── Parse do body ──────────────────────────────────────────────────────────
  let body: Record<string, string>;
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { shop_id, to, type } = body;

  // ── Validações básicas de entrada ──────────────────────────────────────────
  if (!shop_id || typeof shop_id !== "string" || shop_id.length < 10)
    return json({ error: "shop_id inválido" }, 400);

  const toClean = (to || "").replace(/\D/g, "");
  if (!isValidE164(toClean))
    return json({ error: "Número de destino inválido. Use DDI+DDD+número (12-15 dígitos)" }, 400);

  const allowedTypes = ["confirmacao", "lembrete", "test"];
  if (!type || !allowedTypes.includes(type))
    return json({ error: `Tipo inválido. Use: ${allowedTypes.join(", ")}` }, 400);

  // ── Busca credenciais WABA do banco (service_role) ─────────────────────────
  const supaAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

  const { data: shop, error: shopErr } = await supaAdmin
    .from("barbershops")
    .select("id, status, waba_configured, waba_token, waba_phone_number_id")
    .eq("id", shop_id)
    .single();

  if (shopErr || !shop) {
    console.error("[waba-send] Barbearia não encontrada:", shopErr?.message);
    return json({ error: "Barbearia não encontrada" }, 404);
  }
  if (shop.status === "blocked") return json({ error: "Barbearia bloqueada" }, 403);
  if (!shop.waba_configured)     return json({ error: "WhatsApp Business não configurado para esta barbearia" }, 400);
  if (!shop.waba_token || !shop.waba_phone_number_id) {
    return json({ error: "Credenciais WABA incompletas. Reconfigure no painel." }, 400);
  }

  // ── Monta o payload da Meta Cloud API ─────────────────────────────────────
  const messageText = buildMessageText(type, body);
  const metaPayload = {
    messaging_product: "whatsapp",
    recipient_type:    "individual",
    to:                toClean,
    type:              "text",
    text:              { preview_url: false, body: messageText },
  };

  const metaUrl = `https://graph.facebook.com/${META_VERSION}/${shop.waba_phone_number_id}/messages`;

  // ── Envia para a Meta Cloud API ────────────────────────────────────────────
  let metaResp: Response;
  try {
    metaResp = await fetch(metaUrl, {
      method:  "POST",
      headers: {
        "Authorization": `Bearer ${shop.waba_token}`,
        "Content-Type":  "application/json",
      },
      body: JSON.stringify(metaPayload),
    });
  } catch (fetchErr) {
    console.error("[waba-send] Erro de rede ao chamar Meta API:", fetchErr);
    return json({ error: "Erro de rede ao contatar Meta API. Tente novamente." }, 502);
  }

  const metaBody = await metaResp.json().catch(() => ({}));

  // ── Trata resposta da Meta ─────────────────────────────────────────────────
  if (!metaResp.ok) {
    const errMsg = metaBody?.error?.message || metaBody?.error_description || JSON.stringify(metaBody);
    const errCode = metaBody?.error?.code || metaResp.status;
    console.error(`[waba-send] Erro Meta API — shop ${shop_id.slice(0, 8)}*** | code ${errCode}: ${errMsg}`);

    // Erros comuns e mensagens amigáveis
    if (errCode === 190)  return json({ error: "Token Meta expirado ou inválido. Regenere no Meta Business Suite." }, 401);
    if (errCode === 131030) return json({ error: "Número destinatário não aceita mensagens (não é WhatsApp)." }, 400);
    if (errCode === 131047) return json({ error: "Limite de mensagens atingido para este número hoje." }, 429);

    return json({ error: `Meta API: ${errMsg} (código ${errCode})` }, metaResp.status);
  }

  const messageId = metaBody?.messages?.[0]?.id || "desconhecido";
  console.log(`[waba-send] OK — shop ${shop_id.slice(0, 8)}*** → ${toClean.slice(0, 6)}*** | type=${type} | msgId=${messageId}`);

  return json({ ok: true, message_id: messageId, type });
});
