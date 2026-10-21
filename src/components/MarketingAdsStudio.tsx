import React, { useState, useEffect } from 'react';
import { Page } from '../App';

type Props = {
  onNavigate?: (page: Page) => void;
};

export function MarketingAdsStudio({ onNavigate }: Props) {
  const [activeTab, setActiveTab] = useState<'posters' | 'video' | 'copy' | 'targeting'>('posters');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Video Ad Simulator State
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSceneIdx, setCurrentSceneIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  const scenes = [
    {
      id: 1,
      duration: 5,
      title: 'The Problem: Manual Spreadsheet & Attendance Headaches',
      banglaVoice: 'মাস শেষে কর্মীদের হাজিরা খাতা আর এক্সেল শিট মিলাতে গিয়ে কি আপনারও মাথা নষ্ট অবস্থা?',
      englishSubtitle: 'Tired of matching manual attendance registers and Excel formulas at the end of every month?',
      bgGradient: 'from-slate-900 via-rose-950 to-slate-900',
      icon: '😫',
      badge: 'Scene 1: The Frustration',
      visualBadge: '❌ Manual Register Chaos',
      stats: [
        { label: 'Time Wasted on Excel', value: '15+ Hours/mo' },
        { label: 'Calculation Errors', value: 'High Risk' },
      ],
    },
    {
      id: 2,
      duration: 6,
      title: 'The Solution: WorkNest Enterprise HRMS',
      banglaVoice: 'এখনই সময় আপনার প্রতিষ্ঠানকে স্মার্ট করার! চলে এলো WorkNest HRMS—আপনার অল-ইন-ওয়ান ক্লাউড এইচআর ও পেরোল সলিউশন।',
      englishSubtitle: 'Transform your workforce with WorkNest HRMS — the all-in-one cloud HR & payroll platform.',
      bgGradient: 'from-indigo-950 via-violet-900 to-slate-950',
      icon: '✨',
      badge: 'Scene 2: The Breakthrough',
      visualBadge: '🚀 Modern Cloud HRMS',
      stats: [
        { label: 'Automation', value: '100% Real-Time' },
        { label: 'Cloud Access', value: 'Anytime, Anywhere' },
      ],
    },
    {
      id: 3,
      duration: 7,
      title: 'Hardware Biometric + Remote Camera Punch',
      banglaVoice: 'অফিসের ZKTeco বায়োমেট্রিক মেশিন থেকে শুরু করে ফিল্ড ও রিমোট কর্মীদের সেলফি ক্যামেরা পাঞ্চ—সব উপস্থিতির তথ্য রিয়েল-টাইমে সিঙ্ক হয় ক্লাউডে।',
      englishSubtitle: 'Seamless hardware biometric sync with ZKTeco and remote selfie punch for field employees.',
      bgGradient: 'from-blue-950 via-cyan-950 to-slate-900',
      icon: '📟',
      badge: 'Scene 3: Dual Attendance Engine',
      visualBadge: '⚡ ZKTeco Biometric + GPS Camera',
      stats: [
        { label: 'ZKTeco Hardware', value: 'Direct Cloud Push' },
        { label: '3-Day Late Rule', value: 'Auto-Deduction' },
      ],
    },
    {
      id: 4,
      duration: 6,
      title: '1-Click Automated Salary, Bonus & Deductions',
      banglaVoice: 'ওভারটাইম, লেট কর্তন, উইকেন্ড বোনাস ও ট্যাক্স সমন্বয় করে মাত্র ১-ক্লিকেই তৈরি হয়ে যায় মাসের সম্পূর্ণ ব্যাংক পেরোল শিট!',
      englishSubtitle: 'Instant automated payroll with overtime, late penalties, bonuses, and bank advice sheets.',
      bgGradient: 'from-emerald-950 via-teal-900 to-slate-950',
      icon: '💸',
      badge: 'Scene 4: Automated Payroll',
      visualBadge: '৳ 1-Click Salary Master Sheet',
      stats: [
        { label: 'Payroll Time', value: '< 2 Minutes' },
        { label: 'Accuracy', value: '100% Error-Free' },
      ],
    },
    {
      id: 5,
      duration: 6,
      title: 'Conversational Smart AI Report Engine',
      banglaVoice: 'রয়েছে স্মার্ট AI অ্যাসিস্ট্যান্ট—যা বাংলা ও ইংরেজিতে চ্যাট করলেই দিয়ে দেয় দৈনিক হাজিরা রিপোর্ট ও অফিশিয়াল ওয়ার্নিং চিঠি।',
      englishSubtitle: 'Ask in Bangla or English — the AI Report Bot gives daily reports and official warning letters instantly.',
      bgGradient: 'from-purple-950 via-fuchsia-950 to-slate-900',
      icon: '🤖',
      badge: 'Scene 5: AI Report Assistant',
      visualBadge: '✨ Bangla & English AI Engine',
      stats: [
        { label: 'Daily Attendance', value: 'Instant Date Filter' },
        { label: 'Official HR Letters', value: '1-Click Warning & Docs' },
      ],
    },
    {
      id: 6,
      duration: 5,
      title: 'Limited Time Offer: Book Your Free Live Demo',
      banglaVoice: 'দেরি না করে আজই আপনার কোম্পানির জন্য ফ্রি লাইভ ডেমো নিন এবং উপভোগ করুন ৩০% বিশেষ ডিসকাউন্ট!',
      englishSubtitle: 'Book a free live demo today and get 30% special subscription discount!',
      bgGradient: 'from-indigo-950 via-blue-950 to-slate-950',
      icon: '🎯',
      badge: 'Scene 6: Call To Action',
      visualBadge: '🔥 Special 30% Launch Discount',
      stats: [
        { label: 'Free Live Demo', value: 'Available Now' },
        { label: 'Setup Time', value: 'Same Day Deployment' },
      ],
    },
  ];

  // Auto-play timer for video simulation
  useEffect(() => {
    let interval: any = null;
    if (isPlaying) {
      interval = setInterval(() => {
        setProgress(prev => {
          if (prev >= 100) {
            setIsPlaying(false);
            return 100;
          }
          return prev + 1;
        });
      }, 350); // Total duration ~35 seconds
    }
    return () => clearInterval(interval);
  }, [isPlaying]);

  // Synchronize scene based on progress percentage
  useEffect(() => {
    const totalScenes = scenes.length;
    const sceneIdx = Math.min(
      totalScenes - 1,
      Math.floor((progress / 100) * totalScenes)
    );
    setCurrentSceneIdx(sceneIdx);
  }, [progress]);

  const handleTogglePlay = () => {
    if (progress >= 100) {
      setProgress(0);
      setCurrentSceneIdx(0);
      setIsPlaying(true);
    } else {
      setIsPlaying(!isPlaying);
    }
  };

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 3000);
  };

  const currentScene = scenes[currentSceneIdx];

  const primaryAdText = `ম্যানুয়াল হাজিরা খাতা আর জটিল এক্সেল শিট নিয়ে আর কত সময় নষ্ট করবেন? ⏳

আপনার ছোট, মাঝারি কিংবা বড় যেকোনো প্রতিষ্ঠানের কর্মীদের উপস্থিতি, শিফট শিডিউলিং এবং বেতন ব্যবস্থাপনা এক ক্লিকেই স্বয়ংক্রিয় করতে আজই ব্যবহার শুরু করুন WorkNest HRMS! 💼✨

কেন WorkNest HRMS বেছে নিবেন?
✅ ZKTeco বায়োমেট্রিক মেশিন ক্লাউড লাইভ সিঙ্ক
✅ রিমোট ও ফিল্ড স্টাফদের জন্য ক্যামেরা পাঞ্চিং
✅ ৩ দিন লেটে ১ দিন বেতন কর্তন ও পলিসি ক্যালকুলেশন
✅ ১-ক্লিকেই বোনাস, ওভারটাইম ও ডিডাকশনসহ নিখুঁত পেরোল শিট
✅ কর্মচারীদের জন্য নিজস্ব মোবাইল সেলফ-সার্ভিস পোর্টাল
✅ বাংলা কমান্ডে স্মার্ট AI রিপোর্ট ও ওয়ার্নিং লেটার জেনারেটর

অফিস ম্যানেজমেন্ট হোক নির্ভুল ও প্রযুক্তিবান্ধব।

👉 সীমিত সময়ের জন্য ফ্রি লাইভ ডেমো ও স্পেশাল ৩০% ডিসকাউন্ট অফার পেতে এখনই মেসেজ করুন অথবা ডেমো বুক করুন!`;

  return (
    <div className="space-y-6">
      {/* ========================================================================= */}
      {/* TOP HERO BANNER                                                           */}
      {/* ========================================================================= */}
      <div className="bg-gradient-to-r from-indigo-950 via-violet-950 to-slate-900 rounded-3xl p-6 text-white shadow-xl border border-indigo-500/20 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-indigo-500/10 rounded-full blur-3xl -z-0 pointer-events-none" />
        <div className="relative z-10 flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div className="space-y-2 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 bg-indigo-500/20 border border-indigo-400/30 text-indigo-200 rounded-full text-[11px] font-black uppercase tracking-wider">
                📢 Facebook &amp; Digital Ads Marketing Kit
              </span>
              <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 rounded-lg text-[11px] font-semibold">
                High-Converting SaaS Creatives
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white flex items-center space-x-2">
              <span>🚀</span>
              <span>WorkNest HRMS — Facebook Ads &amp; Marketing Studio</span>
            </h1>
            <p className="text-xs sm:text-sm text-indigo-200 leading-relaxed">
              আপনার সফটওয়্যারটির সাবস্ক্রিপশন বিক্রি ও ক্লায়েন্ট পাওয়ার জন্য প্রস্তুতকৃত **রেডিমেড ফেসবুক অ্যাড পোস্টার**, **ইন্টারেক্টিভ ভিডিও বিজ্ঞাপন**, **বিজ্ঞাপনের ক্যাপশন কপি** এবং **টার্গেটিং গাইড** এখানে এক সাথে পেয়ে যাবেন।
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <a
              href="/ads/worknest_fb_ad_poster.jpg"
              download="WorkNest_Facebook_Ad_Poster_Square.jpg"
              className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs sm:text-sm shadow-md transition-all flex items-center space-x-2 cursor-pointer"
            >
              <span>📥</span>
              <span>পোস্টার ডাউনলোড (Square)</span>
            </a>
            <a
              href="/ads/worknest_banner_ad.jpg"
              download="WorkNest_Facebook_Ad_Banner_16x9.jpg"
              className="px-4 py-2.5 bg-white/10 hover:bg-white/20 text-white font-bold rounded-xl text-xs sm:text-sm border border-white/20 transition-all flex items-center space-x-2 cursor-pointer"
            >
              <span>📥</span>
              <span>ব্যানার ডাউনলোড (16:9)</span>
            </a>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="mt-6 pt-4 border-t border-white/10 flex flex-wrap gap-2">
          {[
            { id: 'posters', label: '🖼️ Facebook Ad Posters (রেডি পোস্টার)', count: '2 Designs' },
            { id: 'video', label: '🎬 Video Ad Player (ভিডিও বিজ্ঞাপন)', count: '35s Animated' },
            { id: 'copy', label: '📝 Ad Copy & Captions (বিজ্ঞাপনের লেখা)', count: 'Ready Copy' },
            { id: 'targeting', label: '🎯 Audience Targeting Guide (টার্গেটিং)', count: 'High ROI' },
          ].map(t => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id as any)}
              className={`px-4 py-2 rounded-xl text-xs sm:text-sm font-bold transition-all cursor-pointer flex items-center space-x-2 ${
                activeTab === t.id
                  ? 'bg-white text-indigo-950 shadow-md'
                  : 'bg-white/10 text-indigo-100 hover:bg-white/20'
              }`}
            >
              <span>{t.label}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-900/40 text-indigo-200">
                {t.count}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* ========================================================================= */}
      {/* TAB 1: FACEBOOK AD POSTERS                                                */}
      {/* ========================================================================= */}
      {activeTab === 'posters' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between bg-white p-4 rounded-2xl border border-slate-200 shadow-2xs">
            <div>
              <h2 className="text-base font-bold text-slate-900">
                Ready-to-Deploy High Definition Ad Posters
              </h2>
              <p className="text-xs text-slate-500">
                এই পোস্টারগুলো ফেসবুক ও ইনস্টাগ্রামে সরাসরি পোস্ট কিংবা স্পন্সরড বুস্ট করার জন্য তৈরি করা হয়েছে।
              </p>
            </div>
            <span className="text-xs font-bold px-3 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full">
              Ultra HD Resolution
            </span>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Poster 1: Square Feed Ad (1:1) */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 bg-indigo-50 text-indigo-700 rounded-full">
                      Format: 1:1 Square (1024x1024)
                    </span>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-1.5">
                      Poster 1: Facebook &amp; Instagram Feed Ad
                    </h3>
                  </div>
                  <span className="text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-md">
                    Top Converting
                  </span>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  মোবাইল ও ল্যাপটপে লাইভ বায়োমেট্রিক উপস্থিতি গ্রাফ, পেরোল ড্যাশবোর্ড এবং আকর্ষণীয় হেডলাইন সহ আধুনিক SaaS এক্সিকিউটিভ ডিজাইন।
                </p>

                {/* Poster Image Container */}
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-950 group shadow-sm aspect-square">
                  <img
                    src="/ads/worknest_fb_ad_poster.jpg"
                    alt="WorkNest HRMS Facebook Feed Ad Poster"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                    <button
                      type="button"
                      onClick={() => setPreviewImage('/ads/worknest_fb_ad_poster.jpg')}
                      className="px-3.5 py-2 bg-white text-slate-900 rounded-xl text-xs font-bold shadow-lg hover:bg-slate-100 cursor-pointer flex items-center space-x-1.5"
                    >
                      <span>🔍</span>
                      <span>বড় করে দেখুন (Fullscreen)</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap gap-2">
                <a
                  href="/ads/worknest_fb_ad_poster.jpg"
                  download="WorkNest_Facebook_Ad_Poster_Square.jpg"
                  className="flex-1 py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold text-center shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <span>📥</span>
                  <span>ডাউনলোড পোস্টার ১ (HD JPG)</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewImage('/ads/worknest_fb_ad_poster.jpg')}
                  className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  প্রিভিউ
                </button>
              </div>
            </div>

            {/* Poster 2: Widescreen Banner Ad (16:9) */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-black uppercase tracking-wider px-2.5 py-1 bg-purple-50 text-purple-700 rounded-full">
                      Format: 16:9 Landscape Banner
                    </span>
                    <h3 className="text-sm sm:text-base font-bold text-slate-900 mt-1.5">
                      Poster 2: Desktop, YouTube &amp; Meta Banner Ad
                    </h3>
                  </div>
                  <span className="text-xs font-bold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-md">
                    Enterprise Look
                  </span>
                </div>

                <p className="text-xs text-slate-600 leading-relaxed">
                  ডুয়াল-মনিটর কর্পোরেট অফিস ড্যাশবোর্ড, বায়োমেট্রিক অ্যাটেনডেন্স, ইনস্ট্যান্ট পেরোল এবং সেলফ-সার্ভিস ফিচার ইনফোগ্রাফিক সহ ব্যানার।
                </p>

                {/* Poster Image Container */}
                <div className="relative rounded-2xl overflow-hidden border border-slate-200 bg-slate-950 group shadow-sm aspect-video">
                  <img
                    src="/ads/worknest_banner_ad.jpg"
                    alt="WorkNest HRMS Facebook Banner Ad"
                    className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-4">
                    <button
                      type="button"
                      onClick={() => setPreviewImage('/ads/worknest_banner_ad.jpg')}
                      className="px-3.5 py-2 bg-white text-slate-900 rounded-xl text-xs font-bold shadow-lg hover:bg-slate-100 cursor-pointer flex items-center space-x-1.5"
                    >
                      <span>🔍</span>
                      <span>বড় করে দেখুন (Fullscreen)</span>
                    </button>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 flex flex-wrap gap-2">
                <a
                  href="/ads/worknest_banner_ad.jpg"
                  download="WorkNest_Facebook_Ad_Banner_16x9.jpg"
                  className="flex-1 py-3 px-4 bg-purple-600 hover:bg-purple-700 text-white rounded-xl text-xs font-bold text-center shadow-xs transition-all flex items-center justify-center space-x-2 cursor-pointer"
                >
                  <span>📥</span>
                  <span>ডাউনলোড ব্যানার ২ (HD JPG)</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewImage('/ads/worknest_banner_ad.jpg')}
                  className="px-4 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold transition-all cursor-pointer"
                >
                  প্রিভিউ
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 2: ANIMATED VIDEO AD PLAYER SIMULATOR                                 */}
      {/* ========================================================================= */}
      {activeTab === 'video' && (
        <div className="space-y-6">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center space-x-2">
                  <span>🎬</span>
                  <span>Interactive 35-Second Video Ad Simulator</span>
                </h3>
                <p className="text-xs text-slate-500">
                  নিচে প্লে (Play) বাটনে ক্লিক করে পুরো ভিডিওটির প্রতিটি দৃশ্যের ভিজ্যুয়াল ও স্ক্রিপ্ট অ্যানিমেশন লাইভ দেখুন:
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleTogglePlay}
                  className={`px-5 py-2.5 rounded-xl text-xs font-bold text-white shadow-md transition-all flex items-center space-x-2 cursor-pointer ${
                    isPlaying ? 'bg-amber-600 hover:bg-amber-700' : 'bg-indigo-600 hover:bg-indigo-700'
                  }`}
                >
                  <span>{isPlaying ? '⏸️ Pause' : progress >= 100 ? '🔄 Replay Video' : '▶️ Play Video Ad'}</span>
                </button>
              </div>
            </div>

            {/* Video Player Box */}
            <div className={`relative rounded-3xl overflow-hidden border border-slate-700 text-white p-6 sm:p-10 shadow-2xl transition-all duration-700 bg-gradient-to-br ${currentScene.bgGradient} min-h-[380px] flex flex-col justify-between`}>
              {/* Scene Indicator & Time Badge */}
              <div className="flex items-center justify-between">
                <span className="px-3 py-1 bg-white/20 backdrop-blur-md rounded-full text-xs font-bold tracking-wider text-white">
                  {currentScene.badge}
                </span>
                <span className="font-mono text-xs font-bold text-indigo-200">
                  {Math.round((progress / 100) * 35)}s / 35s
                </span>
              </div>

              {/* Main Animated Visual Center */}
              <div className="my-auto py-6 text-center space-y-4 max-w-2xl mx-auto">
                <div className="text-6xl animate-bounce">
                  {currentScene.icon}
                </div>
                <div className="inline-block px-4 py-1 rounded-full bg-white/10 backdrop-blur-md border border-white/20 text-xs font-black uppercase text-indigo-200">
                  {currentScene.visualBadge}
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-white leading-tight">
                  {currentScene.title}
                </h2>
                <div className="p-4 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10 text-xs sm:text-sm text-indigo-100 font-medium leading-relaxed">
                  📢 <strong>ভয়েস-ওভার:</strong> &ldquo;{currentScene.banglaVoice}&rdquo;
                </div>
                <p className="text-[11px] text-slate-300 italic">
                  Subtitle: &ldquo;{currentScene.englishSubtitle}&rdquo;
                </p>

                {/* Key Stat Cards */}
                <div className="grid grid-cols-2 gap-3 max-w-md mx-auto pt-2">
                  {currentScene.stats.map((s, idx) => (
                    <div key={idx} className="bg-white/10 p-2.5 rounded-xl border border-white/10">
                      <span className="text-[10px] text-indigo-200 uppercase block">{s.label}</span>
                      <span className="text-sm font-black text-white block">{s.value}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Video Timeline & Scene Jumps */}
              <div className="space-y-2 pt-4">
                <div className="w-full bg-white/20 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-indigo-400 h-full transition-all duration-300 ease-linear rounded-full"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="flex justify-between items-center text-[10px] text-slate-300 font-mono">
                  <span>Scene {currentSceneIdx + 1} of {scenes.length}</span>
                  <div className="flex gap-1.5">
                    {scenes.map((_, idx) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => {
                          setProgress((idx / scenes.length) * 100);
                          setCurrentSceneIdx(idx);
                        }}
                        className={`w-6 h-6 rounded-md text-[10px] font-bold cursor-pointer transition-all ${
                          currentSceneIdx === idx ? 'bg-white text-slate-900' : 'bg-white/20 text-white hover:bg-white/30'
                        }`}
                      >
                        {idx + 1}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* Complete Script Box with 1-Click Copy */}
            <div className="bg-slate-50 rounded-2xl p-4 border border-slate-200 space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-xs text-slate-800 uppercase tracking-wider flex items-center space-x-1.5">
                  <span>📋</span>
                  <span>সম্পূর্ণ ভিডিও অ্যাড স্ক্রিপ্ট (Full Voiceover Text)</span>
                </h4>
                <button
                  type="button"
                  onClick={() =>
                    handleCopy(
                      scenes.map((s, i) => `[দৃশ্য ${i + 1} - ${s.title}]\nভয়েস: "${s.banglaVoice}"\nসাবটাইটেল: "${s.englishSubtitle}"\n`).join('\n'),
                      'script'
                    )
                  }
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-bold cursor-pointer flex items-center space-x-1"
                >
                  <span>{copiedKey === 'script' ? '✓ কপি হয়েছে!' : '📋 সম্পূর্ণ স্ক্রিপ্ট কপি করুন'}</span>
                </button>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2.5">
                {scenes.map((s, i) => (
                  <div key={i} className="p-3 bg-white rounded-xl border border-slate-200 text-xs space-y-1">
                    <span className="font-bold text-indigo-700 block">দৃশ্য {i + 1} ({s.duration} সেকেন্ড):</span>
                    <p className="text-slate-700 font-medium">{s.banglaVoice}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 3: AD COPY & CAPTIONS                                                 */}
      {/* ========================================================================= */}
      {activeTab === 'copy' && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-7 bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900">
                  Primary Ad Caption (বিজ্ঞাপনের মূল লেখা)
                </h3>
                <p className="text-xs text-slate-500">
                  ফেসবুক বিজ্ঞাপনের মূল টেক্সট বক্সে এই লেখাটি ব্যবহার করুন:
                </p>
              </div>
              <button
                type="button"
                onClick={() => handleCopy(primaryAdText, 'primaryText')}
                className="px-3.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center space-x-1 shadow-2xs"
              >
                <span>{copiedKey === 'primaryText' ? '✓ কপি হয়েছে!' : '📋 কপি করুন (Copy)'}</span>
              </button>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-2xl">
              <pre className="text-xs sm:text-sm text-slate-800 whitespace-pre-wrap font-sans leading-relaxed">
                {primaryAdText}
              </pre>
            </div>
          </div>

          <div className="lg:col-span-5 space-y-4">
            {/* Headlines */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center space-x-1.5">
                <span>⚡</span>
                <span>Ad Headlines (বিজ্ঞাপনের শিরোনাম)</span>
              </h4>
              <p className="text-[11px] text-slate-500">
                বিজ্ঞাপনের হেডলাইন ফিল্ডে নিচের যেকোনো ১টি ব্যবহার করুন:
              </p>

              {[
                'WorkNest HRMS — স্মার্ট হাজিরা ও স্বয়ংক্রিয় পেরোল সফটওয়্যার',
                'হাজিরা খাতা ও এক্সেল শিটের দিন শেষ! স্বয়ংক্রিয় করুন আপনার অফিস',
                'ZKTeco বায়োমেট্রিক ও ১-ক্লিক পেরোল মাস্টার শিট • WorkNest HR',
              ].map((h, idx) => (
                <div
                  key={idx}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center justify-between gap-2"
                >
                  <span className="text-xs font-bold text-slate-800">{h}</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(h, `h_${idx}`)}
                    className="px-2.5 py-1 bg-white hover:bg-indigo-50 border border-slate-200 rounded-lg text-[11px] font-bold text-indigo-700 shrink-0 cursor-pointer"
                  >
                    {copiedKey === `h_${idx}` ? '✓' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>

            {/* Description & CTA */}
            <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 flex items-center space-x-1.5">
                <span>🎯</span>
                <span>Description &amp; Call To Action</span>
              </h4>
              <div className="space-y-2 text-xs">
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                  <span className="text-slate-500 block text-[10px] uppercase font-bold">News Feed Description:</span>
                  <span className="font-bold text-slate-800">আজই ফ্রি ডেমো বুক করুন • ৩০% স্পেশাল সাবস্ক্রিপশন অফার!</span>
                </div>
                <div className="p-2.5 bg-slate-50 rounded-xl border border-slate-200 flex justify-between items-center">
                  <span className="text-slate-500 text-[10px] uppercase font-bold">Recommended CTA Button:</span>
                  <span className="font-bold text-indigo-700 bg-indigo-50 px-2.5 py-1 rounded-md">Sign Up / Book Now</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: AUDIENCE TARGETING GUIDE                                           */}
      {/* ========================================================================= */}
      {activeTab === 'targeting' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center text-xl font-bold">
              📍
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Location &amp; Demographics</h3>
            <ul className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <li>• <strong>লোকেশন:</strong> Bangladesh (Dhaka, Chittagong, Sylhet, Gazipur, Narayanganj).</li>
              <li>• <strong>বয়স সীমা:</strong> ২৫ থেকে ৫৫ বছর।</li>
              <li>• <strong>জেন্ডার:</strong> All (পুরুষ ও নারী উভয়ই)।</li>
              <li>• <strong>ডিভাইস:</strong> Mobile &amp; Desktop both.</li>
            </ul>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-purple-50 text-purple-600 flex items-center justify-center text-xl font-bold">
              👔
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Target Job Titles (পেশা)</h3>
            <ul className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <li>• Business Owner / Founder / Co-Founder</li>
              <li>• Chief Executive Officer (CEO)</li>
              <li>• Managing Director (MD)</li>
              <li>• HR Manager / Human Resources Director</li>
              <li>• Chief Operating Officer (COO)</li>
              <li>• General Manager (GM) / Operations Head</li>
            </ul>
          </div>

          <div className="bg-white p-5 rounded-3xl border border-slate-200 shadow-xs space-y-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center text-xl font-bold">
              💡
            </div>
            <h3 className="font-bold text-slate-900 text-sm">Interests &amp; Behaviors</h3>
            <ul className="text-xs text-slate-600 space-y-2 leading-relaxed">
              <li>• Human Resource Management (HRM)</li>
              <li>• Payroll &amp; Compensation</li>
              <li>• Enterprise resource planning (ERP)</li>
              <li>• Small and medium-sized enterprises (SME)</li>
              <li>• Cloud computing &amp; SaaS software</li>
              <li>• Business page admins (Facebook Behavior)</li>
            </ul>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* FULLSCREEN IMAGE PREVIEW MODAL                                            */}
      {/* ========================================================================= */}
      {previewImage && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="relative max-w-4xl w-full bg-slate-900 rounded-3xl overflow-hidden border border-slate-700 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 bg-slate-800/80 border-b border-slate-700 flex items-center justify-between text-white">
              <span className="font-bold text-xs uppercase tracking-wider text-indigo-300">
                Ad Poster Fullscreen HD Preview
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={previewImage}
                  download="WorkNest_Ad_Poster.jpg"
                  className="px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold"
                >
                  📥 Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewImage(null)}
                  className="w-8 h-8 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold flex items-center justify-center cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-center justify-center bg-black/50">
              <img
                src={previewImage}
                alt="Ad Preview Full"
                className="max-h-[75vh] w-auto object-contain rounded-xl shadow-lg"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
