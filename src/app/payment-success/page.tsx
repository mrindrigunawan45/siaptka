'use client';

import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

export default function PaymentSuccessPage() {
  const searchParams = useSearchParams();
  const invoiceNumber = searchParams.get('invoice_number');

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 p-4">
      <div className="bg-white p-8 rounded-2xl shadow-lg max-w-md w-full text-center">
        <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4 text-3xl font-bold">
          ✓
        </div>
        <h1 className="text-2xl font-bold text-gray-800 mb-2">Pembayaran Berhasil!</h1>
        <p className="text-gray-600 mb-6">
          Terima kasih, paket simulasi TKA kamu sudah aktif.
        </p>

        {invoiceNumber && (
          <div className="bg-gray-50 p-3 rounded-lg mb-6 text-sm text-gray-500 font-mono">
            No. Invoice: {invoiceNumber}
          </div>
        )}

        <Link
          href="/"
          className="inline-block w-full py-3 px-6 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition"
        >
          Mulai Belajar
        </Link>
      </div>
    </div>
  );
}