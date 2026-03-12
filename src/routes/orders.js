import { Router } from 'express';

import { loadEnv } from '../config/env.js';
import { createOrder, listOrders } from '../db/ordersRepo.js';
import { handleRouteError, sendError } from '../http/errors.js';
import { requireAdminToken } from '../middleware/adminAuth.js';

const router = Router();
const env = loadEnv();
const adminAuth = requireAdminToken(env.ADMIN_TOKEN);

function formatLocalTime(utcStr) {
  const date = new Date(String(utcStr).replace(' ', 'T') + 'Z');
  date.setTime(date.getTime() + 10 * 60 * 60 * 1000);
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' (UTC+10)';
}

async function sendTelegramNotification(runtimeEnv, order) {
  const token = runtimeEnv.TELEGRAM_BOT_TOKEN;
  const chatId = runtimeEnv.TELEGRAM_CHAT_ID;
  const messageThreadId = runtimeEnv.TELEGRAM_MESSAGE_THREAD_ID;

  if (!token || !chatId) return;

  const text = [
    '📋 Новая заявка с сайта',
    `👤 Имя: ${order.name}`,
    `📞 Телефон: ${order.phone}`,
    order.message ? `💬 Описание: ${order.message}` : null,
    `🕒 Время: ${formatLocalTime(order.created_at)}`
  ].filter(Boolean).join('\n');

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
        text
      })
    });

    if (!response.ok) {
      const body = await response.text();
      console.error('[orders] Telegram notification failed:', response.status, body);
    }
  } catch (err) {
    console.error('[orders] Telegram notification failed:', err?.message || String(err));
  }
}

router.post('/', async (req, res) => {
  try {
    const { name, phone, message } = req.body || {};
    const normalizedName = String(name || '').trim();
    const normalizedPhone = String(phone || '').trim();
    const normalizedMessage = String(message || '').trim();

    if (!normalizedName) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Field "name" is required');
    }

    if (!normalizedPhone) {
      return sendError(res, 400, 'VALIDATION_ERROR', 'Field "phone" is required');
    }

    const order = createOrder(env, {
      name: normalizedName,
      phone: normalizedPhone,
      message: normalizedMessage || null
    });

    sendTelegramNotification(env, order).catch(() => {});

    return res.status(201).json({ ok: true, order });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

router.get('/', adminAuth, async (req, res) => {
  try {
    const orders = listOrders(env);
    return res.json({ orders });
  } catch (err) {
    return handleRouteError(res, err);
  }
});

export default router;
