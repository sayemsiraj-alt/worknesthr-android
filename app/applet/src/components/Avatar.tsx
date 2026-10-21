import React, { useState } from 'react';

export function isImageAvatar(avatar?: string | null): boolean {
  if (!avatar || typeof avatar !== 'string') return false;
  const s = avatar.trim();
  return (
    s.startsWith('data:image/') ||
    s.startsWith('data:') ||
    s.startsWith('http://') ||
    s.startsWith('https://') ||
    s.startsWith('blob:') ||
    s.startsWith('/') ||
    s.startsWith('/9j/') ||
    s.startsWith('iVBORw') ||
    (s.length > 50 && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 50)))
  );
}

export function getAvatarImageUrl(avatar?: string | null): string | null {
  if (!avatar || typeof avatar !== 'string') return null;
  const s = avatar.trim();
  if (s.startsWith('data:image/') || s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://') || s.startsWith('blob:') || s.startsWith('/')) {
    if (s.startsWith('/9j/')) return `data:image/jpeg;base64,${s}`;
    return s;
  }
  if (s.startsWith('iVBORw')) {
    return `data:image/png;base64,${s}`;
  }
  if (s.length > 50 && /^[A-Za-z0-9+/=]+$/.test(s.slice(0, 50))) {
    return `data:image/jpeg;base64,${s}`;
  }
  return null;
}

export function getSafeAvatarFallback(avatar?: string | null, name?: string | null, defaultIcon = '👤'): string {
  if (avatar && typeof avatar === 'string') {
    const trimmed = avatar.trim();
    if (trimmed.length > 0 && trimmed.length <= 4) {
      return trimmed;
    }
  }
  if (name && typeof name === 'string' && name.trim().length > 0) {
    return name.trim().charAt(0).toUpperCase();
  }
  return defaultIcon;
}

export interface AvatarProps {
  avatar?: string | null;
  name?: string | null;
  sizeClass?: string;
  textClass?: string;
  bgClass?: string;
  roundedClass?: string;
  className?: string;
  title?: string;
}

export function Avatar({
  avatar,
  name,
  sizeClass = 'w-9 h-9',
  textClass = 'text-sm font-bold',
  bgClass = 'bg-indigo-100 text-indigo-700',
  roundedClass = 'rounded-xl',
  className = '',
  title,
}: AvatarProps) {
  const [hasError, setHasError] = useState(false);
  const imageUrl = !hasError ? getAvatarImageUrl(avatar) : null;
  const fallback = getSafeAvatarFallback(avatar, name);

  if (imageUrl) {
    return (
      <div
        className={`${sizeClass} ${roundedClass} overflow-hidden bg-slate-100 flex items-center justify-center shrink-0 shadow-2xs border border-slate-200/80 ${className}`}
        title={title || name || undefined}
      >
        <img
          src={imageUrl}
          alt={name || 'Avatar'}
          className="w-full h-full object-cover"
          onError={() => setHasError(true)}
        />
      </div>
    );
  }

  return (
    <div
      className={`${sizeClass} ${roundedClass} ${bgClass} flex items-center justify-center ${textClass} shrink-0 shadow-2xs border border-indigo-200/50 overflow-hidden select-none ${className}`}
      title={title || name || undefined}
    >
      {fallback}
    </div>
  );
}
