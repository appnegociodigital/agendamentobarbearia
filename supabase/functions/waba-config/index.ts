/**
 * Edge Function: waba-config
 * ─────────────────────────────────────────────────────────────────────────────
 * Salva a configuração do WhatsApp Business (Meta Cloud API) para uma barbearia.
 * O token de acesso é armazenado exclusivamente no banco via service_role —
 * NUNCA é exposto no frontend nem no código do cliente.
 *
 * Deploy:
 *   supabase functions deploy waba-config --no-verify-jwt
 *
 * Variáveis de ambiente (Supabase Dashboard → Project Settings → Edge Functions):
 *   SUPABASE_URL              → https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY → chave service_role (não a anon key!)
 *
 * Coluna necessária na tabela barbershops (rode no SQL Editor):
 *   ALTER TABLE barbershops
 *     ADD COLUMN IF NOT EXISTS waba_token            TEXT,
 *     ADD COLUMN IF NOT EXISTS waba_phone_id         TEXT,
 *     ADD COLUMN IF NOT EXISTS waba_phone_number_id  TEXT,
 *     ADD COLUMN IF NOT EXISTS waba_configured       BOOLEAN DEFAULT FALSE;
 *
 *   -- Garante que waba_token NUNCA apareça em SELECTs anon/authenticated:
 *   REVOKE SELECT (waba_token) ON barbershops FROM anon, authenticated;
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

// ── Validações ────────────────────────────────────────────────────────────────
function isValidMetaToken(t: string) {
  return typeof t === "string" && t.startsWith("EAA") && t.length >= 50 && t.length <= 600 && /^[A-Za-z0-9_\-]+$/.test(t);
}
function isValidPhoneNumberId(id: string) {
  return typeof id === "string" && /^\d{10,20}$/.test(id);
}
function isValidWaPhone(p: string) {
  return /^\d{12,15}$/.test(p);
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[waba-config] Variáveis de ambiente ausentes");
    return json({ error: "Server misconfiguration" }, 500);
  }

  let body: { shop_id?: string; waba_phone_id?: string; waba_phone_number_id?: string; waba_token?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON" }, 400); }

  const { shop_id, waba_phone_id, waba_phone_number_id, waba_token } = body;

  if (!shop_id || typeof shop_id !== "string" || shop_id.length < 10)
    return json({ error: "shop_id inválido" }, 400);
  if (!waba_phone_id || !isValidWaPhone(waba_phone_id))
    return json({ error: "Número WhatsApp inválido. Use: DDI+DDD+número (só dígitos, 12-15 chars)" }, 400);
  if (!waba_phone_number_id || !isValidPhoneNumberId(waba_phone_number_id))
    return json({ error: "Phone Number ID inválido (10-20 dígitos)" }, 400);
  if (!waba_token || !isValidMetaToken(waba_token))
    return json({ error: "Token Meta inválido. Deve começar com EAA." }, 400);

  const supaAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Verifica se a barbearia existe ────────────────────────────────────────────
  const { data: shop, error: shopErr } = await supaAdmin
    .from("barbershops").select("id, status").eq("id", shop_id).single();

  if (shopErr || !shop) return json({ error: "Barbearia não encontrada" }, 404);
  if (shop.status === "blocked") return json({ error: "Barbearia bloqueada" }, 403);

  // ── Salva via service_role (bypassa RLS) ──────────────────────────────────────
  const { error: updateErr } = await supaAdmin
    .from("barbershops")
    .update({
      waba_phone_id,
      waba_phone_number_id,
      waba_token,
      waba_configured: true,
    })
    .eq("id", shop_id);

  if (updateErr) {
    console.error("[waba-config] Erro ao salvar:", updateErr.message);
    return json({ error: "Erro ao salvar: " + updateErr.message }, 500);
  }

  console.log(`[waba-config] OK — shop ${shop_id.slice(0, 8)}***`);
  return json({ ok: true, message: "Configuração salva! WhatsApp Business ativado." });
});
