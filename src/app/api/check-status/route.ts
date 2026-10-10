import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const invoiceNumber = body.invoiceNumber || body.invoice_number;
    const userId = body.userId;

    if (!invoiceNumber) {
      return NextResponse.json(
        { success: false, isPaid: false, message: 'Nomor invoice diperlukan.' },
        { status: 400 }
      );
    }

    const clientId = process.env.DOKU_CLIENT_ID?.trim();
    const secretKey = process.env.DOKU_SECRET_KEY?.trim();
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

    if (!clientId || !secretKey || !supabaseUrl || !serviceRoleKey) {
      return NextResponse.json(
        { success: false, isPaid: false, message: 'Kredensial server / Supabase Admin belum lengkap di .env.local.' },
        { status: 500 }
      );
    }

    const requestId = `REQ-CHECK-${Date.now()}`;
    const targetPath = `/orders/v1/status/${invoiceNumber}`;
    const requestTimestamp = new Date().toISOString().slice(0, 19) + 'Z';

    const signatureRaw = `Client-Id:${clientId}\nRequest-Id:${requestId}\nRequest-Timestamp:${requestTimestamp}\nRequest-Target:${targetPath}`;
    const signature = crypto.createHmac('sha256', secretKey).update(signatureRaw).digest('base64');

    const resDoku = await fetch(`https://api.doku.com${targetPath}`, {
      method: 'GET',
      headers: {
        'Client-Id': clientId,
        'Request-Id': requestId,
        'Request-Timestamp': requestTimestamp,
        'Signature': `HMACSHA256=${signature}`,
      },
    });

    const dokuData = await resDoku.json();
    console.log('[DOKU STATUS INQUIRY RESP]:', dokuData);

    const rawStatus = dokuData.transaction?.status || dokuData.order?.status;
    const isPaid = ['SUCCESS', 'SUCCESSFUL', 'PAID', 'SETTLED', '0000', '00'].includes(
      String(rawStatus || '').toUpperCase()
    );

    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (isPaid) {
      const proUntilDate = new Date();
      proUntilDate.setFullYear(proUntilDate.getFullYear() + 1);

      let targetUserId = userId;

      if (!targetUserId) {
        const { data: tx } = await supabaseAdmin
          .from('transactions')
          .select('user_id')
          .eq('invoice_number', invoiceNumber)
          .maybeSingle();
        if (tx) targetUserId = tx.user_id;
      }

      if (targetUserId) {
        await supabaseAdmin
          .from('profiles')
          .update({
            is_pro: true,
            pro_until: proUntilDate.toISOString(),
          })
          .eq('id', targetUserId);
      }

      await supabaseAdmin
        .from('transactions')
        .update({ status: 'SUCCESS' })
        .eq('invoice_number', invoiceNumber);

      return NextResponse.json({
        success: true,
        isPaid: true,
        message: 'Pembayaran terkonfirmasi LUNAS! Status akun kamu sudah menjadi PRO.',
      });
    }

    return NextResponse.json({
      success: false,
      isPaid: false,
      message: `Status pembayaran saat ini: ${rawStatus || 'PENDING'}`,
    });
  } catch (err: any) {
    console.error('[CHECK STATUS ERROR]:', err);
    return NextResponse.json(
      { success: false, isPaid: false, message: err.message || 'Terjadi kesalahan pada server.' },
      { status: 500 }
    );
  }
}