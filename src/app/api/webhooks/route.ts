import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const body = await req.json();
    console.log('[DOKU WEBHOOK RECEIVED]:', JSON.stringify(body));

    // Ekstrak Invoice Number dari berbagai struktur payload DOKU
    const invoiceNumber =
      body.order?.invoice_number ||
      body.transaction?.order_id ||
      body.order?.invoice_no ||
      body.invoice_number;

    // Ekstrak Status Pembayaran
    const rawStatus =
      body.transaction?.status ||
      body.order?.status ||
      body.transaction_status ||
      body.status;

    const statusUpper = String(rawStatus || '').toUpperCase();
    const isPaid = ['SUCCESS', 'SUCCESSFUL', 'PAID', 'SETTLED', '0000', '00'].includes(statusUpper);

    if (!invoiceNumber) {
      console.error('[WEBHOOK ERROR]: Invoice Number tidak ditemukan.');
      return NextResponse.json({ success: false, message: 'Missing invoice number' }, { status: 400 });
    }

    if (isPaid) {
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
      const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });

      // 1. Cari user_id berdasarkan invoice_number di tabel transactions
      const { data: transaction, error: txError } = await supabaseAdmin
        .from('transactions')
        .select('user_id')
        .eq('invoice_number', invoiceNumber)
        .maybeSingle();

      if (txError || !transaction) {
        console.error('[WEBHOOK ERROR]: Transaksi tidak ditemukan di database:', invoiceNumber);
        return NextResponse.json({ success: true, message: 'Transaction record not found' }, { status: 200 });
      }

      const userId = transaction.user_id;
      const proUntilDate = new Date();
      proUntilDate.setFullYear(proUntilDate.getFullYear() + 1);

      // 2. Update status profiles user menjadi PRO (is_pro = true)
      const { error: profileError } = await supabaseAdmin
        .from('profiles')
        .update({
          is_pro: true,
          pro_until: proUntilDate.toISOString(),
        })
        .eq('id', userId);

      if (profileError) {
        console.error('[WEBHOOK DB UPDATE ERROR]:', profileError);
      } else {
        console.log(`[WEBHOOK SUCCESS]: User ${userId} otomatis di-upgrade ke PRO via Invoice ${invoiceNumber}`);
      }

      // 3. Update status di tabel transactions menjadi SUCCESS
      await supabaseAdmin
        .from('transactions')
        .update({ status: 'SUCCESS' })
        .eq('invoice_number', invoiceNumber);
    }

    // Mengembalikan HTTP 200 OK ke DOKU
    return NextResponse.json({ success: true, message: 'Notification processed successfully' }, { status: 200 });
  } catch (err: any) {
    console.error('[WEBHOOK EXCEPTION]:', err);
    return NextResponse.json({ success: false, message: err.message }, { status: 500 });
  }
}