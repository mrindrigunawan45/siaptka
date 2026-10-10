import { NextResponse } from 'next/server';
import { GoogleGenAI } from '@google/genai';

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function generateWithRetry(prompt: string, maxRetries = 3) {
  const models = [
    'gemini-3.5-flash-lite',
    'gemini-3.7-flash',
    'gemini-3.8-flash',
  ];

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const selectedModel = models[attempt % models.length];
    
    try {
      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          temperature: 0.6,
        },
      });

      if (response.text) {
        return response.text;
      }
    } catch (err: any) {
      console.warn(`[Attempt ${attempt + 1}] Model ${selectedModel} sibuk. Mencoba opsi berikutnya...`);

      if (attempt === maxRetries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  throw new Error('Server AI sedang padat. Silakan coba lagi.');
}

// 1. ISOLASI DOMAIN MATA PELAJARAN TOTAL
function getStrictSubjectRules(subCategory: string): string {
  const cat = subCategory.toLowerCase();

  if (cat.includes('indonesia')) {
    return `
    [PEMBATASAN DOMAIN: BAHASA INDONESIA]
    - DILARANG KERAS MENAMPILKAN PERHITUNGAN MATEMATIKA, ANGKA, KODE, ATAU RUMUS!
    - SOAL WAJIB 100% BERFOKUS PADA: Teks Bacaan (Paragraf 2-4 kalimat), Ide Pokok, Kalimat Utama, Gagasan Utama, Makna Kata, Menyimpulkan Teks, serta PUEBI.
    - Setiap butir soal WAJIB diawali dengan paragraf/bacaan singkat.
    `;
  }

  if (cat.includes('inggris') || cat.includes('english') || cat.includes('asing')) {
    return `
    [PEMBATASAN DOMAIN: BAHASA INGGRIS / ASING]
    - DILARANG KERAS MENAMPILKAN MATEMATIKA / HITUNGAN ANGKA!
    - Seluruh bacaan, soal, dan pilihan jawaban WAJIB FULL 100% Bahasa Inggris / Bahasa Asing yang dipilih.
    - SOAL WAJIB BERFOKUS PADA: Reading Comprehension, Grammar/Structure, and Contextual Vocabulary.
    `;
  }

  if (cat.includes('matematika')) {
    return `
    [PEMBATASAN DOMAIN: MATEMATIKA]
    - DILARANG MEMBUAT SOAL TEORI BAHASA ATAU HAFALAN TIPE BACAAN!
    - SOAL WAJIB BERFOKUS PADA: Pemecahan masalah angka, logika kuantitatif, operasi hitung, aljabar, geometri, atau penalaran kontekstual matematika.
    `;
  }

  if (cat.includes('ipa') || cat.includes('fisika') || cat.includes('kimia') || cat.includes('biologi')) {
    return `
    [PEMBATASAN DOMAIN: IPA & SAINTEK]
    - SOAL WAJIB BERFOKUS PADA: Fenomena alam, hukum fisika, reaksi kimia, struktur biologi, eksperimen sains, dan analisis data grafik/tabel sains.
    `;
  }

  if (cat.includes('ips') || cat.includes('sosiologi') || cat.includes('geografi') || cat.includes('sejarah') || cat.includes('ekonomi')) {
    return `
    [PEMBATASAN DOMAIN: IPS & SOSHUM]
    - SOAL WAJIB BERFOKUS PADA: Fenomena sosial, interaksi antarmanusia, konsep geosfer/peta, kronologi sejarah, atau perhitungan & kurva ekonomi.
    `;
  }

  return `
  [PEMBATASAN DOMAIN: UPTODATE MATERI ${subCategory.toUpperCase()}]
  - Seluruh isi soal dan jawaban WAJIB 100% konsisten dengan ranah materi ${subCategory}.
  `;
}

// 2. ISOLASI FORMAT & TINGKAT KESULITAN BERDASARKAN JENJANG PUSMENDIK
function getLevelFormatRules(level: string): { rules: string; optionCount: string } {
  if (level === 'SD') {
    return {
      optionCount: '4 opsi (A, B, C, D)',
      rules: `
      [STANDAR PUSMENDIK SD/MI - KELAS 6]
      - Opsi Jawaban: WAJIB HANYA 4 OPSI (A, B, C, D). DILARANG MEMBUAT OPSI E!
      - Kalimat pendek, jelas, dan ramah anak usia 10-12 tahun.
      - DILARANG KERAS: Variabel aljabar (x, y), trigonometri, kalkulus, atau istilah abstrak SMP/SMA.
      `
    };
  }

  if (level === 'SMP') {
    return {
      optionCount: '4 opsi (A, B, C, D)',
      rules: `
      [STANDAR PUSMENDIK SMP/MTS - KELAS 9]
      - Opsi Jawaban: WAJIB HANYA 4 OPSI (A, B, C, D). DILARANG MEMBUAT OPSI E!
      - Bahasa sesuai tingkat kognitif remaja usia 13-15 tahun.
      - DILARANG KERAS: Kalkulus, trigonometri kompleks, matriks, atau teori tingkat SMA.
      `
    };
  }

  return {
    optionCount: '5 opsi (A, B, C, D, E)',
    rules: `
    [STANDAR PUSMENDIK SMA/MA/SMK - KELAS 12]
    - Opsi Jawaban: WAJIB 5 OPSI (A, B, C, D, E).
    - Berfokus pada penalaran HOTS dan analisis studi kasus tingkat lanjut usia 16-18 tahun.
    `
  };
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { level = 'SMA/SMK', examType = 'Wajib', subCategory, count = 5 } = body;

    const subjectStrictRule = getStrictSubjectRules(subCategory || '');
    const { rules, optionCount } = getLevelFormatRules(level);

    const prompt = `Kamu adalah TIM PENYUSUN SOAL RESMI Tes Kemampuan Akademik (TKA) dari Pusat Asesmen Pendidikan (Pusmendik) Kemendikdasmen.
Buatkan ${count} paket soal untuk simulasi ujian resmi dengan spesifikasi:
- Jenjang Pendidikan Target: ${level}
- Kelompok Rumpun: ${examType}
- MATA PELAJARAN SPESIFIK: ${subCategory}

===============================================================
PANDUAN ISOLASI MATA PELAJARAN:
${subjectStrictRule}
===============================================================

PANDUAN JENJANG & FORMAT OPSI:
${rules}

PETUNJUK TIPE SOAL (KOMBINASI VARIATIF):
- Buat sekitar 70%-80% soal bertipe "single" (Pilihan Ganda Biasa, 1 jawaban benar).
- Buat sekitar 20%-30% soal bertipe "multiple" (Pilihan Ganda Kompleks, minimal 2 jawaban benar).

FORMAT KELUARAN WAJIB (JSON ARRAY MURNI):
- Output WAJIB berupa ARRAY JSON murni tanpa pembungkus Markdown!
- Jumlah elemen "options" WAJIB SESUAI JENJANG (${optionCount}).

Contoh Struktur JSON:
[
  {
    "id": 1,
    "type": "single",
    "question": "Soal PG biasa...",
    "options": ${level === 'SMA/SMK' ? '["A. ...", "B. ...", "C. ...", "D. ...", "E. ..."]' : '["A. ...", "B. ...", "C. ...", "D. ..."]'},
    "answer": "A. ..."
  },
  {
    "id": 2,
    "type": "multiple",
    "question": "Pilihlah dua pernyataan yang tepat...",
    "options": ${level === 'SMA/SMK' ? '["A. ...", "B. ...", "C. ...", "D. ...", "E. ..."]' : '["A. ...", "B. ...", "C. ...", "D. ..."]'},
    "answer": ["A. ...", "C. ..."]
  }
]`;

    const rawText = await generateWithRetry(prompt);

    const cleanedText = rawText
      .replace(/```json/g, '')
      .replace(/```/g, '')
      .trim();

    const questionsData = JSON.parse(cleanedText);

    return NextResponse.json({
      success: true,
      data: questionsData,
    });

  } catch (error: any) {
    console.error('API Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Gagal membuat soal TKA. Silakan coba lagi.',
      },
      { status: 500 }
    );
  }
}