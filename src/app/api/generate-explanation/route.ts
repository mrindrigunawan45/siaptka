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
          temperature: 0.5,
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

  throw new Error('Server AI sedang sibuk.');
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { question, options, answer } = body;

    const prompt = `Kamu adalah guru / tentor ahli TKA Pusmendik Kemendikdasmen.
Berikan pembahasan ringkas, jelas, dan mudah dipahami untuk soal berikut:

Soal: "${question}"
Pilihan Jawaban: ${JSON.stringify(options)}
Kunci Jawaban Benar: "${answer}"

Format pembahasan:
1. Konsep / Rumus Utama yang digunakan.
2. Langkah Penyelesaian singkat (step-by-step).
3. Kesimpulan jawaban akhir.

Gunakan Bahasa Indonesia yang ramah dan langsung ke inti penjelasan. DILARANG menggunakan format JSON, cukup teks biasa dengan baris baru.`;

    const explanationText = await generateWithRetry(prompt);

    return NextResponse.json({
      success: true,
      explanation: explanationText,
    });
  } catch (error: any) {
    console.error('Explanation Error:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Gagal memuat pembahasan.',
      },
      { status: 500 }
    );
  }
}