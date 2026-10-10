'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';

function PaymentSuccessContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState('Memverifikasi status pembayaran...');
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    async function verifyPayment() {
      try {
        const { data: { user } } = await supabase.auth.getUser();

        // Cek variasi query parameter invoice dari DOKU
        const invoiceNumber =
          searchParams.get('invoice_number') ||
          searchParams.get('invoice') ||
          searchParams.get('order_id') ||
          searchParams.get('trans_id');

        if (!user) {
          // Jika user tidak terdeteksi tapi ada invoice, jangan langsung diputus
          if (invoiceNumber) {
            setStatusMessage('Sesi login tidak ditemukan. Pembayaran tetap diproses. Silakan login kembali.');
          } else {
            setStatusMessage('Silakan login terlebih dahulu untuk memverifikasi pembayaran.');
          }
          setLoading(false);
          return;
        }

        if (!invoiceNumber) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('is_pro')
            .eq('id', user.id)
            .single();

          if (profile?.is_pro) {
            setIsSuccess(true);
            setStatusMessage('Selamat! Akun kamu sudah berstatus PRO.');
          } else {
            setStatusMessage('Nomor invoice tidak ditemukan di URL.');
          }
          setLoading(false);
          return;
        }

        const res = await fetch('/api/check-status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            invoiceNumber,
            userId: user.id,
          }),
        });

        const data = await res.json();

        if (data.isPaid && data.success) {
          setIsSuccess(true);
          setStatusMessage('Pembayaran Berhasil! Akun kamu sudah aktif sebagai PRO.');
        } else {
          setStatusMessage(data.message || 'Pembayaran belum terkonfirmasi.');
        }
      } catch (err: any) {
        console.error('Error verifying payment:', err);
        setStatusMessage(`Gagal verifikasi: ${err.message || 'Server error'}`);
      } finally {
        setLoading(false);
      }
    }

    verifyPayment();
  }, [searchParams, router]);

  return (
    <div className="min-h-screen w-full bg-[#0B132B] text-slate-100 flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-slate-900 border border-slate-800 rounded-3xl p-6 sm:p-8 text-center space-y-5 shadow-2xl">
        {loading ? (
          <div className="py-6 space-y-4">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-cyan-400 mx-auto"></div>
            <p className="text-slate-300 font-medium text-sm">{statusMessage}</p>
          </div>
        ) : isSuccess ? (
          <div className="py-4 space-y-4">
            <div className="w-16 h-16 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-full flex items-center justify-center mx-auto text-3xl font-black">
              ✓
            </div>
            <h2 className="text-2xl font-black text-white">Pembayaran Sukses!</h2>
            <p className="text-slate-300 text-xs leading-relaxed">{statusMessage}</p>
            <button
              onClick={() => router.push('/')}
              className="w-full bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black py-3.5 rounded-xl text-xs transition shadow-lg shadow-cyan-500/20 cursor-pointer"
            >
              Mulai Ujian Akses Pro 🚀
            </button>
          </div>
        ) : (
          <div className="py-4 space-y-4">
            <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-full flex items-center justify-center mx-auto text-3xl font-black">
              !
            </div>
            <h2 className="text-xl font-black text-white">Status Pembayaran</h2>
            <p className="text-slate-300 text-xs bg-slate-950/80 p-3.5 rounded-xl border border-slate-800 text-left font-mono break-words">
              {statusMessage}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3.5 rounded-xl text-xs transition border border-slate-700 cursor-pointer"
            >
              Cek Ulang Status
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function PaymentSuccessPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-slate-400">Memuat halaman...</div>}>
      <PaymentSuccessContent />
    </Suspense>
  );
}