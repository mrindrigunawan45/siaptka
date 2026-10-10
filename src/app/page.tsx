'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { User } from '@supabase/supabase-js';

interface Question {
  id?: number;
  question: string;
  type?: 'single' | 'multiple';
  options: string[];
  answer: string | string[];
}

interface ExamHistory {
  id: string;
  exam_type: string;
  category: string;
  score: number;
  total_questions: number;
  created_at: string;
}

interface UserProfile {
  id: string;
  email: string;
  is_pro: boolean;
  pro_until: string | null;
}

const LOADING_STEPS = [
  '⚡ Membaca kisi-kisi resmi Pusmendik Kemendikdasmen...',
  '🧠 Merancang narasi soal HOTS & pemecahan masalah...',
  '🎯 Memeriksa variasi opsi A, B, C, D, E...',
  '🚀 Finalisasi paket soal Simulasi TKA...',
];

type Level = 'SD' | 'SMP' | 'SMA/SMK';
type SMACategory = 'Wajib' | 'Saintek' | 'Soshum' | 'Bahasa/Vokasi';

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [dailyCount, setDailyCount] = useState<number>(0);
  const maxFreeQuota = 3;

  const [mode, setMode] = useState<'setup' | 'exam' | 'result'>('setup');

  const [level, setLevel] = useState<Level>('SMA/SMK');
  const [smaCategory, setSmaCategory] = useState<SMACategory>('Wajib');
  const [subCategory, setSubCategory] = useState('Matematika (Wajib)');
  const [count, setCount] = useState(5);

  const [loading, setLoading] = useState(false);
  const [loadingStepIdx, setLoadingStepIdx] = useState(0);

  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string | string[]>>({});
  const [timeLeft, setTimeLeft] = useState(0);
  const [error, setError] = useState('');

  const [explanations, setExplanations] = useState<Record<number, string>>({});
  const [loadingExp, setLoadingExp] = useState<Record<number, boolean>>({});

  const [history, setHistory] = useState<ExamHistory[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [showLoginModal, setShowLoginModal] = useState(false);
  const [showHomeWarningModal, setShowHomeWarningModal] = useState(false);
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    if (level === 'SD') {
      setSubCategory('Bahasa Indonesia SD');
    } else if (level === 'SMP') {
      setSubCategory('Bahasa Indonesia SMP');
    } else {
      if (smaCategory === 'Wajib') setSubCategory('Bahasa Indonesia (Wajib)');
      else if (smaCategory === 'Saintek') setSubCategory('Matematika Tingkat Lanjut');
      else if (smaCategory === 'Soshum') setSubCategory('Sosiologi');
      else setSubCategory('Informatika');
    }
  }, [level, smaCategory]);

  useEffect(() => {
    let interval: any;
    if (loading) {
      setLoadingStepIdx(0);
      interval = setInterval(() => {
        setLoadingStepIdx((prev) => (prev + 1) % LOADING_STEPS.length);
      }, 1500);
    } else {
      clearInterval(interval);
    }
    return () => clearInterval(interval);
  }, [loading]);

  const fetchUserData = async (userId: string) => {
    try {
      const { data: profData } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (profData) setProfile(profData as UserProfile);

      const { data: countData, error: countErr } = await supabase
        .rpc('get_daily_exam_count', { p_user_id: userId });

      if (!countErr && typeof countData === 'number') {
        setDailyCount(countData);
      }
    } catch (err) {
      console.error('Gagal mengambil data user:', err);
    }
  };

  const fetchHistory = async () => {
    setLoadingHistory(true);
    try {
      const { data, error } = await supabase
        .from('exam_results')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && data) {
        setHistory(data as ExamHistory[]);
      }
    } catch (err) {
      console.error('Gagal mengambil riwayat:', err);
    } finally {
      setLoadingHistory(false);
    }
  };

  useEffect(() => {
    const checkUserAndRestoreSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      const currentUser = session?.user ?? null;
      setUser(currentUser);

      if (currentUser) {
        fetchUserData(currentUser.id);
        fetchHistory();

        const savedSession = localStorage.getItem('pending_exam_session');
        if (savedSession) {
          try {
            const parsed = JSON.parse(savedSession);
            if (parsed && Array.isArray(parsed.questions) && parsed.questions.length > 0) {
              setQuestions(parsed.questions);
              setUserAnswers(parsed.userAnswers || {});
              setSubCategory(parsed.subCategory || '');
              setMode('result');

              let correct = 0;
              parsed.questions.forEach((q: Question, idx: number) => {
                const uAns = parsed.userAnswers[idx];
                if (Array.isArray(q.answer) && Array.isArray(uAns)) {
                  if (q.answer.sort().join(',') === uAns.sort().join(',')) correct++;
                } else if (uAns === q.answer) {
                  correct++;
                }
              });
              const restoredScore = Math.round((correct / parsed.questions.length) * 100);

              await saveExamResult(restoredScore);
            }
          } catch (err) {
            console.error('Gagal memulihkan sesi ujian:', err);
          } finally {
            localStorage.removeItem('pending_exam_session');
          }
        }
      }
    };

    checkUserAndRestoreSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((_event: any, session: any) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        fetchUserData(currentUser.id);
        fetchHistory();
      } else {
        setProfile(null);
        setHistory([]);
        setDailyCount(0);
      }
    });

    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleGoogleLogin = async () => {
    if (mode === 'result' && questions.length > 0) {
      const pendingExamState = {
        questions,
        userAnswers,
        level,
        subCategory,
      };
      localStorage.setItem('pending_exam_session', JSON.stringify(pendingExamState));
    }

    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  useEffect(() => {
    if (mode === 'exam' && timeLeft > 0) {
      const timer = setInterval(() => setTimeLeft((prev) => prev - 1), 1000);
      return () => clearInterval(timer);
    } else if (mode === 'exam' && timeLeft === 0) {
      handleFinishExam();
    }
  }, [mode, timeLeft]);

  const handleGoHome = () => {
    if (mode === 'exam') {
      setShowHomeWarningModal(true);
    } else {
      setMode('setup');
    }
  };

  const confirmGoHome = () => {
    setShowHomeWarningModal(false);
    setMode('setup');
  };

  const handlePay = async () => {
    if (!user) {
      alert('Silakan login terlebih dahulu!');
      return;
    }

    setPayLoading(true);

    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          userEmail: user.email,
          amount: 15000,
        }),
      });

      const data = await res.json();

      if (data.success && data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        alert('Gagal memproses pembayaran: ' + (data.message || 'Terjadi kesalahan'));
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Terjadi kesalahan koneksi ke server.');
    } finally {
      setPayLoading(false);
    }
  };

  const saveExamResult = async (finalScore: number, qCount?: number) => {
    if (!user) return;

    try {
      const { error } = await supabase.from('exam_results').insert([
        {
          user_id: user.id,
          exam_type: `${level} - Pusmendik`,
          category: subCategory,
          score: finalScore,
          total_questions: qCount || questions.length,
        },
      ]);

      if (!error) {
        await fetchUserData(user.id);
        fetchHistory();
      }
    } catch (err) {
      console.error('Error saving result:', err);
    }
  };

  const handleStartExam = async (e: React.FormEvent) => {
    e.preventDefault();

    if (count > 5 && !user) {
      alert('Silakan login dengan Google terlebih dahulu untuk mengakses mode 30/50 soal.');
      return;
    }

    if (user && !profile?.is_pro && dailyCount >= maxFreeQuota) {
      setShowUpgradeModal(true);
      return;
    }

    setLoading(true);
    setError('');
    setQuestions([]);
    setExplanations({});

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, examType: smaCategory, subCategory, count }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.error || 'Gagal terhubung ke pembuat soal AI.');
      }

      if (Array.isArray(result.data) && result.data.length > 0) {
        // PEMBATASAN JUMLAH SOAL (TRUNCATE TEPAT SESUAI COUNT)
        const limitedQuestions = result.data.slice(0, count);

        setQuestions(limitedQuestions);
        setUserAnswers({});
        setCurrentIdx(0);
        setTimeLeft(limitedQuestions.length * 90);
        setMode('exam');

        // CATAT LANGSUNG KE SUPABASE BEGITU TES DIMULAI
        if (user) {
          await saveExamResult(0, limitedQuestions.length);
        }
      } else {
        throw new Error('Format soal yang diterima tidak valid.');
      }

    } catch (err: any) {
      console.error('Error starting exam:', err);
      setError(err.message || 'Terjadi kesalahan saat memuat soal.');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectAnswer = (option: string, isMultiple = false) => {
    const currentAns = userAnswers[currentIdx];

    if (isMultiple) {
      const arrAns = Array.isArray(currentAns) ? [...currentAns] : [];
      if (arrAns.includes(option)) {
        setUserAnswers({ ...userAnswers, [currentIdx]: arrAns.filter((o) => o !== option) });
      } else {
        setUserAnswers({ ...userAnswers, [currentIdx]: [...arrAns, option] });
      }
    } else {
      setUserAnswers({ ...userAnswers, [currentIdx]: option });
    }
  };

  const calculateScore = () => {
    let correct = 0;
    questions.forEach((q, idx) => {
      const uAns = userAnswers[idx];
      if (q.type === 'multiple' && Array.isArray(q.answer) && Array.isArray(uAns)) {
        if (q.answer.sort().join(',') === uAns.sort().join(',')) correct++;
      } else if (uAns === q.answer) {
        correct++;
      }
    });
    return Math.round((correct / questions.length) * 100);
  };

  const handleFinishExam = () => {
    const score = calculateScore();
    saveExamResult(score);
    setMode('result');
  };

  const fetchExplanation = async (qIdx: number, questionObj: Question) => {
    if (!user) {
      setShowLoginModal(true);
      return;
    }

    if (explanations[qIdx]) return;

    setLoadingExp((prev) => ({ ...prev, [qIdx]: true }));

    try {
      const res = await fetch('/api/generate-explanation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: questionObj.question,
          options: questionObj.options,
          answer: questionObj.answer,
        }),
      });

      const data = await res.json();
      if (data.success && data.explanation) {
        setExplanations((prev) => ({ ...prev, [qIdx]: data.explanation }));
      }
    } catch (err) {
      console.error('Gagal mengambil pembahasan:', err);
    } finally {
      setLoadingExp((prev) => ({ ...prev, [qIdx]: false }));
    }
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const remainingQuota = Math.max(0, maxFreeQuota - dailyCount);

  return (
    <main className="min-h-screen w-full bg-[#0B132B] text-slate-100 selection:bg-cyan-500 selection:text-slate-950 font-sans antialiased relative overflow-x-hidden flex flex-col justify-between p-3 sm:p-6 md:p-8 pb-20 sm:pb-12">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-[1000px] h-[250px] sm:h-[350px] bg-gradient-to-tr from-cyan-600/15 via-emerald-500/10 to-transparent blur-[100px] sm:blur-[140px] pointer-events-none rounded-full" />

      <div className="max-w-6xl w-full mx-auto flex flex-col min-h-full justify-between gap-5 sm:gap-8 relative z-10">

        <header className="shrink-0 backdrop-blur-xl bg-slate-900/80 border border-slate-800/90 rounded-2xl p-3 sm:px-6 sm:py-4 shadow-2xl flex flex-wrap sm:flex-nowrap items-center justify-between gap-3">
          <button 
            onClick={handleGoHome} 
            className="flex items-center gap-2.5 sm:gap-3.5 text-left hover:opacity-85 transition cursor-pointer focus:outline-none"
          >
            <div className="w-9 h-9 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-tr from-cyan-500 via-teal-500 to-emerald-400 flex items-center justify-center font-black text-slate-950 shadow-lg shadow-cyan-500/20 text-lg shrink-0">
              🎓
            </div>
            <div>
              <h1 className="text-sm sm:text-lg font-black tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-300 bg-clip-text text-transparent leading-none">
                SIMULASI TKA 2026
              </h1>
              <p className="text-[10px] sm:text-xs text-cyan-400 font-semibold mt-0.5">Standar Pusat Asesmen Pendidikan (Pusmendik)</p>
            </div>
          </button>

          <div className="flex items-center gap-2 sm:gap-3 ml-auto sm:ml-0">
            {mode !== 'setup' && (
              <button
                onClick={handleGoHome}
                className="text-xs bg-slate-800/90 hover:bg-slate-700/90 text-slate-200 font-bold px-3 py-2 sm:px-4 sm:py-2 rounded-xl border border-slate-700/80 transition flex items-center gap-1.5 cursor-pointer shadow-sm active:scale-95"
              >
                🏠 <span className="hidden xs:inline">Beranda</span>
              </button>
            )}

            {user ? (
              <div className="flex items-center gap-2 sm:gap-3 bg-slate-800/60 px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border border-slate-700/80">
                <div className="text-right">
                  <p className="text-[11px] sm:text-xs font-bold text-slate-200 max-w-[100px] sm:max-w-[160px] truncate">
                    {user.user_metadata?.full_name || user.email?.split('@')[0]}
                  </p>
                  {profile?.is_pro ? (
                    <span className="text-[9px] sm:text-[10px] text-amber-400 font-bold flex items-center gap-1 justify-end">
                      👑 Akses Pro
                    </span>
                  ) : (
                    <span className="text-[9px] sm:text-[10px] text-slate-400">
                      Gratis: <strong className="text-cyan-400">{remainingQuota}/{maxFreeQuota}</strong>
                    </span>
                  )}
                </div>
                <button
                  onClick={handleLogout}
                  className="text-[11px] sm:text-xs text-rose-400 hover:text-rose-300 font-bold px-2 py-1 rounded-lg hover:bg-rose-500/10 transition cursor-pointer"
                >
                  Keluar
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleLogin}
                className="inline-flex items-center gap-2 bg-white hover:bg-slate-100 text-slate-900 font-extrabold text-xs px-3.5 py-2 sm:px-4 sm:py-2.5 rounded-xl transition duration-200 shadow-md active:scale-95 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 24 24">
                  <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
                </svg>
                <span>Masuk Google</span>
              </button>
            )}
          </div>
        </header>

        <div className="flex-1 flex flex-col justify-center my-auto">

          {loading && (
            <div className="w-full max-w-2xl mx-auto space-y-4 animate-pulse px-2">
              <div className="backdrop-blur-xl bg-slate-900/80 border border-cyan-500/30 rounded-2xl p-5 shadow-2xl flex items-center gap-4">
                <div className="relative w-6 h-6 flex items-center justify-center shrink-0">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-cyan-500"></span>
                </div>
                <div className="flex-1">
                  <p className="text-xs sm:text-sm font-extrabold text-cyan-300">
                    {LOADING_STEPS[loadingStepIdx]}
                  </p>
                  <p className="text-[10px] sm:text-xs text-slate-400 mt-0.5">Menyiapkan {count} soal TKA jenjang {level} secara otomatis...</p>
                </div>
              </div>

              <div className="backdrop-blur-xl bg-slate-900/40 border border-slate-800 rounded-2xl p-6 space-y-4">
                <div className="h-4 bg-slate-800 rounded-md w-3/4"></div>
                <div className="h-4 bg-slate-800/60 rounded-md w-1/2"></div>
                <div className="space-y-3 pt-3">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-12 bg-slate-950/60 border border-slate-800/50 rounded-xl w-full"></div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {mode === 'setup' && !loading && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-start">
              
              <div className="lg:col-span-2 backdrop-blur-xl bg-slate-900/60 border border-slate-800/90 rounded-2xl p-4 sm:p-6 md:p-7 shadow-2xl space-y-5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">Konfigurasi Tes Kemampuan Akademik</h2>
                    <p className="text-xs text-slate-400 mt-0.5">Sesuai struktur kurikulum resmi Pusat Asesmen Pendidikan</p>
                  </div>
                  {!profile?.is_pro && user && (
                    <button
                      onClick={() => setShowUpgradeModal(true)}
                      className="text-xs bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black px-3.5 py-2 rounded-xl shadow-lg hover:scale-105 transition cursor-pointer active:scale-95 shrink-0"
                    >
                      👑 Upgrade Pro
                    </button>
                  )}
                </div>

                {error && (
                  <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-400 rounded-xl text-xs font-semibold">
                    ⚠️ {error}
                  </div>
                )}

                <form onSubmit={handleStartExam} className="space-y-4">
                  
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-400">
                      1. Pilih Tingkat Sekolah
                    </label>
                    <div className="grid grid-cols-3 gap-2 p-1.5 bg-slate-950/80 rounded-2xl border border-slate-800">
                      {(['SD', 'SMP', 'SMA/SMK'] as Level[]).map((lvl) => (
                        <button
                          key={lvl}
                          type="button"
                          onClick={() => setLevel(lvl)}
                          className={`py-3 px-2 sm:px-4 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 ${
                            level === lvl
                              ? 'bg-gradient-to-r from-cyan-500 to-teal-500 text-slate-950 font-black shadow-lg shadow-cyan-500/20'
                              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
                          }`}
                        >
                          <span className="text-base sm:text-lg">{lvl === 'SD' ? '🎒' : lvl === 'SMP' ? '📘' : '🎓'}</span>
                          <span>{lvl === 'SD' ? 'SD/MI' : lvl === 'SMP' ? 'SMP/MTs' : 'SMA/SMK/MA'}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {level === 'SMA/SMK' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-400">
                        2. Kelompok Mata Pelajaran
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 p-1.5 bg-slate-950/80 rounded-2xl border border-slate-800">
                        {(['Wajib', 'Saintek', 'Soshum', 'Bahasa/Vokasi'] as SMACategory[]).map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            onClick={() => setSmaCategory(cat)}
                            className={`py-2.5 px-2 rounded-xl font-bold text-xs transition-all cursor-pointer text-center ${
                              smaCategory === cat
                                ? 'bg-cyan-500 text-slate-950 font-black shadow-md'
                                : 'text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-400">
                      {level === 'SMA/SMK' ? '3.' : '2.'} Pilih Mata Pelajaran
                    </label>
                    <select
                      value={subCategory}
                      onChange={(e) => setSubCategory(e.target.value)}
                      className="w-full bg-slate-950/90 border border-slate-700/80 text-slate-100 font-semibold text-xs sm:text-sm rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
                    >
                      {level === 'SD' && (
                        <>
                          <option value="Bahasa Indonesia SD">🇮🇩 Bahasa Indonesia (Literasi Reading & Teks)</option>
                          <option value="Matematika SD">🔢 Matematika (Pemahaman Konsep & Problem Solving)</option>
                        </>
                      )}

                      {level === 'SMP' && (
                        <>
                          <option value="Bahasa Indonesia SMP">🇮🇩 Bahasa Indonesia (Literasi Teks Fiksi & Informasi)</option>
                          <option value="Matematika SMP">🔢 Matematika (Pemahaman Konsep & Problem Solving)</option>
                        </>
                      )}

                      {level === 'SMA/SMK' && smaCategory === 'Wajib' && (
                        <>
                          <option value="Bahasa Indonesia (Wajib)">🇮🇩 Bahasa Indonesia (Wajib)</option>
                          <option value="Matematika (Wajib)">📐 Matematika (Wajib)</option>
                          <option value="Bahasa Inggris (Wajib)">🇬🇧 Bahasa Inggris (Wajib)</option>
                        </>
                      )}

                      {level === 'SMA/SMK' && smaCategory === 'Saintek' && (
                        <>
                          <option value="Matematika Tingkat Lanjut">📐 Matematika Tingkat Lanjut</option>
                          <option value="Fisika">⚡ Fisika</option>
                          <option value="Kimia">🧪 Kimia</option>
                          <option value="Biologi">🧬 Biologi</option>
                        </>
                      )}

                      {level === 'SMA/SMK' && smaCategory === 'Soshum' && (
                        <>
                          <option value="Sosiologi">👥 Sosiologi</option>
                          <option value="Sejarah">🏛️ Sejarah</option>
                          <option value="Geografi">🗺️ Geografi</option>
                          <option value="Ekonomi">📊 Ekonomi</option>
                        </>
                      )}

                      {level === 'SMA/SMK' && smaCategory === 'Bahasa/Vokasi' && (
                        <>
                          <option value="Informatika">💻 Informatika</option>
                          <option value="Prakarya & Kewirausahaan">💡 Prakarya & Kewirausahaan</option>
                          <option value="Bahasa Asing">🌐 Bahasa & Sastra Asing</option>
                        </>
                      )}
                    </select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[11px] font-extrabold uppercase tracking-wider text-cyan-400">
                      {level === 'SMA/SMK' ? '4.' : '3.'} Mode Latihan
                    </label>
                    <select
                      value={count}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        if (val > 5 && !user) {
                          alert('Mode 30/50 Soal memerlukan login.');
                        } else if (val > 5 && !profile?.is_pro) {
                          setShowUpgradeModal(true);
                        } else {
                          setCount(val);
                        }
                      }}
                      className="w-full bg-slate-950/90 border border-slate-700/80 text-slate-100 font-semibold text-xs sm:text-sm rounded-xl px-4 py-3 outline-none focus:ring-2 focus:ring-cyan-500 cursor-pointer"
                    >
                      <option value={5}>⚡ 5 Soal (Quick Test - Free Guest)</option>
                      <option value={30}>
                        📝 30 Soal {profile?.is_pro ? '(Simulasi Standar Pusmendik - ⭐ Pro)' : '(Simulasi Standar - 🔒 Pro)'}
                      </option>
                      <option value={50}>
                        🎯 50 Soal {profile?.is_pro ? '(Simulasi Lengkap TKA - ⭐ Pro)' : '(Simulasi Lengkap - 🔒 Pro)'}
                      </option>
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full bg-gradient-to-r from-cyan-500 via-teal-500 to-emerald-400 hover:from-cyan-400 hover:to-emerald-300 text-slate-950 font-black py-4 px-6 rounded-2xl shadow-xl shadow-cyan-500/20 transition-all text-sm sm:text-base mt-2 active:scale-[0.98] cursor-pointer"
                  >
                    Mulai Simulasi TKA 🚀
                  </button>
                </form>
              </div>

              <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800/90 rounded-2xl p-4 sm:p-5 shadow-2xl flex flex-col h-full min-h-[250px]">
                <h3 className="text-xs sm:text-sm font-bold text-white tracking-tight border-b border-slate-800 pb-3 mb-3 flex items-center justify-between">
                  <span>📜 Riwayat Nilai Ujian</span>
                  <span className="text-[10px] font-normal px-2 py-0.5 bg-slate-800 rounded-full text-slate-400">
                    {history.length} Selesai
                  </span>
                </h3>

                <div className="flex-1 overflow-y-auto max-h-[320px] sm:max-h-[400px] space-y-2 pr-1">
                  {!user ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                      <span className="text-3xl">🔑</span>
                      <p className="text-xs text-slate-400 font-medium leading-relaxed">
                        Login dengan Google untuk menyimpan & melihat riwayat nilaimu.
                      </p>
                    </div>
                  ) : loadingHistory ? (
                    <p className="text-xs text-slate-500 text-center py-6">Memuat data riwayat...</p>
                  ) : history.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-center p-6 space-y-2">
                      <span className="text-3xl">🎯</span>
                      <p className="text-xs text-slate-400 font-medium">Belum ada tes yang kamu selesaikan.</p>
                    </div>
                  ) : (
                    history.map((item) => (
                      <div
                        key={item.id}
                        className="p-3 bg-slate-950/70 border border-slate-800/80 rounded-xl flex items-center justify-between text-xs hover:border-slate-700 transition"
                      >
                        <div className="truncate pr-2">
                          <p className="font-bold text-slate-200 truncate">{item.category}</p>
                          <p className="text-[10px] text-slate-400 mt-0.5">
                            {item.exam_type} • {new Date(item.created_at).toLocaleDateString('id-ID', {
                              day: 'numeric',
                              month: 'short',
                            })}
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={`font-black text-sm sm:text-base ${
                            item.score >= 75 ? 'text-emerald-400' : item.score >= 50 ? 'text-amber-400' : 'text-rose-400'
                          }`}>
                            {item.score}
                          </span>
                          <span className="text-[9px] text-slate-500 block">/ 100</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>
          )}

          {mode === 'exam' && !loading && questions.length > 0 && (
            <div className="space-y-4 max-w-4xl mx-auto w-full">
              
              <div className="backdrop-blur-xl bg-slate-900/80 border border-slate-800 rounded-2xl p-3 sm:px-5 sm:py-3.5 shadow-xl flex justify-between items-center gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 rounded-full">
                    Soal #{currentIdx + 1} dari {questions.length}
                  </span>
                  <span className="text-xs text-slate-400 font-medium hidden sm:inline">{subCategory} ({level})</span>
                </div>

                <div className="text-xs sm:text-sm font-mono font-extrabold bg-amber-500/10 text-amber-400 px-3.5 py-1.5 rounded-xl border border-amber-500/20 flex items-center gap-1.5">
                  ⏱️ <span>{formatTime(timeLeft)}</span>
                </div>
              </div>

              <div className="backdrop-blur-xl bg-slate-900/60 border border-slate-800 rounded-2xl p-5 sm:p-7 shadow-2xl space-y-6">
                <div>
                  {questions[currentIdx].type === 'multiple' && (
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2.5 py-0.5 rounded-full mb-2">
                      ☑️ Pilihan Ganda Kompleks (Pilih beberapa jawaban)
                    </span>
                  )}
                  <p className="text-slate-100 text-sm sm:text-base font-normal leading-relaxed whitespace-pre-line tracking-wide">
                    {questions[currentIdx].question}
                  </p>
                </div>

                <div className="space-y-3">
                  {questions[currentIdx].options.map((opt, oIdx) => {
                    const isMultiple = questions[currentIdx].type === 'multiple';
                    const currentAns = userAnswers[currentIdx];
                    
                    const isSelected = isMultiple
                      ? Array.isArray(currentAns) && currentAns.includes(opt)
                      : currentAns === opt;

                    return (
                      <button
                        key={oIdx}
                        onClick={() => handleSelectAnswer(opt, isMultiple)}
                        className={`w-full text-left p-4 rounded-xl sm:rounded-2xl border text-xs sm:text-sm transition-all duration-150 flex items-center justify-between leading-snug cursor-pointer active:scale-[0.99] ${
                          isSelected
                            ? 'bg-cyan-500/20 border-cyan-500 text-cyan-200 font-semibold ring-2 ring-cyan-500/30'
                            : 'bg-slate-950/50 border-slate-800/90 text-slate-300 hover:bg-slate-800/60'
                        }`}
                      >
                        <span className="pr-3">{opt}</span>
                        {isMultiple ? (
                          <div className={`w-5 h-5 rounded-md border flex items-center justify-center font-black text-xs shrink-0 ${
                            isSelected ? 'bg-cyan-500 border-cyan-500 text-slate-950' : 'border-slate-700'
                          }`}>
                            {isSelected && '✓'}
                          </div>
                        ) : (
                          <div className={`w-5 h-5 rounded-full border flex items-center justify-center font-black text-xs shrink-0 ${
                            isSelected ? 'bg-cyan-500 border-cyan-500 text-slate-950' : 'border-slate-700'
                          }`}>
                            {isSelected && '✓'}
                          </div>
                        )}
                      </button>
                    );
                  })}
                </div>

                <div className="hidden sm:flex justify-between items-center pt-4 border-t border-slate-800">
                  <button
                    disabled={currentIdx === 0}
                    onClick={() => setCurrentIdx(currentIdx - 1)}
                    className="px-5 py-2.5 border border-slate-700/80 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-30 cursor-pointer"
                  >
                    ← Sebelumnya
                  </button>

                  {currentIdx < questions.length - 1 ? (
                    <button
                      onClick={() => setCurrentIdx(currentIdx + 1)}
                      className="px-6 py-2.5 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg shadow-cyan-500/20 cursor-pointer"
                    >
                      Selanjutnya →
                    </button>
                  ) : (
                    <button
                      onClick={handleFinishExam}
                      className="px-6 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl text-xs transition shadow-lg shadow-emerald-500/20 cursor-pointer"
                    >
                      Selesai Ujian 🏁
                    </button>
                  )}
                </div>
              </div>

              <div className="sm:hidden fixed bottom-0 left-0 right-0 p-3 bg-slate-900/95 border-t border-slate-800 backdrop-blur-lg z-40 flex justify-between gap-2">
                <button
                  disabled={currentIdx === 0}
                  onClick={() => setCurrentIdx(currentIdx - 1)}
                  className="flex-1 py-3 border border-slate-700 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800 disabled:opacity-30 cursor-pointer text-center"
                >
                  ←
                </button>

                {currentIdx < questions.length - 1 ? (
                  <button
                    onClick={() => setCurrentIdx(currentIdx + 1)}
                    className="flex-[2] py-3 bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black rounded-xl text-xs transition shadow-md cursor-pointer text-center"
                  >
                    Selanjutnya →
                  </button>
                ) : (
                  <button
                    onClick={handleFinishExam}
                    className="flex-[2] py-3 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-xl text-xs transition shadow-md cursor-pointer text-center"
                  >
                    Selesai 🏁
                  </button>
                )}
              </div>

            </div>
          )}

          {mode === 'result' && !loading && (
            <div className="space-y-6 max-w-4xl mx-auto w-full">
              
              <div className="backdrop-blur-xl bg-gradient-to-br from-slate-900 via-slate-900 to-teal-950/40 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl text-center space-y-4">
                <span className="text-slate-400 font-bold text-xs uppercase tracking-widest">
                  Hasil Simulasi TKA ({level})
                </span>
                <div className="text-5xl sm:text-6xl font-black text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-teal-300 to-emerald-400">
                  {calculateScore()} <span className="text-base sm:text-lg text-slate-500 font-semibold">/ 100</span>
                </div>

                {!user && (
                  <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-300 max-w-lg mx-auto flex items-center gap-3 text-left">
                    <span className="text-2xl shrink-0">💡</span>
                    <div>
                      <span className="font-bold block">Ingin melihat pembahasan & menyimpan riwayat?</span> 
                      Masuk dengan Google secara gratis untuk membuka fitur pembahasan AI!
                    </div>
                  </div>
                )}

                <button
                  onClick={() => setMode('setup')}
                  className="w-full max-w-md bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-3.5 px-6 rounded-xl border border-slate-700 text-xs transition mx-auto block cursor-pointer shadow-lg active:scale-95"
                >
                  🔄 Kembali ke Menu Utama
                </button>
              </div>

              <div className="space-y-4">
                <h3 className="text-xs sm:text-sm font-bold text-slate-200 flex items-center justify-between border-b border-slate-800 pb-3">
                  <span>📖 Review Jawaban & Pembahasan</span>
                  {!user && (
                    <span className="text-[10px] font-semibold px-2.5 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded-full">
                      🔒 Login untuk Buka Pembahasan
                    </span>
                  )}
                </h3>

                {questions.map((q, idx) => {
                  const uAns = userAnswers[idx];
                  let isCorrect = false;

                  if (q.type === 'multiple' && Array.isArray(q.answer) && Array.isArray(uAns)) {
                    isCorrect = q.answer.sort().join(',') === uAns.sort().join(',');
                  } else {
                    isCorrect = uAns === q.answer;
                  }

                  const displayUserAns = Array.isArray(uAns) ? uAns.join(', ') : uAns || 'Tidak Dijawab';
                  const displayKeyAns = Array.isArray(q.answer) ? q.answer.join(', ') : q.answer;

                  return (
                    <div
                      key={idx}
                      className="backdrop-blur-xl bg-slate-900/60 border border-slate-800 rounded-2xl p-5 sm:p-6 space-y-4 shadow-xl"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-xs font-bold text-cyan-400 bg-cyan-500/10 px-3 py-1 rounded-full border border-cyan-500/20">
                          Soal #{idx + 1} {q.type === 'multiple' && '• Kompleks'}
                        </span>
                        <span
                          className={`text-xs font-bold px-3 py-1 rounded-full border ${
                            isCorrect
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                          }`}
                        >
                          {isCorrect ? '✓ Benar' : '✕ Salah / Tidak Diisi'}
                        </span>
                      </div>

                      <p className="text-slate-100 text-xs sm:text-sm font-medium leading-relaxed whitespace-pre-line">
                        {q.question}
                      </p>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs pt-1">
                        <div className={`p-3.5 rounded-xl border ${
                          isCorrect 
                            ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-300' 
                            : 'bg-rose-950/20 border-rose-800/40 text-rose-300'
                        }`}>
                          <span className="font-bold text-slate-400 block mb-1">Jawaban Kamu:</span>
                          <span className="font-semibold">{displayUserAns}</span>
                        </div>

                        <div className="p-3.5 bg-cyan-950/20 border border-cyan-800/40 rounded-xl text-cyan-300">
                          <span className="font-bold text-slate-400 block mb-1">Kunci Jawaban:</span>
                          <span className="font-semibold">{displayKeyAns}</span>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-slate-800/80">
                        {explanations[idx] ? (
                          <div className="p-4 bg-slate-800/50 border border-slate-700/60 rounded-xl space-y-1.5 text-xs text-slate-200">
                            <span className="font-bold text-amber-400 flex items-center gap-1.5">
                              💡 Pembahasan AI:
                            </span>
                            <p className="leading-relaxed whitespace-pre-line text-slate-300">{explanations[idx]}</p>
                          </div>
                        ) : (
                          <button
                            onClick={() => fetchExplanation(idx, q)}
                            disabled={loadingExp[idx]}
                            className={`w-full py-3 px-4 rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 cursor-pointer ${
                              !user
                                ? 'bg-slate-800/80 hover:bg-slate-800 text-amber-300 border border-amber-500/30'
                                : 'bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/40'
                            }`}
                          >
                            {loadingExp[idx] ? (
                              <span>⏳ AI sedang merancang pembahasan...</span>
                            ) : !user ? (
                              <span>🔒 Login Google untuk Buka Pembahasan</span>
                            ) : (
                              <span>✨ Tampilkan Pembahasan Lengkap AI</span>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {showHomeWarningModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl relative border border-slate-800 text-center">
              <div className="w-12 h-12 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto text-amber-400 text-2xl">
                ⚠️
              </div>
              <div className="space-y-1">
                <h3 className="text-base font-black text-white">Batalkan Ujian?</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Ujian kamu sedang berlangsung. Jika kembali ke beranda sekarang, progres ujian akan hilang.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2">
                <button
                  onClick={() => setShowHomeWarningModal(false)}
                  className="w-full bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold py-2.5 rounded-xl transition text-xs cursor-pointer"
                >
                  Lanjutkan
                </button>
                <button
                  onClick={confirmGoHome}
                  className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-2.5 rounded-xl transition text-xs shadow-lg shadow-rose-600/20 cursor-pointer"
                >
                  Ya, Keluar
                </button>
              </div>
            </div>
          </div>
        )}

        {showLoginModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl relative border border-slate-800 text-center">
              <button
                onClick={() => setShowLoginModal(false)}
                className="absolute top-3 right-3 text-slate-400 hover:text-white font-bold text-base cursor-pointer"
              >
                ✕
              </button>
              <div className="space-y-2">
                <span className="text-3xl">🔑</span>
                <h3 className="text-base font-black text-white">Login Gratis untuk Pembahasan</h3>
                <p className="text-xs text-slate-400 leading-relaxed">
                  Dapatkan pembahasan rinci AI dan simpan riwayat nilaimu dengan login akun Google.
                </p>
              </div>
              <button
                onClick={handleGoogleLogin}
                className="w-full bg-white hover:bg-slate-100 text-slate-900 font-bold py-3 rounded-xl shadow-lg transition text-xs flex items-center justify-center gap-2 cursor-pointer"
              >
                Masuk dengan Google
              </button>
            </div>
          </div>
        )}

        {showUpgradeModal && (
          <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl relative border border-slate-800">
              <button
                onClick={() => setShowUpgradeModal(false)}
                className="absolute top-3 right-3 text-slate-400 hover:text-white font-bold text-base cursor-pointer"
              >
                ✕
              </button>
              <div className="text-center space-y-1">
                <span className="bg-amber-500/10 text-amber-400 text-[10px] font-black px-2.5 py-0.5 rounded-full border border-amber-500/20">
                  ⭐ AKSES PRO UNLIMITED
                </span>
                <h3 className="text-lg font-black text-white">Buka Latihan Tanpa Batas!</h3>
              </div>
              <button
                onClick={handlePay}
                disabled={payLoading}
                className="w-full bg-gradient-to-r from-amber-500 to-amber-600 text-slate-950 font-black py-3 rounded-xl shadow-lg transition text-xs disabled:opacity-50 cursor-pointer"
              >
                {payLoading ? 'Memproses...' : 'Unlock Akses Pro (Rp 15.000)'}
              </button>
            </div>
          </div>
        )}

      </div>
    </main>
  );
}