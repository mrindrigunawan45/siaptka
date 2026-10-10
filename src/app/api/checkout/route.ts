import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { userId, userEmail, amount = 20000 } = body;

    if (!userId || !userEmail) {
      return NextResponse.json(
        { success: false, message: 'Data pengguna tidak lengkap' },
        { status: 400 }
      );
    }

    const clientId = process.env.DOKU_CLIENT_ID?.trim();
    const secretKey = process.env.DOKU_SECRET_KEY?.trim();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
    
    // Pastikan appUrl selalu dipangkas trailing slash-nya dan menggunakan fallback domain jagotka
    const rawAppUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://jagotka.vercel.app';
    const appUrl = rawAppUrl.replace(/\/$/, '');

    if (!clientId || !secretKey || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, message: 'Kredensial server / DOKU / Supabase belum lengkap di .env.local' },
        { status: 500 }
      );
    }

    // Inisialisasi Admin Client (Bypass RLS)
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 1. Amankan profil user jika belum ada di tabel profiles
    await supabaseAdmin.from('profiles').upsert(
      [
        {
          id: userId,
          email: userEmail,
          full_name: userEmail.split('@')[0],
          is_pro: false,
        },
      ],
      { onConflict: 'id' }
    );

    const invoiceNumber = `INV-TKA-${Date.now()}`;

    // 2. Simpan Transaksi PENDING ke Supabase
    const { error: txErr } = await supabaseAdmin.from('transactions').insert([
      {
        invoice_number: invoiceNumber,
        user_id: userId,
        amount: Number(amount),
        status: 'PENDING',
      },
    ]);

    if (txErr) {
      console.error('[CHECKOUT DB ERROR]:', txErr);
      return NextResponse.json(
        { success: false, message: 'Gagal mencatat transaksi ke database.' },
        { status: 500 }
      );
    }

    const targetPath = '/checkout/v1/payment';
    const requestId = crypto.randomUUID();
    const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';
    
    // URL Callback DOKU yang pasti mengarah ke domain jagotka
    const callbackUrl = `${appUrl}/payment-success?invoice_number=${invoiceNumber}`;

    const payload = {
      order: {
        amount: Number(amount),
        invoice_number: invoiceNumber,
        currency: 'IDR',
        callback_url: callbackUrl,
        auto_redirect: true,
        target_type: 'payment_page',
      },
      payment: {
        payment_due_date: 60,
      },
      customer: {
        id: userId,
        name: userEmail.split('@')[0],
        email: userEmail,
      },
    };

    const jsonBody = JSON.stringify(payload);

    const digest = crypto
      .createHash('sha256')
      .update(jsonBody)
      .digest('base64');

    const signatureComponent =
      `Client-Id:${clientId}\n` +
      `Request-Id:${requestId}\n` +
      `Request-Timestamp:${requestTimestamp}\n` +
      `Request-Target:${targetPath}\n` +
      `Digest:${digest}`;

    const signature = crypto
      .createHmac('sha256', secretKey)
      .update(signatureComponent)
      .digest('base64');

    const dokuUrl = 'https://api.doku.com/checkout/v1/payment';

    const dokuRes = await fetch(dokuUrl, {
      method: 'POST',
      headers: {
        'Client-Id': clientId,
        'Request-Id': requestId,
        'Request-Timestamp': requestTimestamp,
        'Signature': `HMACSHA256=${signature}`,
        'Content-Type': 'application/json',
      },
      body: jsonBody,
    });

    const dokuData = await dokuRes.json();

    if (dokuRes.ok && dokuData.response?.payment?.url) {
      return NextResponse.json({
        success: true,
        paymentUrl: dokuData.response.payment.url,
      });
    } else {
      console.error('DOKU API Error Output:', dokuData);
      return NextResponse.json(
        {
          success: false,
          message: dokuData.error?.message || 'Gagal memproses pembayaran DOKU.',
        },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('Checkout error:', error);
    return NextResponse.json(
      { success: false, message: 'Terjadi kesalahan pada server checkout' },
      { status: 500 }
    );
  }
}