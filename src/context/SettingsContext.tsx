import { createContext, useContext, useState, ReactNode, useEffect, useCallback } from 'react';

export type Theme =
  | 'light'
  | 'dark'
  | 'aurora'
  | 'forest'
  | 'ocean'
  | 'rose'
  | 'sunset'
  | 'royal'
  | 'auto';

export type AccentColor =
  | 'indigo'
  | 'blue'
  | 'emerald'
  | 'purple'
  | 'pink'
  | 'amber'
  | 'cyan'
  | 'crimson';

export type Language = 'en' | 'bn' | 'hi' | 'ar' | 'es' | 'fr';
export type DateFormatPreference = 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'DD MMM YYYY';
export type NumberFormatPreference = 'south_asian' | 'international' | 'european';

type SettingsContextType = {
  theme: Theme;
  accentColor: AccentColor;
  language: Language;
  dateFormat: DateFormatPreference;
  numberFormat: NumberFormatPreference;
  setTheme: (t: Theme) => void;
  setAccentColor: (c: AccentColor) => void;
  setLanguage: (l: Language) => void;
  setDateFormat: (df: DateFormatPreference) => void;
  setNumberFormat: (nf: NumberFormatPreference) => void;
  t: (text: string) => string;
};

const SettingsContext = createContext<SettingsContextType | null>(null);

const ACCENT_COLORS: Record<AccentColor, { from: string; to: string; ring: string; text: string; light: string; hex: string }> = {
  indigo: { from: 'from-indigo-500', to: 'to-violet-600', ring: 'ring-indigo-500', text: 'text-indigo-600', light: 'bg-indigo-500', hex: '#6366F1' },
  blue: { from: 'from-blue-500', to: 'to-cyan-600', ring: 'ring-blue-500', text: 'text-blue-600', light: 'bg-blue-500', hex: '#2563EB' },
  emerald: { from: 'from-emerald-500', to: 'to-teal-600', ring: 'ring-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-500', hex: '#10B981' },
  purple: { from: 'from-purple-500', to: 'to-fuchsia-600', ring: 'ring-purple-500', text: 'text-purple-600', light: 'bg-purple-500', hex: '#8B5CF6' },
  pink: { from: 'from-pink-500', to: 'to-rose-600', ring: 'ring-pink-500', text: 'text-pink-600', light: 'bg-pink-500', hex: '#EC4899' },
  amber: { from: 'from-amber-500', to: 'to-orange-600', ring: 'ring-amber-500', text: 'text-amber-600', light: 'bg-amber-500', hex: '#D97706' },
  cyan: { from: 'from-cyan-500', to: 'to-sky-600', ring: 'ring-cyan-500', text: 'text-cyan-600', light: 'bg-cyan-500', hex: '#0891B2' },
  crimson: { from: 'from-rose-500', to: 'to-red-600', ring: 'ring-rose-500', text: 'text-rose-600', light: 'bg-rose-500', hex: '#E11D48' },
};

// Comprehensive UI Localization Dictionary (English -> Bengali, Hindi, Arabic, Spanish, French)
export const TRANSLATIONS: Record<string, { bn: string; hi: string; ar?: string; es?: string; fr?: string }> = {
  // Navigation & Page Titles
  'Overview': { bn: 'ওভারভিউ', hi: 'अवलोकन', ar: 'نظرة عامة', es: 'Resumen', fr: 'Aperçu' },
  'People': { bn: 'কর্মী ব্যবস্থাপনা', hi: 'कर्मचारी प्रबंधन', ar: 'الموظفون', es: 'Personas', fr: 'Personnel' },
  'Operations': { bn: 'অপারেশনস', hi: 'संचालन', ar: 'العمليات', es: 'Operaciones', fr: 'Opérations' },
  'Integrations': { bn: 'ইন্টিগ্রেশন', hi: 'एकीकरण', ar: 'التكامل', es: 'Integraciones', fr: 'Intégrations' },
  'Finance': { bn: 'ফাইন্যান্স ও বেতন', hi: 'वित्त और वेतन', ar: 'المالية والرواتب', es: 'Finanzas y Nómina', fr: 'Paie et Finance' },
  'System': { bn: 'সিস্টেম', hi: 'सिस्टम', ar: 'النظام', es: 'Sistema', fr: 'Système' },
  'Dashboard': { bn: 'ড্যাশবোর্ড', hi: 'डैशबोर्ड', ar: 'لوحة القيادة', es: 'Panel Principal', fr: 'Tableau de bord' },
  'Executive Dashboard': { bn: 'এক্সিকিউটিভ ড্যাশবোর্ড', hi: 'कार्यकारी डैशबोर्ड', ar: 'لوحة القيادة التنفيذية', es: 'Panel Ejecutivo', fr: 'Tableau Exécutif' },
  'Global & Multi-Country': { bn: 'গ্লোবাল ও মাল্টি-কান্ট্রি', hi: 'ग्लोबल और मल्टी-कंट्री', ar: 'الإدارة العالمية والكيانات', es: 'Global y Multipaís', fr: 'Global et Multi-Pays' },
  'Enterprise Security': { bn: 'এন্টারপ্রাইজ সিকিউরিটি', hi: 'एंटरप्राइज सुरक्षा', ar: 'أمن المؤسسات والصلاحيات', es: 'Seguridad Empresarial', fr: 'Sécurité Entreprise' },
  'AI HR Intelligence': { bn: 'এআই এইচআর ইন্টেলিজেন্স', hi: 'एआई एचआर इंटेलिजेंस', ar: 'ذكاء الموارد البشرية', es: 'Inteligencia IA RRHH', fr: 'Intelligence RH IA' },
  'Employees': { bn: 'কর্মচারীবৃন্দ', hi: 'कर्मचारी', ar: 'الموظفون', es: 'Empleados', fr: 'Employés' },
  'Employee Management': { bn: 'কর্মচারী ব্যবস্থাপনা', hi: 'कर्मचारी प्रबंधन', ar: 'إدارة الموظفين', es: 'Gestión de Empleados', fr: 'Gestion des Employés' },
  'Departments': { bn: 'ডিপার্টমেন্টসমূহ', hi: 'विभाग', ar: 'الأقسام', es: 'Departamentos', fr: 'Départements' },
  'Department Management': { bn: 'ডিপার্টমেন্ট ব্যবস্থাপনা', hi: 'विभाग प्रबंधन', ar: 'إدارة الأقسام', es: 'Gestión de Departamentos', fr: 'Gestion des Départements' },
  'Shifts': { bn: 'শিফটসমূহ', hi: 'शिफ्ट', ar: 'الورديات', es: 'Turnos', fr: 'Équipes / Horaires' },
  'Shift Management': { bn: 'শিফট ব্যবস্থাপনা', hi: 'शिफ्ट प्रबंधन', ar: 'إدارة الورديات', es: 'Gestión de Turnos', fr: 'Gestion des Horaires' },
  'Roster': { bn: 'ডিউটি রোস্টার', hi: 'ड्यूटी रोस्टर', ar: 'جدول المناوبات', es: 'Cuadrante de Turnos', fr: 'Planning de Service' },
  'Roster & Duty': { bn: 'রোস্টার ও ডিউটি', hi: 'रोस्टर और ड्यूटी', ar: 'جدول المناوبات والدوام', es: 'Turnos y Guardia', fr: 'Planning et Service' },
  'Recruitment': { bn: 'নিয়োগ প্রক্রিয়া', hi: 'भर्ती', ar: 'التوظيف', es: 'Reclutamiento', fr: 'Recrutement' },
  'Attendance': { bn: 'হাজিরা (Attendance)', hi: 'उपस्थिति', ar: 'الحضور والانصراف', es: 'Asistencia', fr: 'Présence' },
  'Attendance & Timesheets': { bn: 'হাজিরা ও টাইমশিট', hi: 'उपस्थिति और टाइमशीट', ar: 'سجل الحضور والدوام', es: 'Asistencia y Planillas', fr: 'Présence et Feuilles de Temps' },
  'Leave': { bn: 'ছুটি ব্যবস্থাপনা', hi: 'छुट्टी', ar: 'الإجازات', es: 'Permisos y Vacaciones', fr: 'Congés' },
  'Leave Requests': { bn: 'ছুটির আবেদনসমূহ', hi: 'छुट्टी के अनुरोध', ar: 'طلبات الإجازة', es: 'Solicitudes de Permiso', fr: 'Demandes de Congé' },
  'Biometric': { bn: 'বায়োমেট্রিক ডিভাইস', hi: 'बायोमेट्रिक', ar: 'أجهزة البصمة', es: 'Biométrico', fr: 'Biométrie' },
  'Biometric Integration': { bn: 'বায়োমেট্রিক ইন্টিগ্রেশন', hi: 'बायोमेट्रिक एकीकरण', ar: 'تكامل أجهزة البصمة', es: 'Integración Biométrica', fr: 'Intégration Biométrique' },
  'Payroll': { bn: 'পে-রোল ও বেতন', hi: 'पेरोल और वेतन', ar: 'الرواتب والأجور', es: 'Nómina', fr: 'Paie' },
  'Payroll & Salaries': { bn: 'পে-রোল ও বেতন বিবরণী', hi: 'पेरोल और वेतन', ar: 'كشوف الرواتب والأجور', es: 'Nómina y Salarios', fr: 'Paie et Salaires' },
  'Reports': { bn: 'রিপোর্ট ও অ্যানালিটিক্স', hi: 'रिपोर्ट और विश्लेषण', ar: 'التقارير والتحليلات', es: 'Informes y Analítica', fr: 'Rapports et Analyses' },
  'Reports & Analytics': { bn: 'রিপোর্ট ও অ্যানালিটিক্স', hi: 'रिपोर्ट और विश्लेषण', ar: 'التقارير والتحليلات', es: 'Informes y Analítica', fr: 'Rapports et Analyses' },
  'Settings': { bn: 'সেটিংস', hi: 'सेटिंग्स', ar: 'الإعدادات', es: 'Configuración', fr: 'Paramètres' },
  'System Settings': { bn: 'সিস্টেম সেটিংস', hi: 'सिस्टम सेटिंग्स', ar: 'إعدادات النظام', es: 'Configuración del Sistema', fr: 'Paramètres Système' },
  'Team Messaging': { bn: 'টিম মেসেজিং', hi: 'टीम मैसेजिंग', ar: 'مراسلة الفريق', es: 'Mensajería de Equipo', fr: 'Messagerie Équipe' },
  'Team Messages': { bn: 'টিম মেসেজ', hi: 'टीम संदेश', ar: 'رسائل الفريق', es: 'Mensajes de Equipo', fr: 'Messages Équipe' },
  'My Profile': { bn: 'আমার প্রোফাইল', hi: 'मेरी प्रोफ़ाइल', ar: 'ملفي الشخصي', es: 'Mi Perfil', fr: 'Mon Profil' },
  'Notifications': { bn: 'নোটিফিকেশন', hi: 'सूचनाएं', ar: 'الإشعارات', es: 'Notificaciones', fr: 'Notifications' },
  'Tenants & SaaS': { bn: 'টেন্যান্ট ও সাবস্ক্রিপশন', hi: 'टेनेंट और SaaS', ar: 'الشركات والاشتراكات', es: 'Inquilinos y Suscripciones', fr: 'Locataires et SaaS' },
  'Tenant & Subscription Management': { bn: 'টেন্যান্ট ও সাবস্ক্রিপশন ব্যবস্থাপনা', hi: 'टेनेंट और सब्सक्रिप्शन प्रबंधन', ar: 'إدارة الشركات والاشتراكات', es: 'Gestión de Suscripciones', fr: 'Gestion des Abonnements' },
  'Workspace': { bn: 'ওয়ার্কস্পেস', hi: 'वर्कस्पेस', ar: 'مساحة العمل', es: 'Espacio de Trabajo', fr: 'Espace de Travail' },

  // Dashboard
  'Total Staff': { bn: 'মোট স্টাফ', hi: 'कुल कर्मचारी', ar: 'إجمالي الموظفين', es: 'Personal Total', fr: 'Effectif Total' },
  'Present Today': { bn: 'আজ উপস্থিত', hi: 'आज उपस्थित', ar: 'الحاضرون اليوم', es: 'Presentes Hoy', fr: 'Présents Aujourd’hui' },
  'On Leave': { bn: 'ছুটিতে আছেন', hi: 'छुट्टी पर', ar: 'في إجازة', es: 'En Permiso', fr: 'En Congé' },
  'Monthly Payroll': { bn: 'মাসিক বেতন (Payroll)', hi: 'मासिक पेरोल', ar: 'الرواتب الشهرية', es: 'Nómina Mensual', fr: 'Paie Mensuelle' },
  'Gross Salary': { bn: 'গ্রস স্যালারি', hi: 'कुल वेतन (Gross)', ar: 'الراتب الإجمالي', es: 'Salario Bruto', fr: 'Salaire Brut' },
  'Live DB': { bn: 'লাইভ ডাটাবেস', hi: 'लाइव डीबी', ar: 'قاعدة بيانات مباشرة', es: 'BD en Vivo', fr: 'Base en Direct' },
  'Real-time': { bn: 'রিয়েল-টাইম', hi: 'रियल-टाइम', ar: 'لحظي', es: 'Tiempo Real', fr: 'Temps Réel' },
  'Weekly Attendance Trend': { bn: 'সাপ্তাহিক হাজিরার প্রবণতা', hi: 'साप्ताहिक उपस्थिति रुझान', ar: 'اتجاه الحضور الأسبوعي', es: 'Tendencia Semanal de Asistencia', fr: 'Tendance Hebdomadaire de Présence' },
  'Past 7 Days': { bn: 'গত ৭ দিন', hi: 'पिछले 7 दिन', ar: 'آخر 7 أيام', es: 'Últimos 7 Días', fr: '7 Derniers Jours' },
  'This Week': { bn: 'এই সপ্তাহ', hi: 'इस सप्ताह', ar: 'هذا الأسبوع', es: 'Esta Semana', fr: 'Cette Semaine' },
  'Last Week': { bn: 'গত সপ্তাহ', hi: 'पिछला सप्ताह', ar: 'الأسبوع الماضي', es: 'Semana Pasada', fr: 'Semaine Dernière' },
  'Present': { bn: 'উপস্থিত', hi: 'उपस्थित', ar: 'حاضر', es: 'Presente', fr: 'Présent' },
  'Quick Module Hub': { bn: 'কুইক মডিউল হাব', hi: 'त्वरित मॉड्यूल हब', ar: 'مركز الوصول السريع', es: 'Acceso Rápido', fr: 'Accès Rapide' },
  'Add Employee': { bn: 'কর্মী যোগ করুন', hi: 'कर्मचारी जोड़ें', ar: 'إضافة موظف', es: 'Añadir Empleado', fr: 'Ajouter un Employé' },
  'Biometric Devices': { bn: 'বায়োমেট্রিক ডিভাইস', hi: 'बायोमेट्रिक उपकरण', ar: 'أجهزة البصمة', es: 'Dispositivos Biométricos', fr: 'Terminaux Biométriques' },
  'Biometric Punch Machine': { bn: 'বায়োমেট্রিক পাঞ্চ মেশিন', hi: 'बायोमेट्रिक पंच मशीन', ar: 'جهاز تسجيل البصمة', es: 'Reloj Biométrico', fr: 'Pointeuse Biométrique' },

  // Settings Tabs & Appearance
  'Configuration Modules': { bn: 'কনফিগারেশন মডিউলসমূহ', hi: 'कॉन्फ़िगरेशन मॉड्यूल', ar: 'وحدات الإعداد', es: 'Módulos de Configuración', fr: 'Modules de Configuration' },
  'Company Profile': { bn: 'কোম্পানি প্রোফাইল', hi: 'कंपनी प्रोफ़ाइल', ar: 'ملف الشركة', es: 'Perfil de Empresa', fr: 'Profil Entreprise' },
  'Appearance & Theme': { bn: 'অ্যাপিয়ারেন্স ও থিম', hi: 'दिखावट और थीम', ar: 'المظهر والسمات', es: 'Apariencia y Tema', fr: 'Apparence et Thème' },
  'Attendance Rules': { bn: 'হাজিরার নিয়মাবলী', hi: 'उपस्थिति नियम', ar: 'قواعد الحضور', es: 'Reglas de Asistencia', fr: 'Règles de Présence' },
  'Leave Policies': { bn: 'ছুটির নীতিমালা', hi: 'छुट्टी की नीतियां', ar: 'سياسات الإجازات', es: 'Políticas de Permisos', fr: 'Politiques de Congés' },
  'Payroll & Salary': { bn: 'পে-রোল ও বেতন কাঠামো', hi: 'पेरोल और वेतन', ar: 'الرواتب والأجور', es: 'Nómina y Salario', fr: 'Paie et Salaire' },
  'ZKTeco Biometric': { bn: 'ZKTeco বায়োমেট্রিক', hi: 'ZKTeco बायोमेट्रिक', ar: 'أجهزة ZKTeco', es: 'Biometría ZKTeco', fr: 'Biométrie ZKTeco' },
  'Firebase Cloud DB': { bn: 'Firebase ক্লাউড ডাটাবেস', hi: 'Firebase क्लाउड डीबी', ar: 'سحابة Firebase', es: 'Base en Nube Firebase', fr: 'Base Cloud Firebase' },
  'Security & Password': { bn: 'সিকিউরিটি ও পাসওয়ার্ড', hi: 'सुरक्षा और पासवर्ड', ar: 'الأمان وكلمة المرور', es: 'Seguridad y Contraseña', fr: 'Sécurité et Mot de Passe' },
  'Admin Roles & RBAC': { bn: 'অ্যাডমিন রোল ও পারমিশন', hi: 'एडमिन ভূমিকা और अनुमतियां', ar: 'أدوار المشرفين والصلاحيات', es: 'Roles y Permisos RBAC', fr: 'Rôles Admin et RBAC' },
  'Backup & Recovery': { bn: 'ব্যাকআপ ও রিকভারি', hi: 'बैकअप और रिकवरी', ar: 'النسخ الاحتياطي والاستعادة', es: 'Copia de Seguridad y Recuperación', fr: 'Sauvegarde et Restauration' },
  'Appearance, Theme & Localization': { bn: 'অ্যাপিয়ারেন্স, থিম এবং ভাষা সেটিংস', hi: 'दिखावट, थीम और भाषा सेटिंग्स', ar: 'المظهر واللغة والتوطين', es: 'Apariencia, Tema e Idioma', fr: 'Apparence, Thème et Langue' },
  'Customize the interface theme mode, accent brand colors, and internationalization language.': {
    bn: 'সফটওয়্যারের সম্পূর্ণ ইন্টারফেস থিম, ব্র্যান্ড অ্যাকসেন্ট কালার এবং ভাষা আপনার পছন্দমতো কাস্টমাইজ করুন।',
    hi: 'सॉफ़्टवेयर इंटरफ़ेस थीम मोड, ब्रांड एक्सेंट रंग और भाषा को अपनी पसंद के अनुसार कस्टमाइज़ करें।',
    ar: 'قم بتخصيص مظهر الواجهة وألوان العلامة التجارية ولغة النظام والتنسيقات المحلية.',
    es: 'Personalice el tema de la interfaz, los colores corporativos y el idioma de internacionalización.',
    fr: 'Personnalisez le thème de l’interface, les couleurs de marque et la langue d’internationalisation.'
  },
  'Theme Mode': { bn: 'থিম মোড (ইন্টারফেস স্টাইল)', hi: 'थीम मोड (इंटरफ़ेस शैली)', ar: 'وضع المظهر', es: 'Modo de Tema', fr: 'Mode de Thème' },
  'Brand Accent Color': { bn: 'ব্র্যান্ড অ্যাকসেন্ট কালার', hi: 'ब्रांड एक्सेंट रंग', ar: 'لون العلامة التجارية', es: 'Color de Acento', fr: 'Couleur d’Accent' },
  'Language (Localization)': { bn: 'ভাষা নির্বাচন (Language)', hi: 'भाषा (लोकलाइज़ेशन)', ar: 'اللغة (التوطين)', es: 'Idioma (Localización)', fr: 'Langue (Localisation)' },
};

export const useSettings = () => {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error('useSettings must be used within SettingsProvider');
  return ctx;
};

export const getAccentColors = (color: AccentColor) => ACCENT_COLORS[color] || ACCENT_COLORS.indigo;

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    try { return (localStorage.getItem('worknest_theme') as Theme) || 'light'; } catch { return 'light'; }
  });

  const [accentColor, setAccentColorState] = useState<AccentColor>(() => {
    try { return (localStorage.getItem('worknest_accent') as AccentColor) || 'indigo'; } catch { return 'indigo'; }
  });

  const [language, setLanguageState] = useState<Language>(() => {
    try { return (localStorage.getItem('worknest_lang') as Language) || 'en'; } catch { return 'en'; }
  });

  const [dateFormat, setDateFormatState] = useState<DateFormatPreference>(() => {
    try { return (localStorage.getItem('worknest_date_format') as DateFormatPreference) || 'DD/MM/YYYY'; } catch { return 'DD/MM/YYYY'; }
  });

  const [numberFormat, setNumberFormatState] = useState<NumberFormatPreference>(() => {
    try { return (localStorage.getItem('worknest_number_format') as NumberFormatPreference) || 'south_asian'; } catch { return 'south_asian'; }
  });

  const t = useCallback((text: string): string => {
    if (!text || language === 'en') return text;
    const entry = TRANSLATIONS[text];
    if (entry) {
      if (language === 'bn') return entry.bn;
      if (language === 'hi') return entry.hi;
      if (language === 'ar') return entry.ar || text;
      if (language === 'es') return entry.es || text;
      if (language === 'fr') return entry.fr || text;
    }
    return text;
  }, [language]);

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    try { localStorage.setItem('worknest_theme', newTheme); } catch {}
    applyTheme(newTheme);
  };

  const setAccentColor = (newAccent: AccentColor) => {
    setAccentColorState(newAccent);
    try { localStorage.setItem('worknest_accent', newAccent); } catch {}
    applyAccent(newAccent);
  };

  const setLanguage = (newLang: Language) => {
    setLanguageState(newLang);
    try { localStorage.setItem('worknest_lang', newLang); } catch {}
    document.documentElement.setAttribute('lang', newLang);
    document.documentElement.setAttribute('data-lang', newLang);
    window.dispatchEvent(new CustomEvent('worknest-lang-change', { detail: newLang }));
  };

  const setDateFormat = (df: DateFormatPreference) => {
    setDateFormatState(df);
    try { localStorage.setItem('worknest_date_format', df); } catch {}
  };

  const setNumberFormat = (nf: NumberFormatPreference) => {
    setNumberFormatState(nf);
    try { localStorage.setItem('worknest_number_format', nf); } catch {}
  };

  // Apply theme to <html> using data-theme and dark class
  const applyTheme = (targetTheme: Theme) => {
    const root = document.documentElement;
    let resolvedTheme = targetTheme;

    if (targetTheme === 'auto') {
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      resolvedTheme = prefersDark ? 'dark' : 'light';
    }

    const isDarkTheme = resolvedTheme === 'dark' || resolvedTheme === 'aurora' || resolvedTheme === 'forest';
    if (isDarkTheme) {
      root.classList.add('dark');
      root.style.colorScheme = 'dark';
    } else {
      root.classList.remove('dark');
      root.style.colorScheme = 'light';
    }

    root.setAttribute('data-theme', resolvedTheme);
    window.dispatchEvent(new CustomEvent('worknest-theme-change', { detail: targetTheme }));
  };

  // Apply accent color to CSS variables and root data-accent attribute
  const applyAccent = (c: AccentColor) => {
    const root = document.documentElement;
    const palette = ACCENT_COLORS[c] || ACCENT_COLORS.indigo;
    root.setAttribute('data-accent', c);
    root.style.setProperty('--accent-primary', palette.hex);
    window.dispatchEvent(new CustomEvent('worknest-accent-change', { detail: c }));
  };

  // Apply on mount and listen for changes
  useEffect(() => {
    applyTheme(theme);
    applyAccent(accentColor);
    document.documentElement.setAttribute('lang', language);
    document.documentElement.setAttribute('data-lang', language);

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (theme === 'auto') applyTheme('auto');
    };
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [theme, accentColor, language]);

  return (
    <SettingsContext.Provider value={{
      theme,
      accentColor,
      language,
      dateFormat,
      numberFormat,
      setTheme,
      setAccentColor,
      setLanguage,
      setDateFormat,
      setNumberFormat,
      t
    }}>
      {children}
    </SettingsContext.Provider>
  );
}
