import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  try {
    const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;

    if (!serviceRoleKey || !supabaseUrl) {
      console.error('[DOKU NOTIFICATION ERROR] Supabase credentials missing');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    // Supabase Admin Client dengan Service Role Key untuk bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
    const body = await req.json();

    console.log('[DOKU NOTIFICATION INCOMING PAYLOAD]:', JSON.stringify(body, null, 2));

    // Ekstraksi Status Pembayaran dari Berbagai Kemungkinan Format Payload DOKU
    const rawStatus = 
      body.transaction?.status || 
      body.transaction_status || 
      body.order?.status || 
      body.status || 
      '';

    const statusUpper = String(rawStatus).trim().toUpperCase();

    // Ekstraksi User Identity (ID Supabase atau Email)
    const userId = body.customer?.id || body.order?.customer_id || body.service?.id;
    const userEmail = body.customer?.email || body.order?.customer_email;

    // Kriteria Sukses Transaksi DOKU
    const isSuccess = 
      ['SUCCESS', 'SUCCESSFUL', 'PAID', '0000', 'SETTLED'].includes(statusUpper) || 
      statusUpper.includes('SUCCESS');

    if (isSuccess) {
      // Menghitung masa aktif PRO (1 tahun dari sekarang)
      const proUntilDate = new Date();
      proUntilDate.setFullYear(proUntilDate.getFullYear() + 1);

      let isUpdated = false;

      // 1. Eksekusi Update via ID Supabase ke tabel PROFILES
      if (userId && userId !== 'USER-UNKNOWN') {
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .update({
            is_pro: true,
            pro_until: proUntilDate.toISOString(),
          })
          .eq('id', String(userId).trim())
          .select();

        if (!error && data && data.length > 0) {
          isUpdated = true;
          console.log(`[DOKU NOTIFICATION SUCCESS] Profile updated via ID: ${userId}`);
        } else if (error) {
          console.error('[DOKU NOTIFICATION ERROR] Supabase update by ID failed:', error.message);
        }
      }

      // 2. Fallback Update via Email jika ID tidak cocok / tidak ditemukan
      if (!isUpdated && userEmail && userEmail.includes('@')) {
        const { data, error } = await supabaseAdmin
          .from('profiles')
          .update({
            is_pro: true,
            pro_until: proUntilDate.toISOString(),
          })
          .ilike('email', String(userEmail).trim())
          .select();

        if (!error && data && data.length > 0) {
          isUpdated = true;
          console.log(`[DOKU NOTIFICATION SUCCESS] Profile updated via Email: ${userEmail}`);
        } else if (error) {
          console.error('[DOKU NOTIFICATION ERROR] Supabase update by Email failed:', error.message);
        }
      }

      if (!isUpdated) {
        console.error(`[DOKU NOTIFICATION WARNING] User tidak ditemukan di Supabase (ID: ${userId}, Email: ${userEmail})`);
      }
    } else {
      console.log(`[DOKU NOTIFICATION IGNORED] Status pembayaran belum lunas: ${rawStatus}`);
    }

    // Selalu kembalikan status HTTP 200 OK ke DOKU
    return NextResponse.json({ status: 'OK' }, { status: 200 });

  } catch (err: any) {
    console.error('[DOKU NOTIFICATION EXCEPTION]:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}